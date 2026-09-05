import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { usePreferredDark } from '@vueuse/core'
import { getConfig, setTheme, type Theme } from '@/config'
import { type MenuAction, onMenuAction } from '@/projects'
import { type ResolvedTheme, resolveTheme } from '@/domain/theme'
import { explain } from '@/domain/errors'
import { useNoticesStore } from '@/stores/notices'

const THEME_NOTICE = 'theme'

export const useThemeStore = defineStore('theme', () => {
  const preference = ref<Theme>('system')
  const prefersDark = usePreferredDark()

  const resolved = computed<ResolvedTheme>(() => resolveTheme(preference.value, prefersDark.value))

  let stopListening: (() => void) | null = null

  watch(resolved, (mode) => (document.documentElement.dataset.theme = mode), { immediate: true })

  function report(cause: unknown, title: string): void {
    useNoticesStore().notify({
      severity: 'error',
      source: THEME_NOTICE,
      title,
      detail: explain(cause, 'The settings file could not be written.'),
    })
  }

  async function restore(): Promise<void> {
    try {
      preference.value = (await getConfig()).theme
    } catch (cause) {
      report(cause, 'The saved appearance could not be read')
    }
  }

  async function choose(next: Theme): Promise<void> {
    const previous = preference.value
    preference.value = next
    try {
      preference.value = (await setTheme(next)).theme
      useNoticesStore().resolve(THEME_NOTICE)
    } catch (cause) {
      preference.value = previous
      report(cause, 'The appearance could not be changed')
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
      report(cause, 'The View menu is not connected')
    }
  }

  function stopListeningToMenu(): void {
    stopListening?.()
    stopListening = null
  }

  return {
    preference,
    resolved,
    restore,
    choose,
    listenToMenu,
    stopListeningToMenu,
  }
})
