/**
 * Pages under `/__test/` exist only for the automated tests (the components' trial page): the
 * same gate as the `__test` API routes. Nothing in the panel links to them. The router matches
 * paths decoded and without regard to case, so the check does the same.
 */
export default defineEventHandler((event) => {
  const raw = event.path.split('?')[0] ?? '/'
  let path: string
  try {
    path = decodeURIComponent(raw).toLowerCase()
  } catch {
    // a path that does not decode reaches no page: no need to tell which
    return assertTestRoutes()
  }
  if (path === '/__test' || path.startsWith('/__test/')) assertTestRoutes()
})
