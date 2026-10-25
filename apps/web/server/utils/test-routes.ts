/**
 * The `__test` routes exist only for the automated tests: APP_TEST_ROUTES=1, which the
 * configuration accepts only with NODE_ENV=test, and NODE_ENV=test itself.
 */
export function assertTestRoutes(): void {
  if (!useDeps().config.testRoutes || process.env['NODE_ENV'] !== 'test')
    throw createError({ statusCode: 404 })
}
