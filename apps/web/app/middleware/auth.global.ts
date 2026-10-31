/** Pages anyone may open: signing in, links from emails, the status page. */
const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  '/',
  '/accedi',
  '/accedi/verifica',
  '/accedi/password-dimenticata',
  '/reimposta',
  '/conferma-email',
  '/sicurezza/non-sono-stato-io',
])
const isPublic = (path: string) => PUBLIC_PATHS.has(path) || path.startsWith('/attiva/')

/** Where a session that still owes the second factor may stay. */
const SECOND_FACTOR_PAGE = '/accedi/secondo-fattore'

const notFound = () => createError({ statusCode: 404, statusMessage: 'Not Found' })

export default defineNuxtRouteMiddleware(async (to) => {
  // no page here: the 404 page answers, signed in or not
  if (to.matched.length === 0) return
  const path = to.path.length > 1 ? to.path.replace(/\/+$/, '') : to.path
  if (isPublic(path) && path !== '/accedi') return
  const session = useSession()
  const view = await session.current()

  if (path === '/accedi') {
    // already in: straight to where they were going
    if (view.state === 'active') return navigateTo(session.home(view.me, to.query['dopo']))
    return
  }
  if (view.state === 'signed_out' || view.state === 'unknown')
    return navigateTo({ path: '/accedi', query: { dopo: to.fullPath } })
  if (view.state === 'second_factor')
    return path === SECOND_FACTOR_PAGE ? undefined : navigateTo(SECOND_FACTOR_PAGE)
  if (path === SECOND_FACTOR_PAGE) return navigateTo(session.home(view.me))
  // an agency the person is not in, or one that does not exist: the same answer
  const org = to.params['org']
  if (typeof org === 'string' && !view.me.organizations.some((o) => o.slug === org))
    throw notFound()
  // the platform's pages exist only for its administrator
  if (path.startsWith('/piattaforma') && view.me.platformRole !== 'admin') throw notFound()
})
