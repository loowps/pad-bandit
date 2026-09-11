import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import CloseDialog from '@/components/CloseDialog.vue'
import { useProjectsStore } from '@/stores/projects'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<() => Promise<unknown>>(() => Promise.resolve(null)),
}))

describe('CloseDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('stays away until the window is closed with unsaved work', () => {
    expect(mount(CloseDialog).find('[role="alertdialog"]').exists()).toBe(false)
  })

  it('names the project and hands each answer to the store', async () => {
    const projects = useProjectsStore()
    const save = vi.spyOn(projects, 'saveAndClose').mockResolvedValue()
    const discard = vi.spyOn(projects, 'closeWithoutSaving').mockResolvedValue()
    const cancel = vi.spyOn(projects, 'stayOpen').mockResolvedValue()
    const wrapper = mount(CloseDialog)

    projects.name = 'March'
    projects.closeOffer = true
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.headline').text()).toContain('“March”')
    const [saving, discarding, cancelling] = wrapper.findAll('.action')
    await saving?.trigger('click')
    await discarding?.trigger('click')
    await cancelling?.trigger('click')

    expect(save).toHaveBeenCalledOnce()
    expect(discard).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
  })
})
