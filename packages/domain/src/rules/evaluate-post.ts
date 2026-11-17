import type { Platform } from '../accounts/accounts.js'
import { DomainError } from '../errors.js'
import { zonedToInstant } from '../time/zoned.js'
import { publishedCaption } from './caption.js'
import { commonRules, type ResolvedDestination, type ResolvedWhen } from './post-rules.js'
import {
  RULE_OPTIONS,
  type DestinationSummary,
  type PlatformRules,
  type PlatformView,
  type PostDraft,
  type PostEffect,
  type PostWhen,
  type RuleChoice,
  type RuleContext,
  type RuleFinding,
  type RuleOption,
  type RuleOutcome,
  type RuleReport,
  type RuleSubject,
} from './types.js'

// The engine of the checks before scheduling (spec §9.2, plan 05 Task 1). Pure: everything
// comes from the draft and the context. Order: the choices are validated, the common rules
// and the rules of each destination's platform run, the choices that change the post are
// applied, and the post is evaluated once more. Two passes at most: the second applies no
// choice of its own, so a choice never sets off another.

/** The instant of the post; `checkPost` uses it for the windows of the history. */
export function resolveWhen(when: PostWhen, now: Date, timeZone: string): ResolvedWhen {
  if (when.mode === 'now') return { instant: now, adjustment: 'none', scheduled: false }
  return { ...zonedToInstant(when.localDate, when.localTime, timeZone), scheduled: true }
}

/**
 * Two posts are the same on an account (D-50): the same files in the same order and the same
 * text, but for the spaces at its ends and how its lines are broken.
 */
export function postFingerprint(accountId: string, sha256s: readonly string[], caption: string) {
  const text = caption.trim().replace(/\s*\n\s*/g, ' ')
  return JSON.stringify([accountId, sha256s, text])
}

function subjectKey(s: RuleSubject): string {
  switch (s.kind) {
    case 'post':
    case 'cover':
      return s.kind
    case 'destination':
      return `destination:${s.accountId}`
    case 'media':
      return `media:${String(s.index)}`
  }
}

export const outcomeKey = (f: Pick<RuleFinding, 'code' | 'subject' | 'platform'>) =>
  [f.code, subjectKey(f.subject), ...(f.platform ? [f.platform] : [])].join(':')

interface Pass {
  outcomes: RuleOutcome[]
  effects: Map<string, Partial<Record<RuleOption, PostEffect>>>
  destinations: DestinationSummary[]
}

function validateChoices(choices: readonly RuleChoice[]): Map<string, RuleOption> {
  const byKey = new Map<string, RuleOption>()
  for (const c of choices) {
    if (!(RULE_OPTIONS as readonly string[]).includes(c.option))
      throw new DomainError('VALIDATION', 'unknown option', { key: c.key, option: c.option })
    if (byKey.has(c.key))
      throw new DomainError('VALIDATION', 'two choices for one warning', { key: c.key })
    byKey.set(c.key, c.option)
  }
  return byKey
}

function applyEffects(
  platform: Platform,
  draft: PostDraft,
  rules: PlatformRules,
  effects: readonly PostEffect[],
): { view: Omit<PlatformView, 'format'>; format: string | null } {
  let media = draft.media.map((m, index) => ({ index, media: m }))
  let format: string | null = null
  for (const e of effects) {
    if (e.platform !== platform) continue
    if (e.kind === 'keep_media') media = media.filter((m) => e.indices.includes(m.index))
    if (e.kind === 'format') format = e.format
  }
  return {
    view: {
      platform,
      type: draft.type,
      media,
      caption: publishedCaption(draft, platform),
      cover: draft.type === 'reel' ? draft.cover : undefined,
      shareToFeed: draft.shareToFeed,
    },
    format:
      format ??
      rules.format(
        draft.type,
        media.map((m) => m.media),
      ),
  }
}

