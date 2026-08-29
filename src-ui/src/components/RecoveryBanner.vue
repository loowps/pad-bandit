<script setup lang="ts">
import { computed } from 'vue'
import { useProjectsStore } from '@/stores/projects'

const projects = useProjectsStore()

const label = computed(() => {
  const recovered = projects.recoverable
  if (!recovered) {
    return ''
  }
  const what = recovered.name ? `“${recovered.name}”` : 'your unsaved work'
  return `Pad Bandit closed unexpectedly. Restore ${what}?`
})
</script>

<template>
  <div v-if="projects.recoverable" class="recovery" role="alert">
    <span>{{ label }}</span>
    <button type="button" class="action" @click="projects.restoreRecovered()">Restore</button>
    <button type="button" class="action" @click="projects.discardRecovered()">Discard</button>
  </div>
</template>

<style scoped>
.recovery {
  display: flex;
  flex: 0 0 auto;
  gap: 0.5rem;
  align-items: center;
  padding: 0.375rem 0.75rem;
  font-size: 0.75rem;
  background: var(--panel-surface);
  border-bottom: 1px solid var(--panel-border);
}

.action {
  padding: 0.25rem 0.625rem;
  font: inherit;
  font-size: 0.75rem;
  color: var(--text-default);
  cursor: pointer;
  background: var(--panel-surface);
  border: 1px solid var(--control-border);
  border-radius: 3px;
}

.action:hover {
  border-color: var(--accent);
}

.action:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}
</style>
