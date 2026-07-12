# Genera los iconos PWA (192/512 + maskable) en public/icons/:
# 咲 en oro sobre fieltro verde oscuro, con anillo dorado.
# Reproducible: powershell -File scripts/make-icons.ps1

Add-Type -AssemblyName System.Drawing

$dst = Join-Path $PSScriptRoot '..\public\icons'
New-Item -ItemType Directory -Force $dst | Out-Null

function Make-Icon([int]$size, [string]$file, [bool]$maskable) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

  # fondo fieltro (radial aproximado con dos capas)
  $g.Clear([System.Drawing.Color]::FromArgb(255, 12, 42, 26)) # #0c2a1a
  $inner = $size * 0.72
  $off = ($size - $inner) / 2
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.RectangleF($off, $off, $inner, $inner)),
    [System.Drawing.Color]::FromArgb(255, 44, 107, 71),  # #2c6b47
    [System.Drawing.Color]::FromArgb(255, 18, 60, 38),   # #123c26
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
  $g.FillEllipse($brush, $off, $off, $inner, $inner)

  # anillo dorado
  $penW = [Math]::Max(2, $size * 0.018)
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 231, 197, 106), $penW)
  $g.DrawEllipse($pen, $off, $off, $inner, $inner)

  # 咲 en oro (la zona segura maskable es el 80% central: el circulo ya cabe)
  $fontSize = [float]($size * 0.34)
  $font = New-Object System.Drawing.Font('Yu Mincho', $fontSize, [System.Drawing.FontStyle]::Bold)
  $gold = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 231, 197, 106))
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF(0, ($size * 0.02), $size, $size)
  # U+54B2 = el kanji del titulo (literal evitado: PS 5.1 lee ANSI sin BOM)
  $g.DrawString([string][char]0x54B2, $font, $gold, $rect, $fmt)

  $g.Dispose()
  $bmp.Save((Join-Path $dst $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output ("{0,-22} {1}x{1}" -f $file, $size)
}

Make-Icon 192 'icon-192.png' $false
Make-Icon 512 'icon-512.png' $false
Make-Icon 512 'icon-maskable-512.png' $true
