import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  clearJournal,
  closeWindow,
  forgetRecentProjects,
  keepWindowOpen,
  type MenuAction,
  onCloseRequested,
  onMenuAction,
  openProject,
  pickProjectToOpen,
  pickProjectToSave,
  type Project,
  readJournal,
  recentProjects,
  saveProject,
  setWindowTitle,
  setWindowUnsaved,
  type StoredProject,
  writeJournal,
} from '@/projects'
import {
  type Divergence,
  divergedPads,
  diskPathsOf,
  type Portability,
  portabilityOf,
  projectDocument,
  type ProjectResolution,
  resolveProject,
  type RestoreChoice,
} from '@/domain/project'
import { explain } from '@/domain/errors'
import { type FrameRegion, regionsAtSource } from '@/audio'
import { getFileSystemGateway } from '@/filesystem'
import { useCardStore } from '@/stores/card'
import { useNoticesStore } from '@/stores/notices'
import { usePadsStore } from '@/stores/pads'

export const JOURNAL_DELAY_MS = 2000
const APP_TITLE = 'Pad Bandit'
const PROJECT_NOTICE = 'project'
const JOURNAL_NOTICE = 'project:journal'
const REOPENED_NOTICE = 'project:reopened'
const CLOSING_NOTICE = 'project:closing'
const UNTRIMMED: FrameRegion = { startFrame: 0, endFrame: 0 }

export interface RestoreOffer {
  name: string
  divergence: Divergence
}

export const useProjectsStore = defineStore('projects', () => {
  const path = ref<string | null>(null)
  const name = ref<string | null>(null)
  const savedAt = ref<number | null>(null)
  const recent = ref<string[]>([])
  const recoverable = ref<Project | null>(null)
  const restoreOffer = ref<RestoreOffer | null>(null)
  const closeOffer = ref(false)
  const savedSlots = ref<string | null>(null)
  let answerOffer: ((choice: RestoreChoice) => void) | null = null

  const isNamed = computed(() => Boolean(name.value))
  const portability = computed<Portability>(() => portabilityOf(documentFor(name.value ?? '')))
  const currentSlots = computed(() => JSON.stringify(documentFor('').slots))
  const isDirty = computed(
    () => usePadsStore().hasPreparedPads && currentSlots.value !== savedSlots.value,
  )
  const title = computed(() => {
    const label = name.value ? `${APP_TITLE} — ${name.value}` : APP_TITLE
    return isDirty.value ? `${label} •` : label
  })

  let journalTimer: ReturnType<typeof setTimeout> | null = null
  let stopWatching: (() => void) | null = null
  let stopListening: (() => void) | null = null
  let stopListeningToClose: (() => void) | null = null

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
      { count: resolution.summary.fromDisk, label: 'restored from disk' },
      { count: resolution.summary.missing, label: 'source missing' },
      { count: resolution.summary.cleared, label: 'cleared' },
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

  async function missingDiskPaths(project: Project): Promise<Set<string>> {
    const paths = diskPathsOf(project)
    return new Set(paths.length > 0 ? await getFileSystemGateway().missingFiles(paths) : [])
  }

  function askToRestore(project: Project, divergence: Divergence): Promise<RestoreChoice> {
    restoreOffer.value = { name: project.name, divergence }
    return new Promise((answer) => {
      answerOffer = answer
    })
  }

  function answerRestore(choice: RestoreChoice): void {
    const answer = answerOffer
    answerOffer = null
    restoreOffer.value = null
    answer?.(choice)
  }

  async function withSourceRegions(resolution: ProjectResolution): Promise<ProjectResolution> {
    const restored = resolution.fromSource.flatMap((id) => {
      const pad = resolution.pads[id]
      return pad?.audio ? [{ pad, path: pad.audio.path }] : []
    })
    if (restored.length === 0) {
      return resolution
    }

    const regions = await regionsAtSource(
      restored.map(({ pad, path }) => ({
        path,
        region: { startFrame: pad.settings.startFrame, endFrame: pad.settings.endFrame },
      })),
    )
    restored.forEach(({ pad }, at) => {
      pad.settings = { ...pad.settings, ...(regions[at] ?? UNTRIMMED) }
    })
    return resolution
  }

  async function adopt(project: Project, from: string | null): Promise<void> {
    const pads = usePadsStore()
    const missing = await missingDiskPaths(project)
    let resolution = resolveProject(project, pads.cardPads, missing)
    if (divergedPads(resolution.divergence) > 0) {
      const choice = await askToRestore(project, resolution.divergence)
      resolution = resolveProject(project, pads.cardPads, missing, choice)
    }
    pads.applyProject(await withSourceRegions(resolution))
    savedSlots.value = currentSlots.value
    announce(project, resolution)
    path.value = from
    name.value = project.name
    savedAt.value = project.savedAt
  }

  function accept(stored: StoredProject): void {
    path.value = stored.path
    name.value = stored.project.name
    savedAt.value = stored.project.savedAt
    savedSlots.value = currentSlots.value
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
      await adopt(stored.project, stored.path)
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
    savedSlots.value = null
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

  async function restoreRecovered(): Promise<void> {
    if (!recoverable.value) {
      return
    }
    try {
      await adopt(recoverable.value, recoveredPath)
    } catch (cause) {
      report(cause, 'The unsaved work could not be restored')
      return
    }
    savedAt.value = null
    savedSlots.value = null
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
    try {
      if (isDirty.value) {
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

  async function markUnsaved(unsaved: boolean): Promise<void> {
    try {
      await setWindowUnsaved(unsaved)
    } catch (cause) {
      report(cause, 'Closing the window will not ask about unsaved work', CLOSING_NOTICE)
    }
  }

  async function listenToClose(): Promise<void> {
    if (stopListeningToClose) {
      return
    }
    try {
      stopListeningToClose = await onCloseRequested(() => {
        closeOffer.value = true
      })
    } catch (cause) {
      report(cause, 'Closing the window will not ask about unsaved work', CLOSING_NOTICE)
    }
  }

  async function close(): Promise<void> {
    try {
      await closeWindow()
    } catch (cause) {
      report(cause, 'The window could not be closed', CLOSING_NOTICE)
    }
  }

  async function saveAndClose(): Promise<void> {
    closeOffer.value = false
    if (await save()) {
      await close()
    } else {
      await stayOpen()
    }
  }

  async function closeWithoutSaving(): Promise<void> {
    closeOffer.value = false
    try {
      await clearJournal()
    } catch (cause) {
      report(cause, 'The unsaved work could not be let go', CLOSING_NOTICE)
      return
    }
    await close()
  }

  async function stayOpen(): Promise<void> {
    closeOffer.value = false
    try {
      await keepWindowOpen()
    } catch (cause) {
      report(cause, 'Closing the window will not ask again', CLOSING_NOTICE)
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
    const stopUnsaved = watch(isDirty, (dirty) => void markUnsaved(dirty), { immediate: true })

    stopWatching = () => {
      stopSettings()
      stopStructural()
      stopTitle()
      stopUnsaved()
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
    stopListeningToClose?.()
    stopListeningToClose = null
  }

  return {
    path,
    name,
    savedAt,
    recent,
    recoverable,
    restoreOffer,
    answerRestore,
    closeOffer,
    saveAndClose,
    closeWithoutSaving,
    stayOpen,
    isNamed,
    isDirty,
    title,
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
    listenToClose,
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
