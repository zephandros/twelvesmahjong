// Menú principal (portada). Título Mahjong Twelves, botones apilados (jugar /
// ajustes / glosario) y un modal de ajustes idéntico al menú del tablero (idioma,
// mesa, dorso, esperas, volúmenes), pero SIN la opción de salir. Vive en el
// escenario 1920×1080 escalado.
//
// Gate "Toca para continuar": en arranque en frío la portada monta bloqueada
// (solo título + prompt en el sitio de los botones); al primer toque/Enter/Espacio
// aparecen los botones y arranca la música del menú + el clip de Alice (a 1.0 s).
// Al VOLVER desde una partida NO hay gate: suena la música del menú de inmediato
// (crossfade desde el tema de la mesa) y los botones ya están visibles.
//
// Cambio de idioma: refresco in situ (applyTexts) + rebuild del contenido del modal.
// NUNCA se re-invoca renderMenu.

import {
  loadSettings, saveSettings,
  type Language, type VolumeChannel, type TableTheme, type TileBack,
} from './settings'
import { initAudio, playMusic, playTitle, setVolume, playUiClick } from './audio/audio'
import { MENU_TRACK } from './audio/catalog'
import { createScaledStage } from './layout'
import { openGlossary } from './glossary'
import { ICONS } from './icons.generated'
import { t, setLocale, detectLocale } from './i18n'
import type { MsgKey } from './i18n-strings.generated'

const TABLE_THEMES: ReadonlyArray<[TableTheme, MsgKey]> = [
  ['green', 'settings.theme.green'], ['red', 'settings.theme.red'],
  ['blue', 'settings.theme.blue'], ['wood', 'settings.theme.wood'],
]
const TILE_BACKS: ReadonlyArray<[TileBack, MsgKey]> = [
  ['amber', 'settings.back.amber'], ['green', 'settings.back.green'],
  ['red', 'settings.back.red'], ['blue', 'settings.back.blue'],
  ['charcoal', 'settings.back.charcoal'],
]
const VOLUMES: ReadonlyArray<[VolumeChannel, MsgKey]> = [
  ['master', 'settings.volume.master'], ['music', 'settings.volume.music'],
  ['sfx', 'settings.volume.sfx'], ['voices', 'settings.volume.voices'],
]
const LANGUAGES: ReadonlyArray<[Language, MsgKey]> = [
  ['auto', 'settings.lang.auto'], ['es', 'settings.lang.es'],
  ['en', 'settings.lang.en'], ['ja', 'settings.lang.ja'],
]
const TOGGLE: ReadonlyArray<[string, MsgKey]> = [
  ['on', 'settings.toggle.on'], ['off', 'settings.toggle.off'],
]

// ¿El jugador ya pasó el gate "Toca para continuar" en esta sesión? Es de módulo
// (persiste entre renders): la primera visita a la portada muestra el gate; al
// volver desde una partida no (suena la música del menú de inmediato).
let started = false

