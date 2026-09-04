const context2d = {
  clearRect: () => undefined,
  fillRect: () => undefined,
  fillStyle: '',
} as unknown as CanvasRenderingContext2D

HTMLCanvasElement.prototype.getContext = ((contextId: string) =>
  contextId === '2d' ? context2d : null) as HTMLCanvasElement['getContext']
