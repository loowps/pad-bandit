import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import BottomBar from '@/components/BottomBar.vue'
import { useCardStore } from '@/stores/card'
import { usePadsStore } from '@/stores/pads'
import { useSyncStore } from '@/stores/sync'
import { useUiStore } from '@/stores/ui'
import { diskAudio, PAD_COUNT } from '@/domain/pad'
import type { CardState } from '@/card'

const cardState: CardState = {
  root: '/media/SP-CARD',
  fingerprint: 'fp-card',
  slots: Array.from({ length: PAD_COUNT }, (_unused, slot) => ({
    slot,
    settings: {
      volume: 127,
      lofi: false,
      loop: false,
      gate: true,
      reverse: false,
      tempoMode: 'off' as const,
      originalTempo: 119.9,
      userTempo: 119.9,
    },
    sample: null,
  })),
}

describe('BottomBar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('reports that no card folder is chosen yet', () => {
    const wrapper = mount(BottomBar)

    expect(wrapper.get('.status').text()).toBe('No card folder selected')
    expect(wrapper.find('.clear').exists()).toBe(false)
  })

  it('offers sync but leaves it inert while nothing is pending', () => {
    const wrapper = mount(BottomBar)
    const sync = wrapper.get('.sync')

    expect(sync.text()).toBe('Sync to card')
    expect(sync.attributes('disabled')).toBeDefined()
  })

  it('a recognised card alone is not enough to enable sync', async () => {
    const card = useCardStore()
    const wrapper = mount(BottomBar)

    card.rootPath = '/media/SP-CARD'
    card.status = 'valid'
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.path').text()).toBe('SP-CARD')
    expect(wrapper.get('.status').text()).toBe('Card folder recognised')
    expect(wrapper.find('.clear').exists()).toBe(true)
    expect(wrapper.get('.sync').attributes('disabled')).toBeDefined()
  })

  it('pending work enables sync, and pressing it opens the preview', async () => {
    const pads = usePadsStore()
    pads.loadFromCard(cardState)
    useCardStore().presence = 'present'
    pads.assignAudio('A3', diskAudio('/samples/kick.wav'))
    const wrapper = mount(BottomBar)
    await wrapper.vm.$nextTick()

    const sync = wrapper.get('.sync')
    expect(sync.attributes('disabled')).toBeUndefined()

    await sync.trigger('click')

    expect(useSyncStore().isOpen).toBe(true)
  })
})

describe('BottomBar after a fill', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('says how much of the selection landed and takes it back', async () => {
    const pads = usePadsStore()
    const wrapper = mount(BottomBar)

    pads.fillFrom(PAD_COUNT - 2, [
      diskAudio('one.wav'),
      diskAudio('two.wav'),
      diskAudio('three.wav'),
    ])
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.fill').text()).toContain('Filled 2 of 3 pads — 1 did not fit')

    await wrapper.get('.undo').trigger('click')

    expect(pads.padById('J11')?.audio).toBeNull()
    expect(wrapper.find('.fill').exists()).toBe(false)
  })

  it('keeps quiet about the ones that fitted exactly', async () => {
    const pads = usePadsStore()
    const wrapper = mount(BottomBar)

    pads.fillFrom(0, [diskAudio('one.wav'), diskAudio('two.wav')])
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.fill').text()).toContain('Filled 2 pads')

    await wrapper.get('.dismiss').trigger('click')

    expect(wrapper.find('.fill').exists()).toBe(false)
    expect(pads.padById('A1')?.audio).toEqual(diskAudio('one.wav'))
  })
})

describe('BottomBar after a refused drop', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('names the file the decoder turned down and why', async () => {
    const ui = useUiStore()
    const wrapper = mount(BottomBar)

    ui.refusedDrop = { names: ['broken.wav'], reason: 'unsupported codec' }
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.refusal').text()).toContain(
      'broken.wav could not be decoded — unsupported codec',
    )

    await wrapper.get('.refusal .dismiss').trigger('click')

    expect(wrapper.find('.refusal').exists()).toBe(false)
  })

  it('counts them when several are turned down at once', async () => {
    const ui = useUiStore()
    const wrapper = mount(BottomBar)

    ui.refusedDrop = { names: ['one.wav', 'two.wav'], reason: 'unsupported codec' }
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.refusal').text()).toContain('2 files could not be decoded')
  })
})

describe('BottomBar after an overwrite', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('says plainly that pads were written over', async () => {
    const pads = usePadsStore()
    const wrapper = mount(BottomBar)

    pads.fillFrom(0, [diskAudio('one.wav'), diskAudio('two.wav')], 'overwrite')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.fill').text()).toContain('Overwrote 2 pads')
  })
})
