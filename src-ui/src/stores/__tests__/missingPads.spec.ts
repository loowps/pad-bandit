import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNoticesStore } from '@/stores/notices'
import { usePadsStore } from '@/stores/pads'
import { createDefaultSettings, diskAudio, PAD_COUNT, type PadId } from '@/domain/pad'
import type { CardState } from '@/card'
import type { MissingSource } from '@/domain/project'

const SAVED: MissingSource = {
  audio: { kind: 'path', path: '/gone/kick.wav' },
  settings: { ...createDefaultSettings(), volume: 40, loop: true, startFrame: 10, endFrame: 500 },
}

function withMissing(...ids: PadId[]) {
  const pads = usePadsStore()
  pads.applyProject({
    pads: { ...pads.byId },
    intents: { ...pads.intentById },
    orphans: Object.fromEntries(ids.map((id) => [id, SAVED])),
    moved: [],
    summary: { resolved: 0, moved: 0, missing: ids.length, keeping: 0 },
  })
  return pads
}

describe('a pad whose saved source is missing', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('is counted and stays out of the plan', () => {
    const pads = withMissing('A1', 'B2')

    expect(pads.missingCount).toBe(2)
    expect(pads.missingFor('A1')).toEqual(SAVED)
    expect(pads.hasPreparedPads).toBe(false)
  })

  it('takes a re-linked file together with the settings the project saved', () => {
    const pads = withMissing('A1')

    pads.relink('A1', diskAudio('/samples/kick.wav'))

    expect(pads.padById('A1')?.audio).toEqual(diskAudio('/samples/kick.wav'))
    expect(pads.padById('A1')?.settings).toEqual(SAVED.settings)
    expect(pads.missingFor('A1')).toBeNull()
    expect(pads.changeFor('A1')?.status).toBe('added')
  })

  it('keeps its own settings when a file is linked to a pad that was not missing', () => {
    const pads = usePadsStore()
    pads.updateSettings('A1', { volume: 90 })

    pads.relink('A1', diskAudio('/samples/kick.wav'))

    expect(pads.padById('A1')?.settings.volume).toBe(90)
  })

  it('stops being missing once something else is put on it or it is cleared', () => {
    const pads = withMissing('A1', 'A2')

    pads.assignAudio('A1', diskAudio('/samples/snare.wav'))
    pads.clearPad('A2')

    expect(pads.padById('A1')?.settings.volume).toBe(127)
    expect(pads.missingCount).toBe(0)
  })

  it('travels with its pad when the pads are swapped', () => {
    usePadsStore().assignAudio('C5', diskAudio('/samples/snare.wav'))
    const pads = withMissing('A1')

    pads.swapPads('A1', 'C5')

    expect(pads.missingFor('A1')).toBeNull()
    expect(pads.missingFor('C5')).toEqual(SAVED)
  })

  it('comes back when the fill that covered it is undone', () => {
    const pads = withMissing('A1')

    pads.fillFrom(0, [diskAudio('/samples/one.wav'), diskAudio('/samples/two.wav')])
    expect(pads.missingFor('A1')).toBeNull()

    useNoticesStore()
      .entries.find((entry) => entry.source === 'pads:fill')
      ?.action?.run()

    expect(pads.missingFor('A1')).toEqual(SAVED)
  })

  it('is let go on request, and all at once when the changes are discarded', () => {
    const pads = withMissing('A1', 'A2')

    pads.forgetMissing('A1')
    expect(pads.missingFor('A1')).toBeNull()

    pads.discardChanges()
    expect(pads.missingCount).toBe(0)
  })

  it('outlives a sync that left its slot alone, but not one that rewrote it', () => {
    const pads = withMissing('A1', 'A2')
    const card: CardState = {
      root: '/card',
      fingerprint: 'fp-after',
      slots: Array.from({ length: PAD_COUNT }, (_unused, slot) => ({
        slot,
        settings: {
          volume: 127,
          lofi: false,
          loop: false,
          gate: true,
          reverse: false,
          tempoMode: 'off',
          originalTempo: 120,
          userTempo: 120,
        },
        sample: null,
      })),
    }

    pads.adoptSync(card, new Set([1]))

    expect(pads.missingFor('A1')).toEqual(SAVED)
    expect(pads.missingFor('A2')).toBeNull()
  })

  it('is forgotten when a card is read again', () => {
    const pads = withMissing('A1')

    pads.resetCard()

    expect(pads.missingCount).toBe(0)
  })
})
