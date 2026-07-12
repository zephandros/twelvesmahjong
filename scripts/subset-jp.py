# -*- coding: utf-8 -*-
# Recorta Noto Serif JP a los glifos que usa el juego y lo emite como woff2.
# Entrada: public/fonts/_noto-serif-jp-full.ttf (la baja fetch-fonts.mjs).
# Salida:  public/fonts/noto-serif-jp-subset.woff2 (~10 KB).
# Uso: python scripts/subset-jp.py

import os
from fontTools.subset import main as subset

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', 'public', 'fonts')

# Todos los glifos JP que pinta la UI. Si añades kanji nuevos, amplía y relanza.
GLYPHS = (
    '咲'            # título
    '東南西北'       # vientos
    '白發中'         # dragones
    '一二三四五六七八九'  # numerales de kyoku
    '局'            # 東一局
    '流途中'         # 流局 / 途中流局
    '搶槓'           # chankan
    'ツモロン'        # katakana de tsumo/ron
    'プレイヤー対戦者'  # selección de personaje
    'フリー'          # フリー対局
    '対'            # (por si 対局 aparece suelto)
)

src = os.path.join(FONTS, '_noto-serif-jp-full.ttf')
dst = os.path.join(FONTS, 'noto-serif-jp-subset.woff2')

subset([
    src,
    '--text=%s' % GLYPHS,
    '--flavor=woff2',
    '--output-file=%s' % dst,
    '--layout-features=',       # sin features OpenType: solo formas
    '--no-hinting',
    '--desubroutinize',
])

size = os.path.getsize(dst)
print('noto-serif-jp-subset.woff2  %.1f KB  (%d glifos pedidos)' % (size / 1024.0, len(set(GLYPHS))))
