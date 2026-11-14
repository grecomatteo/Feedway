/**
 * Pages under `/__test/` exist only for the automated tests (the components' trial page): the
 * same gate as the `__test` API routes. Nothing in the panel links to them.
 */
export default defineEventHandler((event) => {
  if (event.path === '/__test' || event.path.startsWith('/__test/')) assertTestRoutes()
})
