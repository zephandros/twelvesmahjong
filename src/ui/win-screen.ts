// Pantalla de victoria (mockup 1B): arte del ganador a la derecha, TSUMO!/RON!
// con degradado dorado, píldoras de yaku, han·fu y puntuación, y la mano
// ganadora abajo con la ficha ganadora separada. Solo tsumo/ron; los
// agotamientos y abortos usan la tarjeta sobria del HUD.

import type { HandState } from '../core/state'
import { createTileView, type TileView } from './tile-view'
import { portraitUrl, type Character } from './characters'
import { meldLayout, type MeldSlot } from './meld-layout'

const KYOKU_KANJI = ['一', '二', '三', '四']

export function showWinScreen(
  stage: HTMLElement,
  s: HandState,
  kyoku: number,
  chars: readonly Character[],
  onContinue: () => void,
): void {
  const end = s.end!
  if (end.type !== 'tsumo' && end.type !== 'ron') throw new Error('no es una victoria')

  const winner = end.winner
  const char = chars[winner]!
  const sc = end.score
  const tsumo = end.type === 'tsumo'
  const kanji = tsumo ? 'ツモ' : end.chankan ? '搶槓' : 'ロン'
  const title = tsumo ? 'TSUMO!' : end.chankan ? 'CHANKAN!' : 'RON!'

  const el = document.createElement('div')
  el.className = 'tm-win'

  const yakuPills = sc.yaku
    .map((y) => `<span class="tm-yaku-pill">${y.name}</span>`)
    .join('')
  const limit = sc.limit ? ` · ${sc.limit.toUpperCase()}` : ''
  const hanfu = sc.yakuman > 0 ? 'YAKUMAN' : `${sc.han} HAN · ${sc.fu} FU${limit}`
  const fromLine =
    end.type === 'ron' ? `<span class="tm-win__from">← ${chars[end.from]!.name}</span>` : ''

  el.innerHTML = `
    <div class="tm-win__rays"></div>
    <div class="tm-win__art"><img src="${portraitUrl(char)}" alt="${char.name}"></div>
    <div class="tm-win__body">
      <div class="tm-win__kyoku">東${KYOKU_KANJI[kyoku] ?? '一'}局 · ${s.honba} HONBA</div>
      <div class="tm-win__kanji">${kanji}</div>
      <div class="tm-win__title">${title}</div>
      <div class="tm-win__name"><b>${char.name.toUpperCase()}</b><span>${char.epithet}</span>${fromLine}</div>
      <div class="tm-yaku-list tm-win__yaku">${yakuPills}</div>
      <div class="tm-win__score"><span>${hanfu}</span><b>+${sc.total.toLocaleString('en-US')}</b></div>
      <div class="tm-win__hand"></div>
      <button class="tm-btn tm-btn--primary tm-win__continue">CONTINUE</button>
    </div>
  `

  // mano ganadora: oculta ordenada + melds + la ficha ganadora separada
  const handEl = el.querySelector<HTMLElement>('.tm-win__hand')!
  const r = createTileView(38)
  const st = s.seats[winner]!
  const concealed = [...st.hand].sort((a, b) => a - b)
  for (const id of concealed) handEl.appendChild(r.create('front', id))
  for (const m of st.melds) {
    const gap = document.createElement('span')
    gap.className = 'tm-win__gap'
    handEl.appendChild(gap)
    appendWinMeld(handEl, r, meldLayout(m, winner))
  }
  const winGap = document.createElement('span')
  winGap.className = 'tm-win__gap tm-win__gap--wide'
  handEl.appendChild(winGap)
  const winTileEl = r.create('front', end.winTile)
  winTileEl.classList.add('tm-win__wintile')
  handEl.appendChild(winTileEl)

  el.querySelector('.tm-win__continue')!.addEventListener(
    'click',
    () => {
      el.remove()
      onContinue()
    },
    { once: true },
  )

  stage.appendChild(el)
}

function appendWinMeld(root: HTMLElement, view: TileView, slots: readonly MeldSlot[]): void {
  let stackAnchor: HTMLElement | null = null
  for (const slot of slots) {
    const tile = view.create(slot.faceDown ? 'back' : 'front', slot.id)
    if (slot.stack) {
      if (stackAnchor) {
        tile.classList.add('tm-win__tile--stack')
        stackAnchor.appendChild(tile)
      }
      continue
    }

    const cell = document.createElement('span')
    cell.className = 'tm-win__meld-slot'
    if (slot.sideways) cell.classList.add('tm-win__meld-slot--sideways')
    cell.appendChild(tile)
    root.appendChild(cell)
    stackAnchor = slot.sideways ? cell : null
  }
}
