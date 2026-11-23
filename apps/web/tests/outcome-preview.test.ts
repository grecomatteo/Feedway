import { describe, expect, test } from 'vitest'
import { outcomeTabs, type OutcomeVersion } from '../app/utils/outcome-preview.ts'

// The versions of the page of the outcome (plan 08 Task 10): one per account only when the
// accounts of a tab received different things.

const file = (mediaId: string, copyId: string | null = `${mediaId}-copy`) => ({
  mediaId,
  kind: 'image' as const,
  copyId,
  width: 1080,
  height: 1350,
})

const version = (accountId: string, over: Partial<OutcomeVersion> = {}): OutcomeVersion => ({
  accountId,
  platform: 'instagram',
  format: 'feed_carousel',
  caption: 'Il pane di oggi',
  files: [file('a'), file('b')],
  cover: null,
  ...over,
})

describe('outcomeTabs', () => {
  test('a tab for each way it went out, in the order of the editor', () => {
    const tabs = outcomeTabs([
      version('fb', { platform: 'facebook', format: 'photo' }),
      version('ig'),
    ])
    expect(tabs).toEqual([
      { view: 'instagram_feed', accountIds: ['ig'], differ: false },
      { view: 'facebook_post', accountIds: ['fb'], differ: false },
    ])
  })

  test('two accounts that received the same post are one version', () => {
    const [tab] = outcomeTabs([version('ig1'), version('ig2')])
    expect(tab?.accountIds).toEqual(['ig1', 'ig2'])
    expect(tab?.differ).toBe(false)
  })

  test('another text, a photo left out or another copy: a version for each account', () => {
    for (const other of [
      { caption: 'Il pane di oggi #forno' },
      { files: [file('a')] },
      { files: [file('a'), file('b', 'b-cropped')] },
    ]) {
      const [tab] = outcomeTabs([version('ig1'), version('ig2', other)])
      expect(tab?.differ, JSON.stringify(other)).toBe(true)
    }
  })

  test("a reel's cover counts: another frame is another version", () => {
    const reel = (accountId: string, offsetMs: number) =>
      version(accountId, {
        format: 'reel',
        files: [{ ...file('v'), kind: 'video' }],
        cover: { mediaId: 'v', copyId: null, offsetMs },
      })
    expect(outcomeTabs([reel('ig1', 0), reel('ig2', 0)])[0]?.differ).toBe(false)
    expect(outcomeTabs([reel('ig1', 0), reel('ig2', 1500)])[0]?.differ).toBe(true)
  })

  test('an account the post cannot go to as anything has no tab', () => {
    expect(outcomeTabs([version('x', { format: '' })])).toEqual([])
  })
})
