// HUD (layout Figma 1920×1080): 4 paneles de personaje en las esquinas, contador
// en el recuadro central, botones de acción y overlays de fin. El menú de mesa
// ya NO es una barra: es un botón en el panel del jugador que abre un overlay
// con tema de mesa, dorso de ficha y volúmenes.

import type { HandState } from '../core/state'
import type { Tile34, TileId } from '../core/tile'
import type { Seat } from '../core/seat'
import { SEATS, relSeat, cornerOf, seatWind, windColor, windName, type Corner } from '../core/seat'
import { uraIndicators } from '../core/wall'
import { finalResults } from '../core/results'
import { BOARD, STAGE_H, STAGE_W, place } from './layout'
import { createTileView, type TileView } from './tile-view'
import { charName, thumbUrl, hasAltForm, altForm, type AltForm, type Character } from './characters'
import {
  saveSettings, setVolumeSetting,
  type Language, type Settings, type TableTheme, type TileBack, type VolumeChannel,
} from './settings'
import { setVolume, playUiClick } from './audio/audio'
import { createMusicBar, type MusicBar } from './music-bar'
import { openGlossary } from './glossary'
import { t, yakuLabel, roundLabels, setLocale, detectLocale } from './i18n'
import type { MsgKey } from './i18n-strings.generated'
import { ICONS } from './icons.generated'

export interface ButtonDef {
  label: string
  kind: string
  style?: 'primary' | 'normal' | 'muted'
  /** Mini-fichas dentro del botón (opciones de chi); sustituyen al label. */
  tiles?: TileId[]
}

export interface HudInfo {
  kyoku: number
  buttons: ButtonDef[]
  /** Opciones del picker de chi, en fila propia sobre los botones de acción. */
  chiOptions: ButtonDef[]
  turnLabel: string | null
  /** Esperas del humano tenpai (`live` = copias no visibles); null = ocultar. */
  waits: ReadonlyArray<{ tile: Tile34; live: number }> | null
  furiten: boolean
}

const PLACE_KEYS = ['hud.place.1', 'hud.place.2', 'hud.place.3', 'hud.place.4'] as const

// Cuenta atrás de la propia decisión (red): diámetro, y borde superior de la
// caja del rótulo de turno (`turnEl`: bottom 148 + 22px de caja de línea), que
// es contra lo que se alinea. Medido en el DOM, no estimado.
const TIMER_D = 92
const TURN_LABEL_TOP = 910

const PANEL_MARGIN = 24
const PANEL_W = 240 - PANEL_MARGIN * 2
const PANEL_H = 540 - PANEL_MARGIN * 2

// Grosor del marco de madera de la mesa (padding de .tm-board); BOARD de
// layout.ts es el rect del fieltro, el marco queda FUERA de él.
const FRAME = 24

// Esquina de pantalla → posición del panel, separado del marco y del viewport.
const PANEL_POS: Record<Corner, Record<string, number>> = {
  tl: { left: PANEL_MARGIN, top: PANEL_MARGIN },
  tr: { right: PANEL_MARGIN, top: PANEL_MARGIN },
  bl: { left: PANEL_MARGIN, bottom: PANEL_MARGIN },
  br: { right: PANEL_MARGIN, bottom: PANEL_MARGIN },
}

// Las constantes guardan CLAVES de i18n, no textos resueltos: el cambio de
// idioma en caliente reconstruye el overlay y traduce en ese momento.
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

export class Hud {
  private readonly human: Seat
  private readonly chars: readonly Character[]
  private readonly onButton: (kind: string) => void
  // mini-fichas estáticas dentro de botones (mismo patrón que win-screen)
  private readonly tileView: TileView = createTileView(32)

  private readonly portraits = new Map<Seat, {
    panel: HTMLElement
    imgEl: HTMLImageElement
    placeEl: HTMLElement
    score: HTMLElement
    windBadge: HTMLElement
    riichiTag: HTMLElement
    nameEl: HTMLElement
    playerEl: HTMLElement
    timerEl: HTMLElement
    timerNum: HTMLElement
    oyaEl: HTMLElement
  }>()

  /** Nombre de la persona por asiento (null = IA). Vacío en partida local. */
  private players: readonly (string | null)[] = []
  /** Cuenta atrás en curso: a quién se espera, hasta cuándo, y su ticker. */
  private deadline: { seats: Seat[]; at: number } | null = null
  private deadlineTimer: ReturnType<typeof setInterval> | null = null

