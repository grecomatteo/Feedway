import type { AccountGroupDto, CaptionTemplateDto, LabelDto } from '@app/contracts'

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
    // after a failed read the lists were emptied: read again, they wait (skeletons, not «none»)
    if (failed.value) {
      labels.value = null
      templates.value = null
      groups.value = null
    }
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
      // the menus stop waiting: empty, and the editor says the lists could not be read
      labels.value ??= []
      templates.value ??= []
      groups.value ??= []
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

/**
 * The mark of a label: a small square in a deep tone of its theme (screens 08, 17 and 18), so it
 * never passes for the orange of «Nuovo post»; lighter by night, to show on the dark surfaces.
 * Feedway's is the amber of the screens, not the brand's orange (review of fidelity, B1).
 */
export const LABEL_MARKS: Record<LabelColorName, { light: string; dark: string }> = {
  feedway: { light: '#D98A00', dark: '#F0A733' },
  blu: { light: '#1F5AA6', dark: '#6EA8F0' },
  verde: { light: '#17693F', dark: '#4FBF80' },
  viola: { light: '#7F4BB1', dark: '#BF8AE6' },
  grafite: { light: '#4A4F57', dark: '#A39E95' },
}

/** A label's mark by day or by night, as the panel is (D-68). */
export function useLabelColor() {
  const mode = useColorMode()
  return (color: LabelColorName) => LABEL_MARKS[color][mode.value === 'dark' ? 'dark' : 'light']
}
