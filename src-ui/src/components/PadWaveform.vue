<script setup lang="ts">
import { computed, useTemplateRef, watch } from 'vue'
import { useDevicePixelRatio, useElementSize } from '@vueuse/core'
import AudioDropzone from '@/components/AudioDropzone.vue'
import WaveformCanvas from '@/components/WaveformCanvas.vue'
import { useWaveformPeaks } from '@/composables/useWaveformPeaks'
import { usePlaybackSource } from '@/composables/usePlaybackSource'
import { PAD_PLAYBACK, useAudioStore } from '@/stores/audio'
import { usePadsStore } from '@/stores/pads'
import { useUiStore } from '@/stores/ui'
import {
  clampPlaybackStart,
  fitRegionToBuffer,
  minRegionFrames,
  moveRegion,
  type Region,
  setRegionEnd,
  setRegionStart,
} from '@/domain/region'

type DragMode = 'move' | 'start' | 'end' | 'scrub' | 'playhead'

const CLICK_SLOP_PX = 3

const pads = usePadsStore()
const ui = useUiStore()
const audio = useAudioStore()

const root = useTemplateRef<HTMLElement>('root')
const surface = useTemplateRef<HTMLElement>('surface')
const { width: viewWidth } = useElementSize(root)
const { pixelRatio } = useDevicePixelRatio()
const columns = computed(() => Math.floor(viewWidth.value * pixelRatio.value))

const selectedPad = computed(() => ui.selectedPad)

const audioPath = computed(() => selectedPad.value?.audio?.path ?? null)

const { peaks, isLoading, error: loadError } = useWaveformPeaks(audioPath, columns)

const isReading = computed(() => isLoading.value && !peaks.value)

const totalFrames = computed(() => peaks.value?.frames ?? 0)
const sampleRate = computed(() => peaks.value?.sampleRate ?? 44100)
const minMax = computed(() => peaks.value?.minMax ?? [])

const bounds = computed(() => ({
  totalFrames: totalFrames.value,
  minFrames: minRegionFrames(sampleRate.value),
}))

const region = computed<Region>(() => ({
  start: selectedPad.value?.settings.startFrame ?? 0,
  end: selectedPad.value?.settings.endFrame ?? 0,
}))

function percentOf(frame: number): string {
  return totalFrames.value === 0 ? '0%' : `${(frame / totalFrames.value) * 100}%`
}

const regionStyle = computed(() => ({
  left: percentOf(region.value.start),
  width: percentOf(region.value.end - region.value.start),
}))

const regionStartStyle = computed(() => ({ left: percentOf(region.value.start) }))
const regionEndStyle = computed(() => ({ left: percentOf(region.value.end) }))

const playbackStart = computed(() => clampPlaybackStart(ui.playbackStartFrame, region.value))

const playbackStartStyle = computed(() => ({ left: percentOf(playbackStart.value) }))

const { progress, toggle } = usePlaybackSource(PAD_PLAYBACK, buildRequest, totalFrames)

function buildRequest() {
  const pad = selectedPad.value
  const path = audioPath.value
  if (!pad || !path || totalFrames.value === 0) {
    return null
  }
  return {
    path,
    startFrame: playbackStart.value,
    endFrame: region.value.end,
    sampleRate: sampleRate.value,
    loop: pad.settings.loop,
    reverse: pad.settings.reverse,
    volume: pad.settings.volume / 127,
  }
}

function writeRegion(next: Region): void {
  const pad = selectedPad.value
  if (pad) {
    pads.updateSettings(pad.id, { startFrame: next.start, endFrame: next.end })
  }
}

watch(isLoading, (loading) => {
  ui.isLoadingAudio = loading
})

watch(peaks, (loaded) => {
  if (loaded && loaded.frames > 0) {
    writeRegion(
      fitRegionToBuffer(region.value, {
        totalFrames: loaded.frames,
        minFrames: minRegionFrames(loaded.sampleRate),
      }),
    )
  }
})

watch(audioPath, () => {
  ui.setPlaybackStart(null)
})

watch(
  () => selectedPad.value?.settings.volume,
  (volume) => {
    if (volume !== undefined) {
      audio.setVolume(volume / 127)
    }
  },
)

let dragMode: DragMode | null = null
let dragOriginX = 0
let dragOriginRegion: Region = { start: 0, end: 0 }
let dragMoved = false
let playheadGrabOffset = 0

function framesPerPixel(): number {
  const width = surface.value?.getBoundingClientRect().width ?? 0
  return width > 0 ? totalFrames.value / width : 0
}

function frameAt(clientX: number): number {
  const left = surface.value?.getBoundingClientRect().left ?? 0
  return (clientX - left) * framesPerPixel()
}

function movePlaybackStart(clientX: number): void {
  ui.setPlaybackStart(clampPlaybackStart(frameAt(clientX) + playheadGrabOffset, region.value))
}

