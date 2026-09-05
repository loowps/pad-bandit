import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  type Notice,
  type NoticeInput,
  TOAST_LIFETIME_MS,
  withNotice,
  withoutSource,
  worstSeverity,
} from '@/domain/notices'

export const TOASTS_ON_SCREEN = 3

export const useNoticesStore = defineStore('notices', () => {
  const entries = ref<Notice[]>([])
  const showing = ref(new Set<number>())
  const isOpen = ref(false)
  const seenUpTo = ref(0)

  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  let paused = false
  let lastId = 0

  const toasts = computed(() =>
    entries.value.filter((entry) => showing.value.has(entry.id)).slice(0, TOASTS_ON_SCREEN),
  )

  const worst = computed(() => worstSeverity(entries.value))

  const unseen = computed(() => entries.value.filter((entry) => entry.id > seenUpTo.value).length)

  const count = computed(() => entries.value.length)

  function notify(input: NoticeInput): number {
    lastId += 1
    const notice: Notice = {
      id: lastId,
      severity: input.severity,
      source: input.source,
      title: input.title,
      detail: input.detail ?? null,
      action: input.action ?? null,
      at: Date.now(),
    }

    forgetSource(notice.source)
    entries.value = withNotice(entries.value, notice)
    showing.value.add(notice.id)
    schedule(notice)
    return notice.id
  }

  function schedule(notice: Notice): void {
    if (paused) {
      return
    }
    timers.set(
      notice.id,
      setTimeout(() => hide(notice.id), TOAST_LIFETIME_MS[notice.severity]),
    )
  }

  function stopTimer(id: number): void {
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
  }

  function hide(id: number): void {
    stopTimer(id)
    showing.value.delete(id)
    if (showing.value.size === 0) {
      paused = false
    }
  }

  function dismiss(id: number): void {
    hide(id)
    entries.value = entries.value.filter((entry) => entry.id !== id)
    closeWhenEmpty()
  }

  function forgetSource(source: string): void {
    for (const entry of entries.value) {
      if (entry.source === source) {
        hide(entry.id)
      }
    }
  }

  function resolve(source: string): void {
    forgetSource(source)
    entries.value = withoutSource(entries.value, source)
    closeWhenEmpty()
  }

  function clear(): void {
    for (const timer of timers.values()) {
      clearTimeout(timer)
    }
    timers.clear()
    paused = false
    showing.value = new Set()
    entries.value = []
    seenUpTo.value = lastId
    close()
  }

  function closeWhenEmpty(): void {
    if (entries.value.length === 0) {
      close()
    }
  }

  function open(): void {
    isOpen.value = true
    seenUpTo.value = lastId
  }

  function close(): void {
    isOpen.value = false
  }

  function toggle(): void {
    if (isOpen.value) {
      close()
    } else {
      open()
    }
  }

  function holdToasts(): void {
    paused = true
    for (const timer of timers.values()) {
      clearTimeout(timer)
    }
    timers.clear()
  }

  function releaseToasts(): void {
    paused = false
    for (const notice of toasts.value) {
      schedule(notice)
    }
  }

  onScopeDispose(clear)

  return {
    entries,
    isOpen,
    unseen,
    toasts,
    worst,
    count,
    notify,
    hide,
    dismiss,
    resolve,
    clear,
    close,
    toggle,
    holdToasts,
    releaseToasts,
  }
})