  private readonly kyokuJp: HTMLElement
  private readonly kyokuEn: HTMLElement
  private readonly doraLabel: HTMLElement
  private readonly wallCount: HTMLElement
  private readonly wallLabel: HTMLElement
  private readonly honbaEl: HTMLElement
  private readonly sticksEl: HTMLElement
  private readonly buttonsRow: HTMLElement
  private readonly chiRow: HTMLElement
  /** Cuenta atrás de la propia decisión (red): ver comentario en el constructor. */
  private readonly actionTimerEl: HTMLElement
  private readonly actionTimerNum: HTMLElement
  /** Aviso de espera al resto tras cerrar los resultados (red). */
  private readonly waitOthersEl: HTMLElement
  private waitOthers = 0
  private notice: string | null = null
  private readonly waitsEl: HTMLElement
  private readonly turnEl: HTMLElement
  private readonly overlay: HTMLElement
  private readonly menuBtn: HTMLElement
  private readonly musicBar: MusicBar
  private menuOverlay: HTMLElement
  private readonly stage: HTMLElement
  private readonly settings: Settings
  private readonly onExit: () => void
  private readonly onLanguageChange: (() => void) | undefined

  constructor(
    stage: HTMLElement,
    human: Seat,
    chars: readonly Character[],
    settings: Settings,
    onButton: (kind: string) => void,
    onExit: () => void,
    onLanguageChange?: () => void,
  ) {
    this.human = human
    this.chars = chars
    this.onButton = onButton
    this.stage = stage
    this.settings = settings
    this.onExit = onExit
    this.onLanguageChange = onLanguageChange

    stage.dataset.table = settings.tableTheme
    stage.dataset.back = settings.tileBack

    // --- paneles de personaje en las 4 esquinas ---
    for (const seat of SEATS) {
      const rel = relSeat(seat, human)
      const corner = cornerOf(rel)
      const isSelf = rel === 'self'
      const c = chars[seat]!

      // La esquina va en el class: el reloj de decisión se coloca del lado que
      // mira a la mesa (izquierda en los paneles de la derecha y al revés), y
      // eso solo lo sabe el CSS si se lo decimos.
      const panel = document.createElement('div')
      panel.className = `tm-panel tm-panel--${corner}${isSelf ? ' tm-panel--self' : ''}`
      panel.innerHTML =
        `<img class="tm-panel__img" src="${thumbUrl(c)}" alt="">` +
        `<div class="tm-panel__wind"></div>` +
        `<div class="tm-panel__oya"></div>` +
        `<span class="tm-panel__place"></span>` +
        // El reloj va ANTES que el distintivo de riichi para que el selector
        // hermano (`~`) de styles.css pueda apartarlo cuando ambos coinciden.
        `<div class="tm-panel__timer is-hidden"><span></span></div>` +
        `<div class="tm-panel__riichi"></div>` +
        `<div class="tm-panel__info">` +
        `<div class="tm-panel__row"><span class="tm-panel__player"></span></div>` +
        `<div class="tm-panel__row"><span class="tm-panel__name"></span></div>` +
        `<div class="tm-panel__score"></div>` +
        `</div>`
      place(panel, { ...PANEL_POS[corner], width: PANEL_W, height: PANEL_H, z: 40 })
      stage.appendChild(panel)

      this.portraits.set(seat, {
        panel,
        imgEl: panel.querySelector<HTMLImageElement>('.tm-panel__img')!,
        placeEl: panel.querySelector('.tm-panel__place')!,
        score: panel.querySelector('.tm-panel__score')!,
        windBadge: panel.querySelector('.tm-panel__wind')!,
        riichiTag: panel.querySelector('.tm-panel__riichi')!,
        nameEl: panel.querySelector('.tm-panel__name')!,
        playerEl: panel.querySelector('.tm-panel__player')!,
        timerEl: panel.querySelector('.tm-panel__timer')!,
        timerNum: panel.querySelector('.tm-panel__timer span')!,
        oyaEl: panel.querySelector('.tm-panel__oya')!,
      })
    }

    // botón de menú: pastilla sobre la banda superior del marco de madera
    // (BOARD es el fieltro; el marco son los 24px de padding de .tm-board),
    // alineado a su esquina derecha (inset 34px por el radio de la esquina)
    this.menuBtn = document.createElement('button')
    this.menuBtn.className = 'tm-hud-menu'
    this.menuBtn.addEventListener('click', () => {
      playUiClick()
      this.menuOverlay.classList.remove('is-hidden')
    })
    place(this.menuBtn, {
      right: STAGE_W - (BOARD.x + BOARD.w + FRAME) + 34,
      top: BOARD.y - FRAME,
      height: FRAME,
      z: 45,
    })
    stage.appendChild(this.menuBtn)

    // --- contador central (recuadro cian 180×180) ---
    const counter = document.createElement('div')
    counter.className = 'tm-counter'
    // bajo la fila de indicadores de dora (viven en el padding-top del recuadro)
    this.doraLabel = el('div', 'font-size:9px;letter-spacing:.24em;color:var(--muted2);text-transform:uppercase;margin-bottom:2px')
    this.kyokuJp = el('span', 'font-family:var(--jp);font-weight:700;font-size:18px;color:var(--gold)')
    this.kyokuEn = el('span', 'font-family:var(--ui);font-size:15px;letter-spacing:.1em;color:var(--muted)')
    const kyokuRow = el('div', 'display:flex;align-items:baseline;gap:6px')
    kyokuRow.append(this.kyokuJp, this.kyokuEn)
    this.wallCount = el('div', 'font-family:var(--title);font-weight:300;font-size:54px;line-height:.85;color:var(--cream);text-shadow:0 3px 8px rgba(0,0,0,.5)')
    const wallLabel = el('div', 'font-size:9px;letter-spacing:.24em;color:var(--muted2);text-transform:uppercase')
    this.wallLabel = wallLabel
    const meta = el('div', 'display:flex;gap:12px;margin-top:4px;font-family:var(--ui);font-size:17px;color:#e0d7bd')
    this.honbaEl = el('span', 'display:flex;align-items:center;gap:4px')
    this.sticksEl = el('span', 'display:flex;align-items:center;gap:4px')
    meta.append(this.honbaEl, this.sticksEl)
    counter.append(this.doraLabel, kyokuRow, this.wallCount, wallLabel, meta)
    place(counter, { left: 960, top: 540, transform: 'translate(-50%,-50%)', z: 30 })
    stage.appendChild(counter)

    // --- botones de acción + rótulo de turno ---
    // Pila anclada abajo-derecha del fieltro: opciones de chi encima, acciones
    // debajo. El `gap` reproduce exactamente el hueco de 18px que había entre
    // las dos filas cuando estaban posicionadas a mano (bottom 116 y 172).
    const buttonStack = el('div', 'display:flex;flex-direction:column;align-items:flex-end;gap:18px')
    place(buttonStack, { right: 264, bottom: 116, z: 45 })
    stage.appendChild(buttonStack)

    // fila de opciones de chi, encima de los botones de acción
    this.chiRow = el('div', 'display:flex;gap:10px')
    this.chiRow.className = 'tm-action-row'
    buttonStack.appendChild(this.chiRow)

    this.buttonsRow = el('div', 'display:flex;gap:10px')
    this.buttonsRow.className = 'tm-action-row'
    buttonStack.appendChild(this.buttonsRow)

    // Cuenta atrás de la PROPIA decisión (red). NO va en su panel (esquina
    // inferior izquierda, fuera de donde está mirando mientras decide) NI atada
    // a los botones —cambiaba de sitio según cuántos hubiera—: punto fijo en el
    // eje central de la mesa, justo encima del rótulo de turno, y al doble de
    // tamaño que el de un rival. Sirve igual para descartar que para cantar.
    // `left` centrado a mano (no `centerX`): la animación de `is-urgent` escribe
    // `transform`, y un translate en el posicionamiento se lo comería el keyframe.
    this.actionTimerEl = el('div', '')
    this.actionTimerEl.className = 'tm-action-timer is-hidden'
    this.actionTimerEl.innerHTML = '<span></span>'
    place(this.actionTimerEl, {
      left: 960 - TIMER_D / 2,
      bottom: STAGE_H - TURN_LABEL_TOP + 16, // 16px de aire sobre el rótulo
      width: TIMER_D,
      z: 46,
    })
    stage.appendChild(this.actionTimerEl)
    this.actionTimerNum = this.actionTimerEl.querySelector('span')!

    // Aviso de "ya he continuado, faltan otros". Va por encima de todo (la
    // pantalla de victoria incluida) porque aparece justo cuando esa pantalla
    // se cierra y el jugador se queda mirando una mesa que aún no se mueve.
    this.waitOthersEl = el('div', '')
    this.waitOthersEl.className = 'tm-wait-others is-hidden'
    place(this.waitOthersEl, { left: 960, bottom: 300, centerX: true, z: 120 })
    stage.appendChild(this.waitOthersEl)

    // tira de esperas del humano (espejo izquierdo de los botones de acción)
    this.waitsEl = document.createElement('div')
    this.waitsEl.className = 'tm-waits is-hidden'
    place(this.waitsEl, { left: BOARD.x + 40, bottom: 116, z: 35 })
    stage.appendChild(this.waitsEl)

    this.turnEl = el('div', 'font-family:var(--ui);font-size:20px;letter-spacing:.34em;color:var(--gold);text-transform:uppercase')
    place(this.turnEl, {
      left: 960,
      bottom: STAGE_H - (BOARD.y + BOARD.h) + 118,
      transform: 'translateX(-50%)',
      z: 35,
    })
    stage.appendChild(this.turnEl)

    // --- reproductor de música (banda inferior, alineado al panel br) ---
    this.musicBar = createMusicBar(stage, settings)

    // --- overlay de menú (idioma / tema / dorso / volúmenes) ---
    this.menuOverlay = this.buildMenuOverlay()

    // --- overlay de fin ---
    this.overlay = document.createElement('div')
    this.overlay.className = 'tm-overlay is-hidden'
    stage.appendChild(this.overlay)

    this.applyStaticTexts()
  }

