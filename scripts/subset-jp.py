# -*- coding: utf-8 -*-
# Recorta Kosugi a los glifos JP que usa el juego y lo emite como woff2.
# Entrada: raw/font/_kosugi-full.ttf (la baja fetch-fonts.mjs; insumo
# intermedio fuera de public/ para que no acabe en dist/).
# Salida:  public/fonts/kosugi-subset.woff2
#
# Cobertura: kana completo (margen para UI futura) + puntuación CJK + los
# glifos de jp_glyphs.py. Verificación dura: Kosugi es la ÚNICA fuente JP del
# juego (no hay fallback), así que el script FALLA si algún glifo pedido en
# GLYPHS no acaba en el woff2 — sea porque el subset lo perdió o porque Kosugi
# no lo trae de fábrica.
#
# Uso: python scripts/subset-jp.py  (parte de `npm run assets:fonts`)

import io
import os
import sys

from fontTools.subset import main as subset
from fontTools.ttLib import TTFont

from jp_glyphs import GLYPHS

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'raw', 'font', '_kosugi-full.ttf')
DST = os.path.join(HERE, '..', 'public', 'fonts', 'kosugi-subset.woff2')

# Rangos además de GLYPHS: puntuación CJK y kana completo.
UNICODES = ','.join([
    'U+3000-3002',   # espacio ideográfico 、 。
    'U+300C-300D',   # 「 」
    'U+30FB-30FC',   # ・ ー
    'U+3041-3096',   # hiragana
    'U+30A1-30FA',   # katakana
])

if not os.path.exists(SRC):
    sys.exit('no existe %s — lánzalo con: node scripts/fetch-fonts.mjs' % SRC)

subset([
    SRC,
    '--unicodes=%s' % UNICODES,
    '--text=%s' % GLYPHS,
    '--flavor=woff2',
    '--output-file=%s' % DST,
    '--layout-features=',       # sin features OpenType: solo formas
    '--no-hinting',
    '--desubroutinize',
])

# --- verificación dura del cmap ------------------------------------------------

out_cmap = TTFont(DST).getBestCmap()

missing = sorted({ord(c) for c in GLYPHS} - set(out_cmap))
if missing:
    sys.exit('FALTAN en el subset (Kosugi no tiene fallback JP): %s'
             % ' '.join('%s(U+%04X)' % (chr(cp), cp) for cp in missing))

size = os.path.getsize(DST)
print('kosugi-subset.woff2  %.1f KB  (%d glifos pedidos)'
      % (size / 1024.0, len(set(GLYPHS))))
