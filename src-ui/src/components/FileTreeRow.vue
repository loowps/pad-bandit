<script setup lang="ts">
import { computed } from 'vue'
import { useFileBrowserStore, type VisibleRow } from '@/stores/fileBrowser'
import { useUiStore } from '@/stores/ui'
import { diskAudio } from '@/domain/pad'

const props = defineProps<{ row: VisibleRow }>()

const browser = useFileBrowserStore()
const ui = useUiStore()

const node = computed(() => props.row.node)
const isExpanded = computed(() => browser.isExpanded(node.value.path))
const isLoading = computed(() => browser.isLoading(node.value.path))
const isSelected = computed(() => browser.selectedFilePath === node.value.path)
const indent = computed(() => `${0.375 + props.row.depth * 0.75}rem`)

function activate(): void {
  if (node.value.isDirectory) {
    void browser.toggleDirectory(node.value.path)
  } else {
    browser.selectFile(node.value.path)
  }
}

function handleDragStart(event: DragEvent): void {
  event.dataTransfer?.setData('text/plain', node.value.name)
  ui.startDrag({ source: 'audio', audio: diskAudio(node.value.path) })
}

function removeRoot(): void {
  if (props.row.rootId) {
    void browser.removeRoot(props.row.rootId)
  }
}
</script>

<template>
  <div class="row-wrap">
    <button
      type="button"
      class="row"
      :class="{ 'is-selected': isSelected, 'is-directory': node.isDirectory }"
      :style="{ paddingLeft: indent }"
      :draggable="!node.isDirectory"
      :aria-expanded="node.isDirectory ? isExpanded : undefined"
      :title="node.name"
      @click="activate"
      @dragstart="handleDragStart"
      @dragend="ui.endDrag()"
    >
      <span v-if="node.isDirectory" class="twisty" :class="{ 'is-open': isExpanded }">▸</span>
      <span v-else class="twisty" />
      <span class="name">{{ node.name }}</span>
      <span v-if="isLoading" class="loading">…</span>
    </button>

    <button
      v-if="row.rootId"
      type="button"
      class="remove"
      :aria-label="`Remove ${node.name}`"
      @click="removeRoot"
    >
      ×
    </button>
  </div>
</template>

<style scoped>
.row-wrap {
  display: flex;
  align-items: center;
  height: 24px;
}

.row {
  display: flex;
  flex: 1 1 auto;
  gap: 0.25rem;
  align-items: center;
  min-width: 0;
  height: 100%;
  padding: 0 0.375rem;
  font: inherit;
  font-size: 0.8125rem;
  color: var(--text-default);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 3px;
}

.row:hover {
  background: var(--control-track);
}

.row:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}

.row.is-selected {
  color: #fff;
  background: var(--accent);
}

.twisty {
  flex: 0 0 0.75rem;
  font-size: 0.625rem;
  color: var(--text-muted);
  transition: transform 120ms ease;
}

.twisty.is-open {
  transform: rotate(90deg);
}

.row.is-selected .twisty {
  color: inherit;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.loading {
  margin-left: auto;
  color: var(--text-muted);
}

.remove {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  margin-right: 0.25rem;
  font: inherit;
  font-size: 0.8125rem;
  line-height: 1;
  color: var(--text-muted);
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--control-border);
  border-radius: 3px;
}

.remove:hover {
  color: var(--text-default);
  border-color: var(--accent);
}

.remove:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}
</style>
