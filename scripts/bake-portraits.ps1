# Hornea los retratos de Resources/Portraits a public/portraits/:
#   {id}.jpg   (720 px de ancho, pantalla de victoria)
#   {id}-t.jpg (264 px de ancho, retratos de esquina y selección)
# Los PNG originales (~1.4 MB c/u) son demasiado pesados para la PWA.
# Reproducible: powershell -File scripts/bake-portraits.ps1

Add-Type -AssemblyName System.Drawing

$src = 'D:\Proyectos\Twelves\Resources\Portraits'
$dst = Join-Path $PSScriptRoot '..\public\portraits'
New-Item -ItemType Directory -Force $dst | Out-Null

# id => patrón del nombre de archivo (se toma la PRIMERA variante que case;
# para cambiar de variante, poner aquí el nombre completo del archivo)
$roster = [ordered]@{
  alice     = '*Alice_Liddell*'
  bartleby  = '*Bartleby*'
  cyrano    = '*Cyrano*'
  dante     = '*Dante_Alighieri*'
  dorian    = '*Dorian_Gray*'
  jekyll    = '*Dr._Jekyll*'
  dracula   = '*Dracula*'
  hamlet    = '*Hamlet*'
  huck      = '*Huckleberry_Finn*'
  celestina = '*La_Celestina*'
  defarge   = '*Madame_Defarge*'
  pinocchio = '*Pinocchio*'
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

foreach ($id in $roster.Keys) {
  $file = Get-ChildItem (Join-Path $src $roster[$id]) | Sort-Object Name | Select-Object -First 1
  if (-not $file) { Write-Warning "sin retrato para $id"; continue }
  Resize-Jpeg $file.FullName (Join-Path $dst "$id.jpg") 720 85
  Resize-Jpeg $file.FullName (Join-Path $dst "$id-t.jpg") 264 80
  $big = (Get-Item (Join-Path $dst "$id.jpg")).Length
  $thumb = (Get-Item (Join-Path $dst "$id-t.jpg")).Length
  Write-Output ("{0,-10} {1,7:n0} B + {2,6:n0} B  <- {3}" -f $id, $big, $thumb, $file.Name)
}
