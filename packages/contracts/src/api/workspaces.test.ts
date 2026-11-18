import { expect, test } from 'vitest'
import { renameWorkspaceRoute } from './workspaces.js'

const body = renameWorkspaceRoute.request.body

test('a change of a workspace carries one field at a time, the time as HH:MM or null', () => {
  expect(body.safeParse({ name: 'Forno' }).success).toBe(true)
  expect(body.safeParse({ defaultPostTime: '18:30' }).success).toBe(true)
  expect(body.safeParse({ defaultPostTime: null }).success).toBe(true)
  expect(body.safeParse({ name: 'Forno', defaultPostTime: '18:30' }).success).toBe(false)
  expect(body.safeParse({}).success).toBe(false)
  expect(body.safeParse({ defaultPostTime: '25:00' }).success).toBe(false)
})
