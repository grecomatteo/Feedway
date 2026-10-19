import type { H3Event } from 'h3'

/** Replaces (or removes) a request header so a value sent by the client never reaches the handler. */
export function overrideRequestHeader(event: H3Event, name: string, value: string | null): void {
  const node = event.node.req.headers
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- header names are dynamic
  delete node[name]
  if (value !== null) node[name] = value
  // h3 may already hold a copy of the headers (toWebRequest reads it)
  if (value === null) event.headers.delete(name)
  else event.headers.set(name, value)
}
