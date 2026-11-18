import type { Platform } from '../accounts/accounts.js'
import { DomainError } from '../errors.js'
import { zonedToInstant } from '../time/zoned.js'
import { publishedCaption } from './caption.js'
import { sha256Hex } from './sha256.js'
import { commonRules, type ResolvedDestination, type ResolvedWhen } from './post-rules.js'
import {
  RULE_OPTIONS,
  type CropRect,
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
 * text, but for the spaces at its ends and how its lines are broken. The hex sha256 of that
 * (P3): what `post_targets.fingerprint` keeps, short enough for an index.
 */
export function postFingerprint(accountId: string, sha256s: readonly string[], caption: string) {
  // split, not a regex: the text comes from the request (CodeQL, polynomial regex)
  const text = caption
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ')
  return sha256Hex(JSON.stringify([accountId, sha256s, text]))
}

/** The fingerprint of what a destination publishes; null while a file's sha256 is unknown. */
function fingerprintOf(accountId: string, view: PlatformView): string | null {
  const sha256s = view.media.map((m) => m.media.sha256)
  return sha256s.every((s) => s !== null) ? postFingerprint(accountId, sha256s, view.caption) : null
}

/**
 * The key of each file of the post (Scelta 1 of plan 06): its id, with `:<n>` from the second
 * time the same file comes (D-59). Moving or taking out a file does not move a choice, nor the
 * box of a crop, onto another photo.
 */
export function mediaKeys(media: readonly { mediaId: string }[]): string[] {
  const seen = new Map<string, number>()
  return media.map(({ mediaId }) => {
    const n = (seen.get(mediaId) ?? 0) + 1
    seen.set(mediaId, n)
    return n === 1 ? mediaId : `${mediaId}:${String(n)}`
  })
}

function subjectKey(s: RuleSubject, keys: readonly string[]): string {
  switch (s.kind) {
    case 'post':
    case 'cover':
      return s.kind
    case 'destination':
      return `destination:${s.accountId}`
    case 'media':
      return `media:${keys[s.index] ?? String(s.index)}`
  }
}

/** `keys`: `mediaKeys(draft.media)`, for an outcome about a file. */
export const outcomeKey = (
  f: Pick<RuleFinding, 'code' | 'subject' | 'platform'>,
  keys: readonly string[] = [],
) => [f.code, subjectKey(f.subject, keys), ...(f.platform ? [f.platform] : [])].join(':')

/** The shortest side a box may have, in pixels of the original (D-61). */
export const CROP_MIN_SIDE = 320

/**
 * A box the warning can take (D-61): inside the photo, with the format's proportions (1% of
 * slack for the rounding of the panel), its shortest side at least 320 pixels of the original.
 */
export function isValidCrop(
  crop: CropRect,
  target: { ratio: number; width: number; height: number },
): boolean {
  const { x, y, width, height } = crop
  if (![x, y, width, height].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) return false
  if (width <= 0 || height <= 0 || x + width > 1 + 1e-9 || y + height > 1 + 1e-9) return false
  const w = width * target.width
  const h = height * target.height
  if (Math.min(w, h) < CROP_MIN_SIDE) return false
  return Math.abs(w / h - target.ratio) <= target.ratio * 0.01
}

interface Pass {
  outcomes: RuleOutcome[]
  /** choices with an option their warning does not offer: not applied */
  invalid: RuleChoice[]
  effects: Map<string, Partial<Record<RuleOption, PostEffect>>>
  destinations: DestinationSummary[]
}

function validateChoices(choices: readonly RuleChoice[]): Map<string, RuleChoice> {
  const byKey = new Map<string, RuleChoice>()
  for (const c of choices) {
    if (!(RULE_OPTIONS as readonly string[]).includes(c.option))
      throw new DomainError('VALIDATION', 'unknown option', { key: c.key, option: c.option })
    if (byKey.has(c.key))
      throw new DomainError('VALIDATION', 'two choices for one warning', { key: c.key })
    byKey.set(c.key, c)
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
  choices: ReadonlyMap<string, RuleChoice>,
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

  // once per destination: the sha256 runs on texts up to 70,000 characters
  const fingerprints = new Map<string, string | null>()
  for (const d of destinations) {
    const view = d.account ? views.get(d.account.platform) : undefined
    const rules = d.account ? rulesOf.get(d.account.platform) : undefined
    if (!d.account || !view || !rules) continue
    findings.push(
      ...rules.checkAccount(view, { ...d.account, id: d.accountId }, ctx.history, when.instant),
    )
    const fingerprint = fingerprintOf(d.accountId, view)
    fingerprints.set(d.accountId, fingerprint)
    if (fingerprint !== null) {
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
  const invalid: RuleChoice[] = []
  const effectsByKey = new Map<string, Partial<Record<RuleOption, PostEffect>>>()
  const keys = mediaKeys(draft.media)
  for (const f of findings) {
    const key = outcomeKey(f, keys)
    if (outcomes.has(key)) continue
    const given = choices.get(key)
    // an orphan choice (D-54), a box the format does not take or a box on another option
    // (D-61): the warning stays to be answered, and the report says why
    const valid =
      given !== undefined &&
      f.options?.includes(given.option) === true &&
      (given.option === 'crop'
        ? given.crop === undefined || (f.crop !== undefined && isValidCrop(given.crop, f.crop))
        : given.crop === undefined)
    if (given !== undefined && !valid) invalid.push(given)
    const chosen = valid ? given.option : undefined
    const { effects: fx, crop, ...rest } = f
    outcomes.set(key, {
      ...rest,
      params: f.params ?? {},
      key,
      ...(crop ? { cropRatio: crop.ratio } : {}),
      ...(chosen ? { chosen } : {}),
    })
    if (fx) effectsByKey.set(key, fx)
  }

  const list = [...outcomes.values()]
  return {
    outcomes: list,
    invalid,
    effects: effectsByKey,
    destinations: destinations.map((d) => {
      const view = d.account ? views.get(d.account.platform) : undefined
      return {
        accountId: d.accountId,
        platform: d.account?.platform ?? null,
        format: view?.format ?? null,
        caption: view?.caption ?? '',
        media: view?.media.map((m) => m.index) ?? [],
        fingerprint: fingerprints.get(d.accountId) ?? null,
        outcomeKeys: [],
      }
    }),
  }
}

/** What touches a destination: its own outcomes, its platform's, and those of its files. */
function touches(o: RuleOutcome, d: DestinationSummary): boolean {
  if (o.subject.kind === 'destination') return o.subject.accountId === d.accountId
  if (d.platform === null) return false
  if (o.platform !== undefined && o.platform !== d.platform) return false
  // a file this destination does not publish (left out by a choice) is not its concern
  return o.subject.kind !== 'media' || d.media.includes(o.subject.index)
}

/**
 * D-56: a file no destination publishes after the choices says nothing of its own, only that
 * it does not go out (an information, as the other fixes). Only when some destination goes out:
 * with none, the block of the destinations says it.
 */
function withoutUnusedMedia(
  draft: PostDraft,
  outcomes: RuleOutcome[],
  destinations: readonly DestinationSummary[],
): RuleOutcome[] {
  const going = destinations.filter((d) => d.format !== null)
  if (going.length === 0) return outcomes
  const used = new Set(going.flatMap((d) => d.media))
  const unused = draft.media.flatMap((_, index) => (used.has(index) ? [] : [index]))
  if (unused.length === 0) return outcomes
  const keys = mediaKeys(draft.media)
  const kept = outcomes.filter((o) => o.subject.kind !== 'media' || used.has(o.subject.index))
  return [
    ...kept,
    ...unused.map((index): RuleOutcome => {
      const finding = { code: 'media_unused', subject: { kind: 'media', index } } as const
      return { level: 'fix', ...finding, params: {}, key: outcomeKey(finding, keys) }
    }),
  ]
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
  const outcomes = withoutUnusedMedia(
    draft,
    [...pass.outcomes, ...applied.filter((o) => !keys.has(o.key))],
    pass.destinations,
  )

  const unresolved = outcomes.filter((o) => o.level === 'warning' && !o.chosen).map((o) => o.key)
  return {
    outcomes,
    destinations: pass.destinations.map((d) => ({
      ...d,
      outcomeKeys: outcomes.filter((o) => touches(o, d)).map((o) => o.key),
    })),
    postKeys: outcomes.filter((o) => o.subject.kind !== 'destination').map((o) => o.key),
    unresolved,
    // of the last pass: a warning a choice took away says nothing of its own choices
    invalidChoices: pass.invalid,
    canSchedule: unresolved.length === 0 && !outcomes.some((o) => o.level === 'block'),
    scheduledAt: when.scheduled ? when.instant : null,
    adjustment: when.adjustment,
  }
}
