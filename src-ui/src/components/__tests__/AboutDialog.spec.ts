import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import AboutDialog from '@/components/AboutDialog.vue'
import { MUSIC_LINKS } from '@/about'
import { useAboutStore } from '@/stores/about'
import { useThemeStore } from '@/stores/theme'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(() =>
    Promise.resolve('0.1.0'),
  ),
}))

const invokeMock = vi.mocked(invoke)

async function openAbout() {
  const wrapper = mount(AboutDialog, { attachTo: document.body })
  await useAboutStore().open()
  await nextTick()
  return wrapper
}

describe('AboutDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    invokeMock.mockClear()
  })

  it('stays away until asked for', () => {
    expect(mount(AboutDialog).find('[role="dialog"]').exists()).toBe(false)
  })

  it('shows the logo, the version, the creator and every music link', async () => {
    const wrapper = await openAbout()

    expect(wrapper.get('.logo').attributes('alt')).toBe('Pad Bandit')
    expect(wrapper.get('.version').text()).toBe('Version 0.1.0')
    expect(wrapper.get('.creator').text()).toBe('by Loowps')
    expect(wrapper.findAll('.link').map((link) => link.text())).toEqual(
      MUSIC_LINKS.map((link) => link.label),
    )

    wrapper.unmount()
  })

  it('draws the logo in the ink that reads on the current theme', async () => {
    const wrapper = await openAbout()
    const lightThemeLogo = wrapper.get('.logo').attributes('src')

    useThemeStore().preference = 'dark'
    await nextTick()

    expect(lightThemeLogo).toContain('pad-bandit-logo-dark')
    expect(wrapper.get('.logo').attributes('src')).toContain('pad-bandit-logo-light')

    wrapper.unmount()
  })

  it('opens a link outside the app instead of navigating to it', async () => {
    const wrapper = await openAbout()

    await wrapper.get('.link').trigger('click')

    expect(invokeMock).toHaveBeenCalledWith('plugin:opener|open_url', {
      url: MUSIC_LINKS[0]?.url,
    })

    wrapper.unmount()
  })

  it('closes on its corner button and on Escape', async () => {
    const about = useAboutStore()
    const wrapper = await openAbout()

    expect(document.activeElement).toBe(wrapper.get('.close').element)
    await wrapper.get('.close').trigger('click')
    expect(about.isOpen).toBe(false)

    await about.open()
    await nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(about.isOpen).toBe(false)

    wrapper.unmount()
  })
})
