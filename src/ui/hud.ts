// HUD (layout Figma 1920×1080): 4 paneles de personaje en las esquinas, contador
// en el recuadro central, botones de acción y overlays de fin. El menú de mesa
// ya NO es una barra: es un botón en el panel del jugador que abre un overlay
// con tema de mesa, dorso de ficha y volúmenes.

import type { HandState } from '../core/state'
import type { TileId } from '../core/tile'
import type { Seat } from '../core/seat'
import { SEATS, relSeat, cornerOf, seatWind, windColor, windKanji, type Corner } from '../core/seat'
import { BOARD, STAGE_H, place } from './layout'
import { createTileView, type TileView } from './tile-view'
import { thumbUrl, type Character } from './characters'
import {
  saveSettings, setVolumeSetting, type Settings, type TableTheme, type TileBack, type VolumeChannel,
} from './settings'
import { setVolume, playUiClick } from './audio/audio'

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
const PLACES = ['1st', '2nd', '3rd', '4th']

const PANEL_MARGIN = 24
const PANEL_W = 240 - PANEL_MARGIN * 2
const PANEL_H = 540 - PANEL_MARGIN * 2

// Esquina de pantalla → posición del panel, separado del marco y del viewport.
const PANEL_POS: Record<Corner, Record<string, number>> = {
  tl: { left: PANEL_MARGIN, top: PANEL_MARGIN },
  tr: { right: PANEL_MARGIN, top: PANEL_MARGIN },
  bl: { left: PANEL_MARGIN, bottom: PANEL_MARGIN },
  br: { right: PANEL_MARGIN, bottom: PANEL_MARGIN },
}

