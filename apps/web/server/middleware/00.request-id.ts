export default defineEventHandler(async (event) => {
  await depsReady()
  // always generated here: an id sent by the client is never trusted
  const requestId = useDeps().ids.newId()
  event.context['requestId'] = requestId
  event.context['startedAt'] = Date.now()
  setResponseHeader(event, 'x-request-id', requestId)
  // read by the Better Auth hooks, which see only the web request, to tie their logs to it
  overrideRequestHeader(event, 'x-app-request-id', requestId)
})
