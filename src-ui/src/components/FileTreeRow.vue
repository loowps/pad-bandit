<script setup lang="ts">
import { computed } from 'vue'
import { useFileBrowserStore, type VisibleRow } from '@/stores/fileBrowser'
import { usePadsStore } from '@/stores/pads'
import { useUiStore } from '@/stores/ui'
import { baseName } from '@/filesystem'
import { diskAudio } from '@/domain/pad'

const props = defineProps<{ row: VisibleRow }>()

const browser = useFileBrowserStore()
const pads = usePadsStore()
const ui = useUiStore()

const node = computed(() => props.row.node)
const isExpanded = computed(() => browser.isExpanded(node.value.path))
const isLoading = computed(() => browser.isLoading(node.value.path))
const failure = computed(() => browser.failureOf(node.value.path))
const isSelected = computed(() => browser.isSelected(node.value.path))
const isPreviewed = computed(() => browser.previewPath === node.value.path)
const isAssigned = computed(() => !node.value.isDirectory && pads.usesAudioPath(node.value.path))
const indent = computed(() => `${0.375 + props.row.depth * 0.75}rem`)
const path = computed(() =>
  props.row.location ? `${props.row.location}/${node.value.name}` : node.value.name,
)
const label = computed(() =>
  failure.value ? `${path.value} — ${failure.value} Click to retry.` : path.value,
)

function activate(event: MouseEvent): void {
  if (node.value.isDirectory) {
    void browser.toggleDirectory(node.value.path)
  } else if (event.shiftKey) {
    browser.extendSelection(node.value.path)
  } else if (event.ctrlKey || event.metaKey) {
    browser.toggleFile(node.value.path)
  } else {
    browser.selectFile(node.value.path)
  }
}

function handleDragStart(event: DragEvent): void {
  const paths = browser.dragPaths(node.value.path)
  event.dataTransfer?.setData('text/plain', paths.map(baseName).join('\n'))
  ui.startDrag({ source: 'audio', audio: paths.map(diskAudio) })
}

function removeRoot(): void {
  if (props.row.rootId) {
    void browser.removeRoot(props.row.rootId)
  }
}
</script>

<template>
  <div class="row-wrap" :class="{ 'is-selected': isSelected, 'is-previewed': isPreviewed }">
    <button
      type="button"
      class="row"
      role="treeitem"
      :class="{
        'is-directory': node.isDirectory,
        'is-root': Boolean(row.rootId),
        'is-failed': Boolean(failure),
      }"
      :style="{ paddingLeft: indent }"
      :draggable="!node.isDirectory"
      :aria-level="row.depth + 1"
      :aria-expanded="node.isDirectory ? isExpanded : undefined"
      :aria-selected="node.isDirectory ? undefined : isSelected"
      :title="label"
      @click="activate"
      @dragstart="handleDragStart"
      @dragend="ui.endDrag()"
    >
      <svg class="glyph" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
        <template v-if="node.isDirectory">
          <path
            v-if="isExpanded"
            d="M1 3.6a.7.7 0 0 1 .7-.7h3.2l1.3 1.4h4.9a.7.7 0 0 1 .7.7v.7H4.6a.7.7 0 0 0-.66.46L2.3 11H1.7a.7.7 0 0 1-.7-.7zM3.6 11l1.5-4.1a.7.7 0 0 1 .66-.46h6.6a.5.5 0 0 1 .47.67l-1.4 3.9a.7.7 0 0 1-.66.46z"
          />
          <path
            v-else
            d="M1 3.6a.7.7 0 0 1 .7-.7h3.2l1.3 1.4h5.1a.7.7 0 0 1 .7.7v5.3a.7.7 0 0 1-.7.7H1.7a.7.7 0 0 1-.7-.7z"
          />
        </template>
        <circle v-else-if="isAssigned" class="is-assigned" cx="7" cy="7" r="3" />
        <path v-else d="M5.9 2.6 11 1.4v1.5L7.2 3.8v5.8A2.2 2.2 0 1 1 5.9 7.6z" />
      </svg>
      <span class="name">{{ node.name }}</span>
      <span v-if="row.location" class="location">{{ row.location }}</span>
      <span v-if="isLoading" class="loading">…</span>
      <span v-else-if="failure" class="failure">{{ failure }}</span>
    </button>

    <button
      v-if="row.rootId"
      type="button"
      class="remove"
      :aria-label="`Remove ${node.name}`"
      @click="removeRoot"
    >
      <svg viewBox="0 0 14 14" aria-hidden="true" focusable="false">
        <path d="M4 4l6 6M10 4l-6 6" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.row-wrap {
  display: flex;
  align-items: center;
  height: 24px;
  padding-right: 0.125rem;
  border-radius: var(--radius-sm);
}

.row-wrap:hover {
  background: var(--control-track);
}

.row-wrap.is-selected {
  color: #fff;
  background: var(--accent);
}

.row-wrap.is-previewed {
  box-shadow: inset 2px 0 0 var(--accent);
}

.row-wrap.is-selected.is-previewed {
  box-shadow: inset 2px 0 0 currentcolor;
}

.row {
  display: flex;
  flex: 1 1 auto;
  gap: 0.375rem;
  align-items: center;
  min-width: 0;
  height: 100%;
  padding: 0 0.375rem;
  font: inherit;
  font-size: 0.8125rem;
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
}

.row:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
  border-radius: var(--radius-sm);
}

.row.is-root .name {
  font-weight: 600;
}

.glyph {
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
  fill: var(--text-subtle);
}

.glyph .is-assigned {
  fill: var(--marker-assigned);
}

.row-wrap.is-selected .glyph,
.row-wrap.is-selected .glyph .is-assigned {
  fill: currentcolor;
}

.name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.location {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: 0.6875rem;
  color: var(--text-subtle);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-wrap.is-selected .location {
  color: inherit;
  opacity: 0.75;
}

.loading {
  margin-left: auto;
  color: var(--text-muted);
}

.failure {
  flex: 0 1 auto;
  min-width: 0;
  margin-left: auto;
  padding-left: 0.375rem;
  overflow: hidden;
  font-size: 0.6875rem;
  color: var(--status-danger);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row.is-failed .glyph {
  fill: var(--status-danger);
}

.row-wrap.is-selected .failure,
.row-wrap.is-selected .row.is-failed .glyph {
  color: inherit;
  fill: currentcolor;
}

.remove {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  color: var(--text-muted);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  opacity: 0;
}

.row-wrap:hover .remove,
.remove:focus-visible {
  opacity: 1;
}

.remove:hover {
  color: var(--text-default);
  background: var(--panel-surface);
}

.row-wrap.is-selected .remove {
  color: #fff;
}

.row-wrap.is-selected .remove:hover {
  background: rgb(255 255 255 / 22%);
}

.remove:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}

.remove svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentcolor;
  stroke-width: 1.5;
  stroke-linecap: round;
}
</style>
