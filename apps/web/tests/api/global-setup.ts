import { buildWebOnce } from './helpers.ts'

/**
 * Builds the web app before the integration files start: test files run in parallel and two
 * concurrent `nuxt build` runs fail on Nuxt's lock on .output.
 */
export default function globalSetup(): void {
  buildWebOnce()
}
