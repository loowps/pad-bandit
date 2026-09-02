<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
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
import { preciseTime } from '@/domain/format'

type DragMode = 'move' | 'start' | 'end' | 'scrub' | 'playhead'

type BadgeSide = 'left' | 'right'

const CLICK_SLOP_PX = 3
const BADGE_WIDTH_PX = 56
const BADGE_GAP_PX = 6

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

const leadShadeStyle = computed(() => ({ width: percentOf(region.value.start) }))

const tailShadeStyle = computed(() => ({ left: percentOf(region.value.end) }))

const regionStartStyle = computed(() => ({ left: percentOf(region.value.start) }))
const regionEndStyle = computed(() => ({ left: percentOf(region.value.end) }))

const playbackStart = computed(() => clampPlaybackStart(ui.playbackStartFrame, region.value))

const playbackStartStyle = computed(() => ({ left: percentOf(playbackStart.value) }))

const playedFrom = computed(() =>
  totalFrames.value === 0 ? 0 : playbackStart.value / totalFrames.value,
)

const { isActive, moveTo, progress } = usePlaybackSource(PAD_PLAYBACK, buildRequest, totalFrames)

function timeBadge(frame: number, preferred: BadgeSide) {
  const fraction = totalFrames.value === 0 ? 0 : frame / totalFrames.value
  const offset = fraction * viewWidth.value
  const needed = BADGE_WIDTH_PX + BADGE_GAP_PX
  const fitsLeft = offset >= needed
  const fitsRight = offset <= viewWidth.value - needed
  const side = preferred === 'left' ? (fitsLeft ? 'left' : 'right') : fitsRight ? 'right' : 'left'

  return {
    time: preciseTime(frame / sampleRate.value),
    style: { left: fraction * 100 + '%', '--badge-gap': BADGE_GAP_PX + 'px' },
    side: 'to-' + side,
  }
}

const startBadge = computed(() => timeBadge(region.value.start, 'right'))
const endBadge = computed(() => timeBadge(region.value.end, 'left'))
const playingBadge = computed(() => timeBadge((progress.value ?? 0) * totalFrames.value, 'right'))

const movesWholeRegion = computed(() => dragMode.value === 'move')
const showsStartBadge = computed(() => movesWholeRegion.value || dragMode.value === 'start')
const showsEndBadge = computed(() => movesWholeRegion.value || dragMode.value === 'end')
const showsPlayingBadge = computed(() => isActive.value && progress.value !== null)

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
  ui.setAudioInfo(
    loaded
      ? { frames: loaded.frames, sampleRate: loaded.sampleRate, channels: loaded.channels }
      : null,
  )

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

const dragMode = ref<DragMode | null>(null)
const isDragOver = ref(false)

const acceptsDrop = computed(() => selectedPad.value !== null && ui.dragPayload?.source === 'audio')

const showsDropTarget = computed(() => isDragOver.value && acceptsDrop.value)

function handleDragOver(): void {
  if (acceptsDrop.value) {
    isDragOver.value = true
  }
}

function handleDragLeave(event: DragEvent): void {
  const leaving = event.relatedTarget
  if (!(leaving instanceof Node) || !root.value?.contains(leaving)) {
    isDragOver.value = false
  }
}

function handleDrop(): void {
  const payload = ui.dragPayload
  const pad = selectedPad.value
  isDragOver.value = false

  if (pad && payload?.source === 'audio') {
    pads.assignAudio(pad.id, payload.audio)
  }
  ui.endDrag()
}

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
  dragMode.value = mode
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
  if (!dragMode.value) {
    return
  }
  if (Math.abs(event.clientX - dragOriginX) > CLICK_SLOP_PX) {
    dragMoved = true
  }

  if (dragMode.value === 'scrub' || dragMode.value === 'playhead') {
    movePlaybackStart(event.clientX)
    return
  }

  const delta = (event.clientX - dragOriginX) * framesPerPixel()

  if (dragMode.value === 'move') {
    writeRegion(moveRegion(dragOriginRegion, delta, bounds.value))
  } else if (dragMode.value === 'start') {
    writeRegion(setRegionStart(dragOriginRegion, dragOriginRegion.start + delta, bounds.value))
  } else {
    writeRegion(setRegionEnd(dragOriginRegion, dragOriginRegion.end + delta, bounds.value))
  }
}

function endDrag(event: PointerEvent): void {
  const clicked = dragMode.value === 'move' && !dragMoved
  if (clicked) {
    movePlaybackStart(event.clientX)
  }

  if (clicked || dragMode.value === 'scrub' || dragMode.value === 'playhead') {
    moveTo()
  }

  dragMode.value = null
  const element = event.currentTarget as Element
  if (element.hasPointerCapture(event.pointerId)) {
    element.releasePointerCapture(event.pointerId)
  }
}
</script>

<template>
  <div
    ref="root"
    class="waveform"
    :class="{ 'is-drop-target': showsDropTarget }"
    @dragover.prevent="handleDragOver"
    @dragleave="handleDragLeave"
    @drop.prevent="handleDrop"
  >
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
      <WaveformCanvas :min-max="minMax" :progress="progress" :played-from="playedFrom" />

      <span class="shade" :style="leadShadeStyle" />
      <span class="shade is-tail" :style="tailShadeStyle" />

      <div
        class="region"
        :style="regionStyle"
        @pointerdown.stop="beginDrag('move', $event)"
        @pointermove.stop="continueDrag"
        @pointerup.stop="endDrag"
        @pointercancel.stop="endDrag"
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

      <span
        v-if="showsStartBadge"
        class="badge"
        :class="startBadge.side"
        :style="startBadge.style"
        >{{ startBadge.time }}</span
      >
      <span v-if="showsEndBadge" class="badge" :class="endBadge.side" :style="endBadge.style">{{
        endBadge.time
      }}</span>
      <span
        v-if="showsPlayingBadge"
        class="badge is-playing"
        :class="playingBadge.side"
        :style="playingBadge.style"
        >{{ playingBadge.time }}</span
      >
    </div>
  </div>
</template>

<style scoped>
.waveform {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  overflow: hidden;
  background: var(--wave-surface);
  border-bottom: 1px solid var(--panel-border);
}

.waveform.is-drop-target {
  outline: 2px dashed var(--accent);
  outline-offset: -4px;
}

.waveform.is-drop-target::after {
  position: absolute;
  inset: 0;
  z-index: 6;
  content: '';
  pointer-events: none;
  background: var(--accent-soft);
  opacity: 0.55;
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
  color: var(--status-danger);
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

.shade {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 1;
  pointer-events: none;
  background: var(--wave-shade);
}

.shade.is-tail {
  right: 0;
}

.region {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 2;
  cursor: grab;
  border-right: 1px solid var(--wave-marker);
  border-left: 1px solid var(--wave-marker);
}

.region:active {
  cursor: grabbing;
}

.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 3;
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
  z-index: 4;
  width: 10px;
  cursor: ew-resize;
  transform: translateX(-5px);
}

.badge {
  position: absolute;
  top: 6px;
  z-index: 5;
  padding: 2px 6px;
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: #fff;
  white-space: nowrap;
  pointer-events: none;
  background: var(--wave-marker);
  border-radius: var(--radius-sm);
}

.badge.to-left {
  transform: translateX(calc(-100% - var(--badge-gap)));
}

.badge.to-right {
  transform: translateX(var(--badge-gap));
}

.badge.is-playing {
  background: var(--wave-cursor);
}

.handle::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 3px;
  content: '';
  background: var(--wave-marker);
  transform: translateX(-50%);
}
</style>
