import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, test } from 'vitest'

// The panel's code (`app/`) takes only types from the contracts: their values are zod schemas,
// and zod in the browser trips the page's CSP (it tries `new Function`). A list the page needs
// is copied in `app/utils` with a test that keeps it equal (F8 of the stage 9 review).

const APP = new URL('../app/', import.meta.url).pathname

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.(ts|vue)$/.test(entry.name) ? [path] : []
  })
}

const FROM_CONTRACTS = /\bfrom\s*['"]@app\/contracts[/'"]/g
const DYNAMIC = /\bimport\(\s*['"]@app\/contracts/
const BARE = /^\s*import\s+['"]@app\/contracts/m

/**
 * The statements of `code` that bring values from the contracts: `import { A, type B } from` and
 * `export { A } from` do, only `import type` does not. Each `from` is read back to its keyword,
 * so a statement over more lines is one, and no regex backtracks across the file.
 */
function valueImports(code: string): string[] {
  const found = [...code.matchAll(FROM_CONTRACTS)].flatMap(({ index }) => {
    const start = Math.max(code.lastIndexOf('import', index), code.lastIndexOf('export', index))
    const statement = code.slice(start, index).replace(/\s+/g, ' ')
    return /^(?:import|export) type /.test(statement) ? [] : [statement.trim()]
  })
  if (DYNAMIC.test(code)) found.push('import(…)')
  if (BARE.test(code)) found.push('import of the whole module')
  return found
}

test('the panel imports only types from the contracts', () => {
  const found = sources(APP).flatMap((path) =>
    valueImports(readFileSync(path, 'utf8')).map((line) => `${relative(APP, path)}: ${line}`),
  )
  expect(found).toEqual([])
})

test('the check sees a value import, also over more lines', () => {
  const seen = (code: string) => valueImports(code).length
  expect(seen("import { NotificationLevel } from '@app/contracts'")).toBe(1)
  expect(seen("import {\n  A,\n  type B,\n} from '@app/contracts'")).toBe(1)
  expect(seen("const c = await import('@app/contracts')")).toBe(1)
  expect(seen("import '@app/contracts'")).toBe(1)
  expect(seen("import type { A } from '@app/contracts'")).toBe(0)
  expect(seen("import type {\n  A,\n  B,\n} from '@app/contracts'")).toBe(0)
  expect(seen("import { A } from '@app/contracts/api'")).toBe(1)
  expect(seen("import { A } from '@app/contracts-other'")).toBe(0)
  expect(seen("import { captionStats } from '@app/domain'")).toBe(0)
  expect(seen("import { ref } from 'vue'\nimport type { A } from '@app/contracts'")).toBe(0)
})
