import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import BottomBar from '@/components/BottomBar.vue'
import { useCardStore } from '@/stores/card'
import { usePadsStore } from '@/stores/pads'
import { useNoticesStore } from '@/stores/notices'
import { useSyncStore } from '@/stores/sync'
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

describe('BottomBar messages', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('keeps out of the bar until there is something to say', () => {
    expect(mount(BottomBar).find('.trigger').exists()).toBe(false)
  })

  it('counts what has not been read yet, and opens the list', async () => {
    const notices = useNoticesStore()
    const wrapper = mount(BottomBar)

    notices.notify({ severity: 'error', source: 'card', title: 'The card went away' })
    await wrapper.vm.$nextTick()

    const trigger = wrapper.get('.trigger')
    expect(trigger.text()).toBe('1')
    expect(trigger.classes()).toContain('error')

    await trigger.trigger('click')

    expect(wrapper.get('.panel').text()).toContain('The card went away')
    expect(notices.unseen).toBe(0)
  })
})
