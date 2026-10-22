// Códigos de sala (src/net/codes.ts). El cliente los sortea y las reglas de la
// sala impiden pisar uno vivo; lo que se ata aquí es el alfabeto (dictable por
// voz) y que no se repitan en una tanda razonable.

import { describe, it, expect } from 'vitest'
import { newRoomCode, isRoomCode, CODE_LENGTH } from '../src/net/codes'

describe('código de sala', () => {
  it('tiene la longitud fijada y solo usa el alfabeto sin ambigüedades', () => {
    for (let i = 0; i < 200; i++) {
      const code = newRoomCode()
      expect(code).toHaveLength(CODE_LENGTH)
      // fuera I, O, 0 y 1: se dictan por voz sin equivocarse
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/)
      expect(isRoomCode(code)).toBe(true)
    }
  })

  it('rechaza lo que no es un código', () => {
    expect(isRoomCode('')).toBe(false)
    expect(isRoomCode('ABC')).toBe(false) // corto
    expect(isRoomCode('ABCDEFG')).toBe(false) // largo
    expect(isRoomCode('ABCDE0')).toBe(false) // cero, fuera del alfabeto
    expect(isRoomCode('abcdef')).toBe(false) // minúsculas (la UI normaliza antes)
  })

  it('no se repite en una tanda razonable', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 2000; i++) seen.add(newRoomCode())
    expect(seen.size).toBe(2000)
  })
})
