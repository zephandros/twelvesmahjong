// HUD: retratos, contador central, botones de acción y overlays de fin.
// Construye el DOM una vez y lo actualiza desde el estado; los botones los
// decide el controlador (aquí solo se pintan).

import type { HandState } from '../core/state'
import type { Seat } from '../core/seat'
import { SEATS, relSeat, cornerOf, seatWind, windColor, windKanji } from '../core/seat'
import { place } from './layout'
import { thumbUrl, type Character } from './characters'
import { saveSettings, type Settings, type TableTheme, type TileBack } from './settings'
import { playUiClick } from './audio/audio'

const TABLE_THEMES: ReadonlyArray<[TableTheme, string]> = [
  ['green', 'Green Velvet'], ['red', 'Red Velvet'], ['blue', 'Blue Velvet'], ['wood', 'Aged Wood'],
]
const TILE_BACKS: ReadonlyArray<[TileBack, string]> = [
  ['amber', 'Amber'], ['green', 'Green'], ['red', 'Red'], ['blue', 'Blue'], ['charcoal', 'Charcoal'],
]

export interface ButtonDef {
  label: string
  kind: string
  /** estilo: primary (dorado), normal, muted */
  style?: 'primary' | 'normal' | 'muted'
}

export interface HudInfo {
  /** Índice de kyoku 0..3 (東一局..東四局). */
  kyoku: number
  buttons: ButtonDef[]
  /** Texto bajo la mano ('— YOUR TURN —', '— RIICHI: ELIGE DESCARTE —'…). */
  turnLabel: string | null
}

const KYOKU_KANJI = ['一', '二', '三', '四']
const PLACES = ['1st', '2nd', '3rd', '4th']

export class Hud {
  private readonly human: Seat
  private readonly chars: readonly Character[]
  private readonly onButton: (kind: string) => void