  // Textos del HUD que no pasan por update(); se re-aplican al cambiar idioma.
  private applyStaticTexts(): void {
    this.menuBtn.innerHTML = `${ICONS.menu}<span>${t('hud.menu')}</span>`
    this.doraLabel.textContent = t('hud.dora-label')
    this.wallLabel.textContent = t('hud.tiles-left')
    for (const p of this.portraits.values()) p.oyaEl.textContent = t('hud.dealer')
    this.musicBar.applyTexts()
    for (const seat of SEATS) {
      const p = this.portraits.get(seat)!
      this.setPanelName(seat)
      p.riichiTag.textContent = t('hud.riichi')
    }
  }

  // Nombre + alt del retrato de un panel; con `alt` pinta la forma alterna
  // (Mr. Hyde). Idempotente: se llama tanto al cambiar idioma como en cada
  // update() para seguir al riichi.
  private setPanelName(seat: Seat, alt?: AltForm): void {
    const p = this.portraits.get(seat)!
    const name = charName(this.chars[seat]!, alt)
    p.nameEl.textContent = name
    p.panel.querySelector('.tm-panel__img')!.setAttribute('alt', name)

    // Persona y personaje son cosas distintas, y en red hace falta ver las dos:
    // saber que enfrente está Marta llevando a Drácula, y cuáles son bots.
    // En partida local no hay personas: la línea se oculta y el "· TÚ" vuelve
    // junto al nombre del personaje, como ha sido siempre.
    const label = this.playerLabel(seat)
    p.playerEl.textContent = label ?? ''
    p.playerEl.classList.toggle('is-hidden', label === null)
    if (this.players.length === 0 && seat === this.human) {
      p.nameEl.textContent = `${name} · ${t('hud.you')}`
    }
  }

