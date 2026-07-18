// HUD (layout Figma 1920×1080): 4 paneles de personaje en las esquinas, contador
// en el recuadro central, botones de acción y overlays de fin. El menú de mesa
// ya NO es una barra: es un botón en el panel del jugador que abre un overlay
// con tema de mesa, dorso de ficha y volúmenes.

import type { HandState } from '../core/state'
import type { TileId } from '../core/tile'
import type { Seat } from '../core/seat'
import { SEATS, relSeat, cornerOf, seatWind, windColor, windName, type Corner } from '../core/seat'
import { BOARD, STAGE_H, STAGE_W, place } from './layout'
import { createTileView, type TileView } from './tile-view'
import { charName, thumbUrl, type Character } from './characters'
import {
  saveSettings, setVolumeSetting,
  type Language, type Settings, type TableTheme, type TileBack, type VolumeChannel,
} from './settings'
import { setVolume, playUiClick } from './audio/audio'
import { createMusicBar, type MusicBar } from './music-bar'
import { t, yakuLabel, setLocale, detectLocale } from './i18n'
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
}

const KYOKU_KANJI = ['一', '二', '三', '四']
const PLACE_KEYS = ['hud.place.1', 'hud.place.2', 'hud.place.3', 'hud.place.4'] as const

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

export class Hud {
  private readonly human: Seat
  private readonly chars: readonly Character[]
  private readonly onButton: (kind: string) => void
  // mini-fichas estáticas dentro de botones (mismo patrón que win-screen)
  private readonly tileView: TileView = createTileView(32)

  private readonly portraits = new Map<Seat, {
    panel: HTMLElement
    placeEl: HTMLElement
    score: HTMLElement
    windBadge: HTMLElement
    riichiTag: HTMLElement
    nameEl: HTMLElement
    oyaEl: HTMLElement
  }>()

  private readonly kyokuJp: HTMLElement
  private readonly kyokuEn: HTMLElement
  private readonly wallCount: HTMLElement
  private readonly wallLabel: HTMLElement
  private readonly honbaEl: HTMLElement
  private readonly sticksEl: HTMLElement
  private readonly buttonsRow: HTMLElement
  private readonly chiRow: HTMLElement
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

      const panel = document.createElement('div')
      panel.className = `tm-panel${isSelf ? ' tm-panel--self' : ''}`
      panel.innerHTML =
        `<img class="tm-panel__img" src="${thumbUrl(c)}" alt="">` +
        `<div class="tm-panel__wind"></div>` +
        `<div class="tm-panel__oya"></div>` +
        `<span class="tm-panel__place"></span>` +
        `<div class="tm-panel__riichi"></div>` +
        `<div class="tm-panel__info">` +
        `<div class="tm-panel__row"><span class="tm-panel__name"></span></div>` +
        `<div class="tm-panel__score"></div>` +
        `</div>`
      place(panel, { ...PANEL_POS[corner], width: PANEL_W, height: PANEL_H, z: 40 })
      stage.appendChild(panel)

