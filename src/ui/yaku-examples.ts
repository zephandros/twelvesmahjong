// Manos de ejemplo del glosario. Datos escritos a mano PERO certificados por el
// motor: tests/yaku-examples.test.ts pasa cada mano por scoreWin() y exige que
// el yaku ilustrado aparezca (trampa 3 de CLAUDE.md: la vista nunca inventa
// yaku). Solo yaku de forma y yakuman llevan ejemplo; los situacionales y la
// dora no dependen de la forma de la mano. Módulo puro (sin DOM): lo importan
// la UI y los tests.

import type { Tile34 } from '../core/tile'
import { parseHand } from '../core/tile'
import type { YakuId } from '../core/yaku'

export interface YakuExample {
  readonly id: YakuId
  /**
   * Grupos separados por espacio en notación compacta ('123m', '55z').
   * Sufijo '*' = grupo resaltado; si NINGÚN grupo lleva '*', se resalta la mano
   * entera. Un grupo de 4 fichas iguales ('1111m') es un ankan (meld cerrado
   * en el test, hueco propio al pintarlo). Total: 14 fichas + 1 por ankan.
   */
  readonly hand: string
  /** Ficha ganadora; debe existir en `hand` (el test la separa como winTile). */
  readonly win: string
  /** Solo si el yaku exige tsumo (suuankou tanki). Default: ron. */
  readonly tsumo?: true
}

export interface ExampleGroup {
  readonly tiles: readonly Tile34[]
  readonly highlight: boolean
  readonly kan: boolean
}

/** Expande la notación de una mano de ejemplo a grupos pintables. */
export function parseExample(e: YakuExample): readonly ExampleGroup[] {
  const anyStar = e.hand.includes('*')
  return e.hand.split(/\s+/).filter(Boolean).map((g) => {
    const starred = g.endsWith('*')
    const tiles = parseHand(starred ? g.slice(0, -1) : g)
    return {
      tiles,
      highlight: anyStar ? starred : true,
      kan: tiles.length === 4 && tiles.every((t) => t === tiles[0]),
    }
  })
}

/** Contexto del test (y de la lectura): ron, asiento Sur, ronda Este. */
export const YAKU_EXAMPLES: ReadonlyMap<YakuId, YakuExample> = new Map(
  ([
    // --- forma ---------------------------------------------------------------
    { id: 'pinfu', hand: '234m 567m 234p 567s 88p', win: '7s' },
    { id: 'tanyao', hand: '234m 456m 567p 678s 55s', win: '4m' },
    { id: 'iipeiko', hand: '223344m* 567p 789s 99s', win: '4m' },
    { id: 'ryanpeiko', hand: '223344m* 667788p* 55s', win: '8p' },
    { id: 'yakuhai-haku', hand: '234m 567p 678s 99m 555z*', win: '4m' },
    { id: 'yakuhai-hatsu', hand: '234m 567p 678s 99m 666z*', win: '4m' },
    { id: 'yakuhai-chun', hand: '234m 567p 678s 99m 777z*', win: '4m' },
    { id: 'yakuhai-seat', hand: '345m 456p 678s 99p 222z*', win: '5m' },
    { id: 'yakuhai-round', hand: '345m 456p 678s 99p 111z*', win: '5m' },
    { id: 'sanshoku', hand: '234m* 234p* 234s* 678m 88p', win: '4p' },
    { id: 'sanshoku-doukou', hand: '333m* 333p* 333s* 456p 99s', win: '3s' },
    { id: 'ittsu', hand: '123m* 456m* 789m* 345s 22p', win: '3s' },
    { id: 'toitoi', hand: '222m* 555p* 777s* 888s* 33p', win: '8s' },
    { id: 'sanankou', hand: '222m* 888p* 555s* 567m 99p', win: '5m' },
    { id: 'sankantsu', hand: '1111m* 5555p* 9999s* 234s 88p', win: '3s' },
    { id: 'honroutou', hand: '111m 999p 111s 999s 22z', win: '9s' },
    { id: 'junchan', hand: '123m 789m 123p 999s 11s', win: '2p' },
    { id: 'chanta', hand: '123m 789p 123s 444z 99m', win: '2m' },
    { id: 'shousangen', hand: '234m 567s 555z* 666z* 77z*', win: '4m' },
    { id: 'honitsu', hand: '123m 345m 678m 99m 444z', win: '6m' },
    { id: 'chinitsu', hand: '123p 345p 567p 789p 99p', win: '9p' },
    { id: 'chiitoi', hand: '11m 33m 55p 77s 99s 22z 44z', win: '5p' },
    // --- yakuman (tenhou/chiihou no: son situacionales) ----------------------
    { id: 'kokushi', hand: '19m 19p 19s 1234567z 1z', win: '1z' },
    { id: 'suuankou', hand: '222m* 999m* 555p* 777s* 33s', win: '3s', tsumo: true },
    { id: 'daisangen', hand: '234m 88s 555z* 666z* 777z*', win: '4m' },
    { id: 'daisuushi', hand: '55m 111z* 222z* 333z* 444z*', win: '4z' },
    { id: 'shousuushi', hand: '567s 111z* 222z* 333z* 44z*', win: '7s' },
    { id: 'tsuuiisou', hand: '111z 333z 555z 666z 77z', win: '6z' },
    { id: 'chinroutou', hand: '111m 999m 111p 999s 99p', win: '9s' },
    { id: 'ryuuiisou', hand: '234s 234s 666s 888s 66z', win: '6z' },
    { id: 'suukantsu', hand: '1111m* 5555p* 9999s* 3333z* 22m', win: '2m' },
    { id: 'chuuren', hand: '11122345678999m', win: '2m' },
  ] satisfies readonly YakuExample[]).map((e) => [e.id, e]),
)
