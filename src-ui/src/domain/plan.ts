import {
  type AudioRef,
  type Pad,
  type PadId,
  type PadSnapshot,
  sameAudioRef,
  sameSettings,
} from '@/domain/pad'

export type PadIntent = { kind: 'keep' } | { kind: 'sample'; audio: AudioRef } | { kind: 'clear' }

export type PadChangeStatus = 'settings' | 'moved' | 'replaced' | 'added' | 'removed'

export interface PadChange {
  padId: PadId
  slot: number
  status: PadChangeStatus
  audio: AudioRef | null
  fromSlot: number | null
  previousFileName: string | null
}

export function keepIntent(): PadIntent {
  return { kind: 'keep' }
}

export function sampleIntent(audio: AudioRef): PadIntent {
  return { kind: 'sample', audio }
}

export function clearIntent(): PadIntent {
  return { kind: 'clear' }
}

export function padChange(pad: Pad, intent: PadIntent, snapshot: PadSnapshot): PadChange | null {
  const settingsChanged = !sameSettings(pad.settings, snapshot.settings)
  const change = (status: PadChangeStatus, audio: AudioRef | null, fromSlot: number | null) => ({
    padId: pad.id,
    slot: pad.slot,
    status,
    audio,
    fromSlot,
    previousFileName: snapshot.sample?.fileName ?? null,
  })
  const settingsOnly = () => (settingsChanged ? change('settings', snapshot.audio, null) : null)

  switch (intent.kind) {
    case 'keep':
      return settingsOnly()
    case 'clear':
      return snapshot.audio ? change('removed', null, null) : settingsOnly()
    case 'sample': {
      const { audio } = intent
      if (sameAudioRef(audio, snapshot.audio)) {
        return settingsOnly()
      }
      if (audio.kind === 'card') {
        return change('moved', audio, audio.originSlot)
      }
      return change(snapshot.audio ? 'replaced' : 'added', audio, null)
    }
  }
}

export function cardPlan(
  pads: Pad[],
  intents: Record<PadId, PadIntent>,
  snapshots: Record<PadId, PadSnapshot>,
): PadChange[] {
  const changes: PadChange[] = []
  for (const pad of pads) {
    const snapshot = snapshots[pad.id]
    if (!snapshot) {
      continue
    }
    const change = padChange(pad, intents[pad.id] ?? keepIntent(), snapshot)
    if (change) {
      changes.push(change)
    }
  }
  return changes
}
