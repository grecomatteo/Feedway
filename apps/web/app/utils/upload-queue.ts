import { PART_BYTES } from './upload-file.ts'

/** The states of a file that takes one of the places. */
const RUNNING = new Set(['hashing', 'uploading', 'completing'])

/** Over one piece: a file that keeps its place for a while (a video, mostly). */
const isBig = (size: number) => size > PART_BYTES

/**
 * The files waiting that start now, `max` at once in all (D-120.7). In their order; but while a
 * big file is on its way, the other places go to the small files waiting, so a photo never waits
 * behind two videos. A big file still starts in its turn whenever no big file runs.
 */
export function nextUploads(
  items: readonly { key: string; size: number; state: string }[],
  max: number,
): string[] {
  const running = items.filter((i) => RUNNING.has(i.state))
  let free = max - running.length
  let big = running.some((i) => isBig(i.size))
  const waiting = items.filter((i) => i.state === 'queued')
  const chosen: string[] = []
  while (free > 0) {
    const left = waiting.filter((i) => !chosen.includes(i.key))
    if (left.length === 0) break
    const next = ((big && left.find((i) => !isBig(i.size))) || left[0]) as (typeof left)[number]
    chosen.push(next.key)
    big ||= isBig(next.size)
    free -= 1
  }
  return chosen
}
