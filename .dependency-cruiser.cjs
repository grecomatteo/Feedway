const TEST = '\\.(test|spec)\\.ts$'

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-no-outside',
      comment: 'domain imports nothing outside itself',
      severity: 'error',
      from: { path: '(^|/)packages/domain/src', pathNot: TEST },
      to: { pathNot: '(^|/)packages/domain/' },
    },
    {
      name: 'application-only-domain-and-zod',
      comment: 'application imports only domain, itself and zod',
      severity: 'error',
      from: { path: '(^|/)packages/application/src', pathNot: TEST },
      to: { pathNot: ['(^|/)packages/(application|domain)/', 'node_modules/zod/'] },
    },
    {
      name: 'infrastructure-not-from-apps',
      comment: 'infrastructure never imports from apps',
      severity: 'error',
      from: { path: '(^|/)packages/infrastructure/' },
      to: { path: '(^|/)apps/' },
    },
    {
      name: 'packages-never-import-apps',
      severity: 'error',
      from: { path: '(^|/)packages/' },
      to: { path: '(^|/)apps/' },
    },
    {
      name: 'modules-only-through-public-index',
      comment: 'application/<a> reaches application/<b> only through its index.ts',
      severity: 'error',
      from: { path: '(^|/)packages/application/src/([^/]+)/' },
      to: {
        path: '(^|/)packages/application/src/([^/]+)/',
        pathNot: ['(^|/)packages/application/src/$2/', '/index\\.ts$', '/ports/'],
      },
    },
    {
      name: 'db-modules-not-across-tables',
      comment: 'infrastructure/db/<a> never touches the tables of infrastructure/db/<b>',
      severity: 'error',
      from: {
        path: '(^|/)packages/infrastructure/src/db/([^/]+)/',
        // schema files and the db/schema aggregator have their own rules below
        pathNot: [
          '(^|/)packages/infrastructure/src/db/[^/]+/schema\\.ts$',
          '(^|/)packages/infrastructure/src/db/schema/',
        ],
      },
      to: {
        path: '(^|/)packages/infrastructure/src/db/([^/]+)/',
        pathNot: ['(^|/)packages/infrastructure/src/db/$2/', '/index\\.ts$', '/schema/'],
      },
    },
    {
      name: 'db-schemas-only-reference-schemas',
      comment: 'a db/<a>/schema.ts may import db/<b>/schema.ts, only to declare foreign keys',
      severity: 'error',
      from: { path: '(^|/)packages/infrastructure/src/db/([^/]+)/schema\\.ts$' },
      to: {
        path: '(^|/)packages/infrastructure/src/db/([^/]+)/',
        pathNot: [
          '(^|/)packages/infrastructure/src/db/$2/',
          '(^|/)packages/infrastructure/src/db/schema/',
          '(^|/)packages/infrastructure/src/db/[^/]+/schema\\.ts$',
        ],
      },
    },
    {
      name: 'db-aggregator-only-schemas',
      comment: "db/schema gathers the modules' schema.ts files for drizzle-kit, nothing else",
      severity: 'error',
      from: { path: '(^|/)packages/infrastructure/src/db/schema/' },
      to: {
        path: '(^|/)packages/infrastructure/src/db/[^/]+/',
        pathNot: [
          '(^|/)packages/infrastructure/src/db/schema/',
          '(^|/)packages/infrastructure/src/db/[^/]+/schema\\.ts$',
        ],
      },
    },
    {
      name: 'better-auth-only-in-adapter',
      comment:
        'Better Auth stays behind the Auth port: only the adapter and the browser client use it',
      severity: 'error',
      from: {
        pathNot: [
          '(^|/)packages/infrastructure/src/auth/',
          '(^|/)apps/web/app/lib/auth-client\\.ts$',
        ],
      },
      to: { path: '(^|/)(better-auth|@better-auth/[^/]+)(/|$)' },
    },
    {
      name: 'identity-tables-only-from-identity',
      comment:
        'personal data (users, sessions, …) has no RLS: only its repositories, the auth adapter and the unit of work reach it',
      severity: 'error',
      from: {
        path: '(^|/)packages/',
        pathNot: [
          TEST,
          '(^|/)packages/infrastructure/src/db/identity/',
          '(^|/)packages/infrastructure/src/db/schema/',
          '(^|/)packages/infrastructure/src/db/[^/]+/schema\\.ts$',
          '(^|/)packages/infrastructure/src/db/unit-of-work\\.ts$',
          '(^|/)packages/infrastructure/src/auth/',
        ],
      },
      to: { path: '(^|/)packages/infrastructure/src/db/identity/' },
    },
    {
      name: 'meta-only-inside-platform',
      comment:
        'ADR 019: only platforms/meta itself and the composition root import infrastructure/platforms/meta',
      severity: 'error',
      from: {
        pathNot: [
          '(^|/)packages/infrastructure/src/platforms/meta/',
          '(^|/)packages/infrastructure/src/runtime\\.ts$',
        ],
      },
      to: { path: '(^|/)packages/infrastructure/src/platforms/meta/' },
    },
    {
      name: 'infrastructure-index-hides-meta',
      comment: 'ADR 019: the public index of infrastructure never re-exports Meta code',
      severity: 'error',
      from: { path: '(^|/)packages/infrastructure/src/index\\.ts$' },
      to: { path: '(^|/)packages/infrastructure/src/platforms/' },
    },
    {
      name: 'accounts-knows-no-platform',
      comment: 'ADR 019: the accounts module is generic and never imports a platform module',
      severity: 'error',
      from: { path: '(^|/)packages/(domain|application)/src/accounts/' },
      to: { path: '(^|/)packages/(domain|application)/src/platforms/' },
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'no-orphans',
      severity: 'error',
      from: {
        orphan: true,
        pathNot: [
          TEST,
          '(^|/)index\\.ts$',
          '\\.d\\.ts$',
          'vitest\\.config',
          '\\.config\\.(ts|mjs|cjs)$',
          '(^|/)main\\.ts$',
          // Nuxt loads these by convention, nothing imports them
          '(^|/)apps/web/(app|server)/',
        ],
      },
      to: {},
    },
  ],
  options: {
    // node_modules stays in the graph (not followed) so rules on packages see resolved imports
    exclude: { path: ['(^|/)\\.(nuxt|output)/'] },
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'node', 'default'],
    },
  },
}
