/** A failed download, shaped like the errors of `$fetch` so `useApi().failure` reads it. */
export class DownloadError extends Error {
  constructor(
    readonly statusCode: number,
    readonly data: unknown,
    readonly response: Response,
  ) {
    super(`download failed with ${String(statusCode)}`)
  }
}

/**
 * A file from one of our routes, with the name the server gives it. An error answer is read as
 * JSON, so its code (REAUTH_REQUIRED, LINK_INVALID…) reaches the page: `$fetch` with a blob
 * response type would hand back the error body as a blob instead.
 */
export async function fetchFile(
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ blob: Blob; filename: string | null }> {
  const response = await fetchImpl(path, { credentials: 'same-origin' })
  if (!response.ok) {
    let data: unknown = null
    try {
      data = await response.json()
    } catch {
      // not JSON: the page shows its generic error
    }
    throw new DownloadError(response.status, data, response)
  }
  const disposition = response.headers.get('content-disposition') ?? ''
  return {
    blob: await response.blob(),
    filename: /filename="([^"]+)"/.exec(disposition)?.[1] ?? null,
  }
}

/** Hands a blob to the browser as a file to save. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  // some browsers only follow a link that is in the document
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 60_000)
}
