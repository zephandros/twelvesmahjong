// Menú principal (portada). Título Mahjong Twelves, botón de partida libre y
// panel de volúmenes. Al montar arranca la música exclusiva del menú y, a los
// 1.5 s de que suene, el clip de portada (la VA de Alice dice "Mahjong Twelves").

import { loadSettings, saveSettings, type VolumeChannel } from './settings'
import { initAudio, playMusic, playTitle, setVolume } from './audio/audio'
import { MENU_TRACK } from './audio/catalog'

const VOLUMES: ReadonlyArray<[VolumeChannel, string]> = [
  ['master', 'General'],
  ['music', 'Música'],
  ['sfx', 'Efectos'],
  ['voices', 'Voces'],
]

export function renderMenu(root: HTMLElement, opts: { onStart: () => void }): void {
  root.innerHTML = ''
  const settings = loadSettings()
  initAudio(settings)
  // música del menú + clip de portada a los 1.5 s de que empiece a sonar
  playMusic(MENU_TRACK, { stinger: playTitle, stingerAfterMs: 1500 })

  const menu = document.createElement('div')
  menu.className = 'tm-menu'
  menu.innerHTML = `
    <div class="tm-menu__hero">
      <div class="tm-menu__jp">麻雀トウェルブス</div>
      <h1 class="tm-menu__title">Mahjong Twelves</h1>
      <div class="tm-menu__tag">フリー対局 · FREE GAME · TONPUUSEN</div>
    </div>
    <button class="tm-btn tm-btn--primary tm-menu__play" data-act="start">PARTIDA LIBRE</button>
    <div class="tm-menu__settings">
      <div class="tm-menu__settings-title">Audio</div>
      <div class="tm-menu__sliders"></div>
    </div>
    <div class="tm-menu__credits">Twelves · Kovalet — uso personal. Fuentes: Murecho, Cormorant &amp; EB Garamond (OFL).</div>
  `
  root.appendChild(menu)

  const slidersEl = menu.querySelector<HTMLElement>('.tm-menu__sliders')!
  for (const [ch, label] of VOLUMES) {
    const row = document.createElement('label')
    row.className = 'tm-menu__slider'
    row.innerHTML =
      `<span class="tm-menu__slider-label">${label}</span>` +
      `<input type="range" min="0" max="100" value="${Math.round(settings.volumes[ch] * 100)}">` +
      `<span class="tm-menu__slider-val">${Math.round(settings.volumes[ch] * 100)}</span>`
    const input = row.querySelector<HTMLInputElement>('input')!
    const val = row.querySelector<HTMLElement>('.tm-menu__slider-val')!
    input.addEventListener('input', () => {
      const v = Number(input.value) / 100
      setVolume(ch, v) // aplica al grafo en vivo
      settings.volumes[ch] = v
      saveSettings(settings)
      val.textContent = input.value
    })
    slidersEl.appendChild(row)
  }

  menu.querySelector<HTMLButtonElement>('[data-act="start"]')!
    .addEventListener('click', opts.onStart)
}
