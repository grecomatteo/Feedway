/** One file of an archive: its path inside it and its bytes. */
export interface ZipEntry {
  path: string
  data: Uint8Array
}

/** Builds a ZIP archive (the export of a person's data is small: JSON and one photo). */
export interface ZipWriter {
  create(entries: readonly ZipEntry[]): Uint8Array
}
