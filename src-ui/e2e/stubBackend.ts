import type { Page } from '@playwright/test'

export interface StubEntry {
  name: string
  path: string
  isDir: boolean
  isAudio: boolean
}

export interface StubSlot {
  slot: number
  settings: Record<string, unknown>
  sample: Record<string, unknown> | null
}

export interface StubBackend {
  browseFolders?: { id: string; path: string; addedAt: number }[]
  cardPath?: string | null
  pickedFolder?: string | null
  pickedProject?: string | null
  entries?: Record<string, StubEntry[]>
  card?: { root: string; fingerprint: string; slots: StubSlot[] } | null
}

export const STUB_PROJECT_PATH = '/sets/march.padbandit'

export type StubMenuAction =
  | { kind: 'new' }
  | { kind: 'open' }
  | { kind: 'save' }
  | { kind: 'saveAs' }
  | { kind: 'forgetRecent' }
  | { kind: 'openRecent'; path: string }
  | { kind: 'setTheme'; theme: 'system' | 'light' | 'dark' }

declare global {
  interface Window {
    __MENU__: (action: StubMenuAction) => void
    __SET_ENTRIES__: (path: string, items: StubEntry[]) => void
  }
}

export function chooseFromMenu(page: Page, action: StubMenuAction): Promise<void> {
  return page.evaluate((chosen) => window.__MENU__(chosen), action)
}

export function setEntries(page: Page, path: string, items: StubEntry[]): Promise<void> {
  return page.evaluate((given) => window.__SET_ENTRIES__(given.path, given.items), { path, items })
}

export function cardWithFilledSlots(
  root: string,
  filled: number,
): { root: string; fingerprint: string; slots: StubSlot[] } {
  return {
    root,
    fingerprint: `fp-${root}-${filled}`,
    slots: Array.from({ length: 120 }, (_unused, slot) => ({
      slot,
      settings: {
        volume: 127,
        lofi: false,
        loop: false,
        gate: true,
        reverse: false,
        tempoMode: 'off',
        originalTempo: 119.9,
        userTempo: 119.9,
      },
      sample:
        slot < filled
          ? {
              fileName: `sample${slot}.wav`,
              path: `${root}/sample${slot}.wav`,
              fingerprint: `size:176912 head:${slot} tail:${slot}`,
              format: 'wave',
              channels: 2,
              frames: 44100,
              sizeBytes: 176912,
              startFrame: 0,
              endFrame: 44100,
            }
          : null,
    })),
  }
}

