// Seconds with one decimal, rounded towards the wrong side of a limit (P3 of the stage 5
// review): a reel of 2.96 s reads «2,9», never «3», next to «at least 3 seconds».

/** A value under a minimum: rounded down. */
export const secondsDown = (ms: number) => Math.floor(ms / 100) / 10
/** A value over a maximum: rounded up. */
export const secondsUp = (ms: number) => Math.ceil(ms / 100) / 10
