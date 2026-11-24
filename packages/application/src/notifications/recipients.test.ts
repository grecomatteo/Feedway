import { describe, expect, test, vi } from 'vitest'
import type { Tx } from '../ports/tx.js'
import { eligibleUser } from './recipients.js'

// R9 of the tappa 8 review: a group of deliveries, a page of the centre or a batch of the
// outbox asks about the same person again and again. Each row is read once per transaction.

const ORG = '019a8c2e-0000-7000-8000-000000000001'
const USER = '019a8c2e-0000-7000-8000-000000000002'
const WS = ['019a8c2e-0000-7000-8000-00000000000a', '019a8c2e-0000-7000-8000-00000000000b']
const ACCOUNT = '019a8c2e-0000-7000-8000-0000000000ac'

function fakeTx(role: 'manager' | null = 'manager') {
  const reads = {
    findById: vi.fn(() =>
      Promise.resolve({
        id: USER,
        status: 'active',
        anonymizedAt: null,
        platformRole: null,
      }),
    ),
    find: vi.fn(() => Promise.resolve({ status: 'active', role: 'member' })),
    rolesOf: vi.fn(() => Promise.resolve(new Map(role === null ? [] : WS.map((ws) => [ws, role])))),
    listForAccounts: vi.fn(() => Promise.resolve(WS.map((workspaceId) => ({ workspaceId })))),
  }
  const tx = {
    users: { findById: reads.findById },
    orgMembers: { find: reads.find },
    workspaceMembers: { rolesOf: reads.rolesOf },
    workspaceAccounts: { listForAccounts: reads.listForAccounts },
  } as unknown as Tx
  return { tx, reads }
}

const place = (workspaceId: string | null, accountId: string | null = null) => ({
  organizationId: ORG,
  workspaceId,
  accountId,
})

describe('eligibleUser', () => {
  test('thirty rows of one group read the person, the membership and the roles once', async () => {
    const { tx, reads } = fakeTx()
    for (let i = 0; i < 30; i += 1)
      expect(await eligibleUser(tx, USER, place(WS[i % 2] ?? null), ['scheduler'])).not.toBeNull()
    expect(reads.findById).toHaveBeenCalledTimes(1)
    expect(reads.find).toHaveBeenCalledTimes(1)
    expect(reads.rolesOf).toHaveBeenCalledTimes(1)
  })

  test("an account's clients are read once per account", async () => {
    const { tx, reads } = fakeTx()
    for (let i = 0; i < 5; i += 1)
      await eligibleUser(tx, USER, place(null, ACCOUNT), ['workspace_managers'])
    expect(reads.listForAccounts).toHaveBeenCalledTimes(1)
  })

  test('another transaction reads everything again', async () => {
    const first = fakeTx()
    await eligibleUser(first.tx, USER, place(WS[0] ?? null), ['scheduler'])
    const second = fakeTx(null)
    expect(await eligibleUser(second.tx, USER, place(WS[0] ?? null), ['scheduler'])).toBeNull()
    expect(second.reads.findById).toHaveBeenCalledTimes(1)
  })

  test('a read that failed is read again', async () => {
    const { tx, reads } = fakeTx()
    reads.findById.mockImplementationOnce(() => Promise.reject(new Error('gone')))
    await expect(eligibleUser(tx, USER, place(WS[0] ?? null), ['scheduler'])).rejects.toThrow()
    expect(await eligibleUser(tx, USER, place(WS[0] ?? null), ['scheduler'])).not.toBeNull()
  })
})
