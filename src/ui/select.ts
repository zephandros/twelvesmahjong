// Selección de personaje (フリー対局): layout de dos columnas — asientos con
// viento a la izquierda, elenco + acciones a la derecha. Clic en un personaje
// lo asigna al hueco activo y avanza; ALEATORIO rellena lo que falte; INICIAR
// arranca con el roster completo. Vive en el escenario 1920×1080 escalado.

import { CHARACTERS, thumbUrl, type Character, type Roster } from './characters'
import { playUiClick } from './audio/audio'
import { createScaledStage } from './layout'
import {
  seatWind,
  windColor,
  windKanji,
  type Seat,
} from '../core/seat'

const SLOT_LABELS = ['プレイヤー · YOU', '対戦者 1 · RIVAL', '対戦者 2 · RIVAL', '対戦者 3 · RIVAL']

/** Viento inicial de asiento (East 1, dealer = 0 / HUMAN). Rotan en partida. */
const INITIAL_DEALER: Seat = 0

export function renderSelect(
  root: HTMLElement,
  onStart: (roster: Roster) => void,
  onBack?: () => void,
): void {
  root.innerHTML = ''
  const stage = createScaledStage(root)
  const wrap = document.createElement('div')
  wrap.className = 'tm-select'

  wrap.innerHTML = `
    <div class="tm-select__head">
      ${onBack ? '<button class="tm-select__back" data-act="back" aria-label="Volver al menú">←</button>' : ''}
      <div class="tm-select__headings">
        <span class="tm-select__title">Selección de personaje</span>
        <span class="tm-select__sub">キャラクター選択</span>
      </div>
    </div>
    <div class="tm-select__body">
      <div class="tm-select__seats"></div>
      <div class="tm-select__right">
        <div class="tm-select__grid"></div>
        <div class="tm-select__actions">
          <button class="tm-btn tm-btn--muted" data-act="random">ALEATORIO</button>
          <button class="tm-btn tm-btn--primary" data-act="start" disabled>INICIAR</button>
        </div>
      </div>
    </div>
  `
  stage.appendChild(wrap)

  const seatsEl = wrap.querySelector<HTMLElement>('.tm-select__seats')!
  const gridEl = wrap.querySelector<HTMLElement>('.tm-select__grid')!
  const startBtn = wrap.querySelector<HTMLButtonElement>('[data-act="start"]')!
  const randomBtn = wrap.querySelector<HTMLButtonElement>('[data-act="random"]')!

  const leave = (next: () => void): void => {
    window.removeEventListener('keydown', onKey)
    next()
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && onBack) {
      playUiClick()
      leave(onBack)
    }
  }

  if (onBack) {
    wrap.querySelector<HTMLButtonElement>('[data-act="back"]')!
      .addEventListener('click', () => {
        playUiClick()
        leave(onBack)
      })
    window.addEventListener('keydown', onKey)
  }

  const picked: (Character | null)[] = [null, null, null, null]
  let current = 0

  // --- asientos ---
  const slotEls = SLOT_LABELS.map((label, i) => {
    const seat = i as Seat
    const wind = seatWind(seat, INITIAL_DEALER)
    const el = document.createElement('button')
    el.className = 'tm-slot'
    el.innerHTML =
      `<span class="tm-slot__label">${label}</span>` +
      `<span class="tm-slot__frame">` +
      `<span class="tm-slot__wind">${windKanji(wind)}</span>` +
      `<span class="tm-slot__q">?</span>` +
      `</span>` +
      `<span class="tm-slot__name">—</span>`
    const windEl = el.querySelector<HTMLElement>('.tm-slot__wind')!
    windEl.style.background = windColor(wind)
    el.addEventListener('click', () => {
      playUiClick()
      current = i
      refresh()
    })
    seatsEl.appendChild(el)
    return el
  })

  // --- rejilla ---
  const cardEls = new Map<string, HTMLButtonElement>()
  for (const c of CHARACTERS) {
    const el = document.createElement('button')
    el.className = 'tm-char'
    el.innerHTML =
      `<img src="${thumbUrl(c)}" alt="${c.name}">` +
      `<span>${c.name}</span>`
    el.addEventListener('click', () => {
      if (picked.some((p) => p?.id === c.id)) return
      playUiClick()
      picked[current] = c
      const next = picked.findIndex((p) => p === null)
      current = next === -1 ? current : next
      refresh()
    })
    gridEl.appendChild(el)
    cardEls.set(c.id, el)
  }

  randomBtn.addEventListener('click', () => {
    playUiClick()
    const free = CHARACTERS.filter((c) => !picked.some((p) => p?.id === c.id))
    for (let i = 0; i < 4; i++) {
      if (picked[i] === null) {
        const k = Math.floor(Math.random() * free.length)
        picked[i] = free.splice(k, 1)[0]!
      }
    }
    refresh()
  })

  startBtn.addEventListener('click', () => {
    if (picked.every((p) => p !== null)) {
      playUiClick()
      leave(() => onStart(picked as unknown as Roster))
    }
  })

  function refresh(): void {
    picked.forEach((p, i) => {
      const el = slotEls[i]!
      el.classList.toggle('is-current', i === current)
      const frame = el.querySelector<HTMLElement>('.tm-slot__frame')!
      const name = el.querySelector<HTMLElement>('.tm-slot__name')!
      const seat = i as Seat
      const wind = seatWind(seat, INITIAL_DEALER)
      if (p) {
        frame.innerHTML =
          `<span class="tm-slot__wind">${windKanji(wind)}</span>` +
          `<img src="${thumbUrl(p)}" alt="${p.name}">`
        name.textContent = p.name
      } else {
        frame.innerHTML =
          `<span class="tm-slot__wind">${windKanji(wind)}</span>` +
          `<span class="tm-slot__q">?</span>`
        name.textContent = '—'
      }
      frame.querySelector<HTMLElement>('.tm-slot__wind')!.style.background =
        windColor(wind)
    })
    for (const c of CHARACTERS) {
      cardEls.get(c.id)!.classList.toggle(
        'is-taken',
        picked.some((p) => p?.id === c.id),
      )
    }
    startBtn.disabled = !picked.every((p) => p !== null)
  }

  refresh()
}
