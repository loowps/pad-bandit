<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useProjectsStore } from '@/stores/projects'
import { useCardStore } from '@/stores/card'

const projects = useProjectsStore()
const card = useCardStore()
const dismissed = ref(false)

watch(
  () => projects.summary,
  () => {
    dismissed.value = false
  },
)

const lines = computed(() => {
  const summary = projects.summary
  if (!summary) {
    return []
  }
  return [
    { count: summary.resolved, label: 'resolved' },
    { count: summary.moved, label: 'found, moved to a different slot' },
    { count: summary.missing, label: 'source missing — not on this card' },
    { count: summary.keeping, label: 'unchanged (keep)' },
  ].filter((line) => line.count > 0)
})

const heading = computed(() => {
  const name = projects.name ? `“${projects.name}”` : 'The project'
  return card.path ? `${name} reopened against ${card.path}` : `${name} reopened`
})

const visible = computed(() => !dismissed.value && lines.value.length > 0)
</script>

<template>
  <div v-if="visible" class="reconciliation" role="status">
    <span class="heading">{{ heading }}</span>
    <span v-for="line in lines" :key="line.label" class="line">
      <b>{{ line.count }}</b> {{ line.label }}
    </span>
    <button type="button" class="action" @click="dismissed = true">Dismiss</button>
  </div>
</template>

<style scoped>
.reconciliation {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  padding: 0.375rem 0.75rem;
  font-size: 0.75rem;
  background: var(--panel-surface);
  border-bottom: 1px solid var(--panel-border);
}

.heading {
  font-weight: 600;
}

.line {
  color: var(--text-muted);
  white-space: nowrap;
}

.line b {
  color: var(--text-default);
  font-variant-numeric: tabular-nums;
}

.action {
  margin-left: auto;
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