  private readonly portraits = new Map<Seat, {
    frame: HTMLElement
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

    // tema de mesa y dorso de ficha vienen de los ajustes (barra superior)
    stage.dataset.table = settings.tableTheme
    stage.dataset.back = settings.tileBack
    stage.appendChild(this.buildTopBar(stage, settings, onExit))

    // --- retratos en las 4 esquinas ---
    const cornerCss: Record<string, Record<string, number>> = {
      bl: { left: 10, bottom: 10 }, br: { right: 10, bottom: 10 },
      tr: { right: 10, top: 10 }, tl: { left: 10, top: 10 },
    }
    for (const seat of SEATS) {
      const rel = relSeat(seat, human)
      const wrap = document.createElement('div')
      wrap.style.width = '132px'
      wrap.className = 'tm-col'
      wrap.style.gap = '3px'

      const head = document.createElement('div')
      head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:6px'
      const placeEl = document.createElement('span')
      placeEl.style.cssText = 'font-family:var(--display);font-size:19px;color:var(--gold);letter-spacing:.06em'
      const nameEl = document.createElement('span')
      nameEl.style.cssText = 'font-weight:700;font-size:12px;color:var(--cream);text-shadow:0 1px 2px #000'
      nameEl.textContent = rel === 'self' ? `${chars[seat]!.name} · YOU` : chars[seat]!.name
      head.append(placeEl, nameEl)

      const frame = document.createElement('div')
      frame.className = 'tm-portrait'
      frame.innerHTML = `<img class="tm-portrait__img" src="${thumbUrl(chars[seat]!)}" alt="${chars[seat]!.name}">`
      const windBadge = document.createElement('div')
      windBadge.className = 'tm-portrait__wind'
      frame.appendChild(windBadge)
      const riichiTag = document.createElement('div')
      riichiTag.className = 'tm-portrait__riichi'
      riichiTag.textContent = 'RIICHI'
      frame.appendChild(riichiTag)

      const scoreBar = document.createElement('div')
      scoreBar.style.cssText =
        'display:flex;align-items:center;gap:6px;background:rgba(6,12,9,.72);border:1px solid rgba(231,197,106,.3);border-radius:7px;padding:2px 8px'
      const dot = document.createElement('span')
      dot.style.cssText = `width:7px;height:7px;border-radius:50%;background:${rel === 'self' ? 'var(--gold)' : '#7c8a7f'}`
      const score = document.createElement('span')
      score.style.cssText = 'font-family:var(--display);font-size:26px;color:var(--cream)'
      scoreBar.append(dot, score)

      wrap.append(head, frame, scoreBar)
      place(wrap, { ...cornerCss[cornerOf(rel)]!, z: 40 })
      stage.appendChild(wrap)
      this.portraits.set(seat, { frame, placeEl, score, windBadge, riichiTag })
    }

    // --- contador central ---
    const counter = document.createElement('div')
    counter.className = 'tm-counter'
    this.kyokuJp = el('span', 'font-family:var(--jp);font-weight:700;font-size:15px;color:var(--gold)')
    this.kyokuEn = el('span', 'font-family:var(--display);font-size:15px;letter-spacing:.1em;color:var(--muted)')
    const kyokuRow = el('div', 'display:flex;align-items:center;gap:6px')
    kyokuRow.append(this.kyokuJp, this.kyokuEn)
    this.wallCount = el('div', 'font-family:var(--display);font-size:60px;line-height:.82;color:var(--cream);text-shadow:0 3px 8px rgba(0,0,0,.5)')
    const wallLabel = el('div', 'font-size:10px;letter-spacing:.24em;color:var(--muted2);text-transform:uppercase;margin-top:-2px')
    wallLabel.textContent = 'tiles left'
    const meta = el('div', 'display:flex;gap:10px;margin-top:6px;font-family:var(--display);font-size:18px;color:#e0d7bd')
    this.honbaEl = el('span', 'display:flex;align-items:center;gap:4px')
    this.sticksEl = el('span', 'display:flex;align-items:center;gap:4px')
    meta.append(this.honbaEl, this.sticksEl)
    counter.append(kyokuRow, this.wallCount, wallLabel, meta)
    place(counter, { left: 640, top: 360, transform: 'translate(-50%,-50%)', z: 30 })
    stage.appendChild(counter)

    // --- etiqueta DORA ---
    const doraLabel = el('div', 'font-size:9px;letter-spacing:.2em;color:var(--muted3);text-transform:uppercase')
    doraLabel.textContent = 'DORA'
    place(doraLabel, { left: 735, top: 288, z: 16 })
    stage.appendChild(doraLabel)

    // --- botones + rótulo de turno ---
    this.buttonsRow = el('div', 'display:flex;gap:8px')
    place(this.buttonsRow, { right: 150, bottom: 104, z: 45 })
    stage.appendChild(this.buttonsRow)

    this.turnEl = el('div', 'font-family:var(--display);font-size:16px;letter-spacing:.28em;color:var(--gold);text-transform:uppercase')
    place(this.turnEl, { left: 640, bottom: 98, transform: 'translateX(-50%)', z: 35 })
    stage.appendChild(this.turnEl)

    // --- overlay de fin ---
    this.overlay = document.createElement('div')
    this.overlay.className = 'tm-overlay is-hidden'
    stage.appendChild(this.overlay)
  }

  // Barra superior: 咲 · selector de mesa · selector de dorso · salir. Los
  // selectores ciclan opciones, aplican al escenario en vivo y persisten.
  private buildTopBar(stage: HTMLElement, settings: Settings, onExit: () => void): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'tm-topbar'

    const mark = el('span', 'font-family:var(--display-serif);font-style:italic;font-weight:700;font-size:20px;color:var(--gold)')
    mark.textContent = '咲'
    mark.style.fontFamily = 'var(--jp)'
    bar.appendChild(mark)

    const cycler = (
      caption: string,
      options: ReadonlyArray<[string, string]>,
      current: string,
      onPick: (value: string) => void,
    ): HTMLElement => {
      const wrap = document.createElement('button')
      wrap.className = 'tm-topbar__cycle'
      let idx = Math.max(0, options.findIndex(([v]) => v === current))
      const cap = el('span', '')
      cap.className = 'tm-topbar__cap'
      cap.textContent = caption
      const val = el('span', '')
      val.className = 'tm-topbar__val'
      val.textContent = options[idx]![1]
      wrap.append(cap, val)
      wrap.addEventListener('click', () => {
        idx = (idx + 1) % options.length
        val.textContent = options[idx]![1]
        playUiClick()
        onPick(options[idx]![0])
      })
      return wrap
    }

    bar.appendChild(cycler('Table', TABLE_THEMES, settings.tableTheme, (v) => {
      settings.tableTheme = v as TableTheme
      stage.dataset.table = v
      saveSettings(settings)
    }))
    bar.appendChild(cycler('Tiles', TILE_BACKS, settings.tileBack, (v) => {
      settings.tileBack = v as TileBack
      stage.dataset.back = v
      saveSettings(settings)
    }))

