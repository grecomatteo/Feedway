import type { AccountGroupDto, CaptionTemplateDto, LabelDto } from '@app/contracts'
import { palettes } from '@app/ui'

/**
 * The content settings of a client (spec §11.7, plan 06 Task 7): its labels, caption templates
 * and account groups, read by everyone who sees the client and changed by its Manager and above.
 * The client's page and the editor read them the same way.
 */
export function useContentSettings(workspaceId: Ref<string | null>) {
  const org = useOrganization()
  const { call } = useApi()
  const base = computed(() =>
    workspaceId.value ? org.api(`/workspaces/${encodeURIComponent(workspaceId.value)}`) : '',
  )
  const labels = ref<LabelDto[] | null>(null)
  const templates = ref<CaptionTemplateDto[] | null>(null)
  const groups = ref<AccountGroupDto[] | null>(null)
  const failed = ref(false)

  async function load() {
    if (!base.value) return
    failed.value = false
    try {
      const [l, t, g] = await Promise.all([
        call<{ items: LabelDto[] }>('GET', `${base.value}/labels`),
        call<{ items: CaptionTemplateDto[] }>('GET', `${base.value}/caption-templates`),
        call<{ items: AccountGroupDto[] }>('GET', `${base.value}/account-groups`),
      ])
      labels.value = l.items
      templates.value = t.items
      groups.value = g.items
    } catch {
      failed.value = true
    }
  }
  watch(base, () => void load(), { immediate: true })

  return { base, labels, templates, groups, failed, load }
}

export type LabelColorName = LabelDto['color']
export const LABEL_COLOR_NAMES: readonly LabelColorName[] = [
  'feedway',
  'blu',
  'verde',
  'viola',
  'grafite',
]

/** A label is drawn with the accent of its theme (D-68), by day or by night as the panel is. */
export function useLabelColor() {
  const mode = useColorMode()
  return (color: LabelColorName) => palettes[color][mode.value === 'dark' ? 'dark' : 'light'].brand
}