function runPass(
  draft: PostDraft,
  ctx: RuleContext,
  when: ResolvedWhen,
  choices: ReadonlyMap<string, RuleOption>,
  effects: readonly PostEffect[],
): Pass {
  const skipped = new Set(effects.flatMap((e) => (e.kind === 'skip_platform' ? [e.platform] : [])))
  const ids = [...new Set(draft.destinations.map((d) => d.accountId))]
  const destinations: ResolvedDestination[] = ids.flatMap((accountId) => {
    const found = ctx.accounts.get(accountId)
    const account = found?.inWorkspace ? found : null
    if (account && skipped.has(account.platform)) return []
    return [{ accountId, account, hasRules: account ? ctx.platforms.has(account.platform) : false }]
  })

  const findings: RuleFinding[] = []
  const views = new Map<Platform, PlatformView>()
  const rulesOf = new Map<Platform, PlatformRules>()
  for (const platform of new Set(
    destinations.flatMap((d) => (d.account ? [d.account.platform] : [])),
  )) {
    const rules = ctx.platforms.get(platform)
    if (!rules) continue
    const { view, format } = applyEffects(platform, draft, rules, effects)
    if (format === null) {
      findings.push({
        level: 'block',
        code: 'type_not_supported',
        subject: { kind: 'post' },
        platform,
        params: { platform, type: draft.type },
      })
      continue
    }
    const full = { ...view, format }
    views.set(platform, full)
    rulesOf.set(platform, rules)
    findings.push(...rules.checkPost(full))
  }
  findings.unshift(...commonRules(draft, ctx, when, destinations, new Set(views.keys())))

  for (const d of destinations) {
    const view = d.account ? views.get(d.account.platform) : undefined
    const rules = d.account ? rulesOf.get(d.account.platform) : undefined
    if (!d.account || !view || !rules) continue
    findings.push(...rules.checkAccount(view, { ...d.account, id: d.accountId }, ctx.history))
    const sha256s = view.media.map((m) => m.media.sha256)
    if (sha256s.every((s) => s !== null)) {
      const fingerprint = postFingerprint(d.accountId, sha256s, view.caption)
      if (ctx.history.recentFingerprints.get(d.accountId)?.has(fingerprint))
        findings.push({
          level: 'warning',
          code: 'duplicate_post',
          subject: { kind: 'destination', accountId: d.accountId },
          platform: view.platform,
          params: { platform: view.platform },
          options: ['accept'],
          recommended: 'accept',
        })
    }
  }

  // the rules Instagram and Facebook share give the same key: one is kept
  const outcomes = new Map<string, RuleOutcome>()
  const effectsByKey = new Map<string, Partial<Record<RuleOption, PostEffect>>>()
  for (const f of findings) {
    const key = outcomeKey(f)
    if (outcomes.has(key)) continue
    const chosen = choices.get(key)
    if (chosen !== undefined && !f.options?.includes(chosen))
      throw new DomainError('VALIDATION', 'option not allowed for this warning', {
        key,
        option: chosen,
      })
    const { effects: fx, ...rest } = f
    outcomes.set(key, { ...rest, params: f.params ?? {}, key, ...(chosen ? { chosen } : {}) })
    if (fx) effectsByKey.set(key, fx)
  }

  const list = [...outcomes.values()]
  return {
    outcomes: list,
    effects: effectsByKey,
    destinations: destinations.map((d) => {
      const view = d.account ? views.get(d.account.platform) : undefined
      const platform = d.account?.platform ?? null
      return {
        accountId: d.accountId,
        platform,
        format: view?.format ?? null,
        caption: view?.caption ?? '',
        media: view?.media.map((m) => m.index) ?? [],
        outcomes: list.filter((o) =>
          o.subject.kind === 'destination'
            ? o.subject.accountId === d.accountId
            : platform !== null && (o.platform === undefined || o.platform === platform),
        ),
      }
    }),
  }
}

export function evaluatePost(draft: PostDraft, ctx: RuleContext): RuleReport {
  const choices = validateChoices(draft.choices)
  const when = resolveWhen(draft.when, ctx.now, ctx.timeZone)
  const first = runPass(draft, ctx, when, choices, [])

  const applied: RuleOutcome[] = []
  const effects: PostEffect[] = []
  for (const o of first.outcomes) {
    const effect = o.chosen ? first.effects.get(o.key)?.[o.chosen] : undefined
    if (!effect) continue
    applied.push(o)
    effects.push(effect)
  }
  const pass = effects.length > 0 ? runPass(draft, ctx, when, choices, effects) : first
  // a warning whose choice changed the post stays in the report, with its choice
  const keys = new Set(pass.outcomes.map((o) => o.key))
  const outcomes = [...pass.outcomes, ...applied.filter((o) => !keys.has(o.key))]

  const unresolved = outcomes.filter((o) => o.level === 'warning' && !o.chosen).map((o) => o.key)
  return {
    outcomes,
    destinations: pass.destinations,
    post: outcomes.filter((o) => o.subject.kind !== 'destination'),
    unresolved,
    canSchedule: unresolved.length === 0 && !outcomes.some((o) => o.level === 'block'),
    scheduledAt: when.scheduled ? when.instant : null,
    adjustment: when.adjustment,
  }
}
