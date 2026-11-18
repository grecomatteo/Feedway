<script setup lang="ts">
import type { CaptionTemplateDto } from '@app/contracts'

/** «Nuovo modello» and «Modifica modello»: a text, a signature or hashtags, with a name. */
const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ base: string; template: CaptionTemplateDto | null }>()
const emit = defineEmits<{ saved: [template: CaptionTemplateDto] }>()
const { t } = useI18n()
const { call, failure } = useApi()

type Kind = CaptionTemplateDto['kind']
const KINDS: readonly Kind[] = ['caption', 'signature', 'hashtags']
const form = reactive({ kind: 'caption' as Kind, name: '', body: '' })
const sending = ref(false)
const problem = ref<{ message: string; field: string } | null>(null)
watch(open, (v) => {
  if (!v) return
  form.kind = props.template?.kind ?? 'caption'
  form.name = props.template?.name ?? ''
  form.body = props.template?.body ?? ''
  problem.value = null
})
const kindItems = computed(() =>
  KINDS.map((k) => ({ value: k, label: t(`contentSettings.templates.kind.${k}`) })),
)

async function submit() {
  sending.value = true
  problem.value = null
  try {
    const body = { kind: form.kind, name: form.name, body: form.body }
    const saved = props.template
      ? await call<CaptionTemplateDto>(
          'PATCH',
          `${props.base}/caption-templates/${encodeURIComponent(props.template.id)}`,
          body,
        )
      : await call<CaptionTemplateDto>('POST', `${props.base}/caption-templates`, body)
    open.value = false
    emit('saved', saved)
  } catch (e) {
    const f = failure(e)
    problem.value = { message: f.message, field: f.field ?? '' }
  } finally {
    sending.value = false
  }
}
const errorOf = (field: string) =>
  problem.value?.field === field ? problem.value.message : undefined
</script>

<template>
  <UModal
    v-model:open="open"
    :title="template ? t('contentSettings.templates.edit') : t('contentSettings.templates.new')"
  >
    <template #body>
      <form id="template-form" class="space-y-5" novalidate @submit.prevent="submit">
        <UFormField :label="$t('contentSettings.templates.kindLabel')" name="template-kind">
          <URadioGroup
            v-model="form.kind"
            :items="kindItems"
            orientation="horizontal"
            :ui="{ item: 'min-h-11 items-center' }"
          />
        </UFormField>
        <UFormField
          :label="$t('contentSettings.templates.name')"
          name="template-name"
          :error="errorOf('name')"
        >
          <UInput v-model="form.name" class="w-full" size="xl" maxlength="80" />
        </UFormField>
        <UFormField
          :label="$t('contentSettings.templates.body')"
          :help="$t('contentSettings.templates.bodyHelp')"
          name="template-body"
          :error="errorOf('body')"
        >
          <UTextarea v-model="form.body" class="w-full" :rows="5" autoresize maxlength="2200" />
        </UFormField>
        <p
          v-if="problem && !['name', 'body'].includes(problem.field)"
          role="alert"
          class="text-sm text-(--app-danger)"
        >
          {{ problem.message }}
        </p>
      </form>
    </template>
    <template #footer>
      <div class="flex flex-wrap gap-3">
        <UButton type="submit" form="template-form" class="min-h-11" :loading="sending">
          {{ template ? $t('contentSettings.save') : $t('contentSettings.templates.create') }}
        </UButton>
        <UButton class="min-h-11" color="neutral" variant="ghost" @click="open = false">
          {{ $t('security.cancel') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
