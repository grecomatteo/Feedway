import { expect, test } from 'vitest'
import { DownloadError, fetchFile } from '../app/utils/download.ts'

const answer = (body: BodyInit, init: ResponseInit) => () =>
  Promise.resolve(new Response(body, init))

test('a file comes with the name the server gives it', async () => {
  const file = await fetchFile(
    '/x',
    answer('PK', {
      headers: { 'content-disposition': 'attachment; filename="dati-personali-2026-11-02.zip"' },
    }),
  )
  expect(file.filename).toBe('dati-personali-2026-11-02.zip')
  expect(await file.blob.text()).toBe('PK')
})

test('an error answer keeps its code for the page', async () => {
  const error = await fetchFile(
    '/x',
    answer(JSON.stringify({ error: { code: 'REAUTH_REQUIRED', message: 'Conferma' } }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
  ).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(DownloadError)
  expect(error).toMatchObject({ statusCode: 403, data: { error: { code: 'REAUTH_REQUIRED' } } })
})
