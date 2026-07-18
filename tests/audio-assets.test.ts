// Ata el catálogo (src/ui/audio/catalog.ts) al pipeline (build-audio.mjs):
// cada URL que el catálogo puede producir debe existir en public/. Si el
// pipeline no se ha corrido, este test lo delata en vez de fallar en runtime.

import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  MENU_TRACK, GAME_TRACKS, musicUrl, MUSIC_TITLES,
  CLICK_NOTES, sfxClickUrl, type ClickNote,
  VOICED, voiceUrl, type CallKind, TITLE_VOICE_URL,
} from '../src/ui/audio/catalog'
import type { CharacterId } from '../src/ui/characters'

const PUB = join(__dirname, '..', 'public')
const has = (url: string): boolean => existsSync(join(PUB, url))

const CALLS: readonly CallKind[] = ['chi', 'pon', 'kan', 'riichi', 'ron', 'tsumo']

describe('assets de audio (public/{music,sfx,voices})', () => {
  it('existe cada tema de música (menú + 8 de partida)', () => {
    for (const track of [MENU_TRACK, ...GAME_TRACKS]) {
      expect(has(musicUrl(track)), `falta ${musicUrl(track)}`).toBe(true)
    }
  })

  it('MUSIC_TITLES cubre exactamente los temas del catálogo', () => {
    const tracks = [MENU_TRACK, ...GAME_TRACKS].sort()
    expect(Object.keys(MUSIC_TITLES).sort()).toEqual(tracks)
    for (const title of Object.values(MUSIC_TITLES)) {
      expect(title.length).toBeGreaterThan(0)
    }
  })

  it('existe cada nota de click referenciada por los sets de mesa', () => {
    const notes = new Set<ClickNote>(Object.values(CLICK_NOTES).flat())
    expect(notes.size).toBeGreaterThan(0)
    for (const note of notes) {
      expect(has(sfxClickUrl(note)), `falta ${sfxClickUrl(note)}`).toBe(true)
    }
  })

  it('existe el clip de portada (title)', () => {
    expect(has(TITLE_VOICE_URL), `falta ${TITLE_VOICE_URL}`).toBe(true)
  })

  it('cada personaje con voz tiene las 6 llamadas', () => {
    expect(VOICED.size).toBe(12)
    for (const slug of VOICED as ReadonlySet<CharacterId>) {
      for (const call of CALLS) {
        expect(has(voiceUrl(slug, call)), `falta ${voiceUrl(slug, call)}`).toBe(true)
      }
    }
  })
})
