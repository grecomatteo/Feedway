// The events of the posts outside the publishing (§12.2, plan 09 Task 10): `bulk.completed` is
// written when an import in bulk ends, in the transaction of its last row, for whoever started it.
export const BULK_EVENT_TYPES = ['bulk.completed'] as const
export type BulkEventType = (typeof BULK_EVENT_TYPES)[number]
