export default defineEventHandler(() => {
  // only reachable in the API tests
  if (process.env['NODE_ENV'] !== 'test') throw createError({ statusCode: 404 })
  throw new Error('boom: secret detail that must never reach the client')
})
