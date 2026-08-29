<script setup lang="ts">
import { computed } from 'vue'
import { PAD_PLAYBACK, useAudioStore } from '@/stores/audio'
import { usePadsStore } from '@/stores/pads'
import { useUiStore } from '@/stores/ui'
import { audioSourceName, isPadEmpty } from '@/domain/pad'

const ui = useUiStore()
const pads = usePadsStore()
const audio = useAudioStore()

const padLabel = computed(() => ui.selectedPad?.id ?? '—')

const sourceLabel = computed(() => {
  const source = ui.selectedPad?.audio
  return source ? audioSourceName(source) : 'No audio source'
})

const canPlay = computed(() => Boolean(ui.selectedPad?.audio))

const isPadPlaying = computed(() => audio.isSourcePlaying(PAD_PLAYBACK))

const canClear = computed(() => {
  const pad = ui.selectedPad
  return pad ? !isPadEmpty(pad) : false
})

const canRevert = computed(() => {
  const pad = ui.selectedPad
  return pad ? pads.isPrepared(pad.id) : false
})

function clearSelectedPad(): void {
  const pad = ui.selectedPad
  if (pad) {
    pads.clearPad(pad.id)
  }
}

function revertSelectedPad(): void {
  const pad = ui.selectedPad
  if (pad) {
    pads.revertPad(pad.id)
  }
}
</script>

<template>
  <header class="toolbar">
    <span class="pad-name">{{ padLabel }}</span>

    <button
      type="button"
      class="transport"
      :disabled="!canPlay"
      :aria-label="isPadPlaying ? 'Pause' : 'Play'"
      @click="audio.toggle(PAD_PLAYBACK)"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path v-if="isPadPlaying" d="M4 3h3v10H4zm5 0h3v10H9z" />
        <path v-else d="M5 3l8 5-8 5z" />
      </svg>
    </button>

    <span class="source-name" :class="{ empty: !canPlay }">{{ sourceLabel }}</span>

    <button
      type="button"
      class="revert-pad"
      :disabled="!canRevert"
      title="Drop this pad's pending changes and go back to what the card holds"
      @click="revertSelectedPad"
    >
      Revert pad
    </button>

    <button type="button" class="clear-pad" :disabled="!canClear" @click="clearSelectedPad">
      Clear pad
    </button>
  </header>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex: 0 0 auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.5rem 0.75rem;
  background: var(--panel-surface);
  border-bottom: 1px solid var(--panel-border);
}

.pad-name {
  min-width: 2.5rem;
  font-size: 0.875rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.transport {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--text-default);
  cursor: pointer;
  background: var(--panel-surface);
  border: 1px solid var(--control-border);
  border-radius: 4px;
}

.transport:hover:not(:disabled) {
  border-color: var(--accent);
}

.transport:disabled {
  color: var(--text-muted);
  cursor: default;
  opacity: 0.6;
}

.transport:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

svg {
  width: 14px;
  height: 14px;
  fill: currentcolor;
}

.revert-pad,
.clear-pad {
  flex: 0 0 auto;
  padding: 0.25rem 0.625rem;
  font: inherit;
  font-size: 0.75rem;
  color: var(--text-default);
  cursor: pointer;
  background: var(--panel-surface);
  border: 1px solid var(--control-border);
  border-radius: 3px;
}

.revert-pad {
  margin-left: auto;
}

.revert-pad:hover:not(:disabled),
.clear-pad:hover:not(:disabled) {
  border-color: var(--accent);
}

.revert-pad:disabled,
.clear-pad:disabled {
  color: var(--text-muted);
  cursor: default;
  opacity: 0.6;
}

.revert-pad:focus-visible,
.clear-pad:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.source-name {
  overflow: hidden;
  font-size: 0.8125rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-name.empty {
  color: var(--text-muted);
  font-style: italic;
}
</style>
