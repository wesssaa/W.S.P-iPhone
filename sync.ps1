# Haalt app.js, lettertypes en plaatjes uit de Android-app (..\app) en maakt de iPhone-iconen.
# Gebruik:  .\iphone\sync.ps1
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$app = Join-Path $here '..\app' | Resolve-Path

# 1. dezelfde web-bestanden als op Android
$web = Join-Path $here 'web'
New-Item -ItemType Directory -Force "$web\fonts", "$web\themes" | Out-Null
Copy-Item "$app\assets\app.js" $web -Force
Copy-Item "$app\assets\fonts\*.woff2" "$web\fonts" -Force
Copy-Item "$app\assets\themes\*.png", "$app\assets\themes\*.svg", "$app\assets\themes\*.mp3" "$web\themes" -Force

# 2. iconen: voorgrond en achtergrond van de Android-iconen, het midden op 1024 px
Add-Type -AssemblyName System.Drawing
$cat = Join-Path $here 'IchthusPlus\Assets.xcassets'
New-Item -ItemType Directory -Force $cat | Out-Null
'{"info":{"author":"xcode","version":1}}' | Set-Content "$cat\Contents.json" -Encoding ascii

function Save-Icon($set, [System.Drawing.Image[]]$layers, [bool]$crop) {
  $dir = "$cat\$set.appiconset"
  New-Item -ItemType Directory -Force $dir | Out-Null
  $bmp = New-Object System.Drawing.Bitmap 1024, 1024, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'HighQuality'; $g.PixelOffsetMode = 'HighQuality'
  foreach ($l in $layers) {
    if ($crop) {
      $m = $l.Width / 9  # iets meer dan het zichtbare midden van Android (72 van 108 dp), zodat de vis niet tegen de rand zit
      $src = New-Object System.Drawing.RectangleF $m, $m, ($l.Width - 2 * $m), ($l.Height - 2 * $m)
    } else { $src = New-Object System.Drawing.RectangleF 0, 0, $l.Width, $l.Height }
    $g.DrawImage($l, (New-Object System.Drawing.RectangleF 0, 0, 1024, 1024), $src, 'Pixel')
  }
  $g.Dispose()
  $bmp.Save("$dir\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  '{"images":[{"filename":"icon.png","idiom":"universal","platform":"ios","size":"1024x1024"}],"info":{"author":"xcode","version":1}}' | Set-Content "$dir\Contents.json" -Encoding ascii
}
function Img($p) { [System.Drawing.Image]::FromFile((Resolve-Path $p)) }

# standaard = zwart zonder tekst (net als op Android)
foreach ($v in @(@('AppIcon', 'zwartkaal'), @('AppIcon-Kaal', 'kaal'), @('AppIcon-Zwart', 'zwart'))) {
  $bg = Img "$app\art\v-$($v[1])-bg-xxxhdpi.png"; $fg = Img "$app\art\v-$($v[1])-fg-xxxhdpi.png"
  Save-Icon $v[0] @($bg, $fg) $true
  $bg.Dispose(); $fg.Dispose()
}
$wit = Img "$app\art\icon-512.png"; Save-Icon 'AppIcon-Wit' @($wit) $false; $wit.Dispose()

# 3. opstartscherm: het visje op de achtergrondkleur van het witte thema
$ls = "$cat\LaunchMark.imageset"
New-Item -ItemType Directory -Force $ls | Out-Null
Copy-Item "$app\res\drawable-xxxhdpi\splash_logo_light.png" "$ls\mark.png" -Force
'{"images":[{"filename":"mark.png","idiom":"universal","scale":"3x"}],"info":{"author":"xcode","version":1}}' | Set-Content "$ls\Contents.json" -Encoding ascii
$lc = "$cat\LaunchBackground.colorset"
New-Item -ItemType Directory -Force $lc | Out-Null
'{"colors":[{"color":{"color-space":"srgb","components":{"red":"0xF3","green":"0xF1","blue":"0xEC","alpha":"1.000"}},"idiom":"universal"}],"info":{"author":"xcode","version":1}}' | Set-Content "$lc\Contents.json" -Encoding ascii

'Klaar: web-bestanden en iconen bijgewerkt'
