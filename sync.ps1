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

# 1b. demo met voorbeeldgegevens (de preview), alleen voor de simulator-build: testen zonder in te loggen.
#     app.js zet de iPhone-app er zelf in, dus het script-label van de preview eruit.
New-Item -ItemType Directory -Force "$here\demo" | Out-Null
$demo = (Get-Content "$app\..\preview\index.html" -Raw -Encoding utf8) -replace '<script src="/app/assets/app.js"></script>', ''
[IO.File]::WriteAllText("$here\demo\demo.html", $demo, (New-Object Text.UTF8Encoding $false))

# 2. iconen: de W.S.P-munt op zwart of wit (gemaakt door app\art\make-icons.ps1)
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

# standaard = zwart (net als op Android); de oude namen blijven, zodat een gekozen icoon blijft werken
Save-Icon 'AppIcon' "$app\art\wsp-ios-zwart.png"
Save-Icon 'AppIcon-Zwart' "$app\art\wsp-ios-zwart.png"
Save-Icon 'AppIcon-Kaal' "$app\art\wsp-ios-wit.png"
Save-Icon 'AppIcon-Wit' "$app\art\wsp-ios-wit.png"

# 3. opstartscherm: de munt op de achtergrondkleur van het witte thema
$ls = "$cat\LaunchMark.imageset"
New-Item -ItemType Directory -Force $ls | Out-Null
Copy-Item "$app\art\wsp-launch.png" "$ls\mark.png" -Force
'{"images":[{"filename":"mark.png","idiom":"universal","scale":"3x"}],"info":{"author":"xcode","version":1}}' | Set-Content "$ls\Contents.json" -Encoding ascii
$lc = "$cat\LaunchBackground.colorset"
New-Item -ItemType Directory -Force $lc | Out-Null
'{"colors":[{"color":{"color-space":"srgb","components":{"red":"0xF3","green":"0xF1","blue":"0xEC","alpha":"1.000"}},"idiom":"universal"}],"info":{"author":"xcode","version":1}}' | Set-Content "$lc\Contents.json" -Encoding ascii

'Klaar: web-bestanden en iconen bijgewerkt'