  /** Etiqueta de persona del asiento, o null si no hay que enseñar ninguna. */
  private playerLabel(seat: Seat): string | null {
    if (this.players.length === 0) return null // partida local
    const you = seat === this.human ? t('hud.you') : null
    const name = this.players[seat] ?? null
    if (name === null) return you ?? t('mp.seat-bot') // asiento de la IA
    return you === null ? name : `${name} · ${you}`
  }

  /** Nombres de los jugadores (solo partidas en red). */
  setPlayers(players: readonly (string | null)[]): void {
    this.players = players
    for (const seat of SEATS) this.setPanelName(seat)
  }

  // --- cuenta atrás de decisión (solo en red) ------------------------------------

  /**
   * Arranca la cuenta atrás sobre los paneles de `seats`. En red el plazo es
   * real: si vence, el árbitro juega por ese asiento con la IA, así que el
   * jugador tiene que verlo venir.
   */
  setDeadline(seats: Seat[], at: number): void {
    this.deadline = { seats, at }
    if (this.deadlineTimer === null) {
      // 250 ms basta para que el número no dé saltos y no cuesta nada.
      this.deadlineTimer = setInterval(() => this.paintDeadline(), 250)
    }
    this.paintDeadline()
  }

  /**
   * "Ya continué, faltan otros". `n` = cuántos faltan; 0 lo oculta.
   * Sin esto, quien cierra primero la pantalla de resultados se queda mirando
   * una mesa quieta sin saber por qué.
   */
  setWaitingOthers(n: number): void {
    this.waitOthers = n
    if (n > 0) {
      this.waitOthersEl.textContent = t('mp.waiting-others', { n })
      this.waitOthersEl.classList.remove('is-hidden')
    } else if (this.notice === null) {
      this.waitOthersEl.classList.add('is-hidden')
    }
  }

