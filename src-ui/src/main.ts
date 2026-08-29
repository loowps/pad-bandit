import { createApp } from 'vue'
import { createPinia } from 'pinia'

import '@/assets/main.css'
import App from '@/App.vue'
import router from '@/router'

// Matches the pad sweep authored in index.html: the app appears on the frame the logo completes.
const padSweepDurationMs = 1000

const padSweepFinished = () => {
  const remaining = padSweepDurationMs - performance.now()
  return remaining > 0 ? new Promise((resolve) => setTimeout(resolve, remaining)) : Promise.resolve()
}

const app = createApp(App)

app.use(createPinia())
app.use(router)

padSweepFinished().then(() => {
  app.mount('#app')
})
