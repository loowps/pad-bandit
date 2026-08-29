import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePadsStore } from '@/stores/pads'
import { diskAudio } from '@/domain/pad'

describe('prepared pads', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('marks nothing on an untouched card', () => {
    const pads = usePadsStore()

    expect(pads.preparedPadIds).toEqual([])
    expect(pads.hasPreparedPads).toBe(false)
    expect(pads.isPrepared('A1')).toBe(false)
  })

  it('marks a pad whose settings differ from the card', () => {
    const pads = usePadsStore()

    pads.updateSettings('A1', { volume: 64 })

    expect(pads.isPrepared('A1')).toBe(true)
    expect(pads.isPrepared('A2')).toBe(false)
    expect(pads.preparedPadIds).toEqual(['A1'])
  })

  it('marks a pad whose audio assignment differs from the card', () => {
    const pads = usePadsStore()

    pads.assignAudio('B3', diskAudio('kick.wav'))

    expect(pads.isPrepared('B3')).toBe(true)
    expect(pads.preparedPadIds).toEqual(['B3'])
  })

  it('clears the mark when a setting is edited back to the card value', () => {
    const pads = usePadsStore()
    const original = pads.padById('A1')?.settings.volume

    pads.updateSettings('A1', { volume: 12 })
    expect(pads.isPrepared('A1')).toBe(true)

    pads.updateSettings('A1', { volume: original })

    expect(pads.isPrepared('A1')).toBe(false)
    expect(pads.preparedPadIds).toEqual([])
  })

  it('clears the mark when an assigned audio source is removed again', () => {
    const pads = usePadsStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))

    pads.assignAudio('A1', null)

    expect(pads.isPrepared('A1')).toBe(false)
  })

  it('treats an equal audio reference as unchanged', () => {
    const pads = usePadsStore()
    pads.assignAudio('A1', diskAudio('root/kick.wav'))
    pads.adoptSnapshot()

    pads.assignAudio('A1', diskAudio('root/kick.wav'))

    expect(pads.isPrepared('A1')).toBe(false)
  })

  it('marks both pads after a swap', () => {
    const pads = usePadsStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))
    pads.adoptSnapshot()

    pads.swapPads('A1', 'C5')

    expect(pads.preparedPadIds).toEqual(['A1', 'C5'])
  })

  it('leaves nothing marked when a swap moves identical content', () => {
    const pads = usePadsStore()

    pads.swapPads('A1', 'C5')

    expect(pads.preparedPadIds).toEqual([])
  })

  it('takes a new baseline once the card is synced', () => {
    const pads = usePadsStore()
    pads.updateSettings('A1', { volume: 64 })
    pads.assignAudio('A2', diskAudio('snare.wav'))

    pads.adoptSnapshot()

    expect(pads.preparedPadIds).toEqual([])
    expect(pads.hasPreparedPads).toBe(false)
  })

  it('marks changes made after the last sync', () => {
    const pads = usePadsStore()
    pads.updateSettings('A1', { volume: 64 })
    pads.adoptSnapshot()

    pads.updateSettings('A1', { volume: 65 })

    expect(pads.isPrepared('A1')).toBe(true)
  })

  it('reports prepared pads in slot order', () => {
    const pads = usePadsStore()

    pads.updateSettings('J12', { lofi: true })
    pads.updateSettings('A1', { lofi: true })
    pads.updateSettings('B1', { lofi: true })

    expect(pads.preparedPadIds).toEqual(['A1', 'B1', 'J12'])
  })

  it('starts from a clean baseline again after resetting the card', () => {
    const pads = usePadsStore()
    pads.updateSettings('A1', { volume: 64 })

    pads.resetCard()

    expect(pads.preparedPadIds).toEqual([])
  })
})