const TABLE_THEMES: ReadonlyArray<[TableTheme, string]> = [
  ['green', 'Green Velvet'], ['red', 'Red Velvet'], ['blue', 'Blue Velvet'], ['wood', 'Aged Wood'],
]
const TILE_BACKS: ReadonlyArray<[TileBack, string]> = [
  ['amber', 'Amber'], ['green', 'Green'], ['red', 'Red'], ['blue', 'Blue'], ['charcoal', 'Charcoal'],
]
const VOLUMES: ReadonlyArray<[VolumeChannel, string]> = [
  ['master', 'General'], ['music', 'Música'], ['sfx', 'Efectos'], ['voices', 'Voces'],
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
  }>()

  private readonly kyokuJp: HTMLElement
  private readonly kyokuEn: HTMLElement
  private readonly wallCount: HTMLElement
  private readonly honbaEl: HTMLElement
  private readonly sticksEl: HTMLElement
  private readonly buttonsRow: HTMLElement
  private readonly chiRow: HTMLElement
  private readonly turnEl: HTMLElement
  private readonly overlay: HTMLElement

  constructor(
    stage: HTMLElement,
    human: Seat,
    chars: readonly Character[],
    settings: Settings,
    onButton: (kind: string) => void,
    onExit: () => void,
  ) {
    this.human = human
    this.chars = chars
    this.onButton = onButton

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
        `<img class="tm-panel__img" src="${thumbUrl(c)}" alt="${c.name}">` +
        `<div class="tm-panel__wind"></div>` +
        `<div class="tm-panel__riichi">RIICHI</div>` +
        `<div class="tm-panel__info">` +
        `<div class="tm-panel__row"><span class="tm-panel__place"></span>` +
        `<span class="tm-panel__name">${isSelf ? `${c.name} · YOU` : c.name}</span></div>` +
        `<div class="tm-panel__score"></div>` +
        `</div>`
      place(panel, { ...PANEL_POS[corner], width: PANEL_W, height: PANEL_H, z: 40 })
      stage.appendChild(panel)

      if (isSelf) {
        const menuBtn = document.createElement('button')
        menuBtn.className = 'tm-panel__menu'
        menuBtn.textContent = '☰ MENÚ'
        menuBtn.addEventListener('click', () => {
          playUiClick()
          menuOverlay.classList.remove('is-hidden')
        })
        panel.appendChild(menuBtn)
      }

      this.portraits.set(seat, {
        panel,
        placeEl: panel.querySelector('.tm-panel__place')!,
        score: panel.querySelector('.tm-panel__score')!,
        windBadge: panel.querySelector('.tm-panel__wind')!,
        riichiTag: panel.querySelector('.tm-panel__riichi')!,
      })
    }

    // --- contador central (recuadro cian 180×180) ---
    const counter = document.createElement('div')
    counter.className = 'tm-counter'
    this.kyokuJp = el('span', 'font-family:var(--jp);font-weight:700;font-size:18px;color:var(--gold)')
    this.kyokuEn = el('span', 'font-family:var(--display);font-size:15px;letter-spacing:.1em;color:var(--muted)')
    const kyokuRow = el('div', 'display:flex;align-items:baseline;gap:6px')
    kyokuRow.append(this.kyokuJp, this.kyokuEn)
    this.wallCount = el('div', 'font-family:var(--display);font-weight:700;font-size:54px;line-height:.85;color:var(--cream);text-shadow:0 3px 8px rgba(0,0,0,.5)')
    const wallLabel = el('div', 'font-size:9px;letter-spacing:.24em;color:var(--muted2);text-transform:uppercase')
    wallLabel.textContent = 'tiles left'
    const meta = el('div', 'display:flex;gap:12px;margin-top:4px;font-family:var(--display);font-weight:600;font-size:17px;color:#e0d7bd')
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

    this.turnEl = el('div', 'font-family:var(--display);font-style:italic;font-size:20px;letter-spacing:.34em;color:var(--gold);text-transform:uppercase')
    place(this.turnEl, {
      left: 960,
      bottom: STAGE_H - (BOARD.y + BOARD.h) + 118,
      transform: 'translateX(-50%)',
      z: 35,
    })
    stage.appendChild(this.turnEl)

    // --- overlay de menú (tema / dorso / volúmenes) ---
    const menuOverlay = this.buildMenuOverlay(stage, settings, onExit)

    // --- overlay de fin ---
    this.overlay = document.createElement('div')
    this.overlay.className = 'tm-overlay is-hidden'
    stage.appendChild(this.overlay)
  }

  // Overlay de ajustes de mesa, abierto desde el botón MENÚ del panel del jugador.
  private buildMenuOverlay(stage: HTMLElement, settings: Settings, onExit: () => void): HTMLElement {
    const ov = document.createElement('div')
    ov.className = 'tm-overlay tm-menu-ov is-hidden'
    const card = document.createElement('div')
    card.className = 'tm-overlay__card'
    card.innerHTML = `<div class="tm-overlay__title" style="font-size:44px">Menú</div>`

    const cycler = (caption: string, opts: ReadonlyArray<[string, string]>, cur: string, pick: (v: string) => void): HTMLElement => {
      const row = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%')
      const cap = el('span', 'font-family:var(--serif);font-size:16px;color:var(--cream)')
      cap.textContent = caption
      const btn = document.createElement('button')
      btn.className = 'tm-btn tm-btn--muted'
      let idx = Math.max(0, opts.findIndex(([v]) => v === cur))
      btn.textContent = opts[idx]![1]
      btn.addEventListener('click', () => {
        idx = (idx + 1) % opts.length
        btn.textContent = opts[idx]![1]
        playUiClick()
        pick(opts[idx]![0])
      })
      row.append(cap, btn)
      return row
    }

    card.appendChild(cycler('Mesa', TABLE_THEMES, settings.tableTheme, (v) => {
      settings.tableTheme = v as TableTheme
      stage.dataset.table = v
      saveSettings(settings)
    }))
    card.appendChild(cycler('Dorso', TILE_BACKS, settings.tileBack, (v) => {
      settings.tileBack = v as TileBack
      stage.dataset.back = v
      saveSettings(settings)
    }))

    for (const [ch, label] of VOLUMES) {
      const row = el('label', 'display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%')
      row.innerHTML =
        `<span style="font-family:var(--serif);font-size:16px;color:var(--cream)">${label}</span>` +
        `<input type="range" min="0" max="100" value="${Math.round(settings.volumes[ch] * 100)}" style="flex:1;accent-color:var(--gold)">`
      const input = row.querySelector<HTMLInputElement>('input')!
      input.addEventListener('input', () => {
        const v = Number(input.value) / 100
        setVolume(ch, v)
        setVolumeSetting(settings, ch, v)
        saveSettings(settings)
      })
      card.appendChild(row)
    }

    const actions = el('div', 'display:flex;gap:10px;margin-top:8px')
    const close = document.createElement('button')
    close.className = 'tm-btn tm-btn--primary'
    close.textContent = 'CERRAR'
    close.addEventListener('click', () => { playUiClick(); ov.classList.add('is-hidden') })
    const exit = document.createElement('button')
    exit.className = 'tm-btn tm-btn--muted'
    exit.textContent = 'SALIR'
    exit.addEventListener('click', () => { playUiClick(); onExit() })
    actions.append(exit, close)
    card.appendChild(actions)

    ov.appendChild(card)
    stage.appendChild(ov)
    return ov
  }

  update(s: HandState, info: HudInfo): void {
    const order = [...SEATS].sort((a, b) => s.seats[b]!.points - s.seats[a]!.points || a - b)
    for (const seat of SEATS) {
      const p = this.portraits.get(seat)!
      const st = s.seats[seat]!
      p.placeEl.textContent = PLACES[order.indexOf(seat)]!
      p.score.textContent = st.points.toLocaleString('en-US')
      const wind = seatWind(seat, s.dealer)
      p.windBadge.textContent = windKanji(wind)
      p.windBadge.style.background = windColor(wind)
      p.panel.classList.toggle('is-turn', s.phase !== 'ended' && s.turn === seat)
      p.riichiTag.classList.toggle('is-on', st.riichi > 0)
    }

    this.kyokuJp.textContent = `東${KYOKU_KANJI[info.kyoku] ?? '一'}局`
    this.kyokuEn.textContent = `EAST ${info.kyoku + 1}`
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
    const names = (seat: Seat) => this.chars[seat]!.name
    let title = ''
    let subtitle = ''
    let body = ''

    if (end.type === 'tsumo' || end.type === 'ron') {
      title = end.type === 'tsumo' ? 'TSUMO!' : end.chankan ? 'CHANKAN!' : 'RON!'
      subtitle = end.type === 'tsumo' ? names(end.winner) : `${names(end.winner)} ← ${names(end.from)}`
      const sc = end.score
      const yakuRows = sc.yaku.map((y) => `<span class="tm-yaku-pill">${y.name}</span>`).join('')
      const limit = sc.limit ? ` · ${sc.limit.toUpperCase()}` : ''
      const hanfu = sc.yakuman > 0 ? 'YAKUMAN' : `${sc.han} HAN · ${sc.fu} FU${limit}`
      body =
        `<div class="tm-yaku-list">${yakuRows}</div>` +
        `<div class="tm-score-line"><span>${hanfu}</span><b>+${sc.total.toLocaleString('en-US')}</b></div>`
    } else if (end.type === 'exhaustive') {
      title = '流局'
      subtitle = 'EXHAUSTIVE DRAW'
      body =
        '<div class="tm-yaku-list">' +
        SEATS.map((x) => `<span class="tm-yaku-pill ${end.tenpai[x] ? '' : 'is-muted'}">${names(x)}: ${end.tenpai[x] ? 'TENPAI' : 'NOTEN'}</span>`).join('') +
        '</div>'
    } else {
      title = '途中流局'
      subtitle = `ABORTED · ${end.reason.toUpperCase()}`
    }

    const deltas = SEATS.map((x) => {
      const d = end.deltas[x]!
      const cls = d > 0 ? 'is-plus' : d < 0 ? 'is-minus' : ''
      return `<div class="tm-delta ${cls}"><span>${names(x)}</span><b>${d > 0 ? '+' : ''}${d.toLocaleString('en-US')}</b><i>${s.seats[x]!.points.toLocaleString('en-US')}</i></div>`
    }).join('')

    this.overlay.innerHTML =
      `<div class="tm-overlay__card">` +
      `<div class="tm-overlay__kyoku">東${KYOKU_KANJI[kyoku] ?? '一'}局 · ${s.honba} HONBA</div>` +
      `<div class="tm-overlay__title">${title}</div>` +
      `<div class="tm-overlay__sub">${subtitle}</div>` +
      body +
      `<div class="tm-deltas">${deltas}</div>` +
      `<button class="tm-btn tm-btn--primary tm-overlay__continue">CONTINUE</button>` +
      `</div>`
    this.overlay.classList.remove('is-hidden')
    this.overlay.querySelector('.tm-overlay__continue')!.addEventListener('click', onContinue, { once: true })
  }

  showGameEnd(s: HandState, onRematch: () => void, onCharacters: () => void): void {
    const names = (seat: Seat) => this.chars[seat]!.name
    const order = [...SEATS].sort((a, b) => s.seats[b]!.points - s.seats[a]!.points || a - b)
    const rows = order
      .map((seat, i) =>
        `<div class="tm-delta ${seat === this.human ? 'is-plus' : ''}">` +
        `<span>${PLACES[i]} · ${names(seat)}</span><b>${s.seats[seat]!.points.toLocaleString('en-US')}</b></div>`)
      .join('')
    this.overlay.innerHTML =
      `<div class="tm-overlay__card">` +
      `<div class="tm-overlay__title">GAME OVER</div>` +
      `<div class="tm-overlay__sub">TONPUUSEN COMPLETE</div>` +
      `<div class="tm-deltas">${rows}</div>` +
      `<div style="display:flex;gap:10px;margin-top:8px">` +
      `<button class="tm-btn tm-btn--muted" data-act="chars">CHARACTERS</button>` +
      `<button class="tm-btn tm-btn--primary" data-act="rematch">REMATCH</button>` +
      `</div></div>`
    this.overlay.classList.remove('is-hidden')
    this.overlay.querySelector('[data-act="rematch"]')!.addEventListener('click', onRematch, { once: true })
    this.overlay.querySelector('[data-act="chars"]')!.addEventListener('click', onCharacters, { once: true })
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
