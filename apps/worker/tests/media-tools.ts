import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobHandlerDeps } from '../src/job-handler.js'
import {
  createAdvisoryLock,
  createMediaScratch,
  createMediaTools,
  newPublicToken,
  PLATFORM_RULES,
  type Runtime,
} from '@app/infrastructure'
import { photoMaxBytesOf } from '@app/domain'

/** The limits of the installation by default (ADR 021). */
export const MEDIA_LIMITS: JobHandlerDeps['media']['limits'] = {
  maxImageBytes: 50_000_000,
  maxImagePixels: 50_000_000,
  maxVideoBytes: 300_000_000,
  maxVideoSeconds: 900,
  maxVideoPixels: 4096 * 4096,
  workspaceMaxBytes: null,
  photoMaxBytes: photoMaxBytesOf(PLATFORM_RULES),
}

const unused = () => Promise.reject(new Error('media tools not used in this test'))

/** For handlers that never touch the files of the library. */
export const unusedMediaTools: JobHandlerDeps['media'] = {
  lock: { tryRun: unused },
  scratch: { open: unused, sweep: unused },
  probe: { analyze: unused },
  transformer: {
    photo: unused,
    master: unused,
    thumbnail: unused,
    videoPreview: unused,
    videoReel: unused,
    videoFrame: unused,
    videoFit: unused,
    videoStill: unused,
  },
  newPublicToken,
  limits: MEDIA_LIMITS,
}

/** ffmpeg, ffprobe and sharp for real, a work folder of the test's own, the runtime's lock. */
export function mediaToolsFor(
  runtime: Pick<Runtime, 'pool'>,
  overrides: Partial<JobHandlerDeps['media']> = {},
): JobHandlerDeps['media'] {
  return {
    ...createMediaTools(),
    lock: createAdvisoryLock(runtime.pool),
    scratch: createMediaScratch({ dir: mkdtempSync(join(tmpdir(), 'media-work-')) }),
    newPublicToken,
    limits: MEDIA_LIMITS,
    ...overrides,
  }
}
