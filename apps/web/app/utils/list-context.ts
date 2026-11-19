import type { ComputedRef, InjectionKey } from 'vue'

/** Whether the `ListSurface` around a `ListRow` is a table (it has a head) or a list. */
export const LIST_TABLE: InjectionKey<ComputedRef<boolean>> = Symbol('list-table')
