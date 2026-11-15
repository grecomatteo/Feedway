import type { ModuleDefinition } from '../module-definition.js'

/** The files of the workspaces and their library (spec §11.1, §11.8; plan 04). */
export const mediaModule: ModuleDefinition = {
  name: 'media',
  permissions: ['media.upload'],
  queues: ['media.delete_files'],
}
