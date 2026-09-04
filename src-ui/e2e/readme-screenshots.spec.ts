import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { chooseFromMenu, stubBackend, type StubEntry, type StubSlot } from './stubBackend'

const REPO_ROOT = path.resolve(import.meta.dirname, '../..')

const BROWSE_ROOT = '/Users/name/Samples'
const KIT = `${BROWSE_ROOT}/Drums`
const KIT_SAMPLES = `${KIT}/one shots`
const CARD_ROOT = 'F:/'
const PREPARED_PADS = ['E1', 'E2', 'E6']
const EMPTY_SLOTS = new Set([9, ...Array.from({ length: 12 }, (_unused, pad) => 12 + pad)])

const KIT_FILES = [
  'clap 01.wav',
  'clap 02.wav',
  'hat closed 01.wav',
  'hat closed 02.wav',
  'hat open 01.wav',
  'kick 01.wav',
  'kick 02.wav',
  'kick 03.wav',
  'perc 01.wav',
  'perc 02.wav',
  'rim 01.wav',
  'shaker 01.wav',
  'snare 01.wav',
  'snare 02.wav',
  'tom 01.wav',
  'tom 02.wav',
]

const CARD_FILES = [
  'bass 01.wav',
  'break 01.wav',
  'chord 01.wav',
  'clap 01.wav',
  'crash 01.wav',
  'hat 01.wav',
  'kick 01.wav',
  'pad 01.wav',
  'perc 01.wav',
  'snare 01.wav',
  'stab 01.wav',
  'vox 01.wav',
]

function file(parent: string, name: string): StubEntry {
  return { name, path: `${parent}/${name}`, isDir: false, isAudio: name.endsWith('.wav') }
}

function folder(parent: string, name: string): StubEntry {
  return { name, path: `${parent}/${name}`, isDir: true, isAudio: false }
}

const entries: Record<string, StubEntry[]> = {
  [BROWSE_ROOT]: [
    folder(BROWSE_ROOT, 'Breaks'),
    folder(BROWSE_ROOT, 'Drums'),
    folder(BROWSE_ROOT, 'Loops'),
    folder(BROWSE_ROOT, 'Vocals'),
  ],
  [KIT]: [folder(KIT, 'one shots')],
  [KIT_SAMPLES]: KIT_FILES.map((name) => file(KIT_SAMPLES, name)),
}

function slot(index: number): StubSlot {
  const filled = index < 44 && !EMPTY_SLOTS.has(index)
  const name = CARD_FILES[index % CARD_FILES.length]!
  const frames = 44100 + ((index * 7919) % 88200)

  return {
    slot: index,
    settings: {
      volume: 118,
      lofi: false,
      loop: index % 9 === 0,
      gate: true,
      reverse: false,
      tempoMode: 'off',
      originalTempo: 92,
      userTempo: 92,
    },
    sample: filled
      ? {
          fileName: name,
          path: `${CARD_ROOT}samples/${name}`,
          fingerprint: `size:${frames} head:${index} tail:${index}`,
          format: 'wave',
          channels: 2,
          frames,
          sizeBytes: frames * 4,
          startFrame: 0,
          endFrame: Math.round(frames * 0.72),
        }
      : null,
  }
}

const card = {
  root: CARD_ROOT,
  fingerprint: 'readme-card',
  slots: Array.from({ length: 120 }, (_unused, index) => slot(index)),
}

async function waveformDrawn(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas')
    const context = canvas?.getContext('2d')
    if (!canvas || !context) {
      return false
    }
    const row = context.getImageData(0, Math.floor(canvas.height / 2), canvas.width, 1).data
    return row.some((channel, index) => index % 4 === 3 && channel > 0)
  })
}

async function painted(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

test('captures the README screenshots', async ({ page }) => {
  await stubBackend(page, {
    browseFolders: [{ id: 'f1', path: BROWSE_ROOT, addedAt: 1 }],
    cardPath: CARD_ROOT,
    entries,
    card,
  })

  await page.goto('/')

  await page.addStyleTag({
    content: `
      #__vue-devtools-container__,
      #vue-inspector-container {
        display: none;
      }

      html::after {
        content: '';
        position: fixed;
        inset: 0;
        z-index: 99;
        pointer-events: none;
        border: 1px solid var(--panel-border-strong);
      }
    `,
  })

  await page.getByRole('button', { name: 'Samples', exact: true }).click()
  await page.getByRole('button', { name: 'Drums' }).click()
  await page.getByRole('button', { name: 'one shots' }).click()
  await expect(page.getByRole('button', { name: KIT_FILES[2] })).toBeVisible()
  await page.getByRole('button', { name: KIT_FILES[2] }).click()

  for (const [index, pad] of PREPARED_PADS.entries()) {
    await page.dragAndDrop(`button[title="${KIT_FILES[index]}"]`, `button[aria-label="Pad ${pad}"]`)
  }
  await expect(page.getByText(`${PREPARED_PADS.length} to copy`)).toBeVisible()

  await page.getByRole('button', { name: 'Pad D6', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Selected pad' })).toContainText('Pad D6')
  await waveformDrawn(page)
  await painted(page)

  await page.screenshot({ path: path.join(REPO_ROOT, 'screenshot.png') })

  await chooseFromMenu(page, { kind: 'setTheme', theme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await painted(page)

  await page.screenshot({ path: path.join(REPO_ROOT, 'screenshot-dark.png') })
})
