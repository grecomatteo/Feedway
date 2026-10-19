import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IdGenerator, Mailer, MailMessage } from '@app/application'

/**
 * One JSON file per message in a folder, so the web, the worker and the end-to-end tests
 * (separate processes) read the same mailbox. Test environments only.
 */
export function createFileMailer(opts: { dir: string; ids: IdGenerator }): Mailer {
  return {
    isConfigured: () => Promise.resolve(true),
    async send(message) {
      await mkdir(opts.dir, { recursive: true })
      // ids are time ordered (UUIDv7): file names sort in sending order
      const name = `${opts.ids.newId()}.json`
      const temp = join(opts.dir, `.${name}.tmp`)
      await writeFile(temp, JSON.stringify(message))
      await rename(temp, join(opts.dir, name))
      return 'sent'
    },
  }
}

/** Every message in the folder, oldest first. */
export async function readFileMailbox(dir: string): Promise<MailMessage[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return []
    throw error
  }
  const files = names.filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort()
  return Promise.all(
    files.map(async (n) => JSON.parse(await readFile(join(dir, n), 'utf8')) as MailMessage),
  )
}
