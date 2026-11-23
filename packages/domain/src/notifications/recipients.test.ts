import { expect, test } from 'vitest'
import { recipientsFor, type RecipientFacts } from './recipients.js'

const facts: RecipientFacts = {
  schedulers: ['ada'],
  workspaceManagers: ['bea', 'ada'],
  orgAdmins: ['carla', 'dino'],
  platformAdmins: ['eva'],
}

test('each rule picks its people, and a person in two rules is listed once with both', () => {
  expect(recipientsFor(['scheduler', 'workspace_managers'], facts)).toEqual([
    { userId: 'ada', as: ['scheduler', 'workspace_managers'] },
    { userId: 'bea', as: ['workspace_managers'] },
  ])
  expect(recipientsFor(['org_admins'], facts)).toEqual([
    { userId: 'carla', as: ['org_admins'] },
    { userId: 'dino', as: ['org_admins'] },
  ])
  expect(recipientsFor(['platform_admins'], facts)).toEqual([
    { userId: 'eva', as: ['platform_admins'] },
  ])
})

test('a rule with nobody behind it gives nobody', () => {
  expect(recipientsFor(['scheduler'], { ...facts, schedulers: [] })).toEqual([])
})
