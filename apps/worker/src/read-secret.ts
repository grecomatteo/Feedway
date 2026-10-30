/** Longer than any SMTP password or API token we store (the store refuses over 1024). */
const MAX_BYTES = 4096

export class SecretInputError extends Error {}

interface SecretInput extends NodeJS.ReadableStream {
  isTTY?: boolean
  setRawMode?(mode: boolean): unknown
}

/**
 * Reads a secret from `input`, never from argv or the environment. On a terminal: the prompt on
 * `prompt` (stderr), raw mode so nothing is echoed, Enter ends it, Ctrl-C or Ctrl-D cancels.
 * From a pipe: the whole input, one trailing newline removed.
 */
export async function readSecret(
  input: SecretInput,
  prompt: NodeJS.WritableStream,
  text: string,
): Promise<string> {
  if (input.isTTY === true && input.setRawMode !== undefined)
    return readFromTerminal(input, (mode) => input.setRawMode?.(mode), prompt, text)
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of input) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    size += buffer.length
    if (size > MAX_BYTES) throw new SecretInputError('Password troppo lunga')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '')
}

function readFromTerminal(
  input: SecretInput,
  setRawMode: (mode: boolean) => unknown,
  prompt: NodeJS.WritableStream,
  text: string,
): Promise<string> {
  prompt.write(text)
  setRawMode(true)
  input.resume()
  // one entry per code point, so Backspace removes a whole character
  const typed: string[] = []
  return new Promise<string>((resolve, reject) => {
    const done = (error: Error | null) => {
      input.removeListener('data', onData)
      input.removeListener('end', onEnd)
      input.removeListener('error', onEnd)
      setRawMode(false)
      input.pause()
      prompt.write('\n')
      if (error === null) resolve(typed.join(''))
      else reject(error)
    }
    const onData = (chunk: Buffer | string) => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n') {
          done(null)
          return
        }
        // Ctrl-C, Ctrl-D
        if (char === '\u0003' || char === '\u0004') {
          done(new SecretInputError('Annullato: nessuna modifica'))
          return
        }
        // Backspace, Delete
        if (char === '\u007f' || char === '\b') typed.pop()
        else typed.push(char)
        if (typed.length > MAX_BYTES) {
          done(new SecretInputError('Password troppo lunga'))
          return
        }
      }
    }
    // the terminal went away before Enter: never wait forever, never keep raw mode
    const onEnd = () => {
      done(new SecretInputError('Annullato: nessuna modifica'))
    }
    input.on('data', onData)
    input.on('end', onEnd)
    input.on('error', onEnd)
  })
}
