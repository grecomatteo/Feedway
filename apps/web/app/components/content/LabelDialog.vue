<script setup lang="ts">
import type { LabelDto } from '@app/contracts'
import { LABEL_COLOR_NAMES, type LabelColorName } from '~/composables/useContentSettings'

/** «Nuova etichetta» and «Modifica etichetta»: a name and one of the theme colours (D-68). */
const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ base: string; label: LabelDto | null }>()
const emit = defineEmits<{ saved: [label: LabelDto] }>()
const { t } = useI18n()
const { call, failure } = useApi()

const name = ref('')
const color = ref<LabelColorName>('feedway')
const sending = ref(false)
const problem = ref<{ message: string; field: string } | null>(null)
watch(open, (v) => {
  if (!v) return
  name.value = props.label?.name ?? ''
  color.value = props.label?.color ?? 'feedway'
  problem.value = null
})

async function submit() {
  sending.value = true
  problem.value = null
  try {
    const saved = props.label
      ? await call<LabelDto>(
          'PATCH',
          `${props.base}/labels/${encodeURIComponent(props.label.id)}`,
          { name: name.value, color: color.value },
        )
      : await call<LabelDto>('POST', `${props.base}/labels`, {
          name: name.value,
          color: color.value,
        })
    open.value = false
    emit('saved', saved)
  } catch (e) {
    const f = failure(e)
    problem.value = { message: f.message, field: f.field ?? '' }
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="label ? t('contentSettings.labels.edit') : t('contentSettings.labels.new')"
  >
    <template #body>
      <form id="label-form" class="space-y-5" novalidate @submit.prevent="submit">
        <UFormField
          :label="$t('contentSettings.labels.name')"
          name="label-name"
          :error="problem?.field === 'name' ? problem.message : undefined"
        >
          <UInput v-model="name" class="w-full" size="xl" maxlength="40" autofocus />
        </UFormField>
        <fieldset class="min-w-0">
          <legend class="mb-2 text-sm font-semibold">
            {{ $t('contentSettings.labels.color') }}
          </legend>
          <div class="flex flex-wrap gap-2">
            <label
              v-for="c in LABEL_COLOR_NAMES"
              :key="c"
              class="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--app-focus)"
              :class="
                color === c
                  ? 'border-(--app-text) font-semibold'
                  : 'border-(--app-border) text-(--app-text-muted)'
              "
            >
              <input v-model="color" type="radio" name="label-color" :value="c" class="sr-only" />
              <ContentLabelDot :color="c" />
              {{ $t(`contentSettings.colors.${c}`) }}
            </label>
          </div>
        </fieldset>
        <p
          v-if="problem && problem.field !== 'name'"
          role="alert"
          class="text-sm text-(--app-danger)"
        >
          {{ problem.message }}
        </p>
      </form>
    </template>
    <template #footer>
      <div class="flex flex-wrap gap-3">
        <UButton type="submit" form="label-form" class="min-h-11" :loading="sending">
          {{ label ? $t('contentSettings.save') : $t('contentSettings.labels.create') }}
        </UButton>
        <UButton class="min-h-11" color="neutral" variant="ghost" @click="open = false">
          {{ $t('security.cancel') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
