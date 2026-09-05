import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import RecoveryDialog from '@/components/RecoveryDialog.vue'
import { useProjectsStore } from '@/stores/projects'
import type { Project } from '@/projects'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<() => Promise<unknown>>(() => Promise.resolve(null)),
}))

const unsaved: Project = { version: 1, name: 'March', savedAt: 1, cardRoot: null, slots: [] }

describe('RecoveryDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('stays away when there is nothing to recover', () => {
    expect(mount(RecoveryDialog).find('[role="alertdialog"]').exists()).toBe(false)
  })

  it('names the work it found and takes it back', async () => {
    const projects = useProjectsStore()
    const wrapper = mount(RecoveryDialog, { attachTo: document.body })

    projects.recoverable = unsaved
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.headline').text()).toContain('“March”')
    expect(document.activeElement).toBe(wrapper.get('.is-primary').element)

    await wrapper.get('.is-primary').trigger('click')

    expect(projects.name).toBe('March')
    expect(projects.recoverable).toBeNull()

    wrapper.unmount()
  })

  it('calls unsaved work by no name when the project had none', async () => {
    const projects = useProjectsStore()
    const wrapper = mount(RecoveryDialog)

    projects.recoverable = { ...unsaved, name: '' }
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.headline').text()).toContain('your unsaved work')
  })

  it('throws it away when discarded', async () => {
    const projects = useProjectsStore()
    const wrapper = mount(RecoveryDialog)

    projects.recoverable = unsaved
    await wrapper.vm.$nextTick()

    await wrapper.findAll('.action')[1]?.trigger('click')

    expect(projects.recoverable).toBeNull()
    expect(projects.name).toBeNull()
  })
})
