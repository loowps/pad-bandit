import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePadsStore } from '@/stores/pads'
import { createDefaultSettings, diskAudio, isPadEmpty } from '@/domain/pad'

describe('clearPad', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('removes the audio and returns the settings to defaults', () => {
    const pads = usePadsStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))
    pads.updateSettings('A1', { volume: 3, lofi: true, userTempo: 174 })

    pads.clearPad('A1')

    expect(pads.padById('A1')?.audio).toBeNull()
    expect(pads.padById('A1')?.settings).toEqual(createDefaultSettings())
  })

  it('keeps the pad identity in place', () => {
    const pads = usePadsStore()
    pads.assignAudio('C5', diskAudio('kick.wav'))

    pads.clearPad('C5')

    expect(pads.padById('C5')?.id).toBe('C5')
    expect(pads.padById('C5')?.slot).toBe(28)
  })

  it('leaves other pads untouched', () => {
    const pads = usePadsStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))
    pads.assignAudio('A2', diskAudio('snare.wav'))

    pads.clearPad('A1')

    expect(pads.padById('A2')?.audio).toEqual(diskAudio('snare.wav'))
  })

  it('ignores an unknown pad', () => {
    const pads = usePadsStore()

    expect(() => pads.clearPad('Z9')).not.toThrow()
  })

  it('marks a pad that held card content as pending sync', () => {
    const pads = usePadsStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))
    pads.adoptSnapshot()

    pads.clearPad('A1')

    expect(pads.preparedPadIds).toEqual(['A1'])
  })

  it('leaves an already empty pad unmarked', () => {
    const pads = usePadsStore()

    pads.clearPad('A1')

    expect(pads.preparedPadIds).toEqual([])
  })
})

describe('isPadEmpty', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('recognises a fresh pad as empty', () => {
    const pad = usePadsStore().padById('A1')

    expect(pad && isPadEmpty(pad)).toBe(true)
  })

  it('recognises an assigned pad as not empty', () => {
    const pads = usePadsStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))

    expect(isPadEmpty(pads.padById('A1')!)).toBe(false)
  })

  it('recognises edited settings as not empty even without audio', () => {
    const pads = usePadsStore()
    pads.updateSettings('A1', { reverse: true })

    expect(isPadEmpty(pads.padById('A1')!)).toBe(false)
  })
})
