import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { AppConfig } from '@/config'
import type { CardPadSettings } from '@/card'

export const PROJECT_VERSION = 1
export const PROJECT_EXTENSION = 'padbandit'

export interface ProjectDiskRef {
  kind: 'path'
  path: string
}

export interface ProjectCardRef {
  kind: 'card'
  originSlot: number
  fileName: string
  fingerprint: string
}

export type ProjectAudioRef = ProjectDiskRef | ProjectCardRef

export type ProjectIntentKind = 'keep' | 'sample' | 'clear'

export interface ProjectEdit {
  settings: CardPadSettings
  startFrame: number
  endFrame: number
}

export interface ProjectSlot {
  slot: number
  intent: ProjectIntentKind
  audio: ProjectAudioRef | null
  edit: ProjectEdit
}

export interface Project {
  version: number
  name: string
  savedAt: number
  cardRoot: string | null
  slots: ProjectSlot[]
}

export interface StoredProject {
  path: string
  project: Project
}

export interface Journal {
  path: string | null
  project: Project
}

export type MenuAction =
  | { kind: 'new' }
  | { kind: 'open' }
  | { kind: 'save' }
  | { kind: 'saveAs' }
  | { kind: 'forgetRecent' }
  | { kind: 'openRecent'; path: string }

export function pickProjectToSave(): Promise<string | null> {
  return invoke<string | null>('project_pick_to_save')
}

export function pickProjectToOpen(): Promise<string | null> {
  return invoke<string | null>('project_pick_to_open')
}

export function saveProject(path: string, project: Project): Promise<StoredProject> {
  return invoke<StoredProject>('project_save', { path, project })
}

export function openProject(path: string): Promise<StoredProject> {
  return invoke<StoredProject>('project_open', { path })
}

export function recentProjects(): Promise<string[]> {
  return invoke<string[]>('project_recent')
}

export function forgetRecentProjects(path: string | null = null): Promise<AppConfig> {
  return invoke<AppConfig>('project_forget_recent', { path })
}

export function writeJournal(journal: Journal): Promise<void> {
  return invoke<void>('journal_write', { journal })
}

export function readJournal(): Promise<Journal | null> {
  return invoke<Journal | null>('journal_read')
}

export function clearJournal(): Promise<void> {
  return invoke<void>('journal_clear')
}

export function setWindowTitle(title: string): Promise<void> {
  return invoke<void>('window_set_title', { title })
}

export function onMenuAction(handler: (action: MenuAction) => void): Promise<UnlistenFn> {
  return listen<MenuAction>('menu-action', (event) => handler(event.payload))
}
