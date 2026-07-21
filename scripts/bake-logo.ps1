# Hornea el logo de marca de raw/logo a public/: favicons, iconos PWA e imagen
# social (Open Graph). Salidas:
#   public/favicon.ico                     (32x32, el que pide el navegador solo)
#   public/icons/favicon-16.png, -32.png   (declarados en index.html)
#   public/icons/icon-192.png, icon-512.png        (manifest PWA)
#   public/icons/icon-maskable-512.png     (emblema al 72% sobre el fondo del
#                                           logo: cabe en la zona segura del 80%
#                                           que recortan los lanzadores Android)
#   public/icons/apple-touch-icon-180.png  (iOS; opaco, no admite transparencia)
#   public/og/cover.jpg                    (1200x630, tarjeta de X/Facebook/etc.)
# El banner clasico es 2.39:1 y la tarjeta social 1.91:1: se escala por alto y se
# RECORTA centrado (rellenar arriba/abajo dejaria costura sobre su degradado).
# Reproducible: powershell -File scripts/bake-logo.ps1   (npm run assets:logo)

Add-Type -AssemblyName System.Drawing

$src = Join-Path $PSScriptRoot '..\raw\logo'
$pub = Join-Path $PSScriptRoot '..\public'
$icons = Join-Path $pub 'icons'
$og = Join-Path $pub 'og'
New-Item -ItemType Directory -Force $icons | Out-Null
New-Item -ItemType Directory -Force $og | Out-Null

function Report([string]$path, [string]$note) {
  $f = Get-Item $path
  Write-Output ("{0,-34} {1,8:n0} B  {2}" -f $f.Name, $f.Length, $note)
}

function Copy-Asset([string]$from, [string]$to) {
  $inPath = Join-Path $src $from
  if (-not (Test-Path $inPath)) { throw "falta raw/logo/$from" }
  Copy-Item $inPath $to -Force
  Report $to "<- $from"
}

# --- copias directas (ya vienen al tamano correcto desde raw/) ---------------
Copy-Asset 'favicon.ico'   (Join-Path $pub 'favicon.ico')
Copy-Asset 'favicon-16.png' (Join-Path $icons 'favicon-16.png')
Copy-Asset 'favicon-32.png' (Join-Path $icons 'favicon-32.png')
Copy-Asset 'logo-192.png'  (Join-Path $icons 'icon-192.png')
Copy-Asset 'logo-512.png'  (Join-Path $icons 'icon-512.png')

$logo = [System.Drawing.Image]::FromFile((Join-Path $src 'logo-512.png'))
try {
  # --- maskable: el emblema encogido sobre su propio fondo ------------------
  # El fondo del logo es un degradado vertical casi negro (muestreado en las
  # esquinas: #0F0B07 arriba, #0B0805 abajo); replicarlo hace invisible la union.
  $size = 512
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.RectangleF(0, 0, $size, $size)),
    [System.Drawing.Color]::FromArgb(255, 0x0F, 0x0B, 0x07),
    [System.Drawing.Color]::FromArgb(255, 0x0B, 0x08, 0x05),
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
  $g.FillRectangle($bg, 0, 0, $size, $size)
  # 72%: la ficha frontal (el contenido critico) queda dentro del circulo seguro
  # de diametro 80%; solo las dos fichas del abanico asoman, y son decorativas.
  $inner = [int]($size * 0.72)
  $off = [int](($size - $inner) / 2)
  $g.DrawImage($logo, $off, $off, $inner, $inner)
  $g.Dispose()
  $out = Join-Path $icons 'icon-maskable-512.png'
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Report $out "<- logo-512.png al 72% (zona segura)"

  # --- apple-touch-icon: simple reescalado ---------------------------------
  $w = 180
  $bmp = New-Object System.Drawing.Bitmap($w, $w)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($logo, 0, 0, $w, $w)
  $g.Dispose()
  $out = Join-Path $icons 'apple-touch-icon-180.png'
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Report $out '<- logo-512.png'
} finally { $logo.Dispose() }

# --- imagen social: banner escalado por alto y recortado al centro ----------
$banner = [System.Drawing.Image]::FromFile((Join-Path $src 'banner-classic-1600x670.png'))
try {
  $ow = 1200; $oh = 630
  $scaled = [int][Math]::Round($banner.Width * ($oh / $banner.Height)) # 1600x670 -> 1504x630
  $bmp = New-Object System.Drawing.Bitmap($ow, $oh)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($banner, [int](($ow - $scaled) / 2), 0, $scaled, $oh)
  $g.Dispose()
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq 'image/jpeg' }
  $params = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
    [System.Drawing.Imaging.Encoder]::Quality, [long]90)
  $out = Join-Path $og 'cover.jpg'
  $bmp.Save($out, $codec, $params)
  $bmp.Dispose()
  Report $out "<- banner-classic recortado a ${ow}x${oh}"
} finally { $banner.Dispose() }
