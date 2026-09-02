import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { useCardStore } from '@/stores/card'
import { usePadsStore } from '@/stores/pads'
import type { AppConfig } from '@/config'
import type { CardPresence, CardSlot, CardState } from '@/card'
import { PAD_COUNT } from '@/domain/pad'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
}))

const invokeMock = vi.mocked(invoke)

function config(cardPath: string | null): AppConfig {
  return {
    version: 1,
    browseFolders: [],
    cardPath,
    recentProjects: [],
    theme: 'system',
    window: { width: 1230, height: 900, x: null, y: null, maximized: false },
  }
}

function slot(index: number, withSample: boolean): CardSlot {
  return {
    slot: index,
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
    sample: withSample
      ? {
          fileName: 'A0000001.WAV',
          path: '/media/SP-CARD/ROLAND/SP-404SX/SMPL/A0000001.WAV',
          fingerprint: 'size:25412504 head:aaaa tail:bbbb',
          format: 'wave',
          channels: 2,
          frames: 6_352_998,
          sizeBytes: 25_412_504,
          startFrame: 0,
          endFrame: 6_352_998,
        }
      : null,
  }
}

const cardState: CardState = {
  root: '/media/SP-CARD',
  fingerprint: 'fp-card',
  slots: Array.from({ length: PAD_COUNT }, (_unused, index) => slot(index, index === 0)),
}

beforeEach(() => {
  setActivePinia(createPinia())
  invokeMock.mockReset()
  invokeMock.mockImplementation((command, args) => {
    if (command === 'pick_folder') return Promise.resolve('/media/SP-CARD')
    if (command === 'config_get') return Promise.resolve(config(null))
    if (command === 'card_presence')
      return Promise.resolve({ present: true, fingerprint: 'presence-1' })
    if (command === 'card_read') return Promise.resolve(cardState)
    if (command === 'config_set_card_path') {
      return Promise.resolve(config((args as { path: string | null }).path))
    }
    throw new Error(`unexpected command ${command}`)
  })
})

describe('card store', () => {
  it('starts with nothing selected', () => {
    const card = useCardStore()

    expect(card.status).toBe('empty')
    expect(card.isValid).toBe(false)
    expect(card.path).toBe('')
  })

  it('persists a picked folder and then reads the card', async () => {
    const card = useCardStore()

    await card.pickCard()

    expect(invokeMock).toHaveBeenCalledWith('config_set_card_path', { path: '/media/SP-CARD' })
    expect(invokeMock).toHaveBeenCalledWith('card_read')
    expect(card.status).toBe('valid')
    expect(card.path).toBe('SP-CARD')
  })

  it('fills the pads from what the card reported', async () => {
    const card = useCardStore()
    const pads = usePadsStore()

    await card.pickCard()

    expect(pads.allPads).toHaveLength(PAD_COUNT)
    const first = pads.padById('A1')
    expect(first?.sample?.fileName).toBe('A0000001.WAV')
    expect(first?.audio).toEqual({
      kind: 'card',
      originSlot: 0,
      fileName: 'A0000001.WAV',
      path: '/media/SP-CARD/ROLAND/SP-404SX/SMPL/A0000001.WAV',
    })
    expect(first?.settings.endFrame).toBe(6_352_998)
    expect(first?.settings.originalTempo).toBe(119.9)
    expect(pads.padById('A2')?.audio).toBeNull()
  })

  it('treats a freshly read card as the baseline', async () => {
    const card = useCardStore()
    const pads = usePadsStore()

    await card.pickCard()

    expect(pads.hasPreparedPads).toBe(false)
  })

  it('stays empty when the picker is dismissed', async () => {
    invokeMock.mockImplementation((command) => {
      if (command === 'pick_folder') return Promise.resolve(null)
      throw new Error(`unexpected command ${command}`)
    })
    const card = useCardStore()

    await card.pickCard()

    expect(card.status).toBe('empty')
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })

  it('reports a folder that holds no pad data', async () => {
    invokeMock.mockImplementation((command) => {
      if (command === 'card_presence')
        return Promise.resolve({ present: true, fingerprint: 'presence-1' })
      if (command === 'pick_folder') return Promise.resolve('/media/holiday-photos')
      if (command === 'config_set_card_path') {
        return Promise.resolve(config('/media/holiday-photos'))
      }
      if (command === 'card_read') {
        return Promise.reject(new Error('no pad data at ROLAND/SP-404SX/SMPL/PAD_INFO.BIN'))
      }
      throw new Error(`unexpected command ${command}`)
    })
    const card = useCardStore()

    await card.pickCard()

    expect(card.status).toBe('invalid')
    expect(card.error).toContain('no pad data')
    expect(usePadsStore().padById('A1')?.audio).toBeNull()
  })

  it('restores and reads a saved card path on startup', async () => {
    invokeMock.mockImplementation((command) => {
      if (command === 'config_get') return Promise.resolve(config('/media/SP-CARD'))
      if (command === 'card_presence')
        return Promise.resolve({ present: true, fingerprint: 'presence-1' })
      if (command === 'card_read') return Promise.resolve(cardState)
      throw new Error(`unexpected command ${command}`)
    })
    const card = useCardStore()

    await card.restore()

    expect(card.status).toBe('valid')
    expect(card.path).toBe('SP-CARD')
    expect(usePadsStore().padById('A1')?.sample?.channels).toBe(2)
  })

  it('does not read a card when none was ever chosen', async () => {
    const card = useCardStore()

    await card.restore()

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(card.status).toBe('empty')
  })

  it('clears a chosen card and empties the pads again', async () => {
    const card = useCardStore()
    const pads = usePadsStore()
    await card.pickCard()

    await card.clear()

    expect(invokeMock).toHaveBeenCalledWith('config_set_card_path', { path: null })
    expect(card.status).toBe('empty')
    expect(pads.padById('A1')?.audio).toBeNull()
  })
})

