// Menú principal (portada). Título Mahjong Twelves, partida libre y ajustes
// (idioma + audio) en un modal. Al montar arranca la música exclusiva del menú
// y, a los 1.5 s de que suene, el clip de portada (la VA de Alice dice
// "Mahjong Twelves"). Vive en el escenario 1920×1080 escalado.
//
// Cambio de idioma: refresco in situ (applyTexts) — NUNCA se re-invoca
// renderMenu, porque re-dispararía playMusic + stinger.

import { loadSettings, saveSettings, type Language, type VolumeChannel } from './settings'
import { initAudio, playMusic, playTitle, setVolume, playUiClick } from './audio/audio'
import { MENU_TRACK } from './audio/catalog'
import { createScaledStage } from './layout'
import { t, setLocale, detectLocale } from './i18n'
import type { MsgKey } from './i18n-strings.generated'

const VOLUMES: ReadonlyArray<[VolumeChannel, MsgKey]> = [
  ['master', 'settings.volume.master'],
  ['music', 'settings.volume.music'],
  ['sfx', 'settings.volume.sfx'],
  ['voices', 'settings.volume.voices'],
]

const LANGUAGES: ReadonlyArray<[Language, MsgKey]> = [
  ['auto', 'settings.lang.auto'],
  ['es', 'settings.lang.es'],
  ['en', 'settings.lang.en'],
  ['ja', 'settings.lang.ja'],
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
      <div class="tm-menu__jp"></div>
      <h1 class="tm-menu__title"></h1>
      <div class="tm-menu__tag"></div>
    </div>
    <div class="tm-menu__actions">
      <button class="tm-btn tm-btn--primary tm-menu__play" data-act="start"></button>
      <button class="tm-btn tm-btn--muted tm-menu__settings-btn" data-act="settings"></button>
    </div>
    <div class="tm-menu__credits"></div>
  `
  stage.appendChild(menu)

  const overlay = document.createElement('div')
  overlay.className = 'tm-overlay tm-audio-ov is-hidden'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-labelledby', 'tm-audio-title')
  overlay.innerHTML = `
    <div class="tm-overlay__card">
      <div class="tm-overlay__title" id="tm-audio-title"></div>
      <div class="tm-audio-ov__lang"></div>
      <div class="tm-audio-ov__sliders"></div>
      <button class="tm-btn tm-btn--primary" data-act="close-settings"></button>
    </div>
  `
  stage.appendChild(overlay)

  // --- fila de idioma (cycler) ---
  const langRow = overlay.querySelector<HTMLElement>('.tm-audio-ov__lang')!
  langRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%'
  const langCap = document.createElement('span')
  langCap.style.cssText = 'font-family:var(--serif);font-size:16px;color:var(--cream)'
  const langBtn = document.createElement('button')
  langBtn.className = 'tm-btn tm-btn--muted'
  let langIdx = Math.max(0, LANGUAGES.findIndex(([v]) => v === settings.language))
  langBtn.addEventListener('click', () => {
    playUiClick()
    langIdx = (langIdx + 1) % LANGUAGES.length
    const lang = LANGUAGES[langIdx]![0]
    settings.language = lang
    saveSettings(settings)
    setLocale(lang === 'auto' ? detectLocale() : lang)
    applyTexts()
  })
  langRow.append(langCap, langBtn)

  // --- sliders de volumen ---
  const slidersEl = overlay.querySelector<HTMLElement>('.tm-audio-ov__sliders')!
  const sliderLabels: Array<[HTMLElement, MsgKey]> = []
  for (const [ch, key] of VOLUMES) {
    const row = document.createElement('label')
    row.className = 'tm-audio-ov__slider'
    row.innerHTML =
      `<span class="tm-audio-ov__slider-label"></span>` +
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
    sliderLabels.push([row.querySelector<HTMLElement>('.tm-audio-ov__slider-label')!, key])
    slidersEl.appendChild(row)
  }

  // Textos en el locale activo; se re-aplica al cambiar idioma (in situ).
  function applyTexts(): void {
    menu.querySelector<HTMLElement>('.tm-menu__jp')!.textContent = t('menu.title-jp')
    menu.querySelector<HTMLElement>('.tm-menu__title')!.textContent = t('menu.title')
    menu.querySelector<HTMLElement>('.tm-menu__tag')!.textContent = t('menu.tagline')
    menu.querySelector<HTMLElement>('[data-act="start"]')!.textContent = t('menu.play')
    menu.querySelector<HTMLElement>('[data-act="settings"]')!.textContent = t('menu.settings')
    menu.querySelector<HTMLElement>('.tm-menu__credits')!.textContent = t('menu.credits')
    overlay.querySelector<HTMLElement>('#tm-audio-title')!.textContent = t('menu.audio-title')
    overlay.querySelector<HTMLElement>('[data-act="close-settings"]')!.textContent = t('menu.close')
    langCap.textContent = t('hud.language')
    langBtn.textContent = t(LANGUAGES[langIdx]![1])
    for (const [el, key] of sliderLabels) el.textContent = t(key)
  }
  applyTexts()

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
