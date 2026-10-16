export interface JobPayloads {
  'system.selftest': { requestedAt: string }
}

export type QueueName = keyof JobPayloads

export interface JobQueue {
  send<N extends QueueName>(
    name: N,
    data: JobPayloads[N],
    opts?: { singletonKey?: string; startAfter?: Date },
  ): Promise<string | null>
  work<N extends QueueName>(
    name: N,
    handler: (job: { id: string; data: JobPayloads[N] }) => Promise<void>,
    opts?: { concurrency?: number },
  ): Promise<void>
  ping(): Promise<void>
  stop(opts: { graceful: boolean; timeoutMs: number }): Promise<void>
}
