import { isLocalDate, POST_TYPE_WORDS, type LocalDate, type PostType } from '@app/domain'

// What a new post starts with, in the address of the editor (plan 09 Task 4): the «+» of a day
// of the calendar (`?giorno=2026-12-03`), a file dragged from the library onto a day
// (`&file=<id>`), «Usa in un post». `…/post/nuovo` of «Tutti i clienti» passes it on.

export interface NewPostStart {
  day: LocalDate | null
  /** `HH:MM`; only with a day */
  time: string | null
  /** the library's files the post starts with, in their order */
  fileIds: string[]
  type: PostType | null
}

/** The most files a post holds (D-118): more ids in an address are left out. */
const MAX_FILES = 10
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const TYPES = Object.entries(POST_TYPE_WORDS) as [PostType, string][]

export function newPostQuery(start: Partial<NewPostStart>): Record<string, string> {
  const q: Record<string, string> = {}
  if (start.day) q['giorno'] = start.day
  if (start.day && start.time) q['ora'] = start.time
  if (start.fileIds && start.fileIds.length > 0) q['file'] = start.fileIds.join(',')
  if (start.type) q['tipo'] = POST_TYPE_WORDS[start.type]
  return q
}

/** The start of the address; what is not a real day, time, id or type is left out. */
export function parseNewPostQuery(query: Readonly<Record<string, unknown>>): NewPostStart {
  const text = (key: string) => {
    const v = query[key]
    return typeof v === 'string' ? v : null
  }
  const giorno = text('giorno')
  const day = giorno !== null && isLocalDate(giorno) ? giorno : null
  const ora = text('ora')
  const time = day !== null && ora !== null && TIME.test(ora) ? ora : null
  const fileIds = [...new Set((text('file') ?? '').split(',').filter((id) => UUID.test(id)))].slice(
    0,
    MAX_FILES,
  )
  const tipo = text('tipo')
  const type = TYPES.find(([, word]) => word === tipo)?.[0] ?? null
  return { day, time, fileIds, type }
}
