import { describe, expect, it } from 'vitest'
import {
  cardAudio,
  createDefaultSettings,
  createPad,
  diskAudio,
  padIdForSlot,
  type Pad,
  type PadId,
  type SampleInfo,
} from '@/domain/pad'
import { cardPlan, clearIntent, keepIntent, sampleIntent, type PadIntent } from '@/domain/plan'
import { editOf, projectDocument, resolveProject } from '@/domain/project'
import type { Project } from '@/projects'

function sample(fileName: string, fingerprint: string): SampleInfo {
  return {
    fileName,
    path: `/card/${fileName}`,
    fingerprint,
    format: 'wave',
    channels: 2,
    frames: 1000,
    sizeBytes: 4512,
    startFrame: 0,
    endFrame: 1000,
  }
}

function occupiedPad(slot: number, fileName: string, fingerprint: string): Pad {
  const info = sample(fileName, fingerprint)
  return {
    ...createPad(slot),
    audio: cardAudio(slot, info),
    sample: info,
    settings: { ...createDefaultSettings(), endFrame: info.endFrame },
  }
}

function cardOf(pads: Pad[]): Record<PadId, Pad> {
  const byId: Record<PadId, Pad> = {}
  for (let slot = 0; slot < 24; slot++) {
    const pad = createPad(slot)
    byId[pad.id] = pad
  }
  for (const pad of pads) {
    byId[pad.id] = pad
  }
  return byId
}

function documentOf(pads: Record<PadId, Pad>, intents: Record<PadId, PadIntent>): Project {
  return projectDocument('march', '/media/SP-CARD', Object.values(pads), intents)
}

describe('projectDocument', () => {
  it('records the fingerprint of the sample behind a card reference', () => {
    const pads = cardOf([occupiedPad(0, 'A0000001.WAV', 'fp-kick')])

    const document = documentOf(pads, {})

    expect(document.slots[0]).toMatchObject({
      slot: 0,
      intent: 'keep',
      audio: { kind: 'card', originSlot: 0, fileName: 'A0000001.WAV', fingerprint: 'fp-kick' },
    })
    expect(document.cardRoot).toBe('/media/SP-CARD')
  })

  it('keeps every intent and splits the trim points out of the settings', () => {
    const pads = cardOf([occupiedPad(0, 'A0000001.WAV', 'fp-kick')])
    pads['A2']!.audio = diskAudio('/samples/snare.wav')
    pads['A2']!.settings.startFrame = 12

    const document = documentOf(pads, {
      A1: clearIntent(),
      A2: sampleIntent(diskAudio('/samples/snare.wav')),
    })

    expect(document.slots[0]?.intent).toBe('clear')
    expect(document.slots[1]).toMatchObject({
      intent: 'sample',
      audio: { kind: 'path', path: '/samples/snare.wav' },
      edit: { startFrame: 12, endFrame: 0 },
    })
    expect(document.slots[1]?.edit.settings).not.toHaveProperty('startFrame')
  })
})