    const exit = document.createElement('button')
    exit.className = 'tm-topbar__exit'
    exit.textContent = 'Exit ×'
    exit.addEventListener('click', () => {
      playUiClick()
      onExit()
    })
    bar.appendChild(exit)

    place(bar, { left: 640, top: 14, transform: 'translateX(-50%)', z: 50 })
    return bar
  }

  update(s: HandState, info: HudInfo): void {
    // clasificación por puntos para el rótulo 1st..4th
    const order = [...SEATS].sort(
      (a, b) => s.seats[b]!.points - s.seats[a]!.points || a - b,
    )
    for (const seat of SEATS) {
      const p = this.portraits.get(seat)!
      const st = s.seats[seat]!
      p.placeEl.textContent = PLACES[order.indexOf(seat)]!
      p.score.textContent = st.points.toLocaleString('en-US')
      const wind = seatWind(seat, s.dealer)
      p.windBadge.textContent = windKanji(wind)
      p.windBadge.style.background = windColor(wind)
      p.frame.classList.toggle('is-turn', s.phase !== 'ended' && s.turn === seat)
      p.frame.classList.toggle('is-self', seat === this.human)
      p.riichiTag.classList.toggle('is-on', st.riichi > 0)
    }

    this.kyokuJp.textContent = `東${KYOKU_KANJI[info.kyoku] ?? '一'}局`
    this.kyokuEn.textContent = `EAST ${info.kyoku + 1}`
    this.wallCount.textContent = String(s.wall.live.length)
    this.honbaEl.innerHTML =
      `<span style="width:9px;height:9px;border-radius:50%;background:#d94f4f"></span>${s.honba}`
    this.sticksEl.innerHTML =
      `<span style="width:16px;height:6px;border-radius:2px;background:linear-gradient(#f4ecd6,#cfc6ad);border:1px solid #b9a15a"></span>${s.sticks}`

    // botones
    this.buttonsRow.replaceChildren(
      ...info.buttons.map((b) => {
        const btn = document.createElement('button')
        btn.className = `tm-btn tm-btn--${b.style ?? 'normal'}`
        btn.textContent = b.label
        btn.addEventListener('click', () => this.onButton(b.kind))
        return btn
      }),
    )
    this.turnEl.textContent = info.turnLabel ?? ''
  }

  // --- overlays -------------------------------------------------------------

  showHandEnd(s: HandState, kyoku: number, onContinue: () => void): void {
    const end = s.end!
    const names = (seat: Seat) => this.chars[seat]!.name
    let title = ''
    let subtitle = ''
    let body = ''

    if (end.type === 'tsumo' || end.type === 'ron') {
      title = end.type === 'tsumo' ? 'TSUMO!' : end.chankan ? 'CHANKAN!' : 'RON!'
      subtitle =
        end.type === 'tsumo'
          ? names(end.winner)
          : `${names(end.winner)} ← ${names(end.from)}`
      const sc = end.score
      const yakuRows = sc.yaku
        .map((y) => `<span class="tm-yaku-pill">${y.name}</span>`)
        .join('')
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
        SEATS.map(
          (x) =>
            `<span class="tm-yaku-pill ${end.tenpai[x] ? '' : 'is-muted'}">${names(x)}: ${end.tenpai[x] ? 'TENPAI' : 'NOTEN'}</span>`,
        ).join('') +
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
    this.overlay
      .querySelector('.tm-overlay__continue')!
      .addEventListener('click', onContinue, { once: true })
  }

  showGameEnd(s: HandState, onRematch: () => void, onCharacters: () => void): void {
    const names = (seat: Seat) => this.chars[seat]!.name
    const order = [...SEATS].sort(
      (a, b) => s.seats[b]!.points - s.seats[a]!.points || a - b,
    )
    const rows = order
      .map(
        (seat, i) =>
          `<div class="tm-delta ${seat === this.human ? 'is-plus' : ''}">` +
          `<span>${PLACES[i]} · ${names(seat)}</span><b>${s.seats[seat]!.points.toLocaleString('en-US')}</b></div>`,
      )
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
    this.overlay
      .querySelector('[data-act="rematch"]')!
      .addEventListener('click', onRematch, { once: true })
    this.overlay
      .querySelector('[data-act="chars"]')!
      .addEventListener('click', onCharacters, { once: true })
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
