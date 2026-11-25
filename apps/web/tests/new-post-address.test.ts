import { describe, expect, it } from 'vitest'
import { newPostQuery, parseNewPostQuery } from '../app/utils/new-post-address.ts'

const A = '01a21218-7dcb-77d5-aecc-8069f8c30479'
const B = '01a21218-7e01-740d-831f-c91ef1bdf9f3'

describe('newPostQuery', () => {
  it('writes day, time, files and type in the address words', () => {
    expect(
      newPostQuery({ day: '2026-12-03', time: '18:00', fileIds: [A, B], type: 'carousel' }),
    ).toEqual({
      giorno: '2026-12-03',
      ora: '18:00',
      file: `${A},${B}`,
      tipo: 'carosello',
    })
  })

  it('leaves out what is not given', () => {
    expect(newPostQuery({ day: '2026-12-03' })).toEqual({ giorno: '2026-12-03' })
    expect(newPostQuery({ fileIds: [A] })).toEqual({ file: A })
  })
})

describe('parseNewPostQuery', () => {
  it('reads back what newPostQuery wrote', () => {
    const start = { day: '2026-12-03', time: '18:00', fileIds: [A, B], type: 'reel' as const }
    expect(parseNewPostQuery(newPostQuery(start))).toEqual(start)
  })

  it('reads nothing from an empty address', () => {
    expect(parseNewPostQuery({})).toEqual({ day: null, time: null, fileIds: [], type: null })
  })

  it('drops what is not a real day, a time, an id or a type, without failing', () => {
    expect(
      parseNewPostQuery({
        giorno: '2026-02-30',
        ora: '25:00',
        file: `x,${A},,${A}`,
        tipo: 'video',
      }),
    ).toEqual({ day: null, time: null, fileIds: [A], type: null })
    expect(parseNewPostQuery({ giorno: ['2026-12-03'], ora: '7:5' })).toEqual({
      day: null,
      time: null,
      fileIds: [],
      type: null,
    })
  })

  it('takes at most ten files, the most a post holds', () => {
    const ids = Array.from({ length: 12 }, (_, i) => A.replace(/.$/, i.toString(16)))
    expect(parseNewPostQuery({ file: ids.join(',') }).fileIds).toHaveLength(10)
  })

  it('keeps a time only with a day', () => {
    expect(parseNewPostQuery({ ora: '18:00' }).time).toBeNull()
  })
})
