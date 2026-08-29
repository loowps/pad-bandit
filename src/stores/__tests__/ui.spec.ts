import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAudioStore } from '@/stores/audio'
import { useUiStore } from '@/stores/ui'

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
