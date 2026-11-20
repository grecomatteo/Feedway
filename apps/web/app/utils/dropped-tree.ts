// What came from the computer as a tree (D-104): a folder dragged in, read with the browser's
// `webkitGetAsEntry`, or chosen with `<input webkitdirectory>`. Each file with its path inside,
// the folder itself first, as `planTree` takes them.

export interface TreeFile {
  path: string
  size: number
  type: string
  file: File
}

const asTreeFile = (path: string, file: File): TreeFile => ({
  path,
  size: file.size,
  type: file.type,
  file,
})

/** The files of `<input webkitdirectory>`, each with the path the browser gives it. */
export function filesFromDirectoryInput(files: readonly File[]): TreeFile[] {
  return files.map((f) => asTreeFile(f.webkitRelativePath || f.name, f))
}

function entriesOf(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader()
  const all: FileSystemEntry[] = []
  // a reader gives the entries in batches (100 in Chrome) until an empty one
  return new Promise((resolve, reject) => {
    const next = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all)
        else {
          all.push(...batch)
          next()
        }
      }, reject)
    }
    next()
  })
}

const fileOf = (entry: FileSystemFileEntry) =>
  new Promise<File>((resolve, reject) => {
    entry.file(resolve, reject)
  })

async function walk(entry: FileSystemEntry, prefix: string, out: TreeFile[]) {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name
  if (entry.isFile) out.push(asTreeFile(path, await fileOf(entry as FileSystemFileEntry)))
  else if (entry.isDirectory)
    for (const child of await entriesOf(entry as FileSystemDirectoryEntry))
      await walk(child, path, out)
}

/**
 * A drop that holds a folder: its files with their paths; null when it holds files only, which
 * go the usual way. The entries are taken at once: the browser empties the drop after the event.
 */
export function folderDrop(transfer: DataTransfer): Promise<TreeFile[]> | null {
  const entries = Array.from(transfer.items)
    .map((item) => (item.kind === 'file' ? item.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null)
  if (!entries.some((e) => e.isDirectory)) return null
  return (async () => {
    const out: TreeFile[] = []
    for (const entry of entries) await walk(entry, '', out)
    return out
  })()
}

/** A drop or a choice of one zip alone. */
export const isZip = (file: File) =>
  /\.zip$/i.test(file.name) ||
  file.type === 'application/zip' ||
  file.type === 'application/x-zip-compressed'
