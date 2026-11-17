import { Writable } from 'node:stream'
import { expect, test, vi } from 'vitest'
import { createLogger } from '../logging/logger.js'
import { libraryLog } from './library-log.js'

function capture() {
  let out = ''
  const destination = new Writable({
    write(chunk: Buffer, _enc, cb) {
      out += chunk.toString()
      cb()
    },
  })
  const logger = createLogger({ service: 'web', level: 'debug', destination })
  return { log: libraryLog(logger), read: () => out }
}

test("the library's errors reach our log scrubbed, never the console", () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const { log, read } = capture()
  const failed = new Error(
    'Failed query: select * from "verifications" where "identifier" = $1\nparams: reset-password:querytokenquerytoken0004',
  )
  log('error', 'INTERNAL_SERVER_ERROR', failed)
  log('warn', 'Failed query: delete from sessions where token = $1\nparams: s3ss10n-t0k3n')
  expect(consoleError).not.toHaveBeenCalled()
  const out = read()
  expect(out).toContain('better-auth: INTERNAL_SERVER_ERROR')
  for (const v of ['querytokenquerytoken0004', 's3ss10n-t0k3n']) expect(out).not.toContain(v)
  consoleError.mockRestore()
})
