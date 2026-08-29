import { describe, expect, it } from 'vitest'
import {
  cardAudio,
  createDefaultSettings,
  createPad,
  diskAudio,
  type Pad,
  type PadSnapshot,
  type SampleInfo,
  snapshotOf,
} from '@/domain/pad'
import { cardPlan, clearIntent, keepIntent, padChange, sampleIntent } from '@/domain/plan'

function sample(fileName: string): SampleInfo {
  return {
    fileName,
    path: `/card/${fileName}`,
    fingerprint: `size:4512 head:${fileName} tail:${fileName}`,
    format: 'wave',
    channels: 2,
    frames: 1000,
    sizeBytes: 4512,
    startFrame: 0,
    endFrame: 1000,
  }
}

function occupiedPad(slot: number, fileName: string): Pad {
  const info = sample(fileName)
  return {
    ...createPad(slot),
    audio: cardAudio(slot, info),
    sample: info,
    settings: { ...createDefaultSettings(), endFrame: info.endFrame },
  }
}

function snapshotsOf(pads: Pad[]): Record<string, PadSnapshot> {
  return Object.fromEntries(pads.map((pad) => [pad.id, snapshotOf(pad)]))
}

describe('padChange', () => {
  it('reports nothing for a pad nobody touched', () => {
    const pad = occupiedPad(0, 'A0000001.WAV')

    expect(padChange(pad, keepIntent(), snapshotOf(pad))).toBeNull()
  })

  it('reports a settings change when only the parameters moved', () => {
    const pad = occupiedPad(0, 'A0000001.WAV')
    const snapshot = snapshotOf(pad)
    pad.settings.volume = 64

    expect(padChange(pad, keepIntent(), snapshot)).toMatchObject({
      padId: 'A1',
      slot: 0,
      status: 'settings',
      previousFileName: 'A0000001.WAV',
    })
  })

  it('reports an added sample when the card slot was empty', () => {
    const pad = createPad(3)
    const snapshot = snapshotOf(pad)
    const audio = diskAudio('/samples/kick.wav')
    pad.audio = audio

    expect(padChange(pad, sampleIntent(audio), snapshot)).toMatchObject({
      status: 'added',
      audio,
      previousFileName: null,
    })
  })

  it('reports a replaced sample when the card slot already held one', () => {
    const pad = occupiedPad(0, 'A0000001.WAV')
    const snapshot = snapshotOf(pad)
    const audio = diskAudio('/samples/kick.wav')
    pad.audio = audio

    expect(padChange(pad, sampleIntent(audio), snapshot)).toMatchObject({
      status: 'replaced',
      previousFileName: 'A0000001.WAV',
    })
  })

  it('reports a move when the audio came from another slot on the card', () => {
    const pad = occupiedPad(0, 'A0000001.WAV')
    const snapshot = snapshotOf(pad)
    const audio = cardAudio(26, sample('C0000003.WAV'))
    pad.audio = audio

    expect(padChange(pad, sampleIntent(audio), snapshot)).toMatchObject({
      status: 'moved',
      fromSlot: 26,
      previousFileName: 'A0000001.WAV',
    })
  })

  it('treats the card sample it already held as no change at all', () => {
    const pad = occupiedPad(0, 'A0000001.WAV')
    const snapshot = snapshotOf(pad)

    expect(padChange(pad, sampleIntent(pad.audio!), snapshot)).toBeNull()
  })

  it('reports a removal only where the card actually held a sample', () => {
    const occupied = occupiedPad(0, 'A0000001.WAV')
    const snapshot = snapshotOf(occupied)
    occupied.audio = null
    occupied.sample = null
    occupied.settings = createDefaultSettings()

    expect(padChange(occupied, clearIntent(), snapshot)).toMatchObject({
      status: 'removed',
      audio: null,
      previousFileName: 'A0000001.WAV',
    })
  })

  it('never turns clearing an already empty pad into a delete', () => {
    const empty = createPad(4)

    expect(padChange(empty, clearIntent(), snapshotOf(empty))).toBeNull()
  })
})

describe('cardPlan', () => {
  it('is empty for a card nobody edited', () => {
    const pads = [occupiedPad(0, 'A0000001.WAV'), createPad(1)]

    expect(cardPlan(pads, {}, snapshotsOf(pads))).toEqual([])
  })

  it('keeps untouched pads out of the plan entirely', () => {
    const pads = [occupiedPad(0, 'A0000001.WAV'), occupiedPad(1, 'A0000002.WAV'), createPad(2)]
    const snapshots = snapshotsOf(pads)
    const audio = diskAudio('/samples/kick.wav')
    pads[2]!.audio = audio

    const plan = cardPlan(pads, { A3: sampleIntent(audio) }, snapshots)

    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ padId: 'A3', status: 'added' })
  })

  it('reports the two sides of a swap in slot order', () => {
    const first = occupiedPad(0, 'A0000001.WAV')
    const second = occupiedPad(1, 'A0000002.WAV')
    const pads = [first, second]
    const snapshots = snapshotsOf(pads)
    const fromFirst = first.audio!
    const fromSecond = second.audio!
    first.audio = fromSecond
    second.audio = fromFirst

    const plan = cardPlan(
      pads,
      { A1: sampleIntent(fromSecond), A2: sampleIntent(fromFirst) },
      snapshots,
    )

    expect(plan.map((change) => [change.padId, change.status, change.fromSlot])).toEqual([
      ['A1', 'moved', 1],
      ['A2', 'moved', 0],
    ])
  })

  it('ignores a pad the snapshot knows nothing about', () => {
    const pad = createPad(0)
    pad.audio = diskAudio('/samples/kick.wav')

    expect(cardPlan([pad], { A1: sampleIntent(pad.audio) }, {})).toEqual([])
  })
})
