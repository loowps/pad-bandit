import { describe, expect, it } from 'vitest'
import {
  cardAudio,
  createDefaultSettings,
  createPad,
  diskAudio,
  type Pad,
  type PadId,
  padIdForSlot,
  type SampleInfo,
} from '@/domain/pad'
import { cardPlan, clearIntent, keepIntent, type PadIntent, sampleIntent } from '@/domain/plan'
import {
  diskPathsOf,
  editOf,
  missingSourceLabel,
  portabilityOf,
  projectDocument,
  resolveProject,
  type RestoreChoice,
} from '@/domain/project'
import type { Project } from '@/projects'

const RESTORE: RestoreChoice = { restore: true, clearExtras: false }
const KICK_ON_DISK = '/samples/kick.wav'

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

function fromDisk(pad: Pad, sourcePath: string): Pad {
  return pad.sample ? { ...pad, audio: cardAudio(pad.slot, pad.sample, sourcePath) } : pad
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

  it('records the file on disk a synced card sample came from', () => {
    const pads = cardOf([fromDisk(occupiedPad(0, 'A0000001.WAV', 'fp-kick'), KICK_ON_DISK)])

    const document = documentOf(pads, {})

    expect(document.slots[0]?.audio).toMatchObject({ kind: 'card', sourcePath: KICK_ON_DISK })
    expect(documentOf(cardOf([]), {}).slots[0]?.audio).toBeNull()
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

describe('diskPathsOf', () => {
  it('lists only the disk files the project still wants on a pad', () => {
    const card = cardOf([occupiedPad(0, 'A0000001.WAV', 'fp-kick')])
    card['A2']!.audio = diskAudio('/samples/snare.wav')
    card['A3']!.audio = diskAudio('/samples/kept.wav')
    const document = documentOf(card, {
      A1: sampleIntent(card['A1']!.audio!),
      A2: sampleIntent(diskAudio('/samples/snare.wav')),
    })

    expect(diskPathsOf(document)).toEqual(['/samples/snare.wav'])
  })

  it('includes the file a card sample came from, so a restore knows whether it is still there', () => {
    const card = cardOf([fromDisk(occupiedPad(0, 'A0000001.WAV', 'fp-kick'), KICK_ON_DISK)])

    expect(diskPathsOf(documentOf(card, {}))).toEqual([KICK_ON_DISK])
  })
})

describe('portabilityOf', () => {
  it('counts a card sample whose file on disk is known as portable', () => {
    const card = cardOf([
      fromDisk(occupiedPad(0, 'A0000001.WAV', 'fp-kick'), KICK_ON_DISK),
      occupiedPad(1, 'A0000002.WAV', 'fp-recorded'),
    ])

    expect(portabilityOf(documentOf(card, {}))).toEqual({ fromDisk: 1, fromCard: 1 })
  })
})

describe('missingSourceLabel', () => {
  const settings = createDefaultSettings()

  it('names a disk file and the folder it was in', () => {
    expect(
      missingSourceLabel({ audio: { kind: 'path', path: '/samples/kick.wav' }, settings }),
    ).toEqual({ name: 'kick.wav', location: 'It was at /samples/kick.wav' })
  })

  it('names a card sample and the pad it was saved from', () => {
    const audio = {
      kind: 'card' as const,
      originSlot: 13,
      fileName: 'B0000002.WAV',
      fingerprint: '',
    }

    expect(missingSourceLabel({ audio, settings })).toEqual({
      name: 'B0000002.WAV',
      location: 'It was on the card, on pad B2',
    })
  })

  it('names the file on disk too when the card sample had one', () => {
    const audio = {
      kind: 'card' as const,
      originSlot: 13,
      fileName: 'B0000002.WAV',
      fingerprint: '',
      sourcePath: KICK_ON_DISK,
    }

    expect(missingSourceLabel({ audio, settings }).location).toBe(
      `It was on the card, on pad B2, and at ${KICK_ON_DISK}`,
    )
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

    expect(resolution.orphans).toEqual({})
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
    expect(resolution.orphans).toEqual({})
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

    expect(resolution.orphans).toEqual({})
    expect(resolution.pads['A3']?.sample?.fileName).toBe('A0000001.WAV')
  })

  it('reports a pad as orphaned when the card no longer holds its sample', () => {
    const saved = cardOf([occupiedPad(0, 'A0000001.WAV', 'fp-kick')])
    const missing = sample('A0000001.WAV', 'fp-kick')
    saved['A2'] = { ...createPad(1), audio: cardAudio(0, missing), sample: missing }
    const document = documentOf(saved, { A2: sampleIntent(saved['A2']!.audio!) })
    const wiped = cardOf([])

    const resolution = resolveProject(document, wiped)

    expect(resolution.orphans).toMatchObject({ A2: { audio: { fileName: 'A0000001.WAV' } } })
    expect(resolution.orphans['A2']?.settings.volume).toBe(127)
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

    expect(present.orphans).toEqual({})
    expect(present.pads['A1']?.audio).toEqual(diskAudio('/samples/kick.wav'))
    expect(Object.keys(absent.orphans)).toEqual(['A1'])
    expect(absent.intents['A1']).toEqual(keepIntent())
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

  it('takes a pending card sample from its file on disk when the card lost it, without asking', () => {
    const saved = cardOf([])
    const info = sample('A0000001.WAV', 'fp-kick')
    saved['A3'] = { ...createPad(2), audio: cardAudio(0, info, KICK_ON_DISK), sample: info }
    const document = documentOf(saved, { A3: sampleIntent(saved['A3']!.audio!) })

    const resolution = resolveProject(document, cardOf([]))

    expect(resolution.pads['A3']?.audio).toEqual(diskAudio(KICK_ON_DISK))
    expect(resolution.fromSource).toEqual(['A3'])
    expect(resolution.orphans).toEqual({})
  })
})

describe('resolveProject against a card that no longer matches', () => {
  const synced = () => cardOf([fromDisk(occupiedPad(0, 'A0000001.WAV', 'fp-kick'), KICK_ON_DISK)])

  it('finds nothing to ask about on the card the project was saved from', () => {
    const card = cardOf([occupiedPad(0, 'A0000001.WAV', 'fp-kick')])

    const resolution = resolveProject(documentOf(synced(), {}), card)

    expect(resolution.divergence).toEqual({ onCard: 0, fromDisk: 0, missing: 0, extra: 0 })
    expect(resolution.pads['A1']?.audio).toMatchObject({ kind: 'card', sourcePath: KICK_ON_DISK })
    expect(resolution.intents['A1']).toEqual(keepIntent())
  })

  it('leaves a wiped card as it is until the user asks for a restore', () => {
    const document = documentOf(synced(), {})

    const resolution = resolveProject(document, cardOf([]))

    expect(resolution.divergence).toEqual({ onCard: 0, fromDisk: 1, missing: 0, extra: 0 })
    expect(resolution.pads['A1']?.audio).toBeNull()
    expect(resolution.intents['A1']).toEqual(keepIntent())
    expect(resolution.fromSource).toEqual([])
  })

  it('restores a pad from the file it was synced from', () => {
    const saved = synced()
    saved['A1']!.settings.startFrame = 100
    const document = documentOf(saved, {})

    const resolution = resolveProject(document, cardOf([]), new Set(), RESTORE)

    expect(resolution.pads['A1']?.audio).toEqual(diskAudio(KICK_ON_DISK))
    expect(resolution.pads['A1']?.settings.startFrame).toBe(100)
    expect(resolution.intents['A1']).toEqual(sampleIntent(diskAudio(KICK_ON_DISK)))
    expect(resolution.fromSource).toEqual(['A1'])
    expect(resolution.summary).toMatchObject({ fromDisk: 1, resolved: 0, missing: 0 })
  })

  it('prefers the sample still on the card, on another pad, over copying it again', () => {
    const shuffled = cardOf([occupiedPad(5, 'A0000006.WAV', 'fp-kick')])

    const resolution = resolveProject(documentOf(synced(), {}), shuffled, new Set(), RESTORE)

    expect(resolution.divergence).toMatchObject({ onCard: 1, fromDisk: 0 })
    expect(resolution.moved).toEqual(['A1'])
    expect(resolution.pads['A1']?.audio).toMatchObject({ originSlot: 5, sourcePath: KICK_ON_DISK })
    expect(resolution.fromSource).toEqual([])
  })

  it('reports a pad as missing when neither the card nor the disk still has it', () => {
    const recorded = documentOf(cardOf([occupiedPad(0, 'A0000001.WAV', 'fp-kick')]), {})
    const moved = documentOf(synced(), {})

    const withoutSource = resolveProject(recorded, cardOf([]), new Set(), RESTORE)
    const sourceGone = resolveProject(moved, cardOf([]), new Set([KICK_ON_DISK]), RESTORE)

    for (const resolution of [withoutSource, sourceGone]) {
      expect(resolution.divergence).toMatchObject({ missing: 1, fromDisk: 0 })
      expect(Object.keys(resolution.orphans)).toEqual(['A1'])
      expect(resolution.pads['A1']?.audio).toBeNull()
    }
  })

  it('does not take a different recording under the same file name for the saved one', () => {
    const rerecorded = cardOf([occupiedPad(0, 'A0000001.WAV', 'fp-new-take')])

    const resolution = resolveProject(documentOf(synced(), {}), rerecorded)

    expect(resolution.divergence).toMatchObject({ fromDisk: 1 })
    expect(resolution.pads['A1']?.sample?.fingerprint).toBe('fp-new-take')
  })

  it('clears a pad the project has empty only when that is asked for too', () => {
    const document = documentOf(cardOf([]), {})
    const card = cardOf([occupiedPad(1, 'A0000002.WAV', 'fp-snare')])

    const restored = resolveProject(document, card, new Set(), RESTORE)
    const cleared = resolveProject(document, card, new Set(), { ...RESTORE, clearExtras: true })

    expect(restored.divergence).toEqual({ onCard: 0, fromDisk: 0, missing: 0, extra: 1 })
    expect(restored.pads['A2']?.audio).not.toBeNull()
    expect(restored.intents['A2']).toEqual(keepIntent())
    expect(cleared.pads['A2']?.audio).toBeNull()
    expect(cleared.intents['A2']).toEqual(clearIntent())
    expect(cleared.summary.cleared).toBe(1)
  })
})
