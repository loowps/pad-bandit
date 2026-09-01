<script setup lang="ts">
import { onMounted, useTemplateRef, watch } from 'vue'
import { useDevicePixelRatio, useElementSize } from '@vueuse/core'
import { playedSpan } from '@/domain/region'

const props = withDefaults(
  defineProps<{
    minMax: number[]
    progress: number | null
    playedFrom?: number
  }>(),
  { playedFrom: 0 },
)

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const { width, height } = useElementSize(canvas)
const { pixelRatio } = useDevicePixelRatio()

defineExpose({ width, pixelRatio })

function readColor(styles: CSSStyleDeclaration, token: string): string {
  return styles.getPropertyValue(token).trim()
}

function draw(): void {
  const element = canvas.value
  const context = element?.getContext('2d')
  if (!element || !context || width.value === 0 || height.value === 0) {
    return
  }

  const deviceWidth = Math.floor(width.value * pixelRatio.value)
  const deviceHeight = Math.floor(height.value * pixelRatio.value)
  element.width = deviceWidth
  element.height = deviceHeight

  const styles = getComputedStyle(element)
  const waveColor = readColor(styles, '--wave-fill')
  const playedColor = readColor(styles, '--wave-fill-played')
  const cursorColor = readColor(styles, '--wave-cursor')

  context.clearRect(0, 0, deviceWidth, deviceHeight)

  const middle = deviceHeight / 2
  const scale = deviceHeight / 2
  const values = props.minMax
  const total = values.length / 2
  if (total === 0) {
    return
  }

  const columnWidth = deviceWidth / total
  const played = playedSpan(props.progress, props.playedFrom, total)

  for (let column = 0; column < total; column++) {
    const min = values[column * 2] ?? 0
    const max = values[column * 2 + 1] ?? 0
    const top = middle - max * scale
    const bottom = middle - min * scale

    context.fillStyle = column >= played.from && column < played.to ? playedColor : waveColor
    context.fillRect(
      Math.floor(column * columnWidth),
      top,
      Math.max(1, Math.ceil(columnWidth)),
      Math.max(1, bottom - top),
    )
  }

  if (props.progress !== null && played.to > 0) {
    context.fillStyle = cursorColor
    context.fillRect(Math.min(played.to * columnWidth, deviceWidth - 1), 0, 1, deviceHeight)
  }
}

watch(
  [() => props.minMax, () => props.progress, () => props.playedFrom, width, height, pixelRatio],
  draw,
)
onMounted(draw)
</script>

<template>
  <canvas ref="canvas" class="waveform-canvas" />
</template>

<style scoped>
.waveform-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
