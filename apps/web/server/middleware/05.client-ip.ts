import { clientIp } from '@app/infrastructure'

/** Better Auth and the rate limits read the client address only from this header. */
export default defineEventHandler((event) => {
  const ip = clientIp(event.headers, event.node.req.socket.remoteAddress)
  overrideRequestHeader(event, 'x-app-client-ip', ip)
})
