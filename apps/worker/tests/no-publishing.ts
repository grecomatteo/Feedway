import type { JobHandlerDeps } from '../src/job-handler.js'

/** For the handlers that never publish: any use is a bug of the test. */
export const NO_PUBLISHING: JobHandlerDeps['publishing'] = {
  publishers: {},
  platformRules: new Map(),
  publishingHistory: {
    forDestinations: () => Promise.reject(new Error('not used')),
  },
  publicUrl: null,
  copiesKeptDays: 7,
}
