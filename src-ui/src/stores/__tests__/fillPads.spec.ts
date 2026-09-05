import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePadsStore } from '@/stores/pads'
import { type AudioRef, diskAudio } from '@/domain/pad'

function tracks(count: number): AudioRef[] {
  return Array.from({ length: count }, (_, index) => diskAudio(`track${index + 1}.wav`))
}

describe('filling pads from a selection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('lays the sources out over the free pads in order', () => {
    const pads = usePadsStore()

    expect(pads.fillFrom(0, tracks(3))).toEqual(['A1', 'A2', 'A3'])
    expect(pads.padById('A2')?.audio).toEqual(diskAudio('track2.wav'))
  })

  it('walks past the pads that are already in use', () => {
    const pads = usePadsStore()
    pads.assignAudio('A2', diskAudio('kick.wav'))

    pads.fillFrom(0, tracks(2))

    expect(pads.padById('A1')?.audio).toEqual(diskAudio('track1.wav'))
    expect(pads.padById('A2')?.audio).toEqual(diskAudio('kick.wav'))
    expect(pads.padById('A3')?.audio).toEqual(diskAudio('track2.wav'))
  })

  it('reports how much of the selection fitted', () => {
    const pads = usePadsStore()

    pads.fillFrom(118, tracks(5))

    expect(pads.lastFill).toEqual({ filled: 2, requested: 5, mode: 'fill' })
  })

  it('puts the pads back the way they were', () => {
    const pads = usePadsStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))
    pads.adoptSnapshot()

    pads.fillFrom(0, tracks(2))
    pads.undoFill()

    expect(pads.padById('A1')?.audio).toEqual(diskAudio('kick.wav'))
    expect(pads.padById('A2')?.audio).toBeNull()
    expect(pads.preparedPadIds).toEqual([])
    expect(pads.lastFill).toBeNull()
  })

  it('restores the settings a filled pad was carrying', () => {
    const pads = usePadsStore()
    pads.updateSettings('A1', { volume: 40, reverse: true })

    pads.fillFrom(0, tracks(1))
    pads.undoFill()

    expect(pads.padById('A1')?.settings.volume).toBe(40)
    expect(pads.padById('A1')?.settings.reverse).toBe(true)
  })

  it('forgets the result once the card has been written', () => {
    const pads = usePadsStore()
    pads.fillFrom(0, tracks(2))

    pads.adoptSnapshot()

    expect(pads.lastFill).toBeNull()
  })

  it('forgets the result when the changes are discarded', () => {
    const pads = usePadsStore()
    pads.fillFrom(0, tracks(2))

    pads.discardChanges()

    expect(pads.lastFill).toBeNull()
    expect(pads.padById('A1')?.audio).toBeNull()
  })
})

describe('filling pads over the ones already in use', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('takes the run of pads from the drop', () => {
    const pads = usePadsStore()
    pads.assignAudio('A2', diskAudio('kick.wav'))

    expect(pads.fillFrom(0, tracks(3), 'overwrite')).toEqual(['A1', 'A2', 'A3'])
    expect(pads.padById('A2')?.audio).toEqual(diskAudio('track2.wav'))
    expect(pads.lastFill).toEqual({ filled: 3, requested: 3, mode: 'overwrite' })
  })

  it('gives back what it replaced', () => {
    const pads = usePadsStore()
    pads.assignAudio('A2', diskAudio('kick.wav'))
    pads.updateSettings('A2', { volume: 40 })
    pads.adoptSnapshot()

    pads.fillFrom(0, tracks(3), 'overwrite')
    pads.undoFill()

    expect(pads.padById('A2')?.audio).toEqual(diskAudio('kick.wav'))
    expect(pads.padById('A2')?.settings.volume).toBe(40)
    expect(pads.preparedPadIds).toEqual([])
  })
})
