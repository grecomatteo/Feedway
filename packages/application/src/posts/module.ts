import type { ModuleDefinition } from '../module-definition.js'

/**
 * The posts of the workspaces: drafts, scheduling, back to draft, cancelling (spec §9.1,
 * §11.2, §11.9; plan 06). It owns the permissions of the posts; the checks before scheduling
 * are of `rules`, which it calls. No queue in stage 6.
 */
export const postsModule: ModuleDefinition = {
  name: 'posts',
  permissions: ['post.draft', 'post.publish', 'post.manage_others'],
  queues: [],
}
