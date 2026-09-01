<script setup lang="ts">
import { computed } from 'vue'
import NumberField from '@/components/NumberField.vue'
import ToggleChip from '@/components/ToggleChip.vue'
import { usePadsStore } from '@/stores/pads'
import { useUiStore } from '@/stores/ui'
import { createDefaultSettings, isPadEmpty, type PadSettings } from '@/domain/pad'

const pads = usePadsStore()
const ui = useUiStore()

const fallbackSettings = createDefaultSettings()

function settingModel<K extends keyof PadSettings>(key: K) {
  return computed<PadSettings[K]>({
    get: () => ui.selectedPad?.settings[key] ?? fallbackSettings[key],
    set: (value) => {
      const pad = ui.selectedPad
      if (pad) {
        pads.updateSettings(pad.id, { [key]: value } as Partial<PadSettings>)
      }
    },
  })
}

const lofi = settingModel('lofi')
const gate = settingModel('gate')
const reverse = settingModel('reverse')
const loop = settingModel('loop')
const userTempo = settingModel('userTempo')
const volume = settingModel('volume')

const hasSelection = computed(() => ui.selectedPad !== null)

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
  <div class="parameter-bar">
    <fieldset class="parameters" :disabled="!hasSelection">
      <legend class="sr-only">Pad parameters</legend>

      <NumberField v-model="volume" label="Volume" :min="0" :max="127" />
      <NumberField
        v-model="userTempo"
        label="Tempo"
        suffix="bpm"
        :min="40"
        :max="200"
        :step="0.1"
      />

      <span class="rule" aria-hidden="true" />

      <div class="toggles">
        <ToggleChip v-model="lofi" label="Lo-Fi" />
        <ToggleChip v-model="gate" label="Gate" />
        <ToggleChip v-model="reverse" label="Reverse" />
        <ToggleChip v-model="loop" label="Loop" />
      </div>
    </fieldset>

    <div class="pad-actions">
      <button
        type="button"
        class="revert-pad"
        aria-label="Revert pad"
        title="Drop this pad's pending changes and go back to what the card holds"
        :disabled="!canRevert"
        @click="revertSelectedPad"
      >
        Revert
      </button>
      <button
        type="button"
        class="clear-pad"
        aria-label="Clear pad"
        :disabled="!canClear"
        @click="clearSelectedPad"
      >
        Clear
      </button>
    </div>
  </div>
</template>

<style scoped>
.parameter-bar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 0.625rem 1.25rem;
  align-items: center;
  min-height: var(--bar-height);
  padding: 0.375rem 1rem;
  background: var(--panel-surface);
  border-bottom: 1px solid var(--panel-border);
}

.parameters {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: 0.625rem 1.25rem;
  align-items: center;
  padding: 0;
  margin: 0;
  border: 0;
}

.parameters:disabled {
  opacity: 0.5;
}

.rule {
  width: 1px;
  height: 22px;
  background: var(--panel-border);
}

.toggles {
  display: flex;
  gap: 0.375rem;
  align-items: center;
}

.pad-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-left: auto;
}

.revert-pad,
.clear-pad {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  height: var(--control-height);
  padding: 0 0.875rem;
  font: inherit;
  font-size: 0.8125rem;
  line-height: 1;
  color: var(--text-default);
  cursor: pointer;
  background: var(--control-surface);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-md);
}

.revert-pad:hover:not(:disabled),
.clear-pad:hover:not(:disabled) {
  border-color: var(--text-subtle);
}

.revert-pad:disabled,
.clear-pad:disabled {
  color: var(--text-subtle);
  cursor: default;
}

.revert-pad:focus-visible,
.clear-pad:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
