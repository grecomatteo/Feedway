import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { publicHostListener } from '../public-host/listener'

const EXIT_START_FAILED = 1

/**
 * The public host's own entry (plan 04 Task 11): with PUBLIC_URL, a second listener on
 * PUBLIC_PORT, next to the panel's; without it, nothing listens and `/m/*` answers nowhere.
 */
export default defineNitroPlugin((nitroApp) => {
  let server: Server | undefined
  depsReady()
    .then(() => {
      const deps = useDeps()
      const { publicUrl, publicPort } = deps.config
      if (publicUrl === null) return
      server = createServer(publicHostListener(deps))
      server.once('error', (error: NodeJS.ErrnoException) => {
        // the container restarts; the cause is in the log
        console.error('public host failed to start', error.code ?? error.message)
        process.exit(EXIT_START_FAILED)
      })
      // the same interface as the panel's listener (Nitro reads the same variables)
      const host = process.env['NITRO_HOST'] ?? process.env['HOST'] ?? undefined
      server.listen(publicPort, host === '' ? undefined : host, () => {
        deps.logger.info({ port: publicPort }, 'public host listening')
      })
    })
    .catch(() => {
      // 00.deps already logged it and stops the process
    })
  nitroApp.hooks.hook('close', () => {
    server?.close()
  })
})
