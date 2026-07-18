// Selección de personaje (フリー対局): layout de dos columnas — asientos con
// viento a la izquierda, elenco + acciones a la derecha. Clic en un personaje
// lo asigna al hueco activo y avanza; ALEATORIO rellena lo que falte; INICIAR
// arranca con el roster completo. Vive en el escenario 1920×1080 escalado.

import { CHARACTERS, charName, thumbUrl, type Character, type Roster } from './characters'
import { ICONS } from './icons.generated'
import { playUiClick } from './audio/audio'
import { createScaledStage } from './layout'
import { t } from './i18n'
import {
  seatWind,
  windColor,
  windName,
  type Seat,
} from '../core/seat'
import type { Tile34 } from '../core/tile'

const slotLabel = (i: number): string =>
  i === 0 ? t('select.slot.you') : t('select.slot.rival', { n: i })
const windGlyph = (wind: Tile34): string => t(`wind.${windName(wind)}`)

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
      ${onBack ? `<button class="tm-select__back" data-act="back" aria-label="${t('select.a11y-back')}">${ICONS['arrow-big-left']}</button>` : ''}
      <div class="tm-select__headings">
        <span class="tm-select__title">${t('select.title')}</span>
        <span class="tm-select__sub">${t('select.subtitle')}</span>
      </div>
    </div>
    <div class="tm-select__body">
      <div class="tm-select__seats"></div>
      <div class="tm-select__right">
        <div class="tm-select__grid"></div>
        <div class="tm-select__actions">
          <button class="tm-btn tm-btn--muted" data-act="random">${t('select.random')}</button>
          <button class="tm-btn tm-btn--primary" data-act="start" disabled>${t('select.start')}</button>
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
  const slotEls = [0, 1, 2, 3].map((i) => {
    const seat = i as Seat
    const wind = seatWind(seat, INITIAL_DEALER)
    const el = document.createElement('button')
    el.className = 'tm-slot'
    el.innerHTML =
      `<span class="tm-slot__label">${slotLabel(i)}</span>` +
      `<span class="tm-slot__frame">` +
      `<span class="tm-slot__wind">${windGlyph(wind)}</span>` +
      `<span class="tm-slot__q">?</span>` +
      `</span>`
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
      `<img src="${thumbUrl(c)}" alt="${charName(c)}">` +
      `<span>${charName(c)}</span>`
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
      const seat = i as Seat
      const wind = seatWind(seat, INITIAL_DEALER)
      if (p) {
        // nombre embebido en el marco (abajo-derecha, sobre degradado)
        frame.innerHTML =
          `<span class="tm-slot__wind">${windGlyph(wind)}</span>` +
          `<img src="${thumbUrl(p)}" alt="${charName(p)}">` +
          `<span class="tm-slot__name">${charName(p)}</span>`
      } else {
        frame.innerHTML =
          `<span class="tm-slot__wind">${windGlyph(wind)}</span>` +
          `<span class="tm-slot__q">?</span>`
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
