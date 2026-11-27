<script setup lang="ts">
import type { TimeSlotDto } from '@app/contracts'
import type { DropdownMenuItem } from '@nuxt/ui'
import { monthOf } from '~/utils/day-time'
import {
  canEditPlan,
  canPreparePlan,
  itemsByDay,
  localToday,
  monthCounts,
  monthDays,
  planDay,
  planMonth,
  planRange,
  planStateAt,
  planWeeks,
  shiftMonth,
  suggestedTime,
  type PlanItem,
} from '~/utils/plan'

definePageMeta({ layout: 'agency' })

/**
 * The editorial plan (spec §11.12, plan 09 Task 7, the landing's board «Piano editoriale»): the
 * month of one client to fill, as one writes in a diary. A day opens the short form, and a
 * content moves by dragging it or with «Sposta…», changes and goes from its menu. On a phone the
 * month is a list of days, each with its «+». The client is the one of the context; from «Tutti
 * i clienti» a window asks for it. The clock moves the states on every minute.
 */
const org = useOrganization()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { call, failure } = useApi()
const context = useActiveContext()
const { data: spaces } = useWorkspaces()

useHead({ title: () => t('plan.title') })

const enabled = computed(() => org.organization.value?.modules.plan === true)
const timeZone = computed(() => org.organization.value?.timezone ?? 'Europe/Rome')
const client = computed(() => context.workspace.value)
const canEdit = computed(() => (client.value ? canEditPlan(client.value.myRole) : false))
const canPrepare = computed(() => (client.value ? canPreparePlan(client.value.myRole) : false))

// the minute of the page: «Meno di 36 ore» and «In ritardo» come by themselves
const now = ref(new Date())
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => (tick = setInterval(() => (now.value = new Date()), 60_000)))
onBeforeUnmount(() => clearInterval(tick))

