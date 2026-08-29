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
        +
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
  padding: 0.5rem 0.5rem 0.5rem 0.625rem;
  border-bottom: 1px solid var(--panel-border);
}

.title {
  flex: 1 1 auto;
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.add {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  font: inherit;
  font-size: 0.875rem;
  line-height: 1;
  color: var(--text-muted);
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--control-border);
  border-radius: 3px;
}

.add:hover:not(:disabled) {
  color: var(--text-default);
  border-color: var(--accent);
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
  color: #b4441f;
}
</style>
