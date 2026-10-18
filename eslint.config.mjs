import tseslint from 'typescript-eslint'
import security from 'eslint-plugin-security'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.output/**',
      '**/.nuxt/**',
      'design/**',
      '.claude/**',
      'docs/**',
      'coverage/**',
      '**/migrations/**',
      'tools/arch-fixtures/*/**',
    ],
  },
  ...tseslint.configs.strictTypeChecked,
  security.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.ts', '*.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Nuxt auto-imports are only typed through the generated .nuxt projects (run `nuxt prepare` first)
    files: ['apps/web/server/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./apps/web/.nuxt/tsconfig.server.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Contract tests drive a third-party library through loosely typed calls and raw SQL rows.
    files: [
      'packages/infrastructure/src/auth/contract/**/*.ts',
      'apps/web/tests/e2e/passkey-localhost.spec.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    files: ['**/*.mjs', '**/*.cjs', '**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['packages/domain/**/*.ts', 'packages/application/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Usa la porta Clock, non new Date().',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Usa la porta Clock, non Date.now().',
        },
      ],
    },
  },
)