describe('resolveProject', () => {
  it('reopens onto the same card with every pad and intent restored', () => {
    const card = cardOf([occupiedPad(0, 'A0000001.WAV', 'fp-kick')])
    const saved = { ...card }
    const info = sample('A0000001.WAV', 'fp-kick')
    saved['A3'] = { ...createPad(2), audio: cardAudio(0, info), sample: info }
    const document = documentOf(saved, { A3: sampleIntent(saved['A3']!.audio!) })

    const resolution = resolveProject(document, card)

    expect(resolution.orphans).toEqual([])
    expect(resolution.moved).toEqual([])
    expect(resolution.pads['A3']?.audio).toMatchObject({ kind: 'card', originSlot: 0 })
    expect(resolution.intents['A3']).toMatchObject({ kind: 'sample' })
  })

  it('follows a sample that has since moved to another slot on the card', () => {
    const saved = cardOf([occupiedPad(0, 'A0000001.WAV', 'fp-kick')])
    const document = documentOf(saved, { A1: sampleIntent(saved['A1']!.audio!) })
    const shuffled = cardOf([occupiedPad(5, 'A0000006.WAV', 'fp-kick')])

    const resolution = resolveProject(document, shuffled)

    expect(resolution.moved).toEqual(['A1'])
    expect(resolution.pads['A1']?.audio).toMatchObject({ kind: 'card', originSlot: 5 })
    expect(resolution.pads['A1']?.sample?.fileName).toBe('A0000006.WAV')
    expect(resolution.orphans).toEqual([])
  })

  it('prefers the slot the sample was saved at when the card holds two copies', () => {
    const saved = cardOf([occupiedPad(3, 'A0000004.WAV', 'fp-kick')])
    const document = documentOf(saved, { A4: sampleIntent(saved['A4']!.audio!) })
    const card = cardOf([
      occupiedPad(1, 'A0000002.WAV', 'fp-kick'),
      occupiedPad(3, 'A0000004.WAV', 'fp-kick'),
    ])

    const resolution = resolveProject(document, card)

    expect(resolution.pads['A4']?.audio).toMatchObject({ originSlot: 3 })
    expect(resolution.moved).toEqual([])
  })

  it('falls back to the saved slot and file name when no fingerprint was recorded', () => {
    const card = cardOf([occupiedPad(0, 'A0000001.WAV', 'fp-kick')])
    const saved = { ...card }
    saved['A3'] = { ...createPad(2), audio: cardAudio(0, sample('A0000001.WAV', 'fp-kick')) }
    const document = documentOf(saved, { A3: sampleIntent(saved['A3']!.audio!) })
    expect(document.slots[2]?.audio).toMatchObject({ fingerprint: '' })

    const resolution = resolveProject(document, card)

    expect(resolution.orphans).toEqual([])
    expect(resolution.pads['A3']?.sample?.fileName).toBe('A0000001.WAV')
  })

  it('reports a pad as orphaned when the card no longer holds its sample', () => {
    const saved = cardOf([occupiedPad(0, 'A0000001.WAV', 'fp-kick')])
    const missing = sample('A0000001.WAV', 'fp-kick')
    saved['A2'] = { ...createPad(1), audio: cardAudio(0, missing), sample: missing }
    const document = documentOf(saved, { A2: sampleIntent(saved['A2']!.audio!) })
    const wiped = cardOf([])

    const resolution = resolveProject(document, wiped)

    expect(resolution.orphans).toMatchObject([{ padId: 'A2', audio: { fileName: 'A0000001.WAV' } }])
    expect(resolution.orphans[0]?.settings.volume).toBe(127)
    expect(resolution.summary).toMatchObject({ missing: 1, resolved: 0 })
    expect(resolution.pads['A2']?.audio).toBeNull()
  })

  it('leaves an orphaned pad out of the plan entirely', () => {
    const saved = cardOf([occupiedPad(0, 'A0000001.WAV', 'fp-kick')])
    saved['A1']!.settings.volume = 40
    const document = documentOf(saved, { A1: sampleIntent(saved['A1']!.audio!) })
    const wiped = cardOf([])

    const resolution = resolveProject(document, wiped)
    const snapshots = Object.fromEntries(
      Object.values(wiped).map((pad) => [
        pad.id,
        { settings: { ...pad.settings }, audio: pad.audio, sample: pad.sample },
      ]),
    )

    expect(cardPlan(Object.values(resolution.pads), resolution.intents, snapshots)).toEqual([])
  })

  it('treats a dropped file whose path has gone as orphaned too', () => {
    const saved = cardOf([])
    saved['A1']!.audio = diskAudio('/samples/kick.wav')
    const document = documentOf(saved, { A1: sampleIntent(diskAudio('/samples/kick.wav')) })

    const present = resolveProject(document, cardOf([]))
    const absent = resolveProject(document, cardOf([]), new Set(['/samples/kick.wav']))

    expect(present.orphans).toEqual([])
    expect(present.pads['A1']?.audio).toEqual(diskAudio('/samples/kick.wav'))
    expect(absent.orphans.map((orphan) => orphan.padId)).toEqual(['A1'])
  })

  it('restores a cleared pad as cleared rather than as whatever the card holds', () => {
    const card = cardOf([occupiedPad(0, 'A0000001.WAV', 'fp-kick')])
    const document = documentOf(card, { A1: clearIntent() })

    const resolution = resolveProject(document, card)

    expect(resolution.pads['A1']?.audio).toBeNull()
    expect(resolution.intents['A1']).toEqual(clearIntent())
  })

  it('ignores a saved slot that is not on this card', () => {
    const card = cardOf([])
    const document = documentOf(card, {})
    document.slots.push({
      slot: 0,
      intent: 'keep',
      audio: null,
      edit: editOf(createDefaultSettings()),
    })
    document.slots[0]!.slot = 999

    const resolution = resolveProject(document, card)

    expect(resolution.pads[padIdForSlot(0)]).toBeDefined()
    expect(resolution.intents[padIdForSlot(0)]).toEqual(keepIntent())
  })
})