function beginDrag(mode: DragMode, event: PointerEvent): void {
  if (totalFrames.value === 0) {
    return
  }
  dragMode = mode
  dragOriginX = event.clientX
  dragOriginRegion = region.value
  dragMoved = false
  playheadGrabOffset = mode === 'playhead' ? playbackStart.value - frameAt(event.clientX) : 0
  ;(event.currentTarget as Element).setPointerCapture(event.pointerId)

  if (mode === 'scrub') {
    movePlaybackStart(event.clientX)
  }
}

function continueDrag(event: PointerEvent): void {
  if (!dragMode) {
    return
  }
  if (Math.abs(event.clientX - dragOriginX) > CLICK_SLOP_PX) {
    dragMoved = true
  }

  if (dragMode === 'scrub' || dragMode === 'playhead') {
    movePlaybackStart(event.clientX)
    return
  }

  const delta = (event.clientX - dragOriginX) * framesPerPixel()

  if (dragMode === 'move') {
    writeRegion(moveRegion(dragOriginRegion, delta, bounds.value))
  } else if (dragMode === 'start') {
    writeRegion(setRegionStart(dragOriginRegion, dragOriginRegion.start + delta, bounds.value))
  } else {
    writeRegion(setRegionEnd(dragOriginRegion, dragOriginRegion.end + delta, bounds.value))
  }
}

function endDrag(event: PointerEvent): void {
  if (dragMode === 'move' && !dragMoved) {
    movePlaybackStart(event.clientX)
  }
  dragMode = null
  const element = event.currentTarget as Element
  if (element.hasPointerCapture(event.pointerId)) {
    element.releasePointerCapture(event.pointerId)
  }
}
</script>

<template>
  <div ref="root" class="waveform">
    <p v-if="!selectedPad" class="notice">Select a pad to edit its sample.</p>

    <AudioDropzone v-else-if="!selectedPad.audio" />

    <p v-else-if="isReading" class="notice">
      <span class="spinner" aria-hidden="true" />
      Reading audio…
    </p>

    <p v-else-if="loadError" class="notice is-error">{{ loadError }}</p>

    <div
      v-else
      ref="surface"
      class="surface"
      @pointerdown="beginDrag('scrub', $event)"
      @pointermove="continueDrag"
      @pointerup="endDrag"
      @pointercancel="endDrag"
    >
      <WaveformCanvas :min-max="minMax" :progress="progress" />

      <div
        class="region"
        :style="regionStyle"
        @pointerdown.stop="beginDrag('move', $event)"
        @pointermove.stop="continueDrag"
        @pointerup.stop="endDrag"
        @pointercancel.stop="endDrag"
        @dblclick.stop="toggle()"
      />

      <span
        class="playhead"
        :style="playbackStartStyle"
        title="Drag to set where playback starts"
        @pointerdown.stop="beginDrag('playhead', $event)"
        @pointermove.stop="continueDrag"
        @pointerup.stop="endDrag"
        @pointercancel.stop="endDrag"
      />

      <span
        class="handle"
        :style="regionStartStyle"
        @pointerdown.stop="beginDrag('start', $event)"
        @pointermove.stop="continueDrag"
        @pointerup.stop="endDrag"
        @pointercancel.stop="endDrag"
      />
      <span
        class="handle"
        :style="regionEndStyle"
        @pointerdown.stop="beginDrag('end', $event)"
        @pointermove.stop="continueDrag"
        @pointerup.stop="endDrag"
        @pointercancel.stop="endDrag"
      />
    </div>
  </div>
</template>

<style scoped>
.waveform {
  --wave-color: #2d6a84;
  --wave-played: #3f7991;
  --wave-cursor: #ff6600;
  --region-fill: rgb(94 160 255 / 16%);

  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  overflow: hidden;
  background: var(--app-surface);
  border-bottom: 1px solid var(--panel-border);
}

.notice {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin: 0;
  padding: 1rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
  text-align: center;
}

.notice.is-error {
  color: #b4441f;
}

.spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--control-border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 700ms linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}

.surface {
  position: absolute;
  inset: 0;
  cursor: col-resize;
}

.region {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 1;
  cursor: grab;
  background: var(--region-fill);
  border-right: 1px solid var(--accent);
  border-left: 1px solid var(--accent);
}

.region:active {
  cursor: grabbing;
}

.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 2;
  width: 12px;
  cursor: col-resize;
  transform: translateX(-6px);
}

.playhead::after {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 2px;
  content: '';
  background: var(--wave-cursor);
  transform: translateX(-50%);
}

.playhead::before {
  position: absolute;
  top: 0;
  left: 50%;
  content: '';
  border-top: 7px solid var(--wave-cursor);
  border-right: 6px solid transparent;
  border-left: 6px solid transparent;
  transform: translateX(-50%);
}

.handle {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 3;
  width: 10px;
  cursor: ew-resize;
  transform: translateX(-5px);
}

.handle::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 3px;
  content: '';
  background: var(--accent);
  transform: translateX(-50%);
}
</style>
