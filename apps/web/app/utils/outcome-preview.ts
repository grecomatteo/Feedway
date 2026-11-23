import type { PostOutcomeResponse } from '@app/contracts'
import { previewTabs, type PreviewView } from './post-preview.ts'

// The versions of the page of the outcome (plan 08 Task 10, D-120 request 1): the post as each
// account received it, in the editor's tabs. Accounts of the same tab that received the same
// thing are one version; when they differ (a text for each platform, a photo left out, another
// copy of the reel) each account is its own, chosen as in the editor.

export type OutcomeVersion = NonNullable<PostOutcomeResponse['preview']>['versions'][number]

export interface OutcomeTab {
  view: PreviewView
  /** the accounts of the tab, in the order of the destinations */
  accountIds: string[]
  /** the accounts received different things: one version for each, chosen by account */
  differ: boolean
}

/** What a version shows: two accounts with the same one show the same post. */
export function versionSignature(v: OutcomeVersion): string {
  return JSON.stringify([
    v.format,
    v.caption,
    v.files.map((f) => f.copyId ?? f.mediaId),
    v.cover && [v.cover.copyId ?? v.cover.mediaId, v.cover.offsetMs],
  ])
}

export function outcomeTabs(versions: readonly OutcomeVersion[]): OutcomeTab[] {
  const byId = new Map(versions.map((v) => [v.accountId, v]))
  return previewTabs(versions).map((tab) => {
    const signatures = new Set(
      tab.accountIds.flatMap((id) => {
        const v = byId.get(id)
        return v ? [versionSignature(v)] : []
      }),
    )
    return { ...tab, differ: signatures.size > 1 }
  })
}
