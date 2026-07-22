// Ata HAS_CUT_IN (src/ui/cut-in.ts) al pipeline (scripts/bake-portraits.ps1):
// quien esté en el set debe tener sus 3 viñetas horneadas en public/. El arte
// llega por tandas, así que estar incompleto NO es el fallo — el fallo es
// declarar a alguien sin haber corrido el horneado, que en runtime sería una
// imagen rota en mitad de un cut-in.

import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { HAS_CUT_IN, EXPRESSION, cutInUrl, type Expression } from '../src/ui/cut-in'
import { CHARACTERS } from '../src/ui/characters'
import type { CallKind } from '../src/ui/audio/catalog'

const PUB = join(__dirname, '..', 'public')
const has = (url: string): boolean => existsSync(join(PUB, url))

const CALLS: readonly CallKind[] = ['chi', 'pon', 'kan', 'riichi', 'ron', 'tsumo']
const EXPRS: readonly Expression[] = ['fierce', 'sharp']

describe('assets de cut-in (public/portraits/{id}-cut-{expr}.jpg)', () => {
  it('cada personaje declarado tiene sus 2 expresiones horneadas', () => {
    for (const id of HAS_CUT_IN) {
      for (const expr of EXPRS) {
        expect(has(cutInUrl(id, expr)), `falta ${cutInUrl(id, expr)}`).toBe(true)
      }
    }
  })

  it('EXPRESSION cubre los 6 cantos y solo usa expresiones conocidas', () => {
    for (const call of CALLS) {
      expect(EXPRS).toContain(EXPRESSION[call])
    }
    expect(Object.keys(EXPRESSION).sort()).toEqual([...CALLS].sort())
  })

  it('los ids declarados son del roster (o hyde)', () => {
    const known = new Set<string>([...CHARACTERS.map((c) => c.id), 'hyde'])
    for (const id of HAS_CUT_IN) {
      expect(known.has(id), `${id} no es un personaje ni hyde`).toBe(true)
    }
  })

  it('quien NO está declarado no rompe: cae al retrato 9:16', () => {
    // el fallback existe para todos, que es lo que sostiene el arte por tandas
    for (const c of CHARACTERS) {
      expect(has(`portraits/${c.id}.jpg`), `falta el retrato de ${c.id}`).toBe(true)
    }
    expect(has('portraits/hyde.jpg')).toBe(true)
  })
})