const today = computed(() => localToday(timeZone.value, now.value))
const picked = computed(() => planDay(route.query['giorno']))
const month = computed(() => planMonth(route.query['mese'], today.value, picked.value))
const weeks = computed(() => planWeeks(month.value))
// on the phone a past day with nothing planned says nothing, and only makes the list longer
const days = computed(() =>
  monthDays(month.value).filter((d) => d >= today.value || byDay.value.has(d)),
)
const monthName = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  const name = new Intl.DateTimeFormat('it-IT', { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, 1)),
  )
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${String(y)}`
})
const monthLink = (to: string) => ({
  query: { ...route.query, mese: to, giorno: undefined },
})

// ---------------------------------------------------------------- the client
const choosing = ref(false)
const choices = computed(() => {
  const visible = (spaces.value?.items ?? []).filter((w) => w.archivedAt === null)
  const planning = visible.filter((w) => canEditPlan(w.myRole))
  return (planning.length > 0 ? planning : visible).map((workspace) => ({
    workspace,
    readOnly: !canEditPlan(workspace.myRole),
  }))
})
// «Tutti i clienti»: once the clients are read, the window asks which one
watch(
  [() => spaces.value, client, enabled],
  ([list, chosen, on]) => {
    if (list && !chosen && on && !context.profileMissing.value) choosing.value = true
  },
  { immediate: true },
)
async function choose(slug: string) {
  choosing.value = false
  await router.replace({ query: { ...route.query, spazio: slug, profilo: undefined } })
}

// ---------------------------------------------------------------- the plan of the month
const items = ref<PlanItem[]>([])
const problem = ref<string | null>(null)
/** the client and month the items are of: another month is not «loaded» until it is read */
const view = computed(() => `${client.value?.id ?? ''}:${month.value}`)
const loadedFor = ref('')
const loaded = computed(() => loadedFor.value === view.value)
let latest = 0

async function load() {
  const ws = client.value
  if (!ws || !enabled.value) return
  const seq = ++latest
  const key = view.value
  problem.value = null
  try {
    const { from, to } = planRange(month.value)
    const query = new URLSearchParams({ workspaceId: ws.id, from, to })
    const read = await call<{ items: PlanItem[] }>('GET', `${org.api('/plan')}?${query}`)
    if (seq !== latest) return
    items.value = read.items
    loadedFor.value = key
    // a form open on a content read again: its new version, or closed when it is gone
    if (form.item && form.mode !== 'new') {
      const fresh = read.items.find((i) => i.id === form.item?.id)
      if (fresh) form.item = fresh
      else form.open = false
    }
  } catch {
    if (seq === latest) problem.value = t('plan.loadError')
  }
}
watch([() => client.value?.id, month, enabled], () => void load(), { immediate: true })
watch(
  () => client.value?.id,
  () => (items.value = []),
)

// the client's usual times, for the time a new content starts with; without them, its usual time
const slots = ref<TimeSlotDto[]>([])
watch(
  [() => client.value?.id, enabled],
  async ([id, on]) => {
    slots.value = []
    if (!id || !on) return
    try {
      const read = await call<{ items: TimeSlotDto[] }>(
        'GET',
        org.api(`/workspaces/${encodeURIComponent(id)}/time-slots`),
      )
      if (client.value?.id === id) slots.value = read.items
    } catch {
      // only a suggestion: the form falls back on the usual time
    }
  },
  { immediate: true },
)
const suggestFor = (date: string) =>
  suggestedTime(date, slots.value, items.value, client.value?.defaultPostTime ?? null)

const byDay = computed(() => itemsByDay(items.value))
const stateOf = (item: PlanItem) => planStateAt(item, now.value)
const counts = computed(() => monthCounts(items.value, month.value))
const countLine = computed(() => {
  const { total, prepared } = counts.value
  const all = t('plan.counts', { n: total }, total)
  return prepared > 0 ? `${all} · ${t('plan.preparedCount', { n: prepared }, prepared)}` : all
})

const canAdd = (date: string) => canEdit.value && date >= today.value
const dayName = (date: string) => formatDay(date, { now: now.value })
/** «Oggi, giovedì 19» on the phone's list */
const LIST_DAY = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long',
  day: 'numeric',
  timeZone: 'UTC',
})
const listDay = (date: string) => {
  const name = LIST_DAY.format(new Date(`${date}T12:00:00Z`))
  return date === today.value ? `${t('plan.today')}, ${name}` : name
}

// ---------------------------------------------------------------- the forms
const form = reactive({
  open: false,
  mode: 'new' as 'new' | 'edit' | 'view',
  item: null as PlanItem | null,
  day: '',
})
function openNew(date: string) {
  Object.assign(form, { open: true, mode: 'new', item: null, day: date })
}
function openItem(item: PlanItem) {
  Object.assign(form, {
    open: true,
    mode: canEdit.value ? 'edit' : 'view',
    item,
    day: item.localDate,
  })
}
function onCell(event: MouseEvent, date: string) {
  // a click on the day itself, not on one of its contents
  if ((event.target as HTMLElement).closest('button, a')) return
  if (canAdd(date)) openNew(date)
}

/**
 * A content as the server answered. A new one joins only when it belongs to the client and the
 * weeks on screen: an answer that comes after a change of month does not add it to another.
 */
function put(item: PlanItem, add = false) {
  const at = items.value.findIndex((i) => i.id === item.id)
  if (at !== -1) {
    items.value = items.value.map((i) => (i.id === item.id ? item : i))
    return
  }
  const { from, to } = planRange(month.value)
  if (
    add &&
    item.workspaceId === client.value?.id &&
    item.localDate >= from &&
    item.localDate <= to
  )
    items.value = [...items.value, item]
}
function saved(item: PlanItem, created: boolean) {
  put(item, created)
}

// ---------------------------------------------------------------- toast and «Annulla»
const toast = reactive({ open: false, message: '', action: '' })
let undo: (() => Promise<void>) | null = null
async function tell(message: string, back: (() => Promise<void>) | null = null) {
  undo = back
  // closed first, so a second message with the same words starts its five seconds again
  toast.open = false
  await nextTick()
  Object.assign(toast, { open: true, message, action: back ? t('plan.undo') : '' })
}
async function runUndo() {
  const back = undo
  undo = null
  if (back) await back()
}
const actionProblem = ref<string | null>(null)
function failed(e: unknown) {
  const f = failure(e)
  if (f.status === 409 || f.status === 404) {
    actionProblem.value = f.status === 409 ? t('plan.form.changed') : t('plan.notFound')
    void load()
  } else actionProblem.value = f.message || t('plan.actionError')
}

// ---------------------------------------------------------------- moving
const moving = reactive({ open: false, item: null as PlanItem | null })
/** the contents whose move is on its way: not moved again until the server answers */
const pending = ref(new Set<string>())
async function move(item: PlanItem, date: string, undoable = true) {
  if (pending.value.has(item.id)) return
  actionProblem.value = null
  const before = item
  pending.value = new Set([...pending.value, item.id])
  // drawn on its new day at once; put back if the server says no
  put({ ...item, localDate: date })
  try {
    const moved = await call<PlanItem>('PATCH', org.api(`/plan/${encodeURIComponent(item.id)}`), {
      version: item.version,
      localDate: date,
    })
    put(moved)
    void tell(
      t('plan.move.done', { day: dayName(date) }),
      undoable
        ? async () => {
            // the version of now: the content may have been changed since the move
            const current = items.value.find((i) => i.id === moved.id) ?? moved
            await move(current, before.localDate, false)
          }
        : null,
    )
  } catch (e) {
    put(before)
    failed(e)
  } finally {
    pending.value = new Set([...pending.value].filter((id) => id !== item.id))
  }
}

const lifted = ref<PlanItem | null>(null)
const over = ref<string | null>(null)
function lift(event: DragEvent, item: PlanItem) {
  lifted.value = item
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.id)
  }
}
function drag(event: DragEvent, date: string) {
  if (!lifted.value || !canAdd(date)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  over.value = date
}
function leave(event: DragEvent, date: string) {
  const to = event.relatedTarget
  if (over.value === date && !(to instanceof Node && (event.currentTarget as Node).contains(to)))
    over.value = null
}
function settle() {
  lifted.value = null
  over.value = null
}
function drop(event: DragEvent, date: string) {
  event.preventDefault()
  const item = lifted.value
  lifted.value = null
  over.value = null
  if (item && canAdd(date) && item.localDate !== date) void move(item, date)
}

// ---------------------------------------------------------------- prepare, open, remove
async function prepare(item: PlanItem) {
  const ws = client.value
  if (!ws) return
  actionProblem.value = null
  try {
    const { postId } = await call<{ postId: string }>(
      'POST',
      org.api(`/plan/${encodeURIComponent(item.id)}/prepare`),
    )
    await navigateTo(postLink(postId))
  } catch (e) {
    failed(e)
  }
}
/** from the window of a content: closed first, so an error is said on the page, in view */
function prepareFromView(item: PlanItem) {
  form.open = false
  void prepare(item)
}
const postLink = (postId: string) =>
  org.to(
    `/spazi/${encodeURIComponent(client.value?.slug ?? '')}/post/${encodeURIComponent(postId)}`,
  )
async function openPost(item: PlanItem) {
  if (item.postId) await navigateTo(postLink(item.postId))
}

async function remove(item: PlanItem) {
  actionProblem.value = null
  try {
    await call('DELETE', org.api(`/plan/${encodeURIComponent(item.id)}`))
    items.value = items.value.filter((i) => i.id !== item.id)
    const prepared = item.state === 'prepared'
    // a prepared one is not given back: its post stays as it is, and a new content would not be its
    void tell(
      t(prepared ? 'plan.removedPrepared' : 'plan.removed', { title: item.title }),
      prepared ? null : () => restore(item),
    )
  } catch (e) {
    failed(e)
  }
}
async function restore(item: PlanItem) {
  try {
    const back = await call<PlanItem>('POST', org.api('/plan'), {
      workspaceId: item.workspaceId,
      localDate: item.localDate,
      localTime: item.localTime,
      type: item.type,
      title: item.title,
      note: item.note,
    })
    put(back, true)
    void tell(t('plan.restored', { title: item.title }))
  } catch (e) {
    failed(e)
  }
}

function actionsOf(item: PlanItem): DropdownMenuItem[][] {
  const first: DropdownMenuItem[] = canEdit.value
    ? [
        { label: t('plan.actions.edit'), icon: 'i-lucide-pencil', onSelect: () => openItem(item) },
        {
          label: t('plan.actions.move'),
          icon: 'i-lucide-calendar-arrow-up',
          onSelect: () => Object.assign(moving, { open: true, item }),
        },
      ]
    : [{ label: t('plan.actions.view'), icon: 'i-lucide-eye', onSelect: () => openItem(item) }]
  const post: DropdownMenuItem[] =
    item.state === 'prepared'
      ? [
          {
            label: t('plan.actions.openPost'),
            icon: 'i-lucide-arrow-up-right',
            onSelect: () => void openPost(item),
          },
        ]
      : canPrepare.value
        ? [
            {
              label: t('plan.actions.prepare'),
              icon: 'i-lucide-file-plus-2',
              onSelect: () => void prepare(item),
            },
          ]
        : []
  const last: DropdownMenuItem[] = canEdit.value
    ? [
        {
          label: t('plan.actions.remove'),
          icon: 'i-lucide-trash-2',
          color: 'error',
          onSelect: () => void remove(item),
        },
      ]
    : []
  return [first, post, last].filter((group) => group.length > 0)
}

// from a notification (`?giorno=`): the day in view on the phone's list
watch(
  () => [loaded.value, picked.value] as const,
  async ([ready, day]) => {
    if (!ready || !day || !import.meta.client) return
    await nextTick()
    if (window.matchMedia('(max-width: 767px)').matches)
      document.querySelector(`[data-plan-list-day="${day}"]`)?.scrollIntoView({ block: 'start' })
  },
)

const WEEKDAYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']
const dayNumber = (date: string) => String(Number(date.slice(8)))
const isPast = (date: string) => date < today.value
const ready = computed(
  () => !enabled.value || (spaces.value !== undefined && (!client.value || loaded.value)),
)
</script>

<template>
  <PageShell :data-ready="ready || undefined">
    <template #head>
      <PageHeader :title="$t('plan.title')">
        <template v-if="client" #aside>{{ client.name }}</template>
      </PageHeader>
    </template>

    <EmptyState v-if="!enabled" icon="i-lucide-notebook-pen" :title="$t('plan.off')" />

    <EmptyState
      v-else-if="!client && spaces"
      icon="i-lucide-briefcase-business"
      :title="$t('plan.choose.title')"
      :text="$t('plan.choose.text')"
    >
      <UButton color="neutral" variant="outline" @click="choosing = true">
        {{ $t('plan.choose.again') }}
      </UButton>
    </EmptyState>

    <div v-else-if="client" data-plan>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-chevron-left"
          class="size-control justify-center pointer-coarse:size-11"
          :to="monthLink(shiftMonth(month, -1))"
          :aria-label="$t('plan.prevMonth')"
          replace
        />
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-chevron-right"
          class="size-control justify-center pointer-coarse:size-11"
          :to="monthLink(shiftMonth(month, 1))"
          :aria-label="$t('plan.nextMonth')"
          replace
        />
        <h2 class="min-w-36 text-[15px]/5 font-semibold" aria-live="polite" data-plan-month>
          {{ monthName }}
        </h2>
        <UButton
          v-if="month !== monthOf(today)"
          color="neutral"
          variant="outline"
          :to="monthLink(monthOf(today))"
          replace
        >
          {{ $t('plan.today') }}
        </UButton>
        <span v-if="loaded" class="text-(--app-text-muted) max-md:w-full" data-plan-counts>
          {{ countLine }}
        </span>
      </div>

      <p v-if="!canEdit" class="mb-3 text-(--app-text-muted)" data-plan-read-only>
        {{ $t('plan.readOnly') }}
      </p>
      <p v-if="actionProblem" role="alert" class="mb-3 text-(--app-danger)">
        {{ actionProblem }}
      </p>

      <LoadFailed v-if="problem && !loaded" :text="problem" @retry="load()" />
      <template v-else>
        <EmptyState
          v-if="loaded && counts.total === 0"
          class="mb-3"
          icon="i-lucide-notebook-pen"
          :title="canEdit ? $t('plan.empty') : $t('plan.emptyRead')"
        />

        <!-- the month, from 768 px -->
        <div
          class="overflow-hidden rounded-card border border-(--app-border) bg-(--app-surface) max-md:hidden"
          :aria-busy="!loaded || undefined"
          data-plan-grid
        >
          <div class="grid grid-cols-7" aria-hidden="true">
            <div
              v-for="d in WEEKDAYS"
              :key="d"
              class="px-2.5 py-2 text-caption font-medium text-(--app-text-muted)"
            >
              {{ d }}
            </div>
          </div>
          <div v-for="(week, w) in weeks" :key="w" class="grid grid-cols-7">
            <div
              v-for="d in week"
              role="group"
              :key="d.date"
              class="group flex min-h-[104px] min-w-0 flex-col gap-[3px] border-t border-l border-(--app-border) p-1.5 first:border-l-0"
              :class="[
                d.inMonth ? '' : 'bg-(--app-surface-sunken)',
                d.date === picked
                  ? 'bg-(--app-brand-soft) shadow-[inset_0_0_0_2px_var(--app-brand)]'
                  : '',
                over === d.date ? 'shadow-[inset_0_0_0_2px_var(--app-text)]' : '',
                canAdd(d.date) ? 'cursor-pointer' : '',
              ]"
              :aria-label="dayName(d.date)"
              :data-plan-day="d.date"
              @click="onCell($event, d.date)"
              @dragover="drag($event, d.date)"
              @dragleave="leave($event, d.date)"
              @drop="drop($event, d.date)"
            >
              <div class="flex h-6 items-center">
                <span
                  class="rounded-[5px] px-1.5 text-caption/5 font-medium"
                  :class="
                    d.date === today
                      ? 'bg-(--app-brand) font-semibold text-(--app-on-brand)'
                      : d.inMonth && !isPast(d.date)
                        ? 'text-(--app-text)'
                        : 'text-(--app-text-muted)'
                  "
                  :data-accent="d.date === today || undefined"
                  aria-hidden="true"
                  >{{ dayNumber(d.date) }}</span
                >
                <button
                  v-if="canAdd(d.date)"
                  type="button"
                  class="ms-auto grid size-6 place-items-center rounded-[5px] text-(--app-text-muted) opacity-0 group-hover:opacity-100 hover:bg-(--app-surface-sunken) hover:text-(--app-text) focus-visible:opacity-100 pointer-coarse:opacity-100"
                  :aria-label="$t('plan.addOn', { day: dayName(d.date) })"
                  data-plan-add
                  @click="openNew(d.date)"
                >
                  <UIcon name="i-lucide-plus" class="size-4" aria-hidden="true" />
                </button>
              </div>
              <PlanCard
                v-for="item in byDay.get(d.date) ?? []"
                :key="item.id"
                :item="item"
                :state="stateOf(item)"
                :actions="actionsOf(item)"
                :draggable="canEdit && !pending.has(item.id)"
                :lifted="lifted?.id === item.id"
                @lift="lift($event, item)"
                @drop="settle"
              />
            </div>
          </div>
        </div>

        <!-- the month as a list of days, on a phone -->
        <ol
          class="rounded-card border border-(--app-border) bg-(--app-surface) md:hidden"
          :aria-busy="!loaded || undefined"
          data-plan-list
        >
          <li
            v-for="date in days"
            :key="date"
            class="scroll-mt-16 border-t border-(--app-border) px-3.5 py-2 first:border-t-0"
            :class="date === picked ? 'bg-(--app-brand-soft)' : ''"
            :data-plan-list-day="date"
          >
            <div class="flex min-h-11 items-center gap-2">
              <h3
                class="text-detail font-semibold first-letter:uppercase"
                :class="isPast(date) ? 'text-(--app-text-muted)' : ''"
              >
                {{ listDay(date) }}
              </h3>
              <UButton
                v-if="canAdd(date)"
                color="neutral"
                variant="ghost"
                icon="i-lucide-plus"
                class="ms-auto size-11 justify-center"
                :aria-label="$t('plan.addOn', { day: dayName(date) })"
                data-plan-add
                @click="openNew(date)"
              />
            </div>
            <div v-if="byDay.get(date)" class="grid gap-1.5 pb-1.5">
              <PlanCard
                v-for="item in byDay.get(date) ?? []"
                :key="item.id"
                :item="item"
                :state="stateOf(item)"
                :actions="actionsOf(item)"
              />
            </div>
          </li>
        </ol>
      </template>
    </div>

    <PlanClientPicker v-model:open="choosing" :clients="choices" @choose="choose" />
    <PlanItemDialog
      v-if="client"
      v-model:open="form.open"
      :mode="form.mode"
      :item="form.item"
      :day="form.day"
      :suggest="suggestFor"
      :today="today"
      :workspace-id="client.id"
      :can-prepare="canPrepare"
      @saved="saved"
      @stale="load()"
      @prepare="prepareFromView"
      @open-post="openPost"
    />
    <PlanMoveDialog
      v-model:open="moving.open"
      :item="moving.item"
      :today="today"
      @move="(item, day) => move(item, day)"
    />
    <Toast
      v-model:open="toast.open"
      :message="toast.message"
      :action-label="toast.action || undefined"
      @action="runUndo"
    />
  </PageShell>
</template>
