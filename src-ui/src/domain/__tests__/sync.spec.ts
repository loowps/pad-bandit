import { describe, expect, it } from 'vitest'
import {
  linkedPadIds,
  plannedAction,
  type PreviewRow,
  previewRows,
  rewrittenSlots,
  syncPlan,
} from '@/domain/sync'
import { cardAudio, createEmptyCard, diskAudio, type Pad, type PadId } from '@/domain/pad'
import type { PadChange } from '@/domain/plan'
import type { SampleInfo } from '@/card'

const sample: SampleInfo = {
  fileName: 'A0000001.WAV',
  path: '/media/SP-CARD/A0000001.WAV',
  fingerprint: 'fp-a1',
  format: 'wave',
  channels: 2,
  frames: 1_000,
  sizeBytes: 4_512,
  startFrame: 0,
  endFrame: 1_000,
}

function pads(): Record<PadId, Pad> {
  return createEmptyCard()
}

function change(
  over: Partial<PadChange> & Pick<PadChange, 'padId' | 'slot' | 'status'>,
): PadChange {
  return {
    audio: null,
    fromSlot: null,
    previousFileName: null,
    ...over,
  }
}

describe('rows that only make sense together', () => {
  function row(padId: PadId, slot: number, action: PreviewRow['action']): PreviewRow {
    return { padId, slot, headline: '', detail: '', action }
  }

  const rows = [
    row('A1', 0, { kind: 'move', fromSlot: 1 }),
    row('A2', 1, { kind: 'move', fromSlot: 2 }),
    row('A3', 2, { kind: 'move', fromSlot: 0 }),
    row('B1', 12, { kind: 'move', fromSlot: 13 }),
    row('B2', 13, { kind: 'delete' }),
    row('C1', 24, { kind: 'settings' }),
  ]

  it('follow a rotation all the way round', () => {
    expect(linkedPadIds(rows, 'A2').sort()).toEqual(['A1', 'A2', 'A3'])
  })

  it('tie a move to the pad it empties', () => {
    expect(linkedPadIds(rows, 'B2').sort()).toEqual(['B1', 'B2'])
  })

  it('leave a row that stands alone on its own', () => {
    expect(linkedPadIds(rows, 'C1')).toEqual(['C1'])
  })
})

describe('the slots a sync rewrote', () => {
  const edit = {
    settings: {
      volume: 127,
      lofi: false,
      loop: false,
      gate: true,
      reverse: false,
      tempoMode: 'off' as const,
      originalTempo: 120,
      userTempo: 120,
    },
    startFrame: 0,
    endFrame: 0,
  }

  it('are the applied ones plus the slots an applied move emptied', () => {
    const plan = {
      cardFingerprint: 'fp',
      slots: [
        { slot: 4, action: { kind: 'move' as const, fromSlot: 0 }, edit },
        { slot: 7, action: { kind: 'move' as const, fromSlot: 9 }, edit },
        { slot: 2, action: { kind: 'settings' as const }, edit },
        { slot: 3, action: { kind: 'delete' as const }, edit },
      ],
    }
    const outcome = {
      applied: [4, 2],
      skipped: [3],
      failures: [{ slot: 7, reason: 'gone' }],
      cancelled: true,
      verified: true,
    }

    expect([...rewrittenSlots(plan, outcome)].sort()).toEqual([0, 2, 4])
  })
})

