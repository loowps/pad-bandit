import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { usePadsStore } from '@/stores/pads'
import { useCardStore } from '@/stores/card'
import { useSyncStore } from '@/stores/sync'
import { diskAudio, PAD_COUNT } from '@/domain/pad'
import type { CardSlot, CardState } from '@/card'
import type { Preflight, SyncPlan, SyncProgress } from '@/sync'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
}))

const invokeMock = vi.mocked(invoke)

function slot(index: number, fileName: string | null): CardSlot {
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
    sample: fileName
      ? {
          fileName,
          path: `/media/SP-CARD/${fileName}`,
          fingerprint: `fp-${fileName}`,
          format: 'wave',
          channels: 2,
          frames: 1_000,
          sizeBytes: 4_512,
          startFrame: 0,
          endFrame: 1_000,
        }
      : null,
  }
}

const cardState: CardState = {
  root: '/media/SP-CARD',
  fingerprint: 'fp-card',
  slots: Array.from({ length: PAD_COUNT }, (_unused, index) =>
    slot(index, index === 0 ? 'A0000001.WAV' : null),
  ),
}

const clean: Preflight = {
  problems: [],
  sizes: [],
  bytesToWrite: 4_512,
  bytesToFree: 0,
  freeSpace: 1_000_000_000,
}

let sent: SyncPlan | null = null
let applied: SyncPlan | null = null
let reply: Preflight = clean
let failApply: string | null = null
let progressDuringApply: ((emit: (progress: SyncProgress) => void) => void) | null = null
let emitProgress: ((progress: SyncProgress) => void) | null = null

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn<
    (event: string, handler: (event: { payload: SyncProgress }) => void) => Promise<() => void>
  >((_event, handler) => {
    emitProgress = (progress) => handler({ payload: progress })
    return Promise.resolve(() => {
      emitProgress = null
    })
  }),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  sent = null
  applied = null
  reply = clean
  failApply = null
  progressDuringApply = null
  emitProgress = null
  invokeMock.mockReset()
  invokeMock.mockImplementation((command, args) => {
    if (command === 'sync_preflight') {
      sent = (args as { plan: SyncPlan }).plan
      return Promise.resolve(reply)
    }
    if (command === 'sync_apply') {
      applied = (args as { plan: SyncPlan }).plan
      if (failApply) {
        return Promise.reject(new Error(failApply))
      }
      if (progressDuringApply && emitProgress) {
        progressDuringApply(emitProgress)
      }
      return Promise.resolve({
        outcome: {
          applied: applied.slots.map((planned) => planned.slot),
          skipped: [],
          failures: [],
          cancelled: false,
          verified: true,
        },
        card: { ...cardState, fingerprint: 'fp-after' },
      })
    }
    if (command === 'card_presence') {
      return Promise.resolve({ present: true, fingerprint: 'presence-1' })
    }
    if (command === 'sync_cancel') {
      return Promise.resolve(null)
    }
    throw new Error(`unexpected command ${command}`)
  })
})

function editedCard() {
  const pads = usePadsStore()
  pads.loadFromCard(cardState)
  const card = useCardStore()
  card.fingerprint = 'fp-card'
  card.presence = 'present'
  pads.assignAudio('A3', diskAudio('/samples/kick.wav'))
  pads.assignAudio('A4', diskAudio('/samples/snare.wav'))
  return pads
}

