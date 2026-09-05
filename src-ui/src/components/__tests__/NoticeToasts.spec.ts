import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import NoticeToasts from '@/components/NoticeToasts.vue'
import { useNoticesStore } from '@/stores/notices'

describe('NoticeToasts', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('shows nothing while there is nothing to say', () => {
    expect(mount(NoticeToasts).findAll('.toast')).toHaveLength(0)
  })

  it('reads out the title and the detail behind it', async () => {
    const notices = useNoticesStore()
    const wrapper = mount(NoticeToasts)

    notices.notify({
      severity: 'error',
      source: 'audio:undecodable',
      title: 'broken.wav could not be decoded',
      detail: 'the file holds no decodable audio track',
    })
    await wrapper.vm.$nextTick()

    const toast = wrapper.get('.toast')
    expect(toast.classes()).toContain('error')
    expect(toast.text()).toContain('broken.wav could not be decoded')
    expect(toast.text()).toContain('the file holds no decodable audio track')
  })

  it('runs the action it offers', async () => {
    const notices = useNoticesStore()
    const run = vi.fn<() => void>()
    const wrapper = mount(NoticeToasts)

    notices.notify({
      severity: 'info',
      source: 'pads:fill',
      title: 'Filled 2 pads',
      action: { label: 'Undo', run },
    })
    await wrapper.vm.$nextTick()

    await wrapper.get('.act').trigger('click')

    expect(run).toHaveBeenCalledOnce()
  })

  it('hides one on request but keeps it in the log', async () => {
    const notices = useNoticesStore()
    const wrapper = mount(NoticeToasts)

    notices.notify({ severity: 'info', source: 'sync', title: 'Sync finished' })
    await wrapper.vm.$nextTick()

    await wrapper.get('.hide').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.toast')).toHaveLength(0)
    expect(notices.entries).toHaveLength(1)
  })

  it('holds the timer while the pointer rests on it', async () => {
    const notices = useNoticesStore()
    const hold = vi.spyOn(notices, 'holdToasts')
    const release = vi.spyOn(notices, 'releaseToasts')
    const wrapper = mount(NoticeToasts)

    notices.notify({ severity: 'info', source: 'sync', title: 'Sync finished' })
    await wrapper.vm.$nextTick()

    await wrapper.get('.toast').trigger('mouseenter')
    await wrapper.get('.toast').trigger('mouseleave')

    expect(hold).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  })
})
