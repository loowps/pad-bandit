<script setup lang="ts">
import { computed, ref } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useDialog } from '@/composables/useDialog'

const ui = useUiStore()
const surface = ref<HTMLElement | null>(null)

useDialog(surface, () => ui.closeDrop())

const headline = computed(() => {
  const pending = ui.pendingDrop
  if (!pending) {
    return ''
  }
  const pads = pending.inTheWay === 1 ? 'pad already holds' : 'pads already hold'
  return `${pending.sources.length} files from ${pending.padId} — ${pending.inTheWay} ${pads} a sample.`
})
</script>

<template>
  <div v-if="ui.pendingDrop" class="scrim" @click.self="ui.closeDrop()">
    <section
      ref="surface"
      class="prompt"
      role="dialog"
      aria-modal="true"
      aria-label="Pads in the way"
    >
      <p class="headline">{{ headline }}</p>
      <footer>
        <button
          type="button"
          class="action"
          @mouseenter="ui.previewDrop('fill')"
          @focus="ui.previewDrop('fill')"
          @click="ui.commitDrop('fill')"
        >
          Skip them
        </button>
        <button
          type="button"
          class="action is-destructive"
          @mouseenter="ui.previewDrop('overwrite')"
          @focus="ui.previewDrop('overwrite')"
          @click="ui.commitDrop('overwrite')"
        >
          Overwrite them
        </button>
        <button type="button" class="action" @click="ui.closeDrop()">Cancel</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  display: grid;
  align-content: end;
  justify-items: center;
  padding-bottom: 3rem;
}

.prompt {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  width: min(38rem, 92vw);
  padding: 0.75rem 0.875rem;
  background: var(--panel-surface);
  border: 1px solid var(--panel-border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 25%);
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
  border-radius: 3px;
}

.action:hover {
  border-color: var(--accent);
}

.action:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.action.is-destructive:hover {
  color: var(--status-danger);
  border-color: var(--status-danger);
}
</style>
