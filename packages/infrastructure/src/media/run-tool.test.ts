import { expect, test } from 'vitest'
import { runTool } from './run-tool.js'

// A command that never ends by itself stands in for ffmpeg stuck on a file.
const forever = ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)']

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('the timeout stops the process, even one that ignores SIGTERM', async () => {
  const started = Date.now()
  let pid = 0
  const run = await runTool(process.execPath, forever, {
    timeoutMs: 200,
    killGraceMs: 200,
    onSpawn: (p) => {
      pid = p
    },
  })
  expect(run.outcome).toBe('timeout')
  expect(Date.now() - started).toBeLessThan(5_000)
  expect(pid).toBeGreaterThan(0)
  expect(alive(pid)).toBe(false)
})

test('the job signal stops the process', async () => {
  const controller = new AbortController()
  setTimeout(() => {
    controller.abort()
  }, 100)
  const run = await runTool(process.execPath, forever, {
    timeoutMs: 60_000,
    killGraceMs: 200,
    signal: controller.signal,
  })
  expect(run.outcome).toBe('aborted')
})

test('a signal already aborted starts nothing', async () => {
  const run = await runTool(process.execPath, ['-e', ''], {
    timeoutMs: 1000,
    signal: AbortSignal.abort(),
  })
  expect(run.outcome).toBe('aborted')
})

test('the exit code, stdout and the end of stderr come back', async () => {
  const run = await runTool(
    process.execPath,
    ['-e', 'console.log("out"); console.error("x".repeat(20000) + "end"); process.exit(3)'],
    { timeoutMs: 10_000 },
  )
  expect(run).toMatchObject({ outcome: 'exited', code: 3, stdout: 'out\n' })
  expect(run.stderr.length).toBeLessThanOrEqual(8192)
  expect(run.stderr.trimEnd().endsWith('end')).toBe(true)
})

test('a pattern in stderr is seen even when later errors push it out of the tail', async () => {
  const script = [
    'process.stderr.write("max pi")',
    'setTimeout(() => { process.stderr.write("xels!\\n" + "y".repeat(20000)) }, 50)',
  ].join(';')
  const run = await runTool(process.execPath, ['-e', script], {
    timeoutMs: 10_000,
    watchStderr: /max pixels!/,
  })
  expect(run.stderr).not.toContain('max pixels!')
  expect(run.stderrMatched).toBe(true)
})

test('stdout lines reach the caller as they come', async () => {
  const lines: string[] = []
  await runTool(process.execPath, ['-e', 'console.log("a=1\\nb=2")'], {
    timeoutMs: 10_000,
    onLine: (line) => lines.push(line),
  })
  expect(lines).toEqual(['a=1', 'b=2'])
})

test('a command that does not exist is an error, not a refused file', async () => {
  await expect(runTool('/nonexistent/ffmpeg', [], { timeoutMs: 1000 })).rejects.toThrow()
})
