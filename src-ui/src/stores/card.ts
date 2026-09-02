import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { type CardState, readCard, readCardPresence } from '@/card'
import { getConfig, setCardPath } from '@/config'
import { baseName, getFileSystemGateway } from '@/filesystem'
import { usePadsStore } from '@/stores/pads'

export type CardStatus = 'empty' | 'reading' | 'valid' | 'invalid'

export type CardPresenceState = 'unknown' | 'present' | 'missing' | 'stale'

export const PRESENCE_POLL_MS = 3000

export const useCardStore = defineStore('card', () => {
  const rootPath = ref<string | null>(null)
  const fingerprint = ref<string | null>(null)
  const presence = ref<CardPresenceState>('unknown')
  let seenAt: string | null = null
  let poll: ReturnType<typeof setInterval> | null = null
  let paused = false
  let checkInFlight = false
  const status = ref<CardStatus>('empty')
  const error = ref<string | null>(null)

  const path = computed(() => (rootPath.value ? baseName(rootPath.value) : ''))
  const isValid = computed(() => status.value === 'valid')

  function messageOf(cause: unknown): string {
    if (cause instanceof Error) {
      return cause.message
    }
    return typeof cause === 'string' ? cause : 'Could not open that folder.'
  }

  async function load(): Promise<void> {
    status.value = 'reading'
    try {
      const state = await readCard()
      usePadsStore().loadFromCard(state)
      fingerprint.value = state.fingerprint
      seenAt = (await readCardPresence()).fingerprint
      presence.value = 'present'
      status.value = 'valid'
      error.value = null
    } catch (cause) {
      usePadsStore().resetCard()
      fingerprint.value = null
      seenAt = null
      presence.value = 'unknown'
      status.value = 'invalid'
      error.value = messageOf(cause)
    }
  }

  async function restore(): Promise<void> {
    try {
      rootPath.value = (await getConfig()).cardPath
    } catch (cause) {
      error.value = messageOf(cause)
      return
    }
    if (rootPath.value) {
      await load()
    }
  }

  async function pickCard(): Promise<void> {
    error.value = null
    try {
      const picked = await getFileSystemGateway().pickDirectory()
      if (!picked) {
        return
      }
      rootPath.value = (await setCardPath(picked)).cardPath
    } catch (cause) {
      rootPath.value = null
      status.value = 'invalid'
      error.value = messageOf(cause)
      return
    }
    await load()
  }

  async function adopt(state: CardState): Promise<void> {
    usePadsStore().loadFromCard(state)
    fingerprint.value = state.fingerprint
    seenAt = (await readCardPresence()).fingerprint
    presence.value = 'present'
    status.value = 'valid'
    error.value = null
  }

  async function checkPresence(): Promise<CardPresenceState> {
    if (paused || checkInFlight || status.value !== 'valid' || seenAt === null) {
      return presence.value
    }
    checkInFlight = true
    try {
      const now = await readCardPresence()
      presence.value = !now.present ? 'missing' : now.fingerprint === seenAt ? 'present' : 'stale'
    } catch {
      presence.value = 'missing'
    } finally {
      checkInFlight = false
    }
    return presence.value
  }

  function pausePresence(): void {
    paused = true
  }

  function resumePresence(): void {
    paused = false
  }

  function watchPresence(): void {
    if (poll) {
      return
    }
    poll = setInterval(() => void checkPresence(), PRESENCE_POLL_MS)
  }

  function stopWatching(): void {
    if (poll) {
      clearInterval(poll)
      poll = null
    }
  }

  async function clear(): Promise<void> {
    try {
      await setCardPath(null)
      rootPath.value = null
      fingerprint.value = null
      seenAt = null
      presence.value = 'unknown'
      status.value = 'empty'
      error.value = null
      usePadsStore().resetCard()
    } catch (cause) {
      error.value = messageOf(cause)
    }
  }

  return {
    rootPath,
    fingerprint,
    presence,
    status,
    error,
    path,
    isValid,
    restore,
    pickCard,
    load,
    clear,
    adopt,
    checkPresence,
    pausePresence,
    resumePresence,
    watchPresence,
    stopWatching,
  }
})
