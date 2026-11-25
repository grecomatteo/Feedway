// The events of the plan (§12.2, plan 09 P3): `plan.due_soon` is written by `plan.due_scan`, once
// per content and reference instant, and joins `OUTBOX_EVENT_TYPES` with its kind (Task 8).
export const PLAN_EVENT_TYPES = ['plan.due_soon'] as const
export type PlanEventType = (typeof PLAN_EVENT_TYPES)[number]
