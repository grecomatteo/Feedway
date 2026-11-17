import { customRef, getCurrentScope, onScopeDispose, type Ref } from 'vue'

/** How long a confirmation stays on screen (prova 0.10.0, E-3: «spariscono dopo 4–5 secondi»). */
export const FLASH_MS = 5000

/**
 * A confirmation that goes away by itself («…eliminato», «spostato in…», «Tag salvati.»): set it
 * like a ref and it goes back to null after `ms`; a new message starts the time again. Errors do
 * not use it: they stay until the person acts.
 */
export function useFlash(ms = FLASH_MS): Ref<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const flash = customRef<string | null>((track, trigger) => {
    let value: string | null = null
    return {
      get() {
        track()
        return value
      },
      set(next) {
        stop()
        value = next
        if (next !== null)
          timer = setTimeout(() => {
            timer = undefined
            value = null
            trigger()
          }, ms)
        trigger()
      },
    }
  })
  if (getCurrentScope()) onScopeDispose(stop)
  return flash
}
