import { describe, expect, test } from 'vitest'
import { activityOf, type ActivityDto } from './outcome.js'

const entry = (over: Partial<ActivityDto>): ActivityDto => ({
  at: '2026-11-23T10:00:00.000Z',
  kind: 'post.target_failed',
  actorName: null,
  accountId: 'ig',
  errorCode: 'too_late',
  ...over,
})

describe('activityOf (D-120.8)', () => {
  test('a failure with no call is told by the worker’s entry, with its code', () => {
    expect(activityOf([entry({})], [])).toEqual([entry({})])
  })

  test('a refusal told by its call: the worker’s entry of the same moment is left out', () => {
    const call = entry({
      kind: 'target.failed',
      errorCode: 'meta_rejected',
      at: '2026-11-23T10:00:20.000Z',
    })
    const logged = entry({ errorCode: 'meta_rejected' })
    expect(activityOf([logged], [call])).toEqual([call])
  })

  test('another account, another code or another moment: both are told', () => {
    const call = entry({ kind: 'target.failed', errorCode: 'meta_rejected' })
    const others = [
      entry({ errorCode: 'meta_rejected', accountId: 'fb' }),
      entry({ errorCode: 'too_late' }),
      entry({ errorCode: 'meta_rejected', at: '2026-11-23T10:05:00.000Z' }),
    ]
    expect(activityOf(others, [call])).toEqual([...others, call])
  })
})
