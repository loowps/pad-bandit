import { invoke } from '@tauri-apps/api/core'

export interface BrowseFolder {
  id: string
  path: string
  addedAt: number
}

export interface WindowState {
  width: number
  height: number
  x: number | null
  y: number | null
  maximized: boolean
}

export interface AppConfig {
  version: number
  browseFolders: BrowseFolder[]
  cardPath: string | null
  recentProjects: string[]
  window: WindowState
}

export function getConfig(): Promise<AppConfig> {
  return invoke<AppConfig>('config_get')
}

export function addBrowseFolder(path: string): Promise<AppConfig> {
  return invoke<AppConfig>('config_add_folder', { path })
}

export function removeBrowseFolder(id: string): Promise<AppConfig> {
  return invoke<AppConfig>('config_remove_folder', { id })
}

export function setCardPath(path: string | null): Promise<AppConfig> {
  return invoke<AppConfig>('config_set_card_path', { path })
}
