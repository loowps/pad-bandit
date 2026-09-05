import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface Peaks {
  minMax: number[]
  columns: number
  frames: number
  channels: number
  sampleRate: number
  exact: boolean
}

export interface ExactPeaks {
  path: string
  peaks: Peaks
}

export function requestPeaks(path: string, columns: number): Promise<Peaks> {
  return invoke<Peaks>('audio_peaks', { path, columns })
}

export interface UndecodableFile {
  path: string
  reason: string
}

export function findUndecodable(paths: string[]): Promise<UndecodableFile[]> {
  return invoke<UndecodableFile[]>('audio_undecodable', { paths })
}

export function onExactPeaks(handler: (payload: ExactPeaks) => void): Promise<UnlistenFn> {
  return listen<ExactPeaks>('peaks:exact', (event) => handler(event.payload))
}

export interface PlayRequest {
  path: string
  startFrame: number
  endFrame: number
  looping: boolean
  reverse: boolean
  gain: number
}

export function playAudio(request: PlayRequest): Promise<void> {
  return invoke('audio_play', { request })
}

export function stopAudio(): Promise<void> {
  return invoke('audio_stop')
}

export function setAudioGain(gain: number): Promise<void> {
  return invoke('audio_set_gain', { gain })
}

export function seekAudio(frame: number): Promise<void> {
  return invoke('audio_seek', { frame })
}

export function onPlaybackPosition(handler: (frame: number) => void): Promise<UnlistenFn> {
  return listen<number>('audio:position', (event) => handler(event.payload))
}

export function onPlaybackEnded(handler: () => void): Promise<UnlistenFn> {
  return listen('audio:ended', () => handler())
}

export function onPlaybackError(handler: (message: string) => void): Promise<UnlistenFn> {
  return listen<string>('audio:error', (event) => handler(event.payload))
}
