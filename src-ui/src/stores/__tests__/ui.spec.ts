import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { useAudioStore } from '@/stores/audio'
import { useNoticesStore } from '@/stores/notices'
import { usePadsStore } from '@/stores/pads'
import { useUiStore } from '@/stores/ui'
import { diskAudio } from '@/domain/pad'
import type { Notice } from '@/domain/notices'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
}))

const invokeMock = vi.mocked(invoke)

function refusal(): Notice | undefined {
  return useNoticesStore().entries.find((entry) => entry.source === 'audio:undecodable')
}

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
    invokeMock.mockReset()
    invokeMock.mockResolvedValue([])
  })

  it('goes away when the pads are replaced under it', async () => {
    const pads = usePadsStore()
    const ui = useUiStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))

    await ui.dropAudio('A1', 0, [diskAudio('one.wav'), diskAudio('two.wav')])
    expect(ui.pendingDrop).not.toBeNull()

    pads.resetCard()

    expect(ui.pendingDrop).toBeNull()
    expect(pads.padById('A1')?.audio).toBeNull()
  })

  it('survives an ordinary edit to a pad', async () => {
    const pads = usePadsStore()
    const ui = useUiStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))

    await ui.dropAudio('A1', 0, [diskAudio('one.wav'), diskAudio('two.wav')])
    pads.updateSettings('A4', { volume: 40 })

    expect(ui.pendingDrop).not.toBeNull()
  })
})

describe('a drop the decoder is asked about', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    invokeMock.mockReset()
    invokeMock.mockResolvedValue([])
  })

  it('assigns a single file the decoder can open', async () => {
    const pads = usePadsStore()
    const ui = useUiStore()

    await ui.dropAudio('A1', 0, [diskAudio('/samples/kick.wav')])

    expect(invokeMock).toHaveBeenCalledWith('audio_undecodable', {
      paths: ['/samples/kick.wav'],
    })
    expect(pads.padById('A1')?.audio).toEqual(diskAudio('/samples/kick.wav'))
    expect(ui.selectedPadId).toBe('A1')
    expect(refusal()).toBeUndefined()
  })

  it('leaves the pad alone when the only file cannot be decoded', async () => {
    invokeMock.mockResolvedValue([
      { path: '/samples/broken.wav', reason: 'the file holds no decodable audio track' },
    ])
    const pads = usePadsStore()
    const ui = useUiStore()

    await ui.dropAudio('A1', 0, [diskAudio('/samples/broken.wav')])

    expect(pads.padById('A1')?.audio).toBeNull()
    expect(ui.selectedPadId).toBeNull()
    expect(refusal()).toMatchObject({
      severity: 'error',
      title: 'broken.wav could not be decoded',
      detail: 'the file holds no decodable audio track',
    })
  })

  it('fills the pads from the files that survive the check', async () => {
    invokeMock.mockResolvedValue([{ path: 'two.wav', reason: 'unsupported codec' }])
    const pads = usePadsStore()
    const ui = useUiStore()

    await ui.dropAudio('A1', 0, [
      diskAudio('one.wav'),
      diskAudio('two.wav'),
      diskAudio('three.wav'),
    ])

    expect(pads.padById('A1')?.audio).toEqual(diskAudio('one.wav'))
    expect(pads.padById('A2')?.audio).toEqual(diskAudio('three.wav'))
    expect(refusal()).toMatchObject({ title: 'two.wav could not be decoded' })
  })

  it('forgets the last refusal once a clean drop follows', async () => {
    const ui = useUiStore()
    invokeMock.mockResolvedValue([{ path: 'broken.wav', reason: 'unsupported codec' }])
    await ui.dropAudio('A1', 0, [diskAudio('broken.wav')])

    invokeMock.mockResolvedValue([])
    await ui.dropAudio('A1', 0, [diskAudio('kick.wav')])

    expect(refusal()).toBeUndefined()
  })

  it('assigns as before when the check itself cannot run', async () => {
    invokeMock.mockRejectedValue(new Error('the backend is gone'))
    const pads = usePadsStore()
    const ui = useUiStore()

    await ui.dropAudio('A1', 0, [diskAudio('kick.wav')])

    expect(pads.padById('A1')?.audio).toEqual(diskAudio('kick.wav'))
    expect(refusal()).toBeUndefined()
  })
})
