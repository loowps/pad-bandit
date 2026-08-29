import { describe, expect, it } from 'vitest'
import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import App from '@/App.vue'
import router from '@/router'

describe('App', () => {
  it('resolves the root path to the editor route', () => {
    const resolved = router.resolve('/')

    expect(resolved.name).toBe('editor')
    expect(resolved.matched).toHaveLength(1)
  })

  it('renders the editor at the root path', async () => {
    await router.push('/')
    await router.isReady()

    const wrapper = mount(App, { global: { plugins: [createPinia(), router] } })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.editor').exists()).toBe(true)
    expect(wrapper.find('.toolbar').exists()).toBe(true)
  })
})