      this.portraits.set(seat, {
        panel,
        placeEl: panel.querySelector('.tm-panel__place')!,
        score: panel.querySelector('.tm-panel__score')!,
        windBadge: panel.querySelector('.tm-panel__wind')!,
        riichiTag: panel.querySelector('.tm-panel__riichi')!,
        nameEl: panel.querySelector('.tm-panel__name')!,
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
    counter.append(kyokuRow, this.wallCount, wallLabel, meta)
    place(counter, { left: 960, top: 540, transform: 'translate(-50%,-50%)', z: 30 })
    stage.appendChild(counter)

    // --- botones de acción + rótulo de turno ---
    this.buttonsRow = el('div', 'display:flex;gap:10px')
    this.buttonsRow.className = 'tm-action-row'
    place(this.buttonsRow, { right: 264, bottom: 116, z: 45 })
    stage.appendChild(this.buttonsRow)

    // fila de opciones de chi, encima de los botones de acción
    this.chiRow = el('div', 'display:flex;gap:10px')
    this.chiRow.className = 'tm-action-row'
    place(this.chiRow, { right: 264, bottom: 172, z: 45 })
    stage.appendChild(this.chiRow)

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
    this.wallLabel.textContent = t('hud.tiles-left')
    for (const p of this.portraits.values()) p.oyaEl.textContent = t('hud.dealer')
    this.musicBar.applyTexts()
    for (const seat of SEATS) {
      const p = this.portraits.get(seat)!
      const name = charName(this.chars[seat]!)
      p.nameEl.textContent = seat === this.human ? `${name} · ${t('hud.you')}` : name
      p.riichiTag.textContent = t('hud.riichi')
      p.panel.querySelector('.tm-panel__img')!.setAttribute('alt', name)
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
      const exit = document.createElement('button')
      exit.className = 'tm-btn tm-btn--danger'
      exit.textContent = t('hud.exit')
      exit.addEventListener('click', () => { playUiClick(); askConfirm() })
      footer.appendChild(exit)
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
    }

    this.kyokuJp.textContent = t('hud.round', { n: KYOKU_KANJI[info.kyoku] ?? '一' })
    this.kyokuEn.textContent = t('hud.east-n', { n: info.kyoku + 1 })
    this.wallCount.textContent = String(s.wall.live.length)
    this.honbaEl.innerHTML =
      `<span style="width:9px;height:9px;border-radius:50%;background:#d94f4f"></span>${s.honba}`
    this.sticksEl.innerHTML =
      `<span style="width:16px;height:6px;border-radius:2px;background:linear-gradient(#f4ecd6,#cfc6ad);border:1px solid #b9a15a"></span>${s.sticks}`

    this.renderButtons(this.buttonsRow, info.buttons)
    this.renderButtons(this.chiRow, info.chiOptions)
    this.turnEl.textContent = info.turnLabel ?? ''
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
      subtitle = t('end.exhaustive-draw')
      body =
        '<div class="tm-yaku-list">' +
        SEATS.map((x) => `<span class="tm-yaku-pill ${end.tenpai[x] ? '' : 'is-muted'}">${names(x)}: ${end.tenpai[x] ? t('end.tenpai') : t('end.noten')}</span>`).join('') +
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

    this.overlay.innerHTML =
      `<div class="tm-overlay__card">` +
      `<div class="tm-overlay__kyoku">${t('hud.round', { n: KYOKU_KANJI[kyoku] ?? '一' })} · ${s.honba} ${t('hud.honba')}</div>` +
      `<div class="tm-overlay__title">${title}</div>` +
      `<div class="tm-overlay__sub">${subtitle}</div>` +
      body +
      `<div class="tm-deltas">${deltas}</div>` +
      `<button class="tm-btn tm-btn--primary tm-overlay__continue">${t('hud.continue')}</button>` +
      `</div>`
    this.overlay.classList.remove('is-hidden')
    this.overlay.querySelector('.tm-overlay__continue')!.addEventListener('click', onContinue, { once: true })
  }

  showGameEnd(s: HandState, onRematch: () => void, onCharacters: () => void): void {
    const names = (seat: Seat) => charName(this.chars[seat]!)
    const order = [...SEATS].sort((a, b) => s.seats[b]!.points - s.seats[a]!.points || a - b)
    const rows = order
      .map((seat, i) =>
        `<div class="tm-delta ${seat === this.human ? 'is-plus' : ''}">` +
        `<span>${t(PLACE_KEYS[i]!)} · ${names(seat)}</span><b>${s.seats[seat]!.points.toLocaleString('en-US')}</b></div>`)
      .join('')
    this.overlay.innerHTML =
      `<div class="tm-overlay__card">` +
      `<div class="tm-overlay__title">${t('hud.game-over')}</div>` +
      `<div class="tm-overlay__sub">${t('hud.tonpuusen-complete')}</div>` +
      `<div class="tm-deltas">${rows}</div>` +
      `<div style="display:flex;gap:10px;margin-top:8px">` +
      `<button class="tm-btn tm-btn--muted" data-act="chars">${t('hud.characters')}</button>` +
      `<button class="tm-btn tm-btn--primary" data-act="rematch">${t('hud.rematch')}</button>` +
      `</div></div>`
    this.overlay.classList.remove('is-hidden')
    this.overlay.querySelector('[data-act="rematch"]')!.addEventListener('click', onRematch, { once: true })
    this.overlay.querySelector('[data-act="chars"]')!.addEventListener(
      'click',
      () => { this.musicBar.dispose(); onCharacters() }, // el stage muere: baja del oyente
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
