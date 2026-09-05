<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjectsStore } from '@/stores/projects'
import { useDialog } from '@/composables/useDialog'

const projects = useProjectsStore()
const surface = ref<HTMLElement | null>(null)

const label = computed(() => {
  const recovered = projects.recoverable
  if (!recovered) {
    return ''
  }
  const what = recovered.name ? `“${recovered.name}”` : 'your unsaved work'
  return `Pad Bandit closed unexpectedly. Restore ${what}?`
})

useDialog(surface)
</script>

<template>
  <div v-if="projects.recoverable" class="scrim">
    <section
      ref="surface"
      class="recovery"
      role="alertdialog"
      aria-modal="true"
      aria-label="Restore unsaved work"
    >
      <p class="headline">{{ label }}</p>
      <footer>
        <button type="button" class="action is-primary" @click="projects.restoreRecovered()">
          Restore
        </button>
        <button type="button" class="action" @click="projects.discardRecovered()">Discard</button>
      </footer>
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

.recovery {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  width: min(34rem, 92vw);
  padding: 0.875rem 1rem;
  background: var(--panel-surface);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
}

.headline {
  flex: 1 1 auto;
  margin: 0;
  font-size: 0.8125rem;
}

footer {
  display: flex;
  flex: 0 0 auto;
  gap: 0.5rem;
}

.action {
  padding: 0.25rem 0.625rem;
  font: inherit;
  font-size: 0.75rem;
  color: var(--text-default);
  cursor: pointer;
  background: var(--panel-surface);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-sm);
}

.action:hover {
  border-color: var(--accent);
}

.action:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.action.is-primary {
  font-weight: 600;
  color: #fff;
  background: var(--accent);
  border-color: var(--accent);
}

.action.is-primary:hover {
  background: var(--accent-strong);
}
</style>
