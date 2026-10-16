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
      from: { path: '(^|/)packages/infrastructure/src/db/([^/]+)/' },
      to: {
        path: '(^|/)packages/infrastructure/src/db/([^/]+)/',
        pathNot: ['(^|/)packages/infrastructure/src/db/$2/', '/index\\.ts$', '/schema/'],
      },
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
    exclude: { path: ['node_modules', '(^|/)\\.(nuxt|output)/'] },
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'node', 'default'],
    },
  },
}
