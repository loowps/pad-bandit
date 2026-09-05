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
  type ProjectResolution,
  resolveProject,
} from '@/domain/project'
import { explain } from '@/domain/errors'
import { useCardStore } from '@/stores/card'
import { useNoticesStore } from '@/stores/notices'
import { usePadsStore } from '@/stores/pads'

export const JOURNAL_DELAY_MS = 2000
const APP_TITLE = 'Pad Bandit'
const PROJECT_NOTICE = 'project'
const JOURNAL_NOTICE = 'project:journal'
const REOPENED_NOTICE = 'project:reopened'

export const useProjectsStore = defineStore('projects', () => {
  const path = ref<string | null>(null)
  const name = ref<string | null>(null)
  const savedAt = ref<number | null>(null)
  const recent = ref<string[]>([])
  const orphans = ref<OrphanPad[]>([])
  const recoverable = ref<Project | null>(null)

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

  function report(cause: unknown, title: string, source: string = PROJECT_NOTICE): void {
    useNoticesStore().notify({
      severity: 'error',
      source,
      title,
      detail: explain(cause, 'That project could not be read.'),
    })
  }

  function announce(project: Project, resolution: ProjectResolution): void {
    const lines = [
      { count: resolution.summary.resolved, label: 'resolved' },
      { count: resolution.summary.moved, label: 'found in a different slot' },
      { count: resolution.summary.missing, label: 'source missing' },
      { count: resolution.summary.keeping, label: 'unchanged' },
    ].filter((line) => line.count > 0)

    if (lines.length === 0) {
      return
    }

    const against = useCardStore().path
    const named = project.name ? `“${project.name}”` : 'The project'

    useNoticesStore().notify({
      severity: resolution.summary.missing > 0 ? 'warning' : 'info',
      source: REOPENED_NOTICE,
      title: against ? `${named} reopened against ${against}` : `${named} reopened`,
      detail: lines.map((line) => `${line.count} ${line.label}`).join(' · '),
    })
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
    announce(project, resolution)
    path.value = from
    name.value = project.name
    savedAt.value = project.savedAt
  }

  function accept(stored: StoredProject): void {
    path.value = stored.path
    name.value = stored.project.name
    savedAt.value = stored.project.savedAt
    useNoticesStore().resolve(PROJECT_NOTICE)
  }

  async function refresh(): Promise<void> {
    try {
      recent.value = await recentProjects()
    } catch (cause) {
      report(cause, 'The recent projects list could not be read')
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
      report(cause, 'The project could not be saved')
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
      report(cause, 'The project could not be saved')
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
      useNoticesStore().resolve(PROJECT_NOTICE)
      await refresh()
      return true
    } catch (cause) {
      report(cause, 'The project could not be opened')
      return false
    }
  }

  function start(): void {
    usePadsStore().discardChanges()
    path.value = null
    name.value = null
    savedAt.value = null
    orphans.value = []
    const notices = useNoticesStore()
    notices.resolve(PROJECT_NOTICE)
    notices.resolve(REOPENED_NOTICE)
    void clearJournal()
  }

  async function forgetRecent(): Promise<void> {
    try {
      await forgetRecentProjects()
      await refresh()
    } catch (cause) {
      report(cause, 'The recent projects list could not be cleared')
    }
  }

  async function offerRecovery(): Promise<boolean> {
    try {
      const journal = await readJournal()
      recoverable.value = journal?.project ?? null
      recoveredPath = journal?.path ?? null
      return recoverable.value !== null
    } catch (cause) {
      report(cause, 'Unsaved work could not be looked for')
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
      report(cause, 'The recovered work could not be cleared')
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
      report(cause, 'Unsaved work is not being kept for recovery', JOURNAL_NOTICE)
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
      report(cause, 'The Project menu is not connected')
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
    recoverable,
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