describe('sync store', () => {
  it('shows one preview row per pending change', () => {
    editedCard()
    const sync = useSyncStore()

    expect(sync.rows.map((row) => row.padId)).toEqual(['A3', 'A4'])
    expect(sync.hasSelection).toBe(true)
  })

  it('deselecting a row leaves it out of the plan sent to Rust', async () => {
    editedCard()
    const sync = useSyncStore()

    sync.toggle('A3')
    await sync.check()

    expect(sync.selected.map((row) => row.padId)).toEqual(['A4'])
    expect(sent?.slots.map((planned) => planned.slot)).toEqual([3])
  })

  it('select all brings the deselected rows back', () => {
    editedCard()
    const sync = useSyncStore()
    sync.toggle('A3')
    sync.toggle('A4')
    expect(sync.hasSelection).toBe(false)

    sync.selectAll()

    expect(sync.selected).toHaveLength(2)
  })

  it('sends the fingerprint the card was read with', async () => {
    editedCard()
    const sync = useSyncStore()

    await sync.check()

    expect(sent?.cardFingerprint).toBe('fp-card')
  })

  it('refuses to check before a card has been read', async () => {
    usePadsStore().loadFromCard(cardState)
    const sync = useSyncStore()

    expect(await sync.check()).toBeNull()

    expect(invokeMock).not.toHaveBeenCalled()
    expect(sync.error).toContain('No card')
  })

  it('splits problems into the ones that name a pad and the ones that stop everything', async () => {
    editedCard()
    reply = {
      ...clean,
      problems: [
        { kind: 'cardChanged' },
        { kind: 'sourceUnreadable', slot: 2, source: '/samples/kick.wav', reason: 'gone' },
      ],
    }
    const sync = useSyncStore()

    await sync.check()

    expect(sync.blockers).toEqual([{ kind: 'cardChanged' }])
    expect(sync.problemsBySlot.get(2)).toHaveLength(1)
    expect(sync.problemsBySlot.get(3)).toBeUndefined()
  })

  it('reports a failed check instead of throwing', async () => {
    editedCard()
    invokeMock.mockRejectedValueOnce(new Error('no card folder is selected'))
    const sync = useSyncStore()

    expect(await sync.check()).toBeNull()

    expect(sync.error).toContain('no card folder')
    expect(sync.report).toBeNull()
  })

  it('closing the preview drops the report so it cannot go stale', async () => {
    editedCard()
    const sync = useSyncStore()
    await sync.check()
    expect(sync.report).not.toBeNull()

    sync.close()

    expect(sync.isOpen).toBe(false)
    expect(sync.report).toBeNull()
  })
})

describe('running the sync', () => {
  it('writes the plan, adopts the card that comes back and clears the pending work', async () => {
    const pads = editedCard()
    const sync = useSyncStore()
    await sync.check()

    const done = await sync.run()

    expect(done?.applied).toEqual([2, 3])
    expect(applied?.slots.map((planned) => planned.slot)).toEqual([2, 3])
    expect(pads.hasPreparedPads).toBe(false)
    expect(useCardStore().fingerprint).toBe('fp-after')
    expect(sync.report).toBeNull()
  })

  it('refuses to run while pre-flight has an unresolved problem', async () => {
    editedCard()
    reply = { ...clean, problems: [{ kind: 'cardChanged' }] }
    const sync = useSyncStore()
    await sync.check()

    expect(sync.canSync).toBe(false)
    expect(await sync.run()).toBeNull()
    expect(applied).toBeNull()
  })

  it('refuses to run before pre-flight has been done at all', async () => {
    editedCard()
    const sync = useSyncStore()

    expect(await sync.run()).toBeNull()

    expect(applied).toBeNull()
  })

  it('reports progress while it runs and clears it afterwards', async () => {
    editedCard()
    const sync = useSyncStore()
    await sync.check()

    const seen: number[] = []
    progressDuringApply = (emit) => {
      emit({
        slot: 2,
        phase: 'converting',
        slotsDone: 1,
        slotsTotal: 2,
        bytesDone: 500,
        bytesTotal: 1_000,
      })
      seen.push(sync.percent)
    }

    await sync.run()

    expect(seen).toEqual([50])
    expect(sync.progress).toBeNull()
    expect(sync.running).toBe(false)
  })

  it('keeps the pending work when the write fails', async () => {
    const pads = editedCard()
    const sync = useSyncStore()
    await sync.check()
    failApply = 'the card went away'

    expect(await sync.run()).toBeNull()

    expect(sync.error).toContain('went away')
    expect(pads.hasPreparedPads).toBe(true)
    expect(sync.running).toBe(false)
  })

  it('cancelling asks Rust to stop', async () => {
    editedCard()
    const sync = useSyncStore()

    await sync.cancel()

    expect(invokeMock).toHaveBeenCalledWith('sync_cancel')
  })
})
