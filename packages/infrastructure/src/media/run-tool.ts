import { spawn } from 'node:child_process'
import { setPriority } from 'node:os'

// ffmpeg and ffprobe as child processes (plan 04, «ffmpeg blindato»): low priority, a timeout,
// the job's signal, and never a shell. A process that ignores SIGTERM gets SIGKILL.

export interface ToolRun {
  outcome: 'exited' | 'timeout' | 'aborted'
  /** null when killed */
  code: number | null
  /** all of it, up to `maxStdoutBytes` */
  stdout: string
  /** the last 8 KiB: the error, for the logs only */
  stderr: string
  /** `watchStderr` was seen anywhere in stderr, not only in its last 8 KiB */
  stderrMatched: boolean
}

export interface RunToolOptions {
  timeoutMs: number
  signal?: AbortSignal | undefined
  /** looked for in the whole of stderr as it comes (a short pattern, under 256 characters) */
  watchStderr?: RegExp
  /** each complete line of stdout (ffmpeg's `-progress pipe:1`) */
  onLine?: (line: string) => void
  /** between SIGTERM and SIGKILL */
  killGraceMs?: number
  maxStdoutBytes?: number
  /** test hook */
  onSpawn?: (pid: number) => void
}

const STDERR_TAIL = 8192
/** below the web and the database (spec §16.6) */
const NICENESS = 10

export function runTool(command: string, args: string[], opts: RunToolOptions): Promise<ToolRun> {
  if (opts.signal?.aborted)
    return Promise.resolve({
      outcome: 'aborted',
      code: null,
      stdout: '',
      stderr: '',
      stderrMatched: false,
    })
  const maxStdout = opts.maxStdoutBytes ?? 4 * 1024 * 1024
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    let outcome: ToolRun['outcome'] = 'exited'
    let stdout = ''
    let stderr = ''
    let stderrMatched = false
    // the end of the previous chunk, so a match split between two chunks is still seen
    let stderrCarry = ''
    let partial = ''
    let killTimer: NodeJS.Timeout | undefined
    const stop = (why: 'timeout' | 'aborted') => {
      if (outcome !== 'exited' || child.exitCode !== null) return
      outcome = why
      child.kill('SIGTERM')
      killTimer = setTimeout(() => {
        child.kill('SIGKILL')
      }, opts.killGraceMs ?? 2000)
    }
    const timer = setTimeout(() => {
      stop('timeout')
    }, opts.timeoutMs)
    const onAbort = () => {
      stop('aborted')
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const done = () => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
    child.once('spawn', () => {
      if (child.pid === undefined) return
      opts.onSpawn?.(child.pid)
      try {
        setPriority(child.pid, NICENESS)
      } catch {
        // not allowed here (a container without the right): the command still runs
      }
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < maxStdout) stdout += chunk.slice(0, maxStdout - stdout.length)
      if (!opts.onLine) return
      partial += chunk
      const lines = partial.split('\n')
      partial = lines.pop() ?? ''
      for (const line of lines) opts.onLine(line)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL)
      if (!opts.watchStderr || stderrMatched) return
      const window = stderrCarry + chunk
      stderrMatched = opts.watchStderr.test(window)
      stderrCarry = window.slice(-256)
    })
    child.once('error', (error) => {
      done()
      reject(error)
    })
    child.once('close', (code) => {
      done()
      if (partial && opts.onLine) opts.onLine(partial)
      resolve({ outcome, code, stdout, stderr, stderrMatched })
    })
  })
}
