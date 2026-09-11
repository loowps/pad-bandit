import { createApp } from 'vue'
import { createPinia } from 'pinia'

import '@/assets/main.css'
import App from '@/App.vue'
import router from '@/router'
import { blockBrowserMenu, blockBrowserShortcuts } from '@/composables/browserChrome'

// Both match the pad sweep and fade authored in index.html.
const padSweepDurationMs = 950
const splashFadeMs = 200

const padSweepFinished = () => {
  const remaining = padSweepDurationMs - performance.now()
  return remaining > 0
    ? new Promise((resolve) => setTimeout(resolve, remaining))
    : Promise.resolve()
}

const dismissSplash = () => {
  const splash = document.getElementById('app-loading')
  if (!splash) {
    return
  }
  requestAnimationFrame(() => {
    splash.classList.add('is-done')
    setTimeout(() => splash.remove(), splashFadeMs)
  })
}

if (import.meta.env.PROD) {
  document.addEventListener('contextmenu', blockBrowserMenu)
  window.addEventListener('keydown', blockBrowserShortcuts, true)
}

const app = createApp(App)

app.use(createPinia())
app.use(router)

padSweepFinished().then(() => {
  app.mount('#app')
  dismissSplash()
})
