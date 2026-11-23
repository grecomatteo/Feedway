import { postKind } from './notification-messages.js'
import type { ModuleDefinition } from '../module-definition.js'

/**
 * The posts of the workspaces: drafts, scheduling, back to draft, cancelling (spec §9.1,
 * §11.2, §11.9; plan 06). It owns the permissions of the posts; the checks before scheduling
 * are of `rules`, which it calls. No queue in stage 6.
 */
export const postsModule: ModuleDefinition = {
  name: 'posts',
  permissions: ['post.draft', 'post.publish', 'post.manage_others', 'post.retry'],
  queues: [
    'target.prepare',
    'target.publish',
    'target.reconcile',
    'target.verify',
    'scheduler.reconcile',
  ],
  // plan 08, Scelta 4: «who scheduled» is `posts.scheduled_by`
  notificationKinds: [
    postKind({
      type: 'post.target_confirmed',
      level: 'info',
      recipients: ['scheduler'],
      defaultChannels: ['panel'],
    }),
    postKind({
      type: 'post.confirmed',
      level: 'success',
      recipients: ['scheduler'],
      defaultChannels: ['panel', 'telegram'],
    }),
    postKind({
      type: 'post.target_failed',
      level: 'error',
      recipients: ['scheduler', 'workspace_managers'],
      defaultChannels: ['panel', 'telegram', 'email'],
    }),
    postKind({
      type: 'post.target_problem',
      level: 'error',
      recipients: ['scheduler', 'workspace_managers'],
      defaultChannels: ['panel', 'telegram', 'email'],
    }),
    postKind({
      type: 'post.file_wont_publish',
      level: 'error',
      recipients: ['scheduler', 'workspace_managers'],
      defaultChannels: ['panel', 'telegram', 'email'],
      alwaysEmail: 'scheduler',
    }),
    postKind({
      type: 'post.paused',
      level: 'warning',
      recipients: ['workspace_managers'],
      defaultChannels: ['panel', 'telegram'],
    }),
  ],
}