describe('card presence', () => {
  let presence: CardPresence = { present: true, fingerprint: 'presence-1' }

  beforeEach(() => {
    presence = { present: true, fingerprint: 'presence-1' }
    invokeMock.mockImplementation((command) => {
      if (command === 'card_presence') return Promise.resolve(presence)
      if (command === 'config_get') return Promise.resolve(config('/media/SP-CARD'))
      if (command === 'card_read') return Promise.resolve(cardState)
      return Promise.resolve(null)
    })
  })

  it('is present right after the card is read', async () => {
    const card = useCardStore()
    await card.restore()

    expect(card.presence).toBe('present')
  })

  it('goes stale when the card changes underneath', async () => {
    const card = useCardStore()
    await card.restore()

    presence = { present: true, fingerprint: 'presence-2' }
    await card.checkPresence()

    expect(card.presence).toBe('stale')
  })

  it('goes missing when the card is pulled out', async () => {
    const card = useCardStore()
    await card.restore()

    presence = { present: false, fingerprint: null }
    await card.checkPresence()

    expect(card.presence).toBe('missing')
  })

  it('comes back to present when the same card returns', async () => {
    const card = useCardStore()
    await card.restore()
    presence = { present: false, fingerprint: null }
    await card.checkPresence()

    presence = { present: true, fingerprint: 'presence-1' }
    await card.checkPresence()

    expect(card.presence).toBe('present')
  })

  it('does not poll before a card has ever been read', async () => {
    const card = useCardStore()

    await card.checkPresence()

    expect(card.presence).toBe('unknown')
  })

  it('reports nothing while paused, so a sync writing to the card is not read as a change', async () => {
    const card = useCardStore()
    await card.restore()

    card.pausePresence()
    presence = { present: true, fingerprint: 'presence-mid-write' }
    await card.checkPresence()

    expect(card.presence).toBe('present')

    card.resumePresence()
    await card.checkPresence()

    expect(card.presence).toBe('stale')
  })

  it('never runs two checks at once', async () => {
    const card = useCardStore()
    await card.restore()
    invokeMock.mockClear()

    await Promise.all([card.checkPresence(), card.checkPresence(), card.checkPresence()])

    expect(invokeMock.mock.calls.filter(([command]) => command === 'card_presence')).toHaveLength(1)
  })

  it('adopting a freshly written card takes a new baseline', async () => {
    const card = useCardStore()
    await card.restore()
    presence = { present: true, fingerprint: 'presence-after-sync' }

    await card.adopt({ ...cardState, fingerprint: 'fp-after' })
    await card.checkPresence()

    expect(card.fingerprint).toBe('fp-after')
    expect(card.presence).toBe('present')
  })
})
