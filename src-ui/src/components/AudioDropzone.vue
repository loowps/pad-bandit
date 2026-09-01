<script setup lang="ts">
import { useFileBrowserStore } from '@/stores/fileBrowser'

const browser = useFileBrowserStore()
</script>

<template>
  <div class="dropzone">
    <span class="headline">No audio source assigned</span>
    <span class="hint">
      {{
        browser.roots.length === 0
          ? 'Add an audio folder on the left, then drag a file onto this pad.'
          : 'Drag a file from the folder tree onto this pad.'
      }}
    </span>
  </div>
</template>

<style scoped>
.dropzone {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.25rem;
  align-self: stretch;
  align-items: center;
  justify-content: center;
  margin: 0.75rem;
  padding: 1rem;
  font: inherit;
  color: var(--text-muted);
  background: var(--panel-surface);
  border: 1px dashed var(--dropzone-border);
  border-radius: var(--radius-lg);
}

.headline {
  font-size: 0.8125rem;
}

.hint {
  font-size: 0.75rem;
  opacity: 0.8;
}
</style>
