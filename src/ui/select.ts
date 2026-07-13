// Selección de personaje (フリー対局): 4 huecos (tú + 3 rivales) y la rejilla
// del elenco. Clic en un personaje lo asigna al hueco activo y avanza;
// RANDOM rellena lo que falte; START arranca con el roster completo.

import { CHARACTERS, thumbUrl, type Character, type Roster } from './characters'
import { playUiClick } from './audio/audio'

const SLOT_LABELS = ['プレイヤー · YOU', '対戦者 1 · RIVAL', '対戦者 2 · RIVAL', '対戦者 3 · RIVAL']

export function renderSelect(
  root: HTMLElement,
  onStart: (roster: Roster) => void,
  onBack?: () => void,
): void {
  root.innerHTML = ''
  const wrap = document.createElement('div')
  wrap.className = 'tm-select'

  wrap.innerHTML = `
    <div class="tm-select__head">
      <span class="tm-select__title">TWELVES Mahjong</span>
      <span class="tm-select__sub">RIICHI MAHJONG · TONPUUSEN</span>
    </div>
    <div class="tm-select__slots"></div>
    <div class="tm-select__grid"></div>
    <div class="tm-select__actions">
      ${onBack ? '<button class="tm-btn tm-btn--muted" data-act="back">← MENÚ</button>' : ''}
      <button class="tm-btn tm-btn--muted" data-act="random">RANDOM</button>
      <button class="tm-btn tm-btn--primary" data-act="start" disabled>START</button>
    </div>
    <div class="tm-select__hint">elige tu personaje y tus tres rivales</div>
  `
  root.appendChild(wrap)

  const slotsEl = wrap.querySelector<HTMLElement>('.tm-select__slots')!
  const gridEl = wrap.querySelector<HTMLElement>('.tm-select__grid')!
  const startBtn = wrap.querySelector<HTMLButtonElement>('[data-act="start"]')!
  const randomBtn = wrap.querySelector<HTMLButtonElement>('[data-act="random"]')!
  if (onBack) {
    wrap.querySelector<HTMLButtonElement>('[data-act="back"]')!
      .addEventListener('click', () => {
        playUiClick()
        onBack()
      })
  }

  const picked: (Character | null)[] = [null, null, null, null]
  let current = 0

  // --- huecos ---
  const slotEls = SLOT_LABELS.map((label, i) => {
    const el = document.createElement('button')
    el.className = 'tm-slot'
    el.innerHTML =
      `<span class="tm-slot__label">${label}</span>` +
      `<span class="tm-slot__frame"><span class="tm-slot__q">?</span></span>` +
      `<span class="tm-slot__name">—</span>`
    el.addEventListener('click', () => {
      playUiClick()
      current = i
      refresh()
    })
    slotsEl.appendChild(el)
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
      onStart(picked as unknown as Roster)
    }
  })

  function refresh(): void {
    picked.forEach((p, i) => {
      const el = slotEls[i]!
      el.classList.toggle('is-current', i === current)
      const frame = el.querySelector<HTMLElement>('.tm-slot__frame')!
      const name = el.querySelector<HTMLElement>('.tm-slot__name')!
      if (p) {
        frame.innerHTML = `<img src="${thumbUrl(p)}" alt="${p.name}">`
        name.textContent = p.name
      } else {
        frame.innerHTML = '<span class="tm-slot__q">?</span>'
        name.textContent = '—'
      }
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
