import type { Clock } from '@app/application'

export const systemClock: Clock = { now: () => new Date() }
