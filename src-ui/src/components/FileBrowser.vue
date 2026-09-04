<script setup lang="ts">
import { computed } from 'vue'
import FilePreview from '@/components/FilePreview.vue'
import FileTree from '@/components/FileTree.vue'
import { useFileBrowserStore } from '@/stores/fileBrowser'

const browser = useFileBrowserStore()

const emptyResults = computed(() => browser.visibleRows.length === 0)

const emptyMessage = computed(() => {
  if (browser.searching) {
    return 'Searching…'
  }
  return browser.isIndexing ? 'Still indexing those folders…' : 'No samples match that search.'
})
</script>

<template>
  <aside class="file-browser">
    <header class="header">
      <div v-if="browser.roots.length > 0" class="search">
        <input
          :value="browser.query"
          type="search"
          class="field"
          placeholder="Search"
          aria-label="Search samples"
          autocomplete="off"
          spellcheck="false"
          @input="browser.setQuery(($event.target as HTMLInputElement).value)"
          @keydown.esc="browser.clearQuery()"
        />
        <button
          v-if="browser.query"
          type="button"
          class="clear"
          aria-label="Clear search"
          @click="browser.clearQuery()"
        >
          <svg viewBox="0 0 14 14" aria-hidden="true" focusable="false">
            <path d="M4 4l6 6M10 4l-6 6" />
          </svg>
        </button>
      </div>

      <button
        v-if="browser.roots.length > 0"
        type="button"
        class="icon"
        :class="{ 'is-busy': browser.isIndexing }"
        :disabled="browser.isIndexing"
        :aria-label="browser.isIndexing ? 'Rescanning folders' : 'Rescan folders'"
        :title="browser.isIndexing ? 'Rescanning folders' : 'Rescan folders for new samples'"
        @click="browser.refreshIndex()"
      >
        <svg viewBox="0 0 14 14" aria-hidden="true" focusable="false">
          <path d="M12 7a5 5 0 1 1-1.6-3.7" />
          <path d="M12.2 1.6v2.9H9.3" />
        </svg>
      </button>

      <button type="button" class="icon" aria-label="Add audio folder" @click="browser.addRoot()">
        <svg viewBox="0 0 14 14" aria-hidden="true" focusable="false">
          <path d="M7 2.6v8.8M2.6 7h8.8" />
        </svg>
      </button>
    </header>

    <p v-if="browser.error" class="message is-error">{{ browser.error }}</p>
    <p v-else-if="browser.roots.length === 0" class="message">
      Add a folder of samples to browse it here.
    </p>
    <p v-else-if="browser.isFiltering && emptyResults" class="message">{{ emptyMessage }}</p>

    <FileTree v-else />

    <p v-if="browser.truncated" class="note">
      Showing partial results. Try a more specific search.
    </p>
    <p v-else-if="browser.isIndexing" class="note">Indexing samples…</p>

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
  gap: 0.375rem;
  justify-content: flex-end;
  align-items: center;
  min-height: var(--bar-height);
  padding: 0.5rem 0.5rem 0.5rem 0.625rem;
  border-bottom: 1px solid var(--panel-border);
}

.icon {
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

.icon svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentcolor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.icon:hover:not(:disabled) {
  color: var(--text-default);
  background: var(--control-track);
}

.icon:disabled {
  cursor: default;
  opacity: 0.5;
}

.icon:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.icon.is-busy svg {
  animation: spin 900ms linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(1turn);
  }
}

@media (prefers-reduced-motion: reduce) {
  .icon.is-busy svg {
    animation: none;
  }
}

.search {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  min-width: 0;
}

.field {
  width: 100%;
  height: var(--control-height);
  padding: 0 1.75rem 0 0.5rem;
  font: inherit;
  font-size: 0.75rem;
  color: var(--text-default);
  background: var(--control-surface);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-sm);
}

.field::placeholder {
  color: var(--text-subtle);
}

.field:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -1px;
}

.field::-webkit-search-cancel-button {
  display: none;
}

.clear {
  position: absolute;
  right: 0.1875rem;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  color: var(--text-muted);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
}

.clear:hover {
  color: var(--text-default);
  background: var(--control-track);
}

.clear:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.clear svg {
  width: 11px;
  height: 11px;
  fill: none;
  stroke: currentcolor;
  stroke-width: 1.5;
  stroke-linecap: round;
}

.note {
  flex: 0 0 auto;
  margin: 0;
  padding: 0.375rem 0.625rem 0.5rem;
  font-size: 0.6875rem;
  color: var(--text-subtle);
  border-top: 1px solid var(--panel-border);
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
