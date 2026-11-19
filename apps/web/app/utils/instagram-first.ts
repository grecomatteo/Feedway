/** Profiles with an Instagram account first, as the references show them; otherwise as they came. */
export function instagramFirst<T extends { accounts: { platform: string }[] }>(items: T[]): T[] {
  const has = (p: T) => p.accounts.some((a) => a.platform === 'instagram')
  return [...items.filter(has), ...items.filter((p) => !has(p))]
}
