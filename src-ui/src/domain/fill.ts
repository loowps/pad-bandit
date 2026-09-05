import { PAD_COUNT, type Pad, type PadId, padIdForSlot } from '@/domain/pad'

export type DropMode = 'fill' | 'overwrite'

export function planDrop(
  pads: Readonly<Record<PadId, Pad>>,
  startSlot: number,
  count: number,
  mode: DropMode,
): PadId[] {
  const targets: PadId[] = []
  for (let slot = Math.max(0, startSlot); slot < PAD_COUNT && targets.length < count; slot++) {
    const id = padIdForSlot(slot)
    if (mode === 'overwrite' || pads[id]?.audio === null) {
      targets.push(id)
    }
  }
  return targets
}

export function padsInTheWay(
  pads: Readonly<Record<PadId, Pad>>,
  startSlot: number,
  count: number,
): PadId[] {
  return planDrop(pads, startSlot, count, 'overwrite').filter((id) => pads[id]?.audio !== null)
}
