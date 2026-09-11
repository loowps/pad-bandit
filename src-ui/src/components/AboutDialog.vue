<script setup lang="ts">
import { computed, ref } from 'vue'
import { MUSIC_LINKS } from '@/about'
import { useAboutStore } from '@/stores/about'
import { useThemeStore } from '@/stores/theme'
import { useDialog } from '@/composables/useDialog'
import logoWithDarkInk from '../assets/pad-bandit-logo-dark.svg'
import logoWithLightInk from '../assets/pad-bandit-logo-light.svg'

const about = useAboutStore()
const theme = useThemeStore()
const surface = ref<HTMLElement | null>(null)

const logo = computed(() => (theme.resolved === 'dark' ? logoWithLightInk : logoWithDarkInk))

useDialog(surface, () => about.close())
</script>

<template>
  <div v-if="about.isOpen" class="scrim" @click.self="about.close()">
    <section
      ref="surface"
      class="about"
      role="dialog"
      aria-modal="true"
      aria-label="About Pad Bandit"
    >
      <button type="button" class="close" aria-label="Close" @click="about.close()">
        <svg viewBox="0 0 14 14" aria-hidden="true" focusable="false">
          <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
        </svg>
      </button>
      <img class="logo" :src="logo" alt="Pad Bandit" />
      <p v-if="about.version" class="version">Version {{ about.version }}</p>
      <p class="creator">by Loowps</p>
      <nav class="links" aria-label="Music">
        <button
          v-for="link in MUSIC_LINKS"
          :key="link.url"
          type="button"
          class="link"
          :title="link.url"
          @click="about.follow(link.url)"
        >
          {{ link.label }}
        </button>
      </nav>
    </section>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  background: var(--wave-shade);
}

.about {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: center;
  width: min(22rem, 92vw);
  padding: 2rem 1.5rem 1.5rem;
  text-align: center;
  background: var(--panel-surface);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-overlay);
}

.close {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--text-muted);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
}

.close svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentcolor;
  stroke-width: 1.5;
  stroke-linecap: round;
}

.close:hover {
  color: var(--text-default);
  background: var(--control-track);
}

.close:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.logo {
  width: 9rem;
  height: auto;
  margin: 1rem 0 1rem;
}

.version {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-muted);
}

.creator {
  margin: 0;
  font-size: 1rem;
  color: var(--text-default);
}

.links {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  width: 100%;
  margin-top: 0.5rem;
}

.link {
  padding: 0.375rem 0.625rem;
  font: inherit;
  font-size: 0.75rem;
  color: var(--text-default);
  cursor: pointer;
  background: var(--panel-surface);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-sm);
}

.link:hover {
  border-color: var(--accent);
}

.link:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}
</style>
