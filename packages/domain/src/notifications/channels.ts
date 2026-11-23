/** Where a notification goes (§12.3), in the order they are shown and tried. */
export const CHANNELS = ['panel', 'telegram', 'email'] as const
export type Channel = (typeof CHANNELS)[number]
