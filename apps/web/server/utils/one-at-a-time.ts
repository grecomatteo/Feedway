const running = new Set<string>()

/**
 * One photo at a time per person in this process: the image slots are shared by everyone, and
 * one session sending many uploads at once would take them all (RATE_LIMITED for the rest).
 */
export async function onePerPerson<T>(userId: string, job: () => Promise<T>): Promise<T> {
  if (running.has(userId))
    throw new HttpProblem('RATE_LIMITED', {
      message: 'Stiamo già elaborando una tua foto: aspetta che finisca',
      retryAfterSeconds: 5,
    })
  running.add(userId)
  try {
    return await job()
  } finally {
    running.delete(userId)
  }
}
