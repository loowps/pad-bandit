import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAudioStore } from '@/stores/audio'
import { usePadsStore } from '@/stores/pads'
import { useUiStore } from '@/stores/ui'
import { diskAudio } from '@/domain/pad'

describe('ui store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('resolves the selected pad from the card', () => {
    const ui = useUiStore()

    expect(ui.selectedPad).toBeNull()

    ui.selectPad('B3')

    expect(ui.selectedPad?.id).toBe('B3')
  })

  it('stops playback when selection moves to another pad', () => {
    const ui = useUiStore()
    const audio = useAudioStore()
    ui.selectPad('A1')
    audio.play()

    ui.selectPad('A2')

    expect(audio.isPlaying).toBe(false)
  })

  it('keeps playing when the already selected pad is selected again', () => {
    const ui = useUiStore()
    const audio = useAudioStore()
    ui.selectPad('A1')
    audio.play()

    ui.selectPad('A1')

    expect(audio.isPlaying).toBe(true)
  })
})

describe('a drop waiting for an answer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('goes away when the pads are replaced under it', () => {
    const pads = usePadsStore()
    const ui = useUiStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))

    ui.proposeDrop('A1', 0, [diskAudio('one.wav'), diskAudio('two.wav')])
    expect(ui.pendingDrop).not.toBeNull()

    pads.resetCard()

    expect(ui.pendingDrop).toBeNull()
    expect(pads.padById('A1')?.audio).toBeNull()
  })

  it('survives an ordinary edit to a pad', () => {
    const pads = usePadsStore()
    const ui = useUiStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))

    ui.proposeDrop('A1', 0, [diskAudio('one.wav'), diskAudio('two.wav')])
    pads.updateSettings('A4', { volume: 40 })

    expect(ui.pendingDrop).not.toBeNull()
  })
})
