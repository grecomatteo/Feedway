/**
 * False until the page runs in the browser. Forms drawn by the server stay disabled until then:
 * text typed before would be wiped when Vue takes over the fields, and the submit would do nothing.
 */
export function useHydrated() {
  const ready = ref(false)
  onMounted(() => {
    ready.value = true
  })
  return ready
}