export function renderMenu(root: HTMLElement, opts: { onStart: () => void }): void {
  root.innerHTML = ''
  const settings = loadSettings()
  initAudio(settings)

  const stage = createScaledStage(root)
  // tema/dorso persistidos aplicados al stage: deja los cyclers en el índice correcto
  // y conserva el ajuste (sin vista previa visible en la portada, no hay mesa/fichas).
  stage.dataset.table = settings.tableTheme
  stage.dataset.back = settings.tileBack

  const menu = document.createElement('div')
  menu.className = 'tm-menu'
  menu.innerHTML = `
    <div class="tm-menu__hero">
      <div class="tm-menu__jp"></div>
      <h1 class="tm-menu__title">
        <span class="tm-menu__title-main"></span>
        <span class="tm-menu__title-sub"></span>
      </h1>
      <div class="tm-menu__tag"></div>
    </div>
    <div class="tm-menu__actions">
      <button class="tm-btn tm-btn--primary tm-menu__play" data-act="start"></button>
      <button class="tm-btn tm-btn--muted tm-menu__settings-btn" data-act="settings"></button>
      <button class="tm-btn tm-btn--muted tm-menu__glossary-btn" data-act="glossary"></button>
      <div class="tm-menu__gate-prompt"></div>
    </div>
    <div class="tm-menu__credits"></div>
  `
  stage.appendChild(menu)

  // --- modal de ajustes (estilo tablero) ---
  const overlay = document.createElement('div')
  overlay.className = 'tm-overlay tm-menu-ov is-hidden'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  stage.appendChild(overlay)

  const section = (key: MsgKey): HTMLElement => {
    const sec = document.createElement('div')
    sec.className = 'tm-menu-ov__sec'
    sec.textContent = t(key)
    return sec
  }

  const cycler = (
    caption: string,
    options: ReadonlyArray<[string, MsgKey]>,
    cur: string,
    pick: (v: string) => void,
  ): HTMLElement => {
    const row = document.createElement('div')
    row.className = 'tm-menu-ov__row'
    const cap = document.createElement('span')
    cap.className = 'tm-menu-ov__label'
    cap.textContent = caption
    const btn = document.createElement('button')
    btn.className = 'tm-btn tm-btn--muted'
    let idx = Math.max(0, options.findIndex(([v]) => v === cur))
    btn.textContent = t(options[idx]![1])
    btn.addEventListener('click', () => {
      idx = (idx + 1) % options.length
      btn.textContent = t(options[idx]![1])
      playUiClick()
      pick(options[idx]![0])
    })
    row.append(cap, btn)
    return row
  }

  // (Re)construye el contenido de la tarjeta del modal. Se rehace al cambiar idioma
  // (los captions se hornean al construir), manteniendo el overlay visible.
  function buildModalCard(): void {
    overlay.innerHTML = ''
    const card = document.createElement('div')
    card.className = 'tm-overlay__card'

    const title = document.createElement('div')
    title.className = 'tm-menu-ov__title'
    title.textContent = t('hud.menu-title')
    card.appendChild(title)

    const closeBtn = document.createElement('button')
    closeBtn.className = 'tm-menu-ov__close'
    closeBtn.innerHTML = ICONS.x
    closeBtn.title = t('hud.close')
    closeBtn.setAttribute('aria-label', t('hud.close'))
    closeBtn.addEventListener('click', () => {
      playUiClick()
      overlay.classList.add('is-hidden')
    })
    card.appendChild(closeBtn)

    card.appendChild(section('hud.section-settings'))
    card.appendChild(cycler(t('hud.language'), LANGUAGES, settings.language, (v) => {
      const lang = v as Language
      settings.language = lang
      saveSettings(settings)
      setLocale(lang === 'auto' ? detectLocale() : lang)
      applyTexts()     // refresca el menú principal + el prompt del gate
      buildModalCard() // reconstruye el modal con los textos nuevos (queda visible)
    }))
    card.appendChild(cycler(t('hud.table'), TABLE_THEMES, settings.tableTheme, (v) => {
      settings.tableTheme = v as TableTheme
      stage.dataset.table = v
      saveSettings(settings)
    }))
    card.appendChild(cycler(t('hud.tile-back'), TILE_BACKS, settings.tileBack, (v) => {
      settings.tileBack = v as TileBack
      stage.dataset.back = v
      saveSettings(settings)
    }))
    card.appendChild(cycler(t('hud.show-waits'), TOGGLE, settings.showWaits ? 'on' : 'off', (v) => {
      settings.showWaits = v === 'on'
      saveSettings(settings)
    }))

    card.appendChild(section('hud.section-audio'))
    for (const [ch, key] of VOLUMES) {
      const row = document.createElement('label')
      row.className = 'tm-menu-ov__row'
      row.innerHTML =
        `<span class="tm-menu-ov__label">${t(key)}</span>` +
        `<input type="range" min="0" max="100" value="${Math.round(settings.volumes[ch] * 100)}">`
      const input = row.querySelector<HTMLInputElement>('input')!
      input.addEventListener('input', () => {
        const v = Number(input.value) / 100
        setVolume(ch, v) // aplica al grafo en vivo
        settings.volumes[ch] = v
        saveSettings(settings)
      })
      card.appendChild(row)
    }

    overlay.appendChild(card)
  }
  buildModalCard()

  // Textos del menú principal + prompt del gate en el locale activo (in situ).
  function applyTexts(): void {
    menu.querySelector<HTMLElement>('.tm-menu__jp')!.textContent = t('menu.title-jp')
    menu.querySelector<HTMLElement>('.tm-menu__title-main')!.textContent = t('menu.title-main')
    menu.querySelector<HTMLElement>('.tm-menu__title-sub')!.textContent = t('menu.title-sub')
    menu.querySelector<HTMLElement>('.tm-menu__tag')!.textContent = t('menu.tagline')
    menu.querySelector<HTMLElement>('[data-act="start"]')!.textContent = t('menu.play')
    menu.querySelector<HTMLElement>('[data-act="settings"]')!.textContent = t('menu.settings')
    menu.querySelector<HTMLElement>('[data-act="glossary"]')!.textContent = t('menu.glossary')
    menu.querySelector<HTMLElement>('.tm-menu__gate-prompt')!.textContent = t('menu.tap-start')
    menu.querySelector<HTMLElement>('.tm-menu__credits')!.textContent = t('menu.credits')
  }
  applyTexts()

  menu.querySelector<HTMLButtonElement>('[data-act="settings"]')!
    .addEventListener('click', () => {
      playUiClick()
      overlay.classList.remove('is-hidden')
    })

  menu.querySelector<HTMLButtonElement>('[data-act="glossary"]')!
    .addEventListener('click', () => {
      playUiClick()
      openGlossary(stage)
    })

  menu.querySelector<HTMLButtonElement>('[data-act="start"]')!
    .addEventListener('click', () => {
      playUiClick()
      opts.onStart()
    })

  // --- gate vs retorno ---------------------------------------------------------
  // Primera visita de la sesión: monta bloqueada (solo título + prompt); el primer
  // toque/Enter/Espacio revela los botones y arranca música + narración de Alice.
  // Retorno desde una partida: sin gate, música del menú de inmediato (crossfade
  // desde el tema de la mesa).
  if (started) {
    playMusic(MENU_TRACK)
  } else {
    menu.classList.add('is-locked')
    let entered = false
    const enter = (): void => {
      if (entered) return
      entered = true
      started = true
      menu.classList.remove('is-locked')
      menu.removeEventListener('click', onMenuClick)
      window.removeEventListener('keydown', onKey)
      playMusic(MENU_TRACK, { stinger: playTitle, stingerAfterMs: 1000 })
    }
    const onMenuClick = (): void => enter()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' || e.key === ' ') enter()
    }
    menu.addEventListener('click', onMenuClick)
    window.addEventListener('keydown', onKey)
  }
}
