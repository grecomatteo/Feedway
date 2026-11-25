import { expect, test } from 'vitest'
import { recipientsFor, type RecipientFacts } from './recipients.js'

const facts: RecipientFacts = {
  schedulers: ['ada'],
  workspaceManagers: ['bea', 'ada'],
  workspacePreparers: ['fede', 'carla'],
  initiators: ['gino'],
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

test('who prepares the plan is one rule, Owner and Admin included in its facts', () => {
  expect(recipientsFor(['workspace_preparers'], facts)).toEqual([
    { userId: 'fede', as: ['workspace_preparers'] },
    { userId: 'carla', as: ['workspace_preparers'] },
  ])
})

test('who started an import in bulk is a rule of its own (plan 09 Task 10)', () => {
  expect(recipientsFor(['initiator'], facts)).toEqual([{ userId: 'gino', as: ['initiator'] }])
})

test('a rule with nobody behind it gives nobody', () => {
  expect(recipientsFor(['scheduler'], { ...facts, schedulers: [] })).toEqual([])
})
