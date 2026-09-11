<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjectsStore } from '@/stores/projects'
import { useDialog } from '@/composables/useDialog'

const projects = useProjectsStore()
const surface = ref<HTMLElement | null>(null)

const headline = computed(() =>
  projects.name
    ? `“${projects.name}” has changes that are not saved or synced yet.`
    : 'You have changes that are not saved in a project or synced to the card yet.',
)

useDialog(surface, () => void projects.stayOpen())
</script>

<template>
  <div v-if="projects.closeOffer" class="scrim">
    <section
      ref="surface"
      class="closing"
      role="alertdialog"
      aria-modal="true"
      aria-label="Close Pad Bandit"
    >
      <p class="headline">{{ headline }}</p>
      <footer>
        <button type="button" class="action is-primary" @click="projects.saveAndClose()">
          Save project
        </button>
        <button type="button" class="action" @click="projects.closeWithoutSaving()">
          Close without saving
        </button>
        <button type="button" class="action" @click="projects.stayOpen()">Cancel</button>
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

.closing {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: min(30rem, 92vw);
  padding: 1rem;
  font-size: 0.8125rem;
  background: var(--panel-surface);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
}

.headline {
  margin: 0;
}

footer {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
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
  color: var(--on-accent);
  background: var(--accent);
  border-color: var(--accent);
}

.action.is-primary:hover {
  background: var(--accent-strong);
}
</style>
