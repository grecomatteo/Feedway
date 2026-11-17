import type { ModuleDefinition } from '../module-definition.js'

/**
 * The checks before scheduling (spec §9.2, plan 05). It uses `post.draft`, which the `posts`
 * module of stage 6 will own; it has no permission, queue or personal data of its own.
 */
export const rulesModule: ModuleDefinition = {
  name: 'rules',
  permissions: [],
  queues: [],
}
