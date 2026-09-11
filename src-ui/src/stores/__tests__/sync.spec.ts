import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { usePadsStore } from '@/stores/pads'
import { useCardStore } from '@/stores/card'
import { useSyncStore } from '@/stores/sync'
import { diskAudio, PAD_COUNT } from '@/domain/pad'
import type { CardSlot, CardState } from '@/card'
import type { Preflight, SyncOutcome, SyncPlan, SyncProgress } from '@/sync'

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
let outcomeOverride: Partial<SyncOutcome> = {}
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
  outcomeOverride = {}
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
          ...outcomeOverride,
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

  it('ticks and unticks both pads of a swap together', () => {
    const pads = editedCard()
    pads.swapPads('A1', 'A2')
    const sync = useSyncStore()

    sync.toggle('A2')
    expect([...sync.deselected].sort()).toEqual(['A1', 'A2'])

    sync.toggle('A1')
    expect(sync.deselected.size).toBe(0)
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

  it('checks the plan again whenever the selection changes and holds Sync until it has', async () => {
    editedCard()
    const sync = useSyncStore()
    sync.toggle('A3')
    await sync.check()
    expect(sync.canSync).toBe(true)

    sync.selectAll()

    expect(sync.canSync).toBe(false)
    await vi.waitFor(() => expect(sync.canSync).toBe(true))
    expect(sent?.slots.map((planned) => planned.slot)).toEqual([2, 3])
  })

  it('ignores a check that answers after a newer one', async () => {
    editedCard()
    const answers: Array<(reply: Preflight) => void> = []
    invokeMock.mockImplementation((command) => {
      if (command === 'sync_preflight') {
        return new Promise((resolve) => answers.push(resolve))
      }
      throw new Error(`unexpected command ${command}`)
    })
    const sync = useSyncStore()

    const older = sync.check()
    sync.toggle('A3')
    answers[1]?.(clean)
    answers[0]?.({ ...clean, problems: [{ kind: 'cardChanged' }] })
    await older

    await vi.waitFor(() => expect(sync.checking).toBe(false))
    expect(sync.report?.problems).toEqual([])
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

  it('says a refusal in the app’s own words, not the backend’s', async () => {
    editedCard()
    invokeMock.mockRejectedValueOnce({
      code: 'cardChanged',
      message: 'the card changed since this plan was built',
    })
    const sync = useSyncStore()

    expect(await sync.check()).toBeNull()

    expect(sync.error).toBe('The card changed since it was read. Read it again.')
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

  it('holds the presence poll back while it writes and lets it go again afterwards', async () => {
    editedCard()
    const card = useCardStore()
    const sync = useSyncStore()
    await sync.check()

    const pause = vi.spyOn(card, 'pausePresence')
    const resume = vi.spyOn(card, 'resumePresence')
    let heldDuringWrite = false
    progressDuringApply = () => {
      heldDuringWrite = pause.mock.calls.length === 1 && resume.mock.calls.length === 0
    }

    await sync.run()

    expect(heldDuringWrite).toBe(true)
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it('keeps the pending work when the write fails', async () => {
    const pads = editedCard()
    const card = useCardStore()
    const sync = useSyncStore()
    await sync.check()
    const resume = vi.spyOn(card, 'resumePresence')
    failApply = 'the card went away'

    expect(await sync.run()).toBeNull()

    expect(sync.error).toContain('went away')
    expect(pads.hasPreparedPads).toBe(true)
    expect(sync.running).toBe(false)
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it('keeps the pending work a cancelled sync never reached', async () => {
    const pads = editedCard()
    const sync = useSyncStore()
    await sync.check()
    outcomeOverride = { applied: [2], skipped: [3], cancelled: true }

    await sync.run()

    expect(pads.changeFor('A3')).toBeNull()
    expect(pads.changeFor('A4')?.status).toBe('added')
    expect(pads.padById('A4')?.audio).toEqual(diskAudio('/samples/snare.wav'))
    expect(useCardStore().fingerprint).toBe('fp-after')
  })

  it('keeps the pending work on a pad whose write failed', async () => {
    const pads = editedCard()
    const sync = useSyncStore()
    await sync.check()
    outcomeOverride = { applied: [2], failures: [{ slot: 3, reason: 'disk full' }] }

    await sync.run()

    expect(pads.changeFor('A4')?.status).toBe('added')
  })

  it('keeps a change that was left out of the sync', async () => {
    const pads = editedCard()
    const sync = useSyncStore()
    sync.toggle('A3')
    await sync.check()

    await sync.run()

    expect(pads.changeFor('A3')?.status).toBe('added')
    expect(pads.changeFor('A4')).toBeNull()
    expect(sync.selected.map((row) => row.padId)).toEqual(['A3'])
  })

  it('lets go of a kept pad whose card sample the sync rewrote', async () => {
    const pads = editedCard()
    pads.swapPads('A1', 'A5')
    const sync = useSyncStore()
    await sync.check()
    outcomeOverride = { applied: [0, 2, 3], failures: [{ slot: 4, reason: 'card full' }] }

    await sync.run()

    expect(pads.changeFor('A5')).toBeNull()
    expect(pads.padById('A5')?.audio).toBeNull()
  })

  it('cancelling asks Rust to stop', async () => {
    editedCard()
    const sync = useSyncStore()

    await sync.cancel()

    expect(invokeMock).toHaveBeenCalledWith('sync_cancel')
  })
})
