// The sha-256 of a piece of a file (plan 04 Task 13), away from the page: 20 MiB at a time
// would freeze a phone's page while it counts.

interface Ask {
  id: number
  blob: Blob
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Ask>) => void) | null
  postMessage: (message: unknown) => void
}

scope.onmessage = (event) => {
  const { id, blob } = event.data
  blob
    .arrayBuffer()
    .then((bytes) => crypto.subtle.digest('SHA-256', bytes))
    .then(
      (digest) => {
        scope.postMessage({ id, digest: new Uint8Array(digest) })
      },
      (error: unknown) => {
        scope.postMessage({ id, error: String(error) })
      },
    )
}
