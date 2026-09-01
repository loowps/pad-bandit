import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { usePreferredDark } from '@vueuse/core'
import { getConfig, setTheme, type Theme } from '@/config'
import { type MenuAction, onMenuAction } from '@/projects'
import { type ResolvedTheme, resolveTheme } from '@/domain/theme'

export const useThemeStore = defineStore('theme', () => {
  const preference = ref<Theme>('system')
  const error = ref<string | null>(null)
  const prefersDark = usePreferredDark()

  const resolved = computed<ResolvedTheme>(() => resolveTheme(preference.value, prefersDark.value))

  let stopListening: (() => void) | null = null

  watch(resolved, (mode) => (document.documentElement.dataset.theme = mode), { immediate: true })

  function messageOf(cause: unknown): string {
    if (cause instanceof Error) {
      return cause.message
    }
    return typeof cause === 'string' ? cause : 'The appearance could not be changed.'
  }

  async function restore(): Promise<void> {
    try {
      preference.value = (await getConfig()).theme
    } catch (cause) {
      error.value = messageOf(cause)
    }
  }

  async function choose(next: Theme): Promise<void> {
    const previous = preference.value
    preference.value = next
    try {
      preference.value = (await setTheme(next)).theme
      error.value = null
    } catch (cause) {
      preference.value = previous
      error.value = messageOf(cause)
    }
  }

  function apply(action: MenuAction): void {
    if (action.kind === 'setTheme') {
      void choose(action.theme)
    }
  }

  async function listenToMenu(): Promise<void> {
    if (stopListening) {
      return
    }
    try {
      stopListening = await onMenuAction(apply)
    } catch (cause) {
      error.value = messageOf(cause)
    }
  }

  function stopListeningToMenu(): void {
    stopListening?.()
    stopListening = null
  }

  return {
    preference,
    resolved,
    error,
    restore,
    choose,
    listenToMenu,
    stopListeningToMenu,
  }
})
