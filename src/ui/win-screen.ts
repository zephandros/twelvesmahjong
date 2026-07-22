// Pantalla de victoria (mockup 1B): arte del ganador a la derecha, TSUMO!/RON!
// con degradado dorado, píldoras de yaku, han·fu y puntuación, y la mano
// ganadora abajo con la ficha ganadora separada. Solo tsumo/ron; los
// agotamientos y abortos usan la tarjeta sobria del HUD.

import type { HandState } from '../core/state'
import type { Seat } from '../core/seat'
import { uraIndicators } from '../core/wall'
import { createTileView, type TileView } from './tile-view'
import {
  portraitUrl, charName, charEpithet, altForm, type AltForm, type Character,
} from './characters'
import { meldLayout, type MeldSlot } from './meld-layout'
import { t, yakuLabel, roundLabels, getLocale } from './i18n'


export function showWinScreen(
  stage: HTMLElement,
  s: HandState,
  kyoku: number,
  chars: readonly Character[],
  onContinue: () => void,
  human?: Seat,
): void {
  const end = s.end!
  if (end.type !== 'tsumo' && end.type !== 'ron') throw new Error('no es una victoria')

  const winner = end.winner
  const char = chars[winner]!
  const sc = end.score
  const tsumo = end.type === 'tsumo'
  const kanji = tsumo ? t('win.tsumo-kanji') : end.chankan ? t('win.chankan-kanji') : t('win.ron-kanji')
  const title = tsumo ? t('win.tsumo') : end.chankan ? t('win.chankan') : t('win.ron')

  const el = document.createElement('div')
  el.className = 'tm-win'

  const yakuPills = sc.yaku
    .map((y) => `<span class="tm-yaku-pill">${yakuLabel(y)}</span>`)
    .join('')
  const limit = sc.limit ? ` · ${t(`limit.${sc.limit}`)}` : ''
  const hanfu = sc.yakuman > 0 ? t('hud.yakuman') : `${t('hud.han-fu', { han: sc.han, fu: sc.fu })}${limit}`
  // en ja el nombre va en katakana: el uppercase del look Antique solo aplica al latín
  const displayName = (c: Character, alt?: AltForm): string =>
    getLocale() === 'ja' ? charName(c, alt) : charName(c, alt).toUpperCase()
  // Jekyll ganando o descartando en riichi sigue transformado: nombre + arte de Hyde
  const winnerAlt = altForm(char, s.seats[winner]!.riichi)
  const fromLine =
    end.type === 'ron'
      ? `<span class="tm-win__from">← ${displayName(chars[end.from]!, altForm(chars[end.from]!, s.seats[end.from]!.riichi))}</span>`
      : ''
  // el humano en riichi que perdió la mano ve los ura que le habrían tocado;
  // el ganador riichi ya los tiene como píldora "Ura Dora {n}" entre los yaku
  const showUra = human !== undefined && winner !== human && s.seats[human]!.riichi > 0
  const winnerName = displayName(char, winnerAlt)
  const artUrl = winnerAlt?.portrait ?? portraitUrl(char)

  el.innerHTML = `
    <div class="tm-win__rays"></div>
    <div class="tm-win__art"><img src="${artUrl}" alt="${charName(char, winnerAlt)}"></div>
    <div class="tm-win__body">
      <div class="tm-win__kyoku">${roundLabels(kyoku).kanji} · ${s.honba} ${t('hud.honba')}</div>
      <div class="tm-win__kanji">${kanji}</div>
      <div class="tm-win__title">${title}</div>
      <div class="tm-win__name">
        <div class="tm-win__name-line"><b>${winnerName}</b>${fromLine}</div>
        <span class="tm-win__epithet">${charEpithet(char, winnerAlt)}</span>
      </div>
      <div class="tm-yaku-list tm-win__yaku">${yakuPills}</div>
      <div class="tm-win__score"><span>${hanfu}</span><b>+${sc.total.toLocaleString('en-US')}</b></div>
      ${showUra ? `<div class="tm-win__ura"><span>${t('hud.ura-reveal')}</span></div>` : ''}
      <div class="tm-win__hand"></div>
      <button class="tm-btn tm-btn--primary tm-win__continue">${t('hud.continue')}</button>
    </div>
  `

  // mano ganadora: oculta ordenada + melds + la ficha ganadora separada
  const handEl = el.querySelector<HTMLElement>('.tm-win__hand')!
  const r = createTileView(38)
  if (showUra) {
    const uraEl = el.querySelector<HTMLElement>('.tm-win__ura')!
    const ru = createTileView(32)
    for (const id of uraIndicators(s.wall)) uraEl.appendChild(ru.create('front', id))
  }
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

  // con melds la mano puede exceder el ancho del body (620px, styles.css); las
  // fichas no se encogen (flex 0 0 auto) → se escala la fila entera para que quepa
  const BODY_W = 620
  const handW = handEl.scrollWidth
  if (handW > BODY_W) handEl.style.transform = `scale(${BODY_W / handW})`
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
