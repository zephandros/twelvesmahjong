// Muro amañado vía onBuildWall — dogfooding del sistema de habilidades.
// Compartido por flow.test.ts y bot.test.ts.
//
// deal() toma: dead = tiles[0..13]; live = tiles[14..]; las manos se reparten
// desde el FINAL (seat0 las últimas 13, luego seat1…); los robos hacen pop del
// final del vivo restante → el primer robo es tiles[83], el segundo tiles[82]…

import type { TileId } from '../src/core/tile'
import { parseTile, TILEID_COUNT } from '../src/core/tile'
import type { Seat } from '../src/core/seat'
import type { Ability } from '../src/core/hooks'
import { initHand, type HandState } from '../src/core/state'

const AKA_TYPES = new Set([4, 13, 22])

export function makeIdAssigner() {
  const next: Record<number, number> = {}
  const used = new Set<TileId>()
  return {
    used,
    parse(notation: string): TileId[] {
      const out: TileId[] = []
      let digits = ''
      for (const ch of notation) {
        if (ch >= '0' && ch <= '9') { digits += ch; continue }
        for (const d of digits) {
          let id: TileId
          if (d === '0') {
            id = parseTile(`0${ch}`) << 2
          } else {
            const t = parseTile(`${d}${ch}`)
            const k = next[t] ?? (AKA_TYPES.has(t) ? 1 : 0)
            if (k > 3) throw new Error(`rig: más de 4 copias de ${d}${ch}`)
            id = (t << 2) | k
            next[t] = k + 1
          }
          if (used.has(id)) throw new Error(`rig: id ${id} repetido`)
          used.add(id)
          out.push(id)
        }
        digits = ''
      }
      return out
    },
  }
}

export interface RigSpec {
  /** 4 manos de 13 fichas. */
  hands: [string, string, string, string]
  /** Robos en orden (el primero es el del oya). */
  draws: string[]
  /** Muro muerto completo (14) — imprescindible si se asertan yaku/fu. */
  dead?: string
}

export function rig(spec: RigSpec): Ability {
  const a = makeIdAssigner()
  const hands = spec.hands.map((h) => {
    const ids = a.parse(h)
    if (ids.length !== 13) throw new Error(`rig: mano de ${ids.length} fichas`)
    return ids
  })
  const draws = spec.draws.flatMap((d) => a.parse(d))
  const dead = spec.dead ? a.parse(spec.dead) : []
  if (spec.dead && dead.length !== 14) throw new Error('rig: dead debe tener 14')

  const filler: TileId[] = []
  for (let id = 0; id < TILEID_COUNT; id++) if (!a.used.has(id)) filler.push(id)

  const tiles = new Array<TileId>(TILEID_COUNT)
  for (let i = 0; i < 14; i++) tiles[i] = dead[i] ?? filler.pop()!
  for (let i = 0; i < draws.length; i++) tiles[83 - i] = draws[i]!
  for (let i = 14; i <= 83 - draws.length; i++) tiles[i] = filler.pop()!
  const handBase = [123, 110, 97, 84]
  hands.forEach((h, s) => h.forEach((id, i) => { tiles[handBase[s]! + i] = id }))
  return { onBuildWall: () => tiles }
}

/** Arranca una mano amañada (la habilidad de rig se cuelga del asiento 0). */
export function start(spec: RigSpec, dealer: Seat = 0): { s: HandState; ab: { 0: Ability } } {
  const ab = { 0: rig(spec) }
  return { s: initHand(1, dealer, ab), ab }
}

// manos basura auditadas (sin honores, sin pinzu, nunca tenpai)
export const JUNK1 = '112244m778899s2s'
export const JUNK2 = '335566m1335666s'
export const JUNK3 = '224477s7788m999m'

// mano tenpai clásica: espera 1p/4p, con ittsu como yaku de respaldo
export const HERO = '123456789m1234p'
