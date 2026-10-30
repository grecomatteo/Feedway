import { EventEmitter } from 'node:events'
import { PassThrough, Readable } from 'node:stream'
import { expect, test } from 'vitest'
import { readSecret, SecretInputError } from './read-secret.js'

function sink() {
  const written: string[] = []
  const stream = new PassThrough()
  stream.on('data', (c: Buffer) => written.push(c.toString()))
  return { stream, written }
}

/** A terminal that types `keys` once the prompt is up; records the raw mode it was put in. */
function terminal(keys: string) {
  const modes: boolean[] = []
  const input = Object.assign(new EventEmitter(), {
    isTTY: true,
    setRawMode(mode: boolean) {
      modes.push(mode)
      return input
    },
    resume() {
      setImmediate(() => input.emit('data', Buffer.from(keys)))
      return input
    },
    pause: () => input,
  })
  return { input: input as unknown as NodeJS.ReadableStream, modes }
}

test('from a pipe: the whole input, one trailing newline removed, no prompt', async () => {
  const out = sink()
  const secret = await readSecret(
    Readable.from(['cavallo-batteria', '-graffetta \r\n']),
    out.stream,
    'Password: ',
  )
  expect(secret).toBe('cavallo-batteria-graffetta ')
  expect(out.written).toEqual([])
})

test('from a pipe: empty input is an empty secret', async () => {
  expect(await readSecret(Readable.from([]), sink().stream, 'Password: ')).toBe('')
})

test('from a pipe: an oversized input is refused', async () => {
  await expect(
    readSecret(Readable.from(['x'.repeat(5000)]), sink().stream, 'Password: '),
  ).rejects.toBeInstanceOf(SecretInputError)
})

test('on a terminal: raw mode, nothing echoed, backspace works, raw mode restored', async () => {
  const { input, modes } = terminal('parolx\u007fa-segreta\r')
  const out = sink()
  expect(await readSecret(input, out.stream, 'Password: ')).toBe('parola-segreta')
  expect(modes).toEqual([true, false])
  expect(out.written.join('')).toBe('Password: \n')
})

test('on a terminal: Ctrl-C cancels and restores the terminal', async () => {
  const { input, modes } = terminal('parola\u0003')
  await expect(readSecret(input, sink().stream, 'Password: ')).rejects.toBeInstanceOf(
    SecretInputError,
  )
  expect(modes).toEqual([true, false])
})

test('on a terminal: a terminal that closes before Enter cancels and restores it', async () => {
  const modes: boolean[] = []
  const input = Object.assign(new EventEmitter(), {
    isTTY: true,
    setRawMode(mode: boolean) {
      modes.push(mode)
      return input
    },
    resume() {
      setImmediate(() => {
        input.emit('data', Buffer.from('parola'))
        input.emit('end')
      })
      return input
    },
    pause: () => input,
  })
  await expect(
    readSecret(input as unknown as NodeJS.ReadableStream, sink().stream, 'Password: '),
  ).rejects.toBeInstanceOf(SecretInputError)
  expect(modes).toEqual([true, false])
})
