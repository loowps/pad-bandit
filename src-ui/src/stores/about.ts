import { ref } from 'vue'
import { defineStore } from 'pinia'
import { appVersion, openLink } from '@/about'
import { type MenuAction, onMenuAction } from '@/projects'
import { explain } from '@/domain/errors'
import { useNoticesStore } from '@/stores/notices'

const ABOUT_NOTICE = 'about'

export const useAboutStore = defineStore('about', () => {
  const isOpen = ref(false)
  const version = ref<string | null>(null)

  let stopListening: (() => void) | null = null

  function report(cause: unknown, title: string, fallback: string): void {
    useNoticesStore().notify({
      severity: 'error',
      source: ABOUT_NOTICE,
      title,
      detail: explain(cause, fallback),
    })
  }

  async function open(): Promise<void> {
    isOpen.value = true
    if (version.value) {
      return
    }
    try {
      version.value = await appVersion()
    } catch (cause) {
      report(cause, 'The version could not be read', 'The app did not report its version.')
    }
  }

  function close(): void {
    isOpen.value = false
  }

  async function follow(url: string): Promise<void> {
    try {
      await openLink(url)
      useNoticesStore().resolve(ABOUT_NOTICE)
    } catch (cause) {
      report(cause, 'The link could not be opened', 'No browser accepted the link.')
    }
  }

  function apply(action: MenuAction): void {
    if (action.kind === 'about') {
      void open()
    }
  }

  async function listenToMenu(): Promise<void> {
    if (stopListening) {
      return
    }
    try {
      stopListening = await onMenuAction(apply)
    } catch (cause) {
      report(cause, 'The Help menu is not connected', 'The menu could not be reached.')
    }
  }

  function stopListeningToMenu(): void {
    stopListening?.()
    stopListening = null
  }

  return { isOpen, version, open, close, follow, listenToMenu, stopListeningToMenu }
})
