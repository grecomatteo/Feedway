// Type-aware linting keeps every TypeScript project of the monorepo in memory (about 2.4 GB in
// October 2026), above Node's default heap on many machines: the `lint` script raises the limit.
import tseslint from 'typescript-eslint'
import security from 'eslint-plugin-security'

// The only modules that may open the system scope (every agency visible). A new system job
// adds its module here explicitly (plan of stage 2, Task 7; spec §6.5).
const RUN_AS_SYSTEM_ALLOWED = [
  'packages/application/src/platform/**',
  'packages/application/src/identity/auth-events.ts',
  'packages/application/src/identity/activation.ts',
  'packages/application/src/identity/bootstrap.ts',
  'packages/application/src/identity/sessions.ts',
  'packages/application/src/identity/retention.ts',
]

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
        {
          selector: 'TemplateElement[value.raw=/app\\.scope/], Literal[value=/app\\.scope/]',
          message: 'app.scope si imposta solo in UnitOfWork.runAsSystem, nei moduli consentiti.',
        },
      ],
    },
  },
  {
    files: ['packages/application/src/**/*.ts', 'apps/**/*.ts'],
    ignores: ['**/*.test.ts', ...RUN_AS_SYSTEM_ALLOWED],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          property: 'runAsSystem',
          message:
            "runAsSystem vede tutte le agenzie: usa uow.run con l'ambito. Solo i moduli elencati in RUN_AS_SYSTEM_ALLOWED possono aprirlo.",
        },
      ],
    },
  },
  {
    // The system scope opens only through UnitOfWork.runAsSystem, the call the rule above
    // restricts: no other product code may set app.scope by hand (ADR 017).
    // (domain and application get the same selector in their own block above: a second
    // no-restricted-syntax here would replace theirs)
    files: ['apps/**/*.ts', 'packages/infrastructure/src/**/*.ts', 'packages/ui/**/*.ts'],
    ignores: [
      '**/*.test.ts',
      'packages/infrastructure/src/db/unit-of-work.ts',
      'packages/*/src/testing/**',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TemplateElement[value.raw=/app\\.scope/], Literal[value=/app\\.scope/]',
          message:
            'app.scope si imposta solo in UnitOfWork.runAsSystem: usa quello, nei moduli consentiti.',
        },
      ],
    },
  },
  {
    // Test helpers (seeders, the permission table, soft passkeys) never reach the product code.
    files: ['apps/**/*.ts', 'packages/*/src/**/*.ts'],
    ignores: [
      '**/*.test.ts',
      '**/*.spec.ts',
      'apps/*/tests/**',
      'packages/*/src/testing/**',
      'packages/*/src/testing.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@app/*/testing', '@app/*/testing/*'],
              message:
                'I moduli testing servono solo ai test: non importarli nel codice del prodotto.',
            },
          ],
        },
      ],
    },
  },
)
