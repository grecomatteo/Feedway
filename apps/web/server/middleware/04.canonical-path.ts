/**
 * Only canonical paths go on. h3 matches the path as sent, while Better Auth resolves `.` and
 * `..` (also `%2e`) through `new URL`: `/api/auth/x/../change-password` would pass every check
 * written for other paths and still reach `/change-password`. Browsers never send such paths.
 */
export default defineEventHandler((event) => {
  const raw = (event.node.req.url ?? '/').split('?')[0] ?? '/'
  // joined to an origin, so a leading `//` stays a path instead of becoming a host
  if (new URL(`http://canonical.invalid${raw}`).pathname !== raw)
    throw createError({ statusCode: 400 })
})
