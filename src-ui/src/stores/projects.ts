import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  clearJournal,
  forgetRecentProjects,
  type MenuAction,
  onMenuAction,
  openProject,
  pickProjectToOpen,
  pickProjectToSave,
  type Project,
  readJournal,
  recentProjects,
  saveProject,
  setWindowTitle,
  type StoredProject,
  writeJournal,
} from '@/projects'
import {
  type OrphanPad,
  type Portability,
  portabilityOf,
  projectDocument,
  type ResolutionSummary,
  resolveProject,
} from '@/domain/project'
import { useCardStore } from '@/stores/card'
import { usePadsStore } from '@/stores/pads'

export const JOURNAL_DELAY_MS = 2000
const APP_TITLE = 'Pad Bandit'

export const useProjectsStore = defineStore('projects', () => {
  const path = ref<string | null>(null)
  const name = ref<string | null>(null)
  const savedAt = ref<number | null>(null)
  const recent = ref<string[]>([])
  const orphans = ref<OrphanPad[]>([])
  const summary = ref<ResolutionSummary | null>(null)
  const recoverable = ref<Project | null>(null)
  const error = ref<string | null>(null)

  const isNamed = computed(() => Boolean(name.value))
  const hasOrphans = computed(() => orphans.value.length > 0)
  const portability = computed<Portability>(() => portabilityOf(documentFor(name.value ?? '')))
  const isDirty = computed(() => usePadsStore().hasPreparedPads)
  const title = computed(() => {
    const label = name.value ? `${APP_TITLE} — ${name.value}` : APP_TITLE
    return isDirty.value ? `${label} •` : label
  })

  let journalTimer: ReturnType<typeof setTimeout> | null = null
  let stopWatching: (() => void) | null = null
  let stopListening: (() => void) | null = null

  function messageOf(cause: unknown): string {
    if (cause instanceof Error) {
      return cause.message
    }
    return typeof cause === 'string' ? cause : 'That project could not be read.'
  }

  function documentFor(as: string): Project {
    const pads = usePadsStore()
    return projectDocument(as, useCardStore().rootPath, pads.allPads, pads.intentById)
  }

  function adopt(project: Project, from: string | null): void {
    const pads = usePadsStore()
    const resolution = resolveProject(project, pads.cardPads)
    pads.applyProject(resolution)
    orphans.value = resolution.orphans
    summary.value = resolution.summary
    path.value = from
    name.value = project.name
    savedAt.value = project.savedAt
  }

  function accept(stored: StoredProject): void {
    path.value = stored.path
    name.value = stored.project.name
    savedAt.value = stored.project.savedAt
    error.value = null
  }

  async function refresh(): Promise<void> {
    try {
      recent.value = await recentProjects()
    } catch (cause) {
      error.value = messageOf(cause)
    }
  }

  async function save(): Promise<boolean> {
    return path.value ? saveTo(path.value) : saveAs()
  }

  async function saveAs(): Promise<boolean> {
    try {
      const chosen = await pickProjectToSave()
      return chosen ? saveTo(chosen) : false
    } catch (cause) {
      error.value = messageOf(cause)
      return false
    }
  }

  async function saveTo(target: string): Promise<boolean> {
    try {
      accept(await saveProject(target, documentFor(nameFrom(target))))
      await clearJournal()
      await refresh()
      return true
    } catch (cause) {
      error.value = messageOf(cause)
      return false
    }
  }

  async function open(from: string | null = null): Promise<boolean> {
    try {
      const chosen = from ?? (await pickProjectToOpen())
      if (!chosen) {
        return false
      }
      const stored = await openProject(chosen)
      adopt(stored.project, stored.path)
      error.value = null
      await refresh()
      return true
    } catch (cause) {
      error.value = messageOf(cause)
      return false
    }
  }

  function start(): void {
    usePadsStore().discardChanges()
    path.value = null
    name.value = null
    savedAt.value = null
    orphans.value = []
    summary.value = null
    error.value = null
    void clearJournal()
  }

  async function forgetRecent(): Promise<void> {
    try {
      await forgetRecentProjects()
      await refresh()
    } catch (cause) {
      error.value = messageOf(cause)
    }
  }

  async function offerRecovery(): Promise<boolean> {
    try {
      const journal = await readJournal()
      recoverable.value = journal?.project ?? null
      recoveredPath = journal?.path ?? null
      return recoverable.value !== null
    } catch (cause) {
      error.value = messageOf(cause)
      return false
    }
  }

  let recoveredPath: string | null = null

  function restoreRecovered(): void {
    if (!recoverable.value) {
      return
    }
    adopt(recoverable.value, recoveredPath)
    savedAt.value = null
    recoverable.value = null
  }

  async function discardRecovered(): Promise<void> {
    recoverable.value = null
    recoveredPath = null
    try {
      await clearJournal()
    } catch (cause) {
      error.value = messageOf(cause)
    }
  }

  async function journalNow(): Promise<void> {
    const pads = usePadsStore()
    try {
      if (pads.hasPreparedPads) {
        await writeJournal({
          path: path.value,
          project: documentFor(name.value ?? ''),
        })
      } else {
        await clearJournal()
      }
    } catch (cause) {
      error.value = messageOf(cause)
    }
  }

  function apply(action: MenuAction): void {
    switch (action.kind) {
      case 'new':
        return start()
      case 'open':
        void open()
        return
      case 'openRecent':
        void open(action.path)
        return
      case 'save':
        void save()
        return
      case 'saveAs':
        void saveAs()
        return
      case 'forgetRecent':
        void forgetRecent()
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

  function startJournal(): void {
    if (stopWatching) {
      return
    }
    const pads = usePadsStore()
    const stopSettings = watch(
      () => pads.byId,
      () => {
        if (journalTimer) {
          clearTimeout(journalTimer)
        }
        journalTimer = setTimeout(() => {
          journalTimer = null
          void journalNow()
        }, JOURNAL_DELAY_MS)
      },
      { deep: true },
    )
    const stopStructural = watch(
      () => pads.intentById,
      () => {
        void journalNow()
      },
      { deep: true },
    )
    const stopTitle = watch(title, (current) => void showTitle(current), { immediate: true })

    stopWatching = () => {
      stopSettings()
      stopStructural()
      stopTitle()
    }
  }

  function stopJournal(): void {
    if (journalTimer) {
      clearTimeout(journalTimer)
      journalTimer = null
    }
    stopWatching?.()
    stopWatching = null
    stopListening?.()
    stopListening = null
  }

  return {
    path,
    name,
    savedAt,
    recent,
    orphans,
    summary,
    recoverable,
    error,
    isNamed,
    isDirty,
    title,
    hasOrphans,
    portability,
    documentFor,
    refresh,
    save,
    saveAs,
    open,
    start,
    forgetRecent,
    offerRecovery,
    restoreRecovered,
    discardRecovered,
    journalNow,
    listenToMenu,
    startJournal,
    stopJournal,
  }
})

async function showTitle(current: string): Promise<void> {
  try {
    await setWindowTitle(current)
  } catch {
    // the window title is cosmetic; a failure here must not surface as an error
  }
}

function nameFrom(target: string): string {
  const file = target.split(/[\\/]/).pop() ?? target
  return file.replace(/\.[^.]+$/, '')
}
