<script setup lang="ts">
import { onMounted, useTemplateRef, watch } from 'vue'
import { useDevicePixelRatio, useElementSize } from '@vueuse/core'

const props = defineProps<{
  minMax: number[]
  progress: number | null
}>()

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
  const waveColor = readColor(styles, '--wave-color')
  const playedColor = readColor(styles, '--wave-played')
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
  const playedColumns =
    props.progress === null ? 0 : Math.round(Math.min(1, Math.max(0, props.progress)) * total)

  for (let column = 0; column < total; column++) {
    const min = values[column * 2] ?? 0
    const max = values[column * 2 + 1] ?? 0
    const top = middle - max * scale
    const bottom = middle - min * scale

    context.fillStyle = column < playedColumns ? playedColor : waveColor
    context.fillRect(
      Math.floor(column * columnWidth),
      top,
      Math.max(1, Math.ceil(columnWidth)),
      Math.max(1, bottom - top),
    )
  }

  if (props.progress !== null && playedColumns > 0) {
    context.fillStyle = cursorColor
    context.fillRect(Math.min(playedColumns * columnWidth, deviceWidth - 1), 0, 1, deviceHeight)
  }
}

watch([() => props.minMax, () => props.progress, width, height, pixelRatio], draw)
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
