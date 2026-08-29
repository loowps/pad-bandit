import { describe, expect, it } from 'vitest'
import { plannedAction, previewRows, syncPlan } from '@/domain/sync'
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
