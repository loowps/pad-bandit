<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { usePlaybackSource } from '@/composables/usePlaybackSource'
import { useWaveformPeaks } from '@/composables/useWaveformPeaks'
import { baseName } from '@/filesystem'
import { PREVIEW_PLAYBACK, useAudioStore } from '@/stores/audio'
import { useFileBrowserStore } from '@/stores/fileBrowser'
import { clampPlaybackStart } from '@/domain/region'
import { clockTime } from '@/domain/format'

const PEAK_COLUMNS = 1

const browser = useFileBrowserStore()
const audio = useAudioStore()

const track = useTemplateRef<HTMLElement>('track')

const selectedPath = computed(() => browser.selectedFilePath)
const { peaks, isLoading, error } = useWaveformPeaks(
  selectedPath,
  computed(() => PEAK_COLUMNS),
)

const isReading = computed(() => isLoading.value && !peaks.value)

const name = computed(() => (selectedPath.value ? baseName(selectedPath.value) : ''))
const totalFrames = computed(() => peaks.value?.frames ?? 0)
const sampleRate = computed(() => peaks.value?.sampleRate ?? 44100)

const wholeFile = computed(() => ({ start: 0, end: totalFrames.value }))

const startFrame = computed(() => clampPlaybackStart(browser.previewStartFrame, wholeFile.value))

const { isActive, toggle } = usePlaybackSource(PREVIEW_PLAYBACK, buildRequest, totalFrames)

const positionFrame = computed(() => (isActive.value ? audio.positionFrame : startFrame.value))

const percent = computed(() =>
  totalFrames.value === 0 ? 0 : (positionFrame.value / totalFrames.value) * 100,
)

const elapsed = computed(() => clockTime(positionFrame.value / sampleRate.value))
const duration = computed(() => clockTime(totalFrames.value / sampleRate.value))

function buildRequest() {
  const path = selectedPath.value
  if (!path || totalFrames.value === 0) {
    return null
  }
  return {
    path,
    startFrame: startFrame.value,
    endFrame: totalFrames.value,
    sampleRate: sampleRate.value,
    loop: false,
    reverse: false,
    volume: 1,
  }
}

let scrubbing = false

function frameAt(clientX: number): number {
  const rect = track.value?.getBoundingClientRect()
  if (!rect || rect.width === 0) {
    return 0
  }
  return ((clientX - rect.left) / rect.width) * totalFrames.value
}

function moveStart(clientX: number): void {
  browser.setPreviewStart(clampPlaybackStart(frameAt(clientX), wholeFile.value))
}

function beginScrub(event: PointerEvent): void {
  if (totalFrames.value === 0) {
    return
  }
  scrubbing = true
  ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
  moveStart(event.clientX)
}

function continueScrub(event: PointerEvent): void {
  if (scrubbing) {
    moveStart(event.clientX)
  }
}

function endScrub(event: PointerEvent): void {
  scrubbing = false
  const element = event.currentTarget as Element
  if (element.hasPointerCapture(event.pointerId)) {
    element.releasePointerCapture(event.pointerId)
  }
}
</script>

<template>
  <section class="preview">
    <p v-if="!selectedPath" class="hint">Select a file to preview it.</p>
    <p v-else-if="isReading" class="hint">Reading…</p>
    <p v-else-if="error" class="hint is-error">{{ error }}</p>

    <template v-else>
      <div class="controls">
        <button
          type="button"
          class="transport"
          :aria-label="isActive ? 'Stop preview' : 'Play preview'"
          @click="toggle()"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path v-if="isActive" d="M4.5 4.5h7v7h-7z" />
            <path v-else d="M5 3l8 5-8 5z" />
          </svg>
        </button>
        <span class="file-name" :title="name">{{ name }}</span>
        <span class="clock">{{ elapsed }} / {{ duration }}</span>
      </div>

      <div
        ref="track"
        class="track"
        :style="{ '--fraction': percent / 100 }"
        :title="`Preview starts at frame ${startFrame}`"
        @pointerdown="beginScrub"
        @pointermove="continueScrub"
        @pointerup="endScrub"
        @pointercancel="endScrub"
      >
        <span class="fill" />
        <span class="knob" />
      </div>
    </template>
  </section>
</template>

<style scoped>
.preview {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.5rem 0.625rem 0.625rem;
  border-top: 1px solid var(--panel-border);
}

.hint {
  margin: 0;
  padding: 0.125rem 0.125rem 0.25rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.hint.is-error {
  color: var(--status-danger);
}

.controls {
  display: flex;
  gap: 0.375rem;
  align-items: center;
  min-width: 0;
}

.transport {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--text-muted);
  cursor: pointer;
  background: var(--control-surface);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-sm);
}

.transport:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.transport:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.transport svg {
  width: 10px;
  height: 10px;
  fill: currentcolor;
}

.file-name {
  overflow: hidden;
  flex: 1 1 auto;
  font-size: 0.8125rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clock {
  flex: 0 0 auto;
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

.file-name,
.clock {
  position: relative;
  top: -1px;
}

.track {
  --knob-size: 10px;

  position: relative;
  height: 12px;
  cursor: pointer;
}

.track::before {
  position: absolute;
  top: 50%;
  right: 0;
  left: 0;
  height: 3px;
  content: '';
  background: var(--control-track);
  border-radius: 2px;
  transform: translateY(-50%);
}

.fill {
  position: absolute;
  top: 50%;
  left: 0;
  width: calc(var(--knob-size) / 2 + (100% - var(--knob-size)) * var(--fraction));
  height: 3px;
  background: var(--accent);
  border-radius: 2px;
  transform: translateY(-50%);
}

.knob {
  position: absolute;
  top: 50%;
  left: calc(var(--knob-size) / 2 + (100% - var(--knob-size)) * var(--fraction));
  width: var(--knob-size);
  height: var(--knob-size);
  background: var(--panel-surface);
  border: 2px solid var(--accent);
  border-radius: 50%;
  transform: translate(-50%, -50%);
}
</style>
