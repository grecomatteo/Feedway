// What the panel already does. The landing describes the finished product; every feature still
// false here shows an «In arrivo» mark. At the end of each tappa, set to true what has shipped and
// update the README in the same PR (Matteo, 23/11, D-122).
export const SHIPPED = {
  notifications: false, // tappa 8
  calendar: false, // tappa 9
  editorialPlan: false, // tappa 9
  clientLink: false, // tappa 10
  clientApproval: false, // version 1.1
  stats: false, // version 1.3
  tasks: false, // version 1.5
  tiktok: false,
  linkedin: false,
} as const satisfies Record<string, boolean>

export type Feature = keyof typeof SHIPPED

export function isShipped(feature: Feature | undefined): boolean {
  return feature === undefined || SHIPPED[feature]
}
