# -*- coding: utf-8 -*-
# Recorta Noto Serif JP a los glifos que usa el juego y lo emite como woff2.
# Entrada: raw/font/_noto-serif-jp-full.ttf (la baja fetch-fonts.mjs; insumo
# intermedio fuera de public/ para que no acabe en dist/).
# Salida:  public/fonts/noto-serif-jp-subset.woff2 (~10 KB).
# Uso: python scripts/subset-jp.py  (parte de `npm run assets:fonts`)

import os
from fontTools.subset import main as subset

from jp_glyphs import GLYPHS  # lista única compartida con subset-murecho.py

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', 'public', 'fonts')

src = os.path.join(HERE, '..', 'raw', 'font', '_noto-serif-jp-full.ttf')
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
