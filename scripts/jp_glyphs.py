# -*- coding: utf-8 -*-
# Lista única de glifos JP que pinta la UI. La consumen subset-jp.py (Kosugi)
# y la validación de build-i18n.mjs. Si añades kanji nuevos a la UI: amplía
# aquí y relanza `npm run assets:fonts`.

GLYPHS = (
    '麻雀トウェルブス'  # título: Mahjong Twelves (麻雀トウェルブス)
    '咲'            # marca 咲 (icono / acentos)
    '東南西北'       # vientos
    '白發中'         # dragones
    '一二三四五六七八九'  # numerales de kyoku
    '局'            # 東一局
    '流途中'         # 流局 / 途中流局
    '搶槓'           # chankan
    'ツモロン'        # katakana de tsumo/ron
    'プレイヤー対戦者'  # selección de personaje (slots)
    'キャラクター選択'  # subtítulo de la pantalla de selección
    'フリー'          # フリー対局
    '対'            # (por si 対局 aparece suelto)
    '親'            # insignia de dealer (oya)
    # i18n: glifos de i18n/strings.csv (las 3 columnas). build-i18n.mjs valida
    # que todo glifo CJK/kana del CSV esté aquí; al añadir textos nuevos, amplía
    # esta entrada y relanza `npm run assets:fonts`.
    'ゥズ・マジチ風設定オディ閉じるダム開始メニュに戻あなたの番捨て牌を鳴きますか？'
    'カ種ポセテ背言語退出続け残り本場位終了再翻符役満荒断聴ノ連打家立直グベッドエアバコ'
    '全体音楽効果ボ自動日発門前清摸和海底月河撈魚嶺上花天地平幺盃口色同順刻気通貫々暗子'
    '混老頭純帯小元国士無双大喜字緑蓮宝燈裏赤跳倍数え不思議ビ代書人シヘザ千夜肖像画つ顔'
    'ハミピナ仲ァ夫編み手糸し切'
    '生時停止曲次ュ解除'  # reproductor de música in-game (music.*)
    'はい'            # confirmación del menú in-game (hud.yes)
    '待表示'          # tira de esperas (hud.waits / hud.show-waits)
    'ち'             # 待ち
    # glosario de yaku (glossary.* + yaku.*.desc)
    '覧状況で宣、点。巡目後以内分最引加されが配第組と外両面使わず揃作だ含む集めもう枚ご算見ら'
    # roster 2026-07-19: Irene (あの女), Ahab (エイハブ船長 / 白鯨)
    '女船長鯨'
    # epítetos de los 12 Movimientos (char.<id>.epithet, columna ja)
    '無限好奇心永遠保存砕二面性共生絆君臨渇非情野盲目執念報復反響鮮烈抗絶対漂流物語超越自律覚'
    'のけたするきなめ'  # hiragana de los epítetos
    # forma alterna de Jekyll: ジキル博士 · ハイド氏 · 解き放たれた影
    '博氏放影'
    # reglamento configurable (settings.rules.*) y fin de partida en hanchan
    '半荘規則長初期棒供託'
    '新消ョ成績喰飛び給原'  # navegación de la portada + cyclers de reglas
    '難易度級'  # cycler de dificultad (難易度 · 初級/中級/上級; 初中上 ya arriba)
    '記録均得銃率高'  # pantalla de estadísticas (stats.*)
)
