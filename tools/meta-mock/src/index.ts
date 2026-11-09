export { startMetaMock, type MetaMock, type MetaMockCall } from './server.ts'
export type { ScenarioName, ScenarioOptions } from './scenarios.ts'

/** Ids and fake credentials of the initial data (fixtures/), for tests and development. */
export const META_MOCK = {
  app: { id: '1000000000000001', secret: 'meta-mock-app-secret', configId: '2000000000000001' },
  tokens: {
    systemUser: 'mock-system-user-token',
    businessLogin: 'mock-business-login-token',
    businessLoginPersonal: 'mock-business-login-personal-token',
    page: (pageId: string) => `mock-page-token-${pageId}`,
  },
  businesses: {
    agency: '3000000000000001',
    client: '3000000000000002',
    personal: '3000000000000003',
  },
  users: {
    systemUser: '4000000000000001',
    clientIntegration: '4000000000000002',
    personalIntegration: '4000000000000003',
  },
  pages: { withInstagram: '5000000000000001', withoutInstagram: '5000000000000002' },
  instagram: {
    /** Linked to the page with Instagram. */
    ofPage: '6000000000000001',
    /** Without a page, in the agency business: seen by the system user. */
    agencyOnly: '6000000000000002',
    /** Seen by both the system user and the unified login (plan 03, choice 2). */
    shared: '6000000000000003',
    /** Without a page, in the client portfolio: reached through the unified login. */
    clientOnly: '6000000000000004',
  },
} as const
