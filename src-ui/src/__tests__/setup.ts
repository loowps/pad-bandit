import { afterEach } from 'vitest'
import { getActivePinia } from 'pinia'
import { useNoticesStore } from '@/stores/notices'

afterEach(() => {
  if (getActivePinia()) {
    useNoticesStore().clear()
  }
})

const context2d = {
  clearRect: () => undefined,
  fillRect: () => undefined,
  fillStyle: '',
} as unknown as CanvasRenderingContext2D

HTMLCanvasElement.prototype.getContext = ((contextId: string) =>
  contextId === '2d' ? context2d : null) as HTMLCanvasElement['getContext']