export async function stubBackend(page: Page, backend: StubBackend = {}): Promise<void> {
  await page.addInitScript(
    (given: Required<StubBackend>) => {
      const config = {
        version: 1,
        browseFolders: [...given.browseFolders],
        cardPath: given.cardPath,
        recentProjects: [],
        theme: 'light',
        window: { width: 1230, height: 900, x: null, y: null, maximized: false },
      }

      type StubProject = {
        name: string
        savedAt: number
        cardRoot: string | null
        slots: unknown[]
      }
      const files: Record<string, StubProject> = {}
      let recent: string[] = []
      let journal: { path: string | null; project: StubProject } | null = null

      const calls: { command: string; args: unknown }[] = []
      Object.defineProperty(window, '__BACKEND_CALLS__', { value: calls, configurable: true })

      type Listener = (event: { event: string; id: number; payload: unknown }) => void
      const listeners: Record<string, Listener[]> = {}

      Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', {
        configurable: true,
        value: {
          unregisterListener: (event: string, eventId: number) => {
            listeners[event] = (listeners[event] ?? []).filter(
              (_known, index) => index + 1 !== eventId,
            )
          },
        },
      })

      Object.defineProperty(window, '__MENU__', {
        configurable: true,
        value: (action: unknown) => {
          for (const listener of listeners['menu-action'] ?? []) {
            listener({ event: 'menu-action', id: 1, payload: action })
          }
        },
      })

      Object.defineProperty(window, '__SET_ENTRIES__', {
        configurable: true,
        value: (path: string, items: unknown) => {
          given.entries[path] = items as (typeof given.entries)[string]
        },
      })

      const handlers: Record<string, (args: Record<string, never>) => unknown> = {
        config_get: () => config,
        config_add_folder: ({ path }) => {
          const folder = { id: `f${config.browseFolders.length + 1}`, path, addedAt: 1 }
          config.browseFolders = [...config.browseFolders, folder]
          return config
        },
        config_remove_folder: ({ id }) => {
          config.browseFolders = config.browseFolders.filter((folder) => folder.id !== id)
          return config
        },
        config_set_card_path: ({ path }) => {
          config.cardPath = path
          return config
        },
        config_set_theme: ({ theme }) => {
          config.theme = theme
          return config
        },
        pick_folder: () => given.pickedFolder,
        list_dir: ({ path }) => given.entries[path] ?? [],
        index_busy: () => false,
        index_refresh: () => null,
        index_search: ({ query }) => {
          const needle = String(query).trim().toLowerCase()
          const relative = (parent: string) => {
            const root = config.browseFolders.find((folder) => parent.startsWith(folder.path))
            return root ? parent.slice(root.path.length).replace(/^[\\/]/, '') : parent
          }

          const hits = Object.entries(given.entries).flatMap(([parent, items]) =>
            items
              .filter((item) => !item.isDir && item.isAudio)
              .filter(
                (item) =>
                  item.name.toLowerCase().includes(needle) ||
                  relative(parent).toLowerCase().includes(needle),
              )
              .map((item) => ({
                path: item.path,
                name: item.name,
                location: relative(parent),
              })),
          )

          return { hits, truncated: false }
        },
        audio_undecodable: () => [],
        audio_peaks: ({ path, columns }) => {
          const total = Math.max(1, Number(columns))
          const sample = given.card?.slots
            .map((slot) => slot.sample as { path: string; frames: number } | null)
            .find((each) => each?.path === path)

          let seed = String(path)
            .split('')
            .reduce((carried, letter) => (carried * 31 + letter.charCodeAt(0)) % 65521, 7)

          const minMax: number[] = []
          for (let column = 0; column < total; column++) {
            seed = (seed * 1103515245 + 12345) % 2147483648
            const position = column / total
            const attack = Math.min(1, position * 40)
            const decay = Math.exp(-4 * position)
            const amplitude = attack * decay * (0.35 + 0.65 * (seed / 2147483648))
            minMax.push(-amplitude, amplitude)
          }

          return {
            minMax,
            columns: total,
            frames: sample?.frames ?? 44100,
            channels: 2,
            sampleRate: 44100,
            exact: true,
          }
        },
        card_read: () => {
          if (!given.card) {
            throw new Error('no pad data on that card')
          }
          return given.card
        },
        project_pick_to_save: () => given.pickedProject,
        project_pick_to_open: () => given.pickedProject,
        project_save: ({ path, project }) => {
          const name = String(path)
            .split(/[\\/]/)
            .pop()!
            .replace(/\.[^.]+$/, '')
          files[path] = { ...(project as StubProject), name, savedAt: 1 }
          recent = [path, ...recent.filter((known) => known !== path)]
          journal = null
          return { path, project: files[path] }
        },
        project_open: ({ path }) => {
          if (!files[path]) {
            throw new Error(`no project at ${path}`)
          }
          recent = [path, ...recent.filter((known) => known !== path)]
          return { path, project: files[path] }
        },
        project_recent: () => recent,
        project_forget_recent: ({ path }) => {
          recent = path ? recent.filter((known) => known !== path) : []
          return config
        },
        journal_write: ({ journal: written }) => {
          journal = written as unknown as typeof journal
          return null
        },
        journal_read: () => journal,
        journal_clear: () => {
          journal = null
          return null
        },
        window_set_title: () => null,
        card_presence: () => ({
          present: Boolean(given.card),
          fingerprint: given.card ? 'presence-1' : null,
        }),
        sync_preflight: () => ({
          problems: [],
          sizes: [],
          bytesToWrite: 4512,
          bytesToFree: 0,
          freeSpace: 1000000000,
        }),
        sync_apply: ({ plan }) => ({
          outcome: {
            applied: (plan as unknown as { slots: { slot: number }[] }).slots.map((s) => s.slot),
            skipped: [],
            failures: [],
            cancelled: false,
            verified: true,
          },
          card: given.card,
        }),
        sync_cancel: () => null,
        'plugin:event|listen': ({ event, handler }) => {
          const known = listeners[event] ?? []
          known.push(handler as unknown as Listener)
          listeners[event] = known
          return known.length
        },
        'plugin:event|unlisten': () => null,
      }

      Object.defineProperty(window, '__TAURI_INTERNALS__', {
        configurable: true,
        value: {
          transformCallback: (callback: unknown) => callback,
          convertFileSrc: (path: string) => path,
          invoke: (command: string, args: Record<string, never>) => {
            calls.push({ command, args })
            const handler = handlers[command]
            return handler
              ? Promise.resolve(handler(args ?? ({} as Record<string, never>)))
              : Promise.reject(new Error(`no stub for ${command}`))
          },
        },
      })
    },
    {
      browseFolders: backend.browseFolders ?? [],
      cardPath: backend.cardPath ?? null,
      pickedFolder: backend.pickedFolder ?? null,
      pickedProject: backend.pickedProject ?? STUB_PROJECT_PATH,
      entries: backend.entries ?? {},
      card: backend.card ?? null,
    } as Required<StubBackend>,
  )
}

export function backendCalls(page: Page): Promise<{ command: string; args: unknown }[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __BACKEND_CALLS__: { command: string; args: unknown }[] })
        .__BACKEND_CALLS__,
  )
}
