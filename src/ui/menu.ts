// Menú principal (portada). Título Mahjong Twelves, partida libre y ajustes de
// audio en un modal. Al montar arranca la música exclusiva del menú y, a los
// 1.5 s de que suene, el clip de portada (la VA de Alice dice "Mahjong Twelves").
// Vive en el escenario 1920×1080 escalado (mismo letterbox que el tablero).

import { loadSettings, saveSettings, type VolumeChannel } from './settings'
import { initAudio, playMusic, playTitle, setVolume, playUiClick } from './audio/audio'
import { MENU_TRACK } from './audio/catalog'
import { createScaledStage } from './layout'

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

  const stage = createScaledStage(root)

  const menu = document.createElement('div')
  menu.className = 'tm-menu'
  menu.innerHTML = `
    <div class="tm-menu__hero">
      <div class="tm-menu__jp">トゥウェルブズ・マージャン</div>
      <h1 class="tm-menu__title">TWELVES Mahjong</h1>
      <div class="tm-menu__tag">RIICHI MAHJONG · TONPUUSEN</div>
    </div>
    <div class="tm-menu__actions">
      <button class="tm-btn tm-btn--primary tm-menu__play" data-act="start">JUGAR</button>
      <button class="tm-btn tm-btn--muted tm-menu__settings-btn" data-act="settings">AJUSTES</button>
    </div>
    <div class="tm-menu__credits">Arenacun Software</div>
  `
  stage.appendChild(menu)

  const overlay = document.createElement('div')
  overlay.className = 'tm-overlay tm-audio-ov is-hidden'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-labelledby', 'tm-audio-title')
  overlay.innerHTML = `
    <div class="tm-overlay__card">
      <div class="tm-overlay__title" id="tm-audio-title">Audio</div>
      <div class="tm-audio-ov__sliders"></div>
      <button class="tm-btn tm-btn--primary" data-act="close-settings">CERRAR</button>
    </div>
  `
  stage.appendChild(overlay)

  const slidersEl = overlay.querySelector<HTMLElement>('.tm-audio-ov__sliders')!
  for (const [ch, label] of VOLUMES) {
    const row = document.createElement('label')
    row.className = 'tm-audio-ov__slider'
    row.innerHTML =
      `<span class="tm-audio-ov__slider-label">${label}</span>` +
      `<input type="range" min="0" max="100" value="${Math.round(settings.volumes[ch] * 100)}">` +
      `<span class="tm-audio-ov__slider-val">${Math.round(settings.volumes[ch] * 100)}</span>`
    const input = row.querySelector<HTMLInputElement>('input')!
    const val = row.querySelector<HTMLElement>('.tm-audio-ov__slider-val')!
    input.addEventListener('input', () => {
      const v = Number(input.value) / 100
      setVolume(ch, v) // aplica al grafo en vivo
      settings.volumes[ch] = v
      saveSettings(settings)
      val.textContent = input.value
    })
    slidersEl.appendChild(row)
  }

  menu.querySelector<HTMLButtonElement>('[data-act="settings"]')!
    .addEventListener('click', () => {
      playUiClick()
      overlay.classList.remove('is-hidden')
    })
  overlay.querySelector<HTMLButtonElement>('[data-act="close-settings"]')!
    .addEventListener('click', () => {
      playUiClick()
      overlay.classList.add('is-hidden')
    })

  menu.querySelector<HTMLButtonElement>('[data-act="start"]')!
    .addEventListener('click', () => {
      playUiClick()
      opts.onStart()
    })
}
