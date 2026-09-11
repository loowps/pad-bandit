import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import RestoreDialog from '@/components/RestoreDialog.vue'
import { useProjectsStore } from '@/stores/projects'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<() => Promise<unknown>>(() => Promise.resolve(null)),
}))

describe('RestoreDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('stays away while the card matches the project', () => {
    expect(mount(RestoreDialog).find('[role="alertdialog"]').exists()).toBe(false)
  })

  it('says how many pads differ and where each can come back from', async () => {
    const projects = useProjectsStore()
    const wrapper = mount(RestoreDialog)

    projects.restoreOffer = {
      name: 'March',
      divergence: { onCard: 2, fromDisk: 1, missing: 3, extra: 0 },
    }
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.headline').text()).toBe("The card doesn't match “March” on 6 pads.")
    expect(wrapper.findAll('.findings li').map((item) => item.text())).toEqual([
      '2 pads still on the card, on another pad',
      '1 pad from the original file on your computer',
      "3 pads can't be found anywhere",
    ])
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  })

  it('restores and clears the extra pads only when that box is ticked', async () => {
    const projects = useProjectsStore()
    const answered = vi.spyOn(projects, 'answerRestore')
    const wrapper = mount(RestoreDialog)

    projects.restoreOffer = {
      name: 'March',
      divergence: { onCard: 0, fromDisk: 1, missing: 0, extra: 4 },
    }
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.extra').text()).toBe('Also clear 4 pads that are empty in the project')

    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('.is-primary').trigger('click')

    expect(answered).toHaveBeenCalledWith({ restore: true, clearExtras: true })
  })

  it('keeping the card never clears anything, whatever the box says', async () => {
    const projects = useProjectsStore()
    const answered = vi.spyOn(projects, 'answerRestore')
    const wrapper = mount(RestoreDialog)

    projects.restoreOffer = {
      name: 'March',
      divergence: { onCard: 0, fromDisk: 0, missing: 0, extra: 1 },
    }
    await wrapper.vm.$nextTick()

    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.findAll('.action')[1]?.trigger('click')

    expect(answered).toHaveBeenCalledWith({ restore: false, clearExtras: false })
  })
})
