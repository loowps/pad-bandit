import { invoke } from '@tauri-apps/api/core'

interface MusicLink {
  label: string
  url: string
}

export const MUSIC_LINKS: readonly MusicLink[] = [
  { label: 'Bandcamp', url: 'https://loowps.bandcamp.com' },
  { label: 'SoundCloud', url: 'https://soundcloud.com/loowps' },
  { label: 'Apple Music', url: 'https://music.apple.com/us/artist/loowps/1326334750' },
  { label: 'Spotify', url: 'https://open.spotify.com/artist/2jOQrKX3rRoZORPfFcXaYU' },
]

export function appVersion(): Promise<string> {
  return invoke<string>('plugin:app|version')
}

export function openLink(url: string): Promise<void> {
  return invoke<void>('plugin:opener|open_url', { url })
}
