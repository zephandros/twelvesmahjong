// Metadata de PRESENTACIÓN del glosario de yaku. Los valores de han están
// transcritos del código de core/yaku.ts (el descuento por mano abierta es el
// `menzen ? n : n-1` de cada push) — si una regla cambia allí, refléjalo aquí.
// Los nombres salen de i18n `yaku.<id>` y las descripciones de `yaku.<id>.desc`
// (DerivedKeyCheck en i18n.ts fuerza que el CSV tenga las 45).

import type { YakuId } from '../core/yaku'

export type GlossarySection = 'situational' | 'form' | 'yakuman' | 'dora'

export interface YakuInfo {
  readonly id: YakuId
  /** Han con mano cerrada (ignorado si `yakuman`). */
  readonly closed: number
  /** Han con mano abierta; null = solo mano cerrada. */
  readonly open: number | null
  readonly yakuman?: true
  readonly section: GlossarySection
}

export const GLOSSARY_SECTIONS: readonly GlossarySection[] = [
  'situational', 'form', 'yakuman', 'dora',
]

export const YAKU_GLOSSARY: readonly YakuInfo[] = [
  // situacionales
  { id: 'riichi', closed: 1, open: null, section: 'situational' },
  { id: 'double-riichi', closed: 2, open: null, section: 'situational' },
  { id: 'ippatsu', closed: 1, open: null, section: 'situational' },
  { id: 'tsumo', closed: 1, open: null, section: 'situational' },
  { id: 'haitei', closed: 1, open: 1, section: 'situational' },
  { id: 'houtei', closed: 1, open: 1, section: 'situational' },
  { id: 'rinshan', closed: 1, open: 1, section: 'situational' },
  { id: 'chankan', closed: 1, open: 1, section: 'situational' },
  // de forma
  { id: 'pinfu', closed: 1, open: null, section: 'form' },
  { id: 'tanyao', closed: 1, open: 1, section: 'form' },
  { id: 'iipeiko', closed: 1, open: null, section: 'form' },
  { id: 'ryanpeiko', closed: 3, open: null, section: 'form' },
  { id: 'yakuhai-haku', closed: 1, open: 1, section: 'form' },
  { id: 'yakuhai-hatsu', closed: 1, open: 1, section: 'form' },
  { id: 'yakuhai-chun', closed: 1, open: 1, section: 'form' },
  { id: 'yakuhai-seat', closed: 1, open: 1, section: 'form' },
  { id: 'yakuhai-round', closed: 1, open: 1, section: 'form' },
  { id: 'sanshoku', closed: 2, open: 1, section: 'form' },
  { id: 'sanshoku-doukou', closed: 2, open: 2, section: 'form' },
  { id: 'ittsu', closed: 2, open: 1, section: 'form' },
  { id: 'toitoi', closed: 2, open: 2, section: 'form' },
  { id: 'sanankou', closed: 2, open: 2, section: 'form' },
  { id: 'sankantsu', closed: 2, open: 2, section: 'form' },
  { id: 'honroutou', closed: 2, open: 2, section: 'form' },
  { id: 'junchan', closed: 3, open: 2, section: 'form' },
  { id: 'chanta', closed: 2, open: 1, section: 'form' },
  { id: 'shousangen', closed: 2, open: 2, section: 'form' },
  { id: 'honitsu', closed: 3, open: 2, section: 'form' },
  { id: 'chinitsu', closed: 6, open: 5, section: 'form' },
  { id: 'chiitoi', closed: 2, open: null, section: 'form' },
  // yakuman
  { id: 'tenhou', closed: 13, open: null, yakuman: true, section: 'yakuman' },
  { id: 'chiihou', closed: 13, open: null, yakuman: true, section: 'yakuman' },
  { id: 'kokushi', closed: 13, open: null, yakuman: true, section: 'yakuman' },
  { id: 'suuankou', closed: 13, open: null, yakuman: true, section: 'yakuman' },
  { id: 'daisangen', closed: 13, open: null, yakuman: true, section: 'yakuman' },
  { id: 'daisuushi', closed: 13, open: null, yakuman: true, section: 'yakuman' },
  { id: 'shousuushi', closed: 13, open: null, yakuman: true, section: 'yakuman' },
  { id: 'tsuuiisou', closed: 13, open: null, yakuman: true, section: 'yakuman' },
  { id: 'chinroutou', closed: 13, open: null, yakuman: true, section: 'yakuman' },
  { id: 'ryuuiisou', closed: 13, open: null, yakuman: true, section: 'yakuman' },
  { id: 'suukantsu', closed: 13, open: null, yakuman: true, section: 'yakuman' },
  { id: 'chuuren', closed: 13, open: null, yakuman: true, section: 'yakuman' },
  // dora (han = nº de fichas; no son yaku por sí solos)
  { id: 'dora', closed: 1, open: 1, section: 'dora' },
  { id: 'ura', closed: 1, open: null, section: 'dora' },
  { id: 'aka', closed: 1, open: 1, section: 'dora' },
]
