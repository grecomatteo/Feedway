import { INITIAL_PLAN, INITIAL_POSTS, type PlanItem, type Post, type TargetState } from '~/fixtures/scenario'

export type Role = 'Manager' | 'Editor' | 'Viewer' | 'Member'

interface DemoState {
  posts: Post[]
  plan: PlanItem[]
  showPlan: boolean
  role: Role
  dark: boolean
  client: string
  /** Active profile (IG + linked FB Page) inside the client, or null for the whole client. */
  profile: string | null
}

const STORAGE_KEY = 'feedway-demo-v3'

const fresh = (): DemoState => ({ posts: structuredClone(INITIAL_POSTS), plan: structuredClone(INITIAL_PLAN), showPlan: true, role: 'Manager', dark: false, client: 'all', profile: null })

// Demo state lives in memory and is mirrored to this browser's localStorage only.
// Nothing is sent to a server and nothing is published.
export function useDemo() {
  const state = useState<DemoState>('demo', () => {
    if (import.meta.client) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) return { ...fresh(), ...JSON.parse(raw) } as DemoState
      }
      catch { /* storage unavailable: fall back to a fresh scenario */ }
    }
    return fresh()
  })

  const persist = () => {
    if (!import.meta.client) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.value)) }
    catch { /* ignore: the demo keeps working in memory */ }
  }

  // Member = agency person without any client role: sees no client (personal tools arrive in 1.5).
  const can = computed(() => ({
    seeClients: state.value.role !== 'Member',
    create: state.value.role === 'Manager' || state.value.role === 'Editor',
    schedule: state.value.role === 'Manager',
    retry: state.value.role === 'Manager',
    upload: state.value.role === 'Manager' || state.value.role === 'Editor',
    plan: state.value.role === 'Manager',
  }))

  function upsert(post: Post) {
    const i = state.value.posts.findIndex(p => p.id === post.id)
    if (i >= 0) state.value.posts.splice(i, 1, post)
    else state.value.posts.push(post)
    persist()
  }

  function setTargets(id: string, fn: (accountId: string, current: TargetState) => Partial<Post['targets'][number]>) {
    const p = state.value.posts.find(x => x.id === id)
    if (!p) return
    p.targets = p.targets.map(t => ({ ...t, ...fn(t.accountId, t.state) }))
    persist()
  }

  function update(id: string, patch: Partial<Post>) {
    const p = state.value.posts.find(x => x.id === id)
    if (!p) return
    Object.assign(p, patch)
    persist()
  }

  function upsertPlan(item: PlanItem) {
    const i = state.value.plan.findIndex(p => p.id === item.id)
    if (i >= 0) state.value.plan.splice(i, 1, item)
    else state.value.plan.push(item)
    persist()
  }

  function removePlan(id: string) {
    state.value.plan = state.value.plan.filter(p => p.id !== id)
    persist()
  }

  function reset() {
    state.value = fresh()
    persist()
  }

  watch(() => state.value.dark, (d) => {
    if (import.meta.client) document.documentElement.classList.toggle('dark', d)
    persist()
  }, { immediate: true })
  watch(() => [state.value.role, state.value.client, state.value.profile, state.value.showPlan], persist)

  return { state, can, upsert, update, setTargets, upsertPlan, removePlan, reset }
}