describe('planned actions', () => {
  it('maps each change status onto what the writer has to do', () => {
    expect(plannedAction(change({ padId: 'A1', slot: 0, status: 'settings' }))).toEqual({
      kind: 'settings',
    })
    expect(plannedAction(change({ padId: 'A1', slot: 0, status: 'removed' }))).toEqual({
      kind: 'delete',
    })
    expect(plannedAction(change({ padId: 'A1', slot: 0, status: 'moved', fromSlot: 7 }))).toEqual({
      kind: 'move',
      fromSlot: 7,
    })
    expect(
      plannedAction(
        change({ padId: 'A1', slot: 0, status: 'added', audio: diskAudio('/samples/kick.wav') }),
      ),
    ).toEqual({ kind: 'write', source: '/samples/kick.wav' })
  })

  it('a replacement from disc is a write, whatever was there before', () => {
    const replaced = change({
      padId: 'A1',
      slot: 0,
      status: 'replaced',
      audio: diskAudio('/samples/snare.wav'),
      previousFileName: 'A0000001.WAV',
    })

    expect(plannedAction(replaced)).toEqual({ kind: 'write', source: '/samples/snare.wav' })
  })

  it('a change the writer cannot act on is dropped rather than guessed at', () => {
    expect(plannedAction(change({ padId: 'A1', slot: 0, status: 'moved' }))).toBeNull()
    expect(plannedAction(change({ padId: 'A1', slot: 0, status: 'added', audio: null }))).toBeNull()
    expect(
      plannedAction(change({ padId: 'A1', slot: 0, status: 'added', audio: cardAudio(7, sample) })),
    ).toBeNull()
  })
})

describe('the plan sent to Rust', () => {
  it('carries the fingerprint it was built from', () => {
    const plan = syncPlan('fp-card', [], pads())

    expect(plan.cardFingerprint).toBe('fp-card')
    expect(plan.slots).toEqual([])
  })

  it('carries one slot per actionable change, with that pad edit', () => {
    const all = pads()
    all.A3!.settings.volume = 90
    const changes = [
      change({ padId: 'A3', slot: 2, status: 'added', audio: diskAudio('/samples/kick.wav') }),
      change({ padId: 'A4', slot: 3, status: 'settings' }),
    ]

    const plan = syncPlan('fp-card', changes, all)

    expect(plan.slots).toHaveLength(2)
    expect(plan.slots[0]).toMatchObject({
      slot: 2,
      action: { kind: 'write', source: '/samples/kick.wav' },
    })
    expect(plan.slots[0]!.edit.settings.volume).toBe(90)
    expect(plan.slots[1]).toMatchObject({ slot: 3, action: { kind: 'settings' } })
  })

  it('leaves out a change the writer cannot act on', () => {
    const changes = [change({ padId: 'A1', slot: 0, status: 'moved' })]

    expect(syncPlan('fp-card', changes, pads()).slots).toEqual([])
  })
})

describe('the preview rows', () => {
  it('reads like the plan in the design doc', () => {
    const changes = [
      change({ padId: 'A3', slot: 2, status: 'added', audio: diskAudio('/samples/kick.wav') }),
      change({ padId: 'B7', slot: 18, status: 'settings', previousFileName: 'B0000007.WAV' }),
      change({ padId: 'C2', slot: 25, status: 'moved', fromSlot: 8 }),
      change({ padId: 'D1', slot: 36, status: 'removed', previousFileName: 'D0000001.WAV' }),
    ]

    const rows = previewRows(changes, pads())

    expect(rows.map((row) => [row.padId, row.headline, row.detail])).toEqual([
      ['A3', 'new sample', 'kick.wav'],
      ['B7', 'settings', 'B0000007.WAV'],
      ['C2', 'move', 'from A9'],
      ['D1', 'delete sample', 'D0000001.WAV'],
    ])
  })

  it('says a pad whose sample moves away is moved, not deleted', () => {
    const changes = [
      change({ padId: 'C1', slot: 24, status: 'moved', fromSlot: 13 }),
      change({ padId: 'B2', slot: 13, status: 'removed', previousFileName: 'B0000002.WAV' }),
    ]

    const rows = previewRows(changes, pads())

    expect(rows.map((row) => [row.padId, row.headline, row.detail])).toEqual([
      ['C1', 'move', 'from B2'],
      ['B2', 'moved away', 'to C1'],
    ])
    expect(rows[1]!.action).toEqual({ kind: 'delete' })
  })

  it('names the source file rather than its whole path', () => {
    const changes = [
      change({
        padId: 'A1',
        slot: 0,
        status: 'added',
        audio: diskAudio('D:\\samples\\drums\\kick 01.wav'),
      }),
    ]

    expect(previewRows(changes, pads())[0]!.detail).toBe('kick 01.wav')
  })
})
