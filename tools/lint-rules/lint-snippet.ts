import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import type { Linter } from 'eslint'
import tseslint from 'typescript-eslint'

const root = fileURLToPath(new URL('../../', import.meta.url))

// The snippet is not a file on disk, so type information is off: the rules under test do not
// need it.
const eslint = new ESLint({
  cwd: root,
  overrideConfig: [tseslint.configs.disableTypeChecked],
})

/** Lints `code` as if it lived at `filePath` (relative to the repository root). */
export async function lintSnippet(code: string, filePath: string): Promise<Linter.LintMessage[]> {
  const [result] = await eslint.lintText(code, { filePath: `${root}${filePath}` })
  return result?.messages ?? []
}
