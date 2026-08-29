<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { useDevicePixelRatio, useElementSize } from '@vueuse/core'
import WaveformCanvas from '@/components/WaveformCanvas.vue'
import { usePlaybackSource } from '@/composables/usePlaybackSource'
import { useWaveformPeaks } from '@/composables/useWaveformPeaks'
import { baseName } from '@/filesystem'
import { PREVIEW_PLAYBACK } from '@/stores/audio'
import { useFileBrowserStore } from '@/stores/fileBrowser'
import { clampPlaybackStart } from '@/domain/region'

const browser = useFileBrowserStore()

const body = useTemplateRef<HTMLElement>('body')
const canvasWrap = useTemplateRef<HTMLElement>('canvasWrap')
const { width } = useElementSize(body)
const { pixelRatio } = useDevicePixelRatio()
const columns = computed(() => Math.floor(width.value * pixelRatio.value))

const selectedPath = computed(() => browser.selectedFilePath)
const { peaks, isLoading, error } = useWaveformPeaks(selectedPath, columns)

const isReading = computed(() => isLoading.value && !peaks.value)

const name = computed(() => (selectedPath.value ? baseName(selectedPath.value) : ''))
const minMax = computed(() => peaks.value?.minMax ?? [])
const totalFrames = computed(() => peaks.value?.frames ?? 0)
const sampleRate = computed(() => peaks.value?.sampleRate ?? 44100)

const wholeFile = computed(() => ({ start: 0, end: totalFrames.value }))

const startFrame = computed(() => clampPlaybackStart(browser.previewStartFrame, wholeFile.value))

const startStyle = computed(() => ({
  left: totalFrames.value === 0 ? '0%' : `${(startFrame.value / totalFrames.value) * 100}%`,
}))

const { isActive, progress, toggle } = usePlaybackSource(
  PREVIEW_PLAYBACK,
  buildRequest,
  totalFrames,
)

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

const duration = computed(() => {
  const loaded = peaks.value
  if (!loaded || loaded.sampleRate === 0) {
    return ''
  }
  const seconds = loaded.frames / loaded.sampleRate
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`
})

let scrubbing = false

function frameAt(clientX: number): number {
  const rect = canvasWrap.value?.getBoundingClientRect()
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
    <h3 class="title">Preview</h3>

    <div ref="body" class="body">
      <p v-if="!selectedPath" class="hint">Select a file to preview it.</p>
      <p v-else-if="isReading" class="hint">Reading…</p>
      <p v-else-if="error" class="hint is-error">{{ error }}</p>

      <template v-else>
        <div
          ref="canvasWrap"
          class="canvas-wrap"
          @pointerdown="beginScrub"
          @pointermove="continueScrub"
          @pointerup="endScrub"
          @pointercancel="endScrub"
        >
          <WaveformCanvas :min-max="minMax" :progress="progress" />
          <span
            class="playback-start"
            :style="startStyle"
            :title="`Preview starts at frame ${startFrame}`"
          />
        </div>
        <div class="controls">
          <button
            type="button"
            class="transport"
            :aria-label="isActive ? 'Stop preview' : 'Play preview'"
            @click="toggle()"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path v-if="isActive" d="M4 4h8v8H4z" />
              <path v-else d="M5 3l8 5-8 5z" />
            </svg>
          </button>
          <span class="file-name">{{ name }}</span>
          <span class="duration">{{ duration }}</span>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.preview {
  --wave-color: #2d6a84;
  --wave-played: #3f7991;
  --wave-cursor: #ff6600;

  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.5rem;
  border-top: 1px solid var(--panel-border);
}

.title {
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.hint.is-error {
  color: #b4441f;
}

.canvas-wrap {
  position: relative;
  height: 4rem;
  cursor: col-resize;
  background: var(--app-surface);
}

.playback-start {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  pointer-events: none;
  background: var(--wave-cursor);
  transform: translateX(-1px);
}

.playback-start::before {
  position: absolute;
  top: 0;
  left: 50%;
  content: '';
  border-top: 6px solid var(--wave-cursor);
  border-right: 5px solid transparent;
  border-left: 5px solid transparent;
  transform: translateX(-50%);
}

.controls {
  display: flex;
  gap: 0.5rem;
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
  color: var(--text-default);
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--control-border);
  border-radius: 3px;
}

.transport:hover {
  border-color: var(--accent);
}

.transport:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.transport svg {
  width: 11px;
  height: 11px;
  fill: currentcolor;
}

.file-name {
  overflow: hidden;
  flex: 1 1 auto;
  font-size: 0.75rem;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.duration {
  flex: 0 0 auto;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}
</style>
