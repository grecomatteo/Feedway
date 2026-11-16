import type { MediaTurn } from '../ports/media.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

// The one read of `media.process` across the agencies (ADR 021, approved by Matteo): which file
// comes next, at its agency's turn. Ids only; the file is then processed in its own agency's
// scope. Listed in the ESLint rule on `runAsSystem`.

export function nextMediaTurn(uow: UnitOfWork): Promise<MediaTurn | null> {
  return uow.runAsSystem('media.process: next file at its turn', (tx) => tx.media.nextToProcess())
}
