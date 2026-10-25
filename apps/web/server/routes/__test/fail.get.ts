// Only in the tests: a page request that fails, to see the error page a person would get.
export default defineEventHandler(() => {
  assertTestRoutes()
  throw new Error('boom: secret detail that must never reach the page')
})
