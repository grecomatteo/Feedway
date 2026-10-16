<script setup lang="ts">
import { WORKSPACES, type PlanItem, type PostType } from '~/fixtures/scenario'
import { TYPE_LABEL, capitalize, dt, workspace } from '~/utils/format'

// "Pianifica": three required fields (day, type, title). Everything else is optional.
const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ item: PlanItem | null, defaultDate: string, workspace?: string }>()
const { state, can, upsertPlan, removePlan } = useDemo()
const toast = useToast()

const editing = ref(false)
const form = reactive({ workspaceId: '', date: '', time: '', type: 'reel' as PostType, title: '', note: '' })
watch(open, (o) => {
  if (!o) return
  editing.value = !props.item
  const it = props.item
  Object.assign(form, {
    workspaceId: it?.workspaceId ?? props.workspace ?? (state.value.client !== 'all' ? state.value.client : ''),
    date: it?.date ?? props.defaultDate, time: it?.time ?? '', type: it?.type ?? 'reel', title: it?.title ?? '', note: it?.note ?? '',
  })
})
const valid = computed(() => !!form.workspaceId && !!form.date && !!form.title.trim())
function save() {
  upsertPlan({ id: props.item?.id ?? `plan-n${Date.now()}`, workspaceId: form.workspaceId, date: form.date, time: form.time || undefined, type: form.type, title: form.title.trim(), note: form.note.trim() || undefined, createdBy: props.item?.createdBy ?? 'Giulia R.' })
  toast.add({ title: props.item ? 'Piano aggiornato' : 'Aggiunto al piano editoriale', description: `${TYPE_LABEL[form.type]} «${form.title.trim()}» · ${capitalize(dt(`${form.date}T12:00:00`).toFormat('ccc d LLLL'))}`, color: 'success' })
  open.value = false
}
function remove() {
  removePlan(props.item!.id)
  toast.add({ title: 'Tolto dal piano editoriale', color: 'neutral' })
  open.value = false
}
async function prepare() {
  open.value = false
  await navigateTo(`/demo/post/nuovo?piano=${props.item!.id}`)
}
const title = computed(() => (editing.value ? (props.item ? 'Modifica il contenuto pianificato' : 'Pianifica un contenuto') : 'Contenuto da preparare'))
</script>

<template>
  <UModal v-model:open="open" :title="title" description="Il piano editoriale dice cosa deve uscire e quando, prima che il contenuto esista.">
    <template #body>
      <div v-if="!editing && item" class="flex flex-col gap-3 text-sm">
        <p class="fw-title text-lg">{{ item.title }}</p>
        <dl class="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1.5">
          <dt class="text-[var(--text-muted)]">Cliente</dt><dd class="font-semibold">{{ workspace(item.workspaceId).short }}</dd>
          <dt class="text-[var(--text-muted)]">Quando</dt><dd>{{ capitalize(dt(`${item.date}T12:00:00`).toFormat('cccc d LLLL')) }}{{ item.time ? `, ${item.time}` : ', orario libero' }}</dd>
          <dt class="text-[var(--text-muted)]">Tipo</dt><dd>{{ TYPE_LABEL[item.type] }}</dd>
          <dt class="text-[var(--text-muted)]">Pianificato da</dt><dd>{{ item.createdBy }}</dd>
        </dl>
        <p v-if="item.note" class="rounded-lg bg-[var(--surface-sunken)] p-3">{{ item.note }}</p>
      </div>
      <form v-else id="plan-form" class="flex flex-col gap-3" @submit.prevent="valid && save()">
        <label v-if="!workspace && (state.client === 'all' || item)" class="text-[13px] font-semibold">Cliente
          <select v-model="form.workspaceId" class="fw-input mt-1" required>
            <option value="" disabled>Scegli il cliente</option>
            <option v-for="w in WORKSPACES" :key="w.id" :value="w.id">{{ w.short }}</option>
          </select>
        </label>
        <p v-else class="text-[13px]">Cliente: <strong>{{ workspace(form.workspaceId).short }}</strong></p>
        <div class="flex flex-wrap gap-3">
          <label class="text-[13px] font-semibold">Giorno<input v-model="form.date" type="date" class="fw-input mt-1 w-44" required></label>
          <label class="text-[13px] font-semibold">Ora <span class="font-normal text-[var(--text-muted)]">(facoltativa)</span><input v-model="form.time" type="time" class="fw-input mt-1 w-32"></label>
        </div>
        <fieldset>
          <legend class="text-[13px] font-semibold">Tipo</legend>
          <div class="mt-1 flex flex-wrap gap-2">
            <label v-for="(l, t) in TYPE_LABEL" :key="t" class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[13px]" :class="form.type === t ? 'border-[var(--fw-carbone)] bg-[var(--brand-soft)] font-semibold' : 'border-[var(--border)]'">
              <input v-model="form.type" type="radio" :value="t" class="accent-[#242321]">{{ l }}
            </label>
          </div>
        </fieldset>
        <label class="text-[13px] font-semibold">Titolo<input v-model="form.title" type="text" placeholder="Per esempio VIDEO 1 · porte aperte" class="fw-input mt-1" required maxlength="80"></label>
        <label class="text-[13px] font-semibold">Nota per chi prepara <span class="font-normal text-[var(--text-muted)]">(facoltativa)</span><textarea v-model="form.note" rows="2" class="fw-input mt-1 resize-y" maxlength="400" /></label>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <template v-if="!editing && item">
          <button v-if="can.plan" type="button" class="fw-btn fw-btn--ghost text-[var(--danger)]" @click="remove">Togli dal piano</button>
          <button v-if="can.plan" type="button" class="fw-btn" @click="editing = true">Modifica</button>
          <button v-if="can.create" type="button" class="fw-btn fw-btn--primary" @click="prepare"><UIcon name="i-lucide-wand-sparkles" class="size-[18px]" aria-hidden="true" />Prepara questo contenuto</button>
        </template>
        <template v-else>
          <button type="button" class="fw-btn" @click="open = false">Annulla</button>
          <button type="submit" form="plan-form" class="fw-btn fw-btn--primary" :disabled="!valid">{{ item ? 'Salva' : 'Aggiungi al piano' }}</button>
        </template>
      </div>
    </template>
  </UModal>
</template>
