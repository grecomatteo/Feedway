/**
 * `/m/*` and `/share/*` belong to the public host, which has its own entry (plan 04 Task 11):
 * the panel answers none of them, whatever `Host` says. Checked decoded and without regard to
 * case, as the page router matches.
 */
export default defineEventHandler((event) => {
  const raw = event.path.split('?')[0] ?? '/'
  let path: string
  try {
    path = decodeURIComponent(raw).toLowerCase()
  } catch {
    return
  }
  if (/^\/(m|share)(\/|$)/.test(path)) throw createError({ statusCode: 404 })
})
