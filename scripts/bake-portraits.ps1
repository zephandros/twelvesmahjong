# Hornea los retratos de raw/portraits a public/portraits/. Cada personaje trae
# tres artes por aspecto ({base}_9_16 / _1_1 / _3_4.png) que salen como:
#   {id}.jpg      (9:16, 720 px de ancho, pantalla de victoria)
#   {id}-t.jpg    (9:16, 264 px de ancho, paneles de esquina del tablero)
#   {id}-sq.jpg   (1:1,  320 px, tarjetas de la rejilla de selección)
#   {id}-seat.jpg (3:4,  480 px, marcos de asiento de la selección)
# Los PNG originales (~1.4 MB c/u) son demasiado pesados para la PWA.
# Reproducible: powershell -File scripts/bake-portraits.ps1

Add-Type -AssemblyName System.Drawing

$src = Join-Path $PSScriptRoot '..\raw\portraits'
$dst = Join-Path $PSScriptRoot '..\public\portraits'
New-Item -ItemType Directory -Force $dst | Out-Null

# id => base del nombre de archivo en raw/portraits (roster 2026-07-19); a cada
# base se le añade el sufijo de aspecto (_9_16/_1_1/_3_4). La UI recorta con
# object-fit: cover, aquí solo se reescala por ancho.
$roster = [ordered]@{
  alice     = 'alice_portrait'
  irene     = 'irene_portrait'
  scheherazade = 'scheherezade_portrait'
  dorian    = 'dorian_portrait'
  jekyll    = 'jekyll_portrait'
  dracula   = 'dracula_portrait'
  macbeth   = 'macbeth_portrait'
  huck      = 'huckleberry_portrait'
  celestina = 'celestina_portrait'
  defarge   = 'defarge_portrait'
  pinocchio = 'pinocchio_portrait'
  ahab      = 'ahab_portrait'
}

function Resize-Jpeg([string]$inPath, [string]$outPath, [int]$targetW, [int]$quality) {
  $img = [System.Drawing.Image]::FromFile($inPath)
  try {
    $w = [Math]::Min($targetW, $img.Width)
    $h = [int][Math]::Round($img.Height * ($w / $img.Width))
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($img, 0, 0, $w, $h)
    $g.Dispose()
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
      Where-Object { $_.MimeType -eq 'image/jpeg' }
    $params = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
      [System.Drawing.Imaging.Encoder]::Quality, [long]$quality)
    $bmp.Save($outPath, $codec, $params)
    $bmp.Dispose()
  } finally { $img.Dispose() }
}

# variante de aspecto => lista de salidas (sufijo del jpg, ancho, calidad).
# La coma inicial evita que PowerShell aplane las listas de un solo elemento.
$variants = [ordered]@{
  '9_16' = @(('', 720, 85), ('-t', 264, 80))
  '1_1'  = , ('-sq', 320, 80)
  '3_4'  = , ('-seat', 480, 80)
}

function Bake([string]$id, [string]$inPath, [object[]]$outs) {
  $sizes = foreach ($o in $outs) {
    $suffix, $w, $q = $o
    $outPath = Join-Path $dst "$id$suffix.jpg"
    Resize-Jpeg $inPath $outPath $w $q
    '{0,7:n0} B' -f (Get-Item $outPath).Length
  }
  Write-Output ("{0,-14} {1}  <- {2}" -f $id, ($sizes -join ' + '), (Split-Path $inPath -Leaf))
}

foreach ($id in $roster.Keys) {
  foreach ($aspect in $variants.Keys) {
    $file = Join-Path $src "$($roster[$id])_$aspect.png"
    if (-not (Test-Path $file)) { Write-Warning "sin retrato ${aspect} para $id"; continue }
    Bake $id $file $variants[$aspect]
  }
}

# hyde no es un personaje: es el arte alterno de Jekyll durante su riichi.
# Solo existe en 9:16 (paneles del tablero y pantalla de victoria).
Bake 'hyde' (Join-Path $src 'jekyll_hyde_portrait.png') $variants['9_16']

# --- viñetas de cut-in (2:1, una por expresión) --------------------------------
# Se acepta el SLUG canónico o la base de $roster sin `_portrait`, porque los dos
# nombres conviven en raw/ (`alice_cut_*` pero `scheherezade_cut_*`, con la z del
# resto de sus archivos). Probar ambas evita renombrados y sorpresas con huck.
# El arte llega por tandas, así que faltar NO es un error: cut-in.ts cae al
# retrato 9:16 para quien no la tenga (ver HAS_CUT_IN). Se listan las que faltan
# al final para que se vea el avance de un vistazo.
$cutExprs = @('fierce', 'sharp')
$cutIds = @($roster.Keys) + 'hyde'
$cutDone = 0
$cutMissing = @()

foreach ($id in $cutIds) {
  # bases candidatas: el slug y, si difiere, la de $roster sin `_portrait`
  $bases = @($id)
  if ($roster.Contains($id)) {
    $alt = $roster[$id] -replace '_portrait$', ''
    if ($alt -ne $id) { $bases += $alt }
  }
  foreach ($expr in $cutExprs) {
    $file = $bases | ForEach-Object { Join-Path $src "${_}_cut_${expr}.png" } |
      Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $file) { $cutMissing += "$id/$expr"; continue }
    Bake $id $file @(, ("-cut-$expr", 760, 82))
    $cutDone++
  }
}

$cutTotal = $cutIds.Count * $cutExprs.Count
Write-Output ''
Write-Output ("cut-ins: {0}/{1} horneados" -f $cutDone, $cutTotal)
if ($cutMissing.Count -gt 0) {
  Write-Output ("  faltan: {0}" -f ($cutMissing -join ', '))
}
