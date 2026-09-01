<script setup lang="ts">
import FilePreview from '@/components/FilePreview.vue'
import FileTree from '@/components/FileTree.vue'
import { useFileBrowserStore } from '@/stores/fileBrowser'

const browser = useFileBrowserStore()
</script>

<template>
  <aside class="file-browser">
    <header class="header">
      <h2 class="title">Audio Folders</h2>
      <button type="button" class="add" aria-label="Add audio folder" @click="browser.addRoot()">
        <svg viewBox="0 0 14 14" aria-hidden="true" focusable="false">
          <path d="M7 2.6v8.8M2.6 7h8.8" />
        </svg>
      </button>
    </header>

    <p v-if="browser.error" class="message is-error">{{ browser.error }}</p>
    <p v-else-if="browser.roots.length === 0" class="message">
      Add a folder of samples to browse it here.
    </p>

    <FileTree v-else />

    <FilePreview />
  </aside>
</template>

<style scoped>
.file-browser {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--panel-surface);
}

.header {
  display: flex;
  flex: 0 0 auto;
  gap: 0.5rem;
  align-items: center;
  padding: 0.75rem 0.625rem 0.75rem 0.875rem;
  border-bottom: 1px solid var(--panel-border);
}

.title {
  flex: 1 1 auto;
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.add {
  display: grid;
  flex: 0 0 auto;
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

.add svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentcolor;
  stroke-width: 1.5;
  stroke-linecap: round;
}

.add:hover:not(:disabled) {
  color: var(--text-default);
  background: var(--control-track);
}

.add:disabled {
  cursor: default;
  opacity: 0.5;
}

.add:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.message {
  flex: 1 1 auto;
  margin: 0;
  padding: 0.75rem 0.625rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.message.is-error {
  color: var(--status-danger);
}
</style>