  /**
   * Aviso de red que no bloquea (hoy: "el anfitrión se ha desconectado").
   * Comparte sitio con el de espera de fin de mano: nunca coinciden, porque
   * sin anfitrión no hay quien reparta.
   */
  setNotice(text: string | null): void {
    this.notice = text
    if (text === null) {
      if (this.waitOthers === 0) this.waitOthersEl.classList.add('is-hidden')
      return
    }
    this.waitOthersEl.textContent = text
    this.waitOthersEl.classList.remove('is-hidden')
  }

  /** Se resolvió la jugada: fuera relojes. */
  clearDeadline(): void {
    this.deadline = null
    if (this.deadlineTimer !== null) {
      clearInterval(this.deadlineTimer)
      this.deadlineTimer = null
    }
    for (const seat of SEATS) this.hideTimer(seat)
  }

  /**
   * Reloj de un asiento: el propio va sobre la zona de acción
   * (`actionTimerEl`); el de un rival, en su panel de esquina. Único punto
   * donde se decide el destino, para no repetir la condición en cada sitio.
   */
  private timerFor(seat: Seat): { el: HTMLElement; num: HTMLElement } {
    if (seat === this.human) return { el: this.actionTimerEl, num: this.actionTimerNum }
    const p = this.portraits.get(seat)!
    return { el: p.timerEl, num: p.timerNum }
  }

  /** Oculta el reloj Y le quita lo urgente: si no, al reaparecer daría un
   *  fogonazo rojo heredado del plazo anterior. */
  private hideTimer(seat: Seat): void {
    const { el } = this.timerFor(seat)
    el.classList.add('is-hidden')
    el.classList.remove('is-urgent')
  }

  private paintDeadline(): void {
    const d = this.deadline
    if (!d) return
    const left = Math.max(0, Math.ceil((d.at - Date.now()) / 1000))
    for (const seat of SEATS) {
      if (!d.seats.includes(seat)) {
        this.hideTimer(seat)
        continue
      }
      const { el, num } = this.timerFor(seat)
      el.classList.remove('is-hidden')
      num.textContent = String(left)
      // últimos 5 segundos: el reloj se pone rojo y late
      el.classList.toggle('is-urgent', left <= 5)
    }
  }

