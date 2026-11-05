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

# 2. iconen: het C.R.H-logo op zwart of wit (gemaakt door app\art\make-icons.ps1)
Add-Type -AssemblyName System.Drawing
$cat = Join-Path $here 'IchthusPlus\Assets.xcassets'
New-Item -ItemType Directory -Force $cat | Out-Null
'{"info":{"author":"xcode","version":1}}' | Set-Content "$cat\Contents.json" -Encoding ascii

# iOS wil app-iconen zonder doorzichtigheid: daarom overzetten naar 24-bits
function Save-Icon($set, $src) {
  $dir = "$cat\$set.appiconset"
  New-Item -ItemType Directory -Force $dir | Out-Null
  $img = [System.Drawing.Image]::FromFile((Resolve-Path $src))
  $bmp = New-Object System.Drawing.Bitmap 1024, 1024, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.DrawImage($img, 0, 0, 1024, 1024)
  $g.Dispose(); $img.Dispose()
  $bmp.Save("$dir\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  '{"images":[{"filename":"icon.png","idiom":"universal","platform":"ios","size":"1024x1024"}],"info":{"author":"xcode","version":1}}' | Set-Content "$dir\Contents.json" -Encoding ascii
}

# zelfde vier als op Android: standaard = witte letters op zwart, Kaal = zwart op wit, Zwart = goud op zwart, Wit = goud op wit
Save-Icon 'AppIcon' "$app\art\crh-ios-zwart.png"
Save-Icon 'AppIcon-Kaal' "$app\art\crh-ios-wit.png"
Save-Icon 'AppIcon-Zwart' "$app\art\crh-ios-goudzwart.png"
Save-Icon 'AppIcon-Wit' "$app\art\crh-ios-goudwit.png"

# 3. opstartscherm: het zwarte C.R.H-vierkant op de achtergrondkleur van het witte thema
$ls = "$cat\LaunchMark.imageset"
New-Item -ItemType Directory -Force $ls | Out-Null
Copy-Item "$app\art\crh-launch.png" "$ls\mark.png" -Force
'{"images":[{"filename":"mark.png","idiom":"universal","scale":"3x"}],"info":{"author":"xcode","version":1}}' | Set-Content "$ls\Contents.json" -Encoding ascii
$lc = "$cat\LaunchBackground.colorset"
New-Item -ItemType Directory -Force $lc | Out-Null
# licht: achtergrond van het witte thema; staat de iPhone op donker, dan die van het zwarte thema (geen witte flits)
'{"colors":[{"color":{"color-space":"srgb","components":{"red":"0xF3","green":"0xF1","blue":"0xEC","alpha":"1.000"}},"idiom":"universal"},{"appearances":[{"appearance":"luminosity","value":"dark"}],"color":{"color-space":"srgb","components":{"red":"0x0D","green":"0x0C","blue":"0x0A","alpha":"1.000"}},"idiom":"universal"}],"info":{"author":"xcode","version":1}}' | Set-Content "$lc\Contents.json" -Encoding ascii

'Klaar: web-bestanden en iconen bijgewerkt'