  // Overlay de ajustes de mesa, abierto desde el botón MENÚ del marco.
  // Se reconstruye entero al cambiar de idioma (los textos se traducen aquí).
  // Estructura: título + X de cierre, secciones AJUSTES (cyclers) y AUDIO
  // (sliders) en grid de dos columnas, y pie con ABANDONAR PARTIDA (dos pasos).
  private buildMenuOverlay(): HTMLElement {
    const { stage, settings } = this
    const ov = document.createElement('div')
    ov.className = 'tm-overlay tm-menu-ov is-hidden'
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
      ov.classList.add('is-hidden')
      resetFooter() // al reabrir, el pie vuelve al estado inicial
    })
    card.appendChild(closeBtn)

    const section = (key: MsgKey): void => {
      const sec = document.createElement('div')
      sec.className = 'tm-menu-ov__sec'
      sec.textContent = t(key)
      card.appendChild(sec)
    }

    const cycler = (caption: string, opts: ReadonlyArray<[string, MsgKey]>, cur: string, pick: (v: string) => void): HTMLElement => {
      const row = document.createElement('div')
      row.className = 'tm-menu-ov__row'
      const cap = document.createElement('span')
      cap.className = 'tm-menu-ov__label'
      cap.textContent = caption
      const btn = document.createElement('button')
      btn.className = 'tm-btn tm-btn--muted'
      let idx = Math.max(0, opts.findIndex(([v]) => v === cur))
      btn.textContent = t(opts[idx]![1])
      btn.addEventListener('click', () => {
        idx = (idx + 1) % opts.length
        btn.textContent = t(opts[idx]![1])
        playUiClick()
        pick(opts[idx]![0])
      })
      row.append(cap, btn)
      return row
    }

    section('hud.section-settings')
    card.appendChild(cycler(t('hud.language'), LANGUAGES, settings.language, (v) => {
      const lang = v as Language
      settings.language = lang
      saveSettings(settings)
      setLocale(lang === 'auto' ? detectLocale() : lang)
      this.applyStaticTexts()
      // reconstruir el overlay con los textos nuevos, manteniéndolo visible
      const fresh = this.buildMenuOverlay()
      fresh.classList.remove('is-hidden')
      this.menuOverlay.remove()
      this.menuOverlay = fresh
      this.onLanguageChange?.() // re-pinta botones/rótulos dinámicos del HUD
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
      this.onLanguageChange?.() // mismo callback de re-render: refresca la tira
    }))

    section('hud.section-audio')
    for (const [ch, key] of VOLUMES) {
      const row = document.createElement('label')
      row.className = 'tm-menu-ov__row'
      row.innerHTML =
        `<span class="tm-menu-ov__label">${t(key)}</span>` +
        `<input type="range" min="0" max="100" value="${Math.round(settings.volumes[ch] * 100)}">`
      const input = row.querySelector<HTMLInputElement>('input')!
      input.addEventListener('input', () => {
        const v = Number(input.value) / 100
        setVolume(ch, v)
        setVolumeSetting(settings, ch, v)
        saveSettings(settings)
      })
      card.appendChild(row)
    }

    // pie: ABANDONAR PARTIDA con confirmación en dos pasos (Sí/No)
    const footer = document.createElement('div')
    footer.className = 'tm-menu-ov__footer'
    const resetFooter = (): void => {
      footer.innerHTML = ''
      const glossary = document.createElement('button')
      glossary.className = 'tm-btn tm-btn--muted'
      glossary.textContent = t('hud.glossary')
      // se apila sobre el menú (mismo z, añadido después); al cerrarse reaparece
      glossary.addEventListener('click', () => { playUiClick(); openGlossary(stage) })
      const exit = document.createElement('button')
      exit.className = 'tm-btn tm-btn--danger'
      exit.textContent = t('hud.exit')
      exit.addEventListener('click', () => { playUiClick(); askConfirm() })
      footer.append(glossary, exit)
    }
    const askConfirm = (): void => {
      footer.innerHTML = ''
      const q = document.createElement('span')
      q.className = 'tm-menu-ov__confirm'
      q.textContent = t('hud.exit-confirm')
      const yes = document.createElement('button')
      yes.className = 'tm-btn tm-btn--danger'
      yes.textContent = t('hud.yes')
      yes.addEventListener('click', () => { playUiClick(); this.musicBar.dispose(); this.onExit() })
      const no = document.createElement('button')
      no.className = 'tm-btn tm-btn--muted'
      no.textContent = t('hud.no')
      no.addEventListener('click', () => { playUiClick(); resetFooter() })
      footer.append(q, yes, no)
    }
    resetFooter()
    card.appendChild(footer)

    ov.appendChild(card)
    stage.appendChild(ov)
    return ov
  }

  update(s: HandState, info: HudInfo): void {
    const order = [...SEATS].sort((a, b) => s.seats[b]!.points - s.seats[a]!.points || a - b)
    for (const seat of SEATS) {
      const p = this.portraits.get(seat)!
      const st = s.seats[seat]!
      // ordinal "1ro/1st/1位": dígito grande + sufijo en superíndice
      const placeText = t(PLACE_KEYS[order.indexOf(seat)]!)
      const m = /^(\d+)(.*)$/.exec(placeText)
      p.placeEl.innerHTML = m ? `${m[1]}<sup>${m[2]}</sup>` : placeText
      p.score.textContent = st.points.toLocaleString('en-US')
      const wind = seatWind(seat, s.dealer)
      p.windBadge.textContent = t(`wind.${windName(wind)}`)
      p.windBadge.style.background = windColor(wind)
      p.panel.classList.toggle('is-dealer', seat === s.dealer)
      p.panel.classList.toggle('is-turn', s.phase !== 'ended' && s.turn === seat)
      p.riichiTag.classList.toggle('is-on', st.riichi > 0)
      // Jekyll se transforma en Hyde (arte + nombre) mientras su riichi está vivo
      const c = this.chars[seat]!
      if (hasAltForm(c)) {
        const alt = altForm(c, st.riichi)
        const src = alt?.thumb ?? thumbUrl(c)
        if (p.imgEl.getAttribute('src') !== src) p.imgEl.setAttribute('src', src)
        this.setPanelName(seat, alt)
      }
    }

    const round = roundLabels(info.kyoku)
    this.kyokuJp.textContent = round.kanji
    this.kyokuEn.textContent = round.latin
    this.wallCount.textContent = String(s.wall.live.length)
    this.honbaEl.innerHTML =
      `<span style="width:9px;height:9px;border-radius:50%;background:#d94f4f"></span>${s.honba}`
    this.sticksEl.innerHTML =
      `<span style="width:16px;height:6px;border-radius:2px;background:linear-gradient(#f4ecd6,#cfc6ad);border:1px solid #b9a15a"></span>${s.sticks}`

    this.renderButtons(this.buttonsRow, info.buttons)
    this.renderButtons(this.chiRow, info.chiOptions)
    this.turnEl.textContent = info.turnLabel ?? ''
    this.renderWaits(info.waits, info.furiten)
  }

  // La tira se reconstruye en cada update (traduce con el locale vigente); el
  // cambio de idioma en caliente pasa por onLanguageChange → render → update.
  private renderWaits(
    waits: HudInfo['waits'],
    furiten: boolean,
  ): void {
    if (!waits || waits.length === 0) {
      this.waitsEl.classList.add('is-hidden')
      return
    }
    this.waitsEl.classList.remove('is-hidden')
    this.waitsEl.replaceChildren()
    const label = document.createElement('span')
    label.className = 'tm-waits__label'
    label.textContent = t('hud.waits')
    this.waitsEl.appendChild(label)
    for (const w of waits) {
      const cell = document.createElement('span')
      cell.className = 'tm-waits__tile'
      // copia 1, nunca la 0: en 5m/5p/5s la copia 0 es el aka (ids 16/52/88)
      cell.appendChild(this.tileView.create('front', ((w.tile << 2) | 1) as TileId))
      const n = document.createElement('span')
      n.className = 'tm-waits__count'
      n.textContent = `×${w.live}`
      cell.appendChild(n)
      this.waitsEl.appendChild(cell)
    }
    if (furiten) {
      const pill = document.createElement('span')
      pill.className = 'tm-waits__furiten'
      pill.textContent = t('hud.furiten')
      this.waitsEl.appendChild(pill)
    }
  }

  private renderButtons(row: HTMLElement, defs: ButtonDef[]): void {
    row.replaceChildren(
      ...defs.map((b) => {
        const btn = document.createElement('button')
        btn.className = `tm-btn tm-btn--${b.style ?? 'normal'}`
        if (b.tiles) {
          btn.classList.add('tm-btn--tiles')
          for (const id of b.tiles) btn.appendChild(this.tileView.create('front', id))
        } else {
          btn.textContent = b.label
        }
        btn.addEventListener('click', () => this.onButton(b.kind))
        return btn
      }),
    )
  }

  // --- overlays de fin ------------------------------------------------------

  showHandEnd(s: HandState, kyoku: number, onContinue: () => void): void {
    const end = s.end!
    const names = (seat: Seat) => charName(this.chars[seat]!)
    let title = ''
    let subtitle = ''
    let body = ''

    if (end.type === 'tsumo' || end.type === 'ron') {
      title = end.type === 'tsumo' ? t('win.tsumo') : end.chankan ? t('win.chankan') : t('win.ron')
      subtitle = end.type === 'tsumo' ? names(end.winner) : `${names(end.winner)} ← ${names(end.from)}`
      const sc = end.score
      const yakuRows = sc.yaku.map((y) => `<span class="tm-yaku-pill">${yakuLabel(y)}</span>`).join('')
      const limit = sc.limit ? ` · ${t(`limit.${sc.limit}`)}` : ''
      const hanfu = sc.yakuman > 0 ? t('hud.yakuman') : `${t('hud.han-fu', { han: sc.han, fu: sc.fu })}${limit}`
      body =
        `<div class="tm-yaku-list">${yakuRows}</div>` +
        `<div class="tm-score-line"><span>${hanfu}</span><b>+${sc.total.toLocaleString('en-US')}</b></div>`
    } else if (end.type === 'exhaustive') {
      title = t('end.ryuukyoku')
      subtitle = end.nagashi.length > 0 ? t('end.nagashi') : t('end.exhaustive-draw')
      // con nagashi la fila útil es quién lo consiguió, no el tenpai de cada uno
      body =
        '<div class="tm-yaku-list">' +
        SEATS.map((x) =>
          end.nagashi.includes(x)
            ? `<span class="tm-yaku-pill">${names(x)}: ${t('end.nagashi-short')}</span>`
            : `<span class="tm-yaku-pill ${end.tenpai[x] ? '' : 'is-muted'}">${names(x)}: ${end.tenpai[x] ? t('end.tenpai') : t('end.noten')}</span>`,
        ).join('') +
        '</div>'
    } else {
      title = t('end.tochuu')
      subtitle = `${t('end.aborted')} · ${t(`abort.${end.reason}`)}`
    }

    const deltas = SEATS.map((x) => {
      const d = end.deltas[x]!
      const cls = d > 0 ? 'is-plus' : d < 0 ? 'is-minus' : ''
      return `<div class="tm-delta ${cls}"><span>${names(x)}</span><b>${d > 0 ? '+' : ''}${d.toLocaleString('en-US')}</b><i>${s.seats[x]!.points.toLocaleString('en-US')}</i></div>`
    }).join('')

    // el humano en riichi que no ganó ve los ura que le habrían tocado; solo en
    // agotamiento (en abortos la mano no llegó a resolverse)
    const showUra = end.type === 'exhaustive' && s.seats[this.human]!.riichi > 0

    this.overlay.innerHTML =
      `<div class="tm-overlay__card">` +
      `<div class="tm-overlay__kyoku">${roundLabels(kyoku).kanji} · ${s.honba} ${t('hud.honba')}</div>` +
      `<div class="tm-overlay__title">${title}</div>` +
      `<div class="tm-overlay__sub">${subtitle}</div>` +
      body +
      (showUra ? `<div class="tm-ura-row"><span>${t('hud.ura-reveal')}</span></div>` : '') +
      `<div class="tm-deltas">${deltas}</div>` +
      `<button class="tm-btn tm-btn--primary tm-overlay__continue">${t('hud.continue')}</button>` +
      `</div>`
    if (showUra) {
      const row = this.overlay.querySelector('.tm-ura-row')!
      for (const id of uraIndicators(s.wall)) row.appendChild(this.tileView.create('front', id))
    }
    this.overlay.classList.remove('is-hidden')
    this.overlay.querySelector('.tm-overlay__continue')!.addEventListener('click', onContinue, { once: true })
  }

  /** `onRematch` null = sin revancha (partida en red: la negociaría la sala). */
  showGameEnd(s: HandState, onRematch: (() => void) | null, onCharacters: () => void): void {
    const names = (seat: Seat) => charName(this.chars[seat]!)
    // puntos de mesa a la izquierda, resultado con uma/oka a la derecha
    const rows = finalResults(s.seats.map((st) => st.points), s.rules)
      .map((r) =>
        `<div class="tm-delta ${r.total > 0 ? 'is-plus' : r.total < 0 ? 'is-minus' : ''}${r.seat === this.human ? ' is-you' : ''}">` +
        `<span>${t(PLACE_KEYS[r.place - 1]!)} · ${names(r.seat)}</span>` +
        `<i>${r.points.toLocaleString('en-US')}</i>` +
        `<b>${r.total > 0 ? '+' : ''}${r.total.toFixed(1)}</b></div>`)
      .join('')
    this.overlay.innerHTML =
      `<div class="tm-overlay__card">` +
      `<div class="tm-overlay__title">${t('hud.game-over')}</div>` +
      `<div class="tm-overlay__sub">${t(s.rules.length === 'hanchan' ? 'hud.hanchan-complete' : 'hud.tonpuusen-complete')}</div>` +
      `<div class="tm-deltas">${rows}</div>` +
      `<div style="display:flex;gap:10px;margin-top:8px">` +
      `<button class="tm-btn tm-btn--muted" data-act="chars">${t('hud.to-menu')}</button>` +
      (onRematch
        ? `<button class="tm-btn tm-btn--primary" data-act="rematch">${t('hud.rematch')}</button>`
        : '') +
      `</div></div>`
    this.overlay.classList.remove('is-hidden')
    if (onRematch) {
      this.overlay.querySelector('[data-act="rematch"]')!
        .addEventListener('click', onRematch, { once: true })
    }
    this.overlay.querySelector('[data-act="chars"]')!.addEventListener(
      'click',
      () => { this.musicBar.dispose(); onCharacters() }, // el stage muere: baja del oyente
      { once: true },
    )
  }

  /**
   * La partida en red se ha caído y no se puede seguir. No hay nada que
   * decidir: solo enterarse y volver a la portada. `message` llega ya
   * traducido desde ui/net.ts, que es quien sabe por qué se cortó.
   */
  showNetError(message: string, onCharacters: () => void): void {
    this.overlay.innerHTML =
      `<div class="tm-overlay__card">` +
      `<div class="tm-overlay__title">${t('net.error.title')}</div>` +
      `<div class="tm-overlay__sub">${message}</div>` +
      `<div style="display:flex;gap:10px;margin-top:8px">` +
      `<button class="tm-btn tm-btn--primary" data-act="chars">${t('hud.to-menu')}</button>` +
      `</div></div>`
    this.overlay.classList.remove('is-hidden')
    this.overlay.querySelector('[data-act="chars"]')!.addEventListener(
      'click',
      () => { this.musicBar.dispose(); onCharacters() },
      { once: true },
    )
  }

  hideOverlay(): void {
    this.overlay.classList.add('is-hidden')
  }
}

function el(tag: string, css: string): HTMLElement {
  const e = document.createElement(tag)
  e.style.cssText = css
  return e
}
