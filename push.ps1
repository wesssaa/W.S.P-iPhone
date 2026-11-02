# Zet de map iphone\ als één commit op GitHub (wesssaa/W.S.P-iPhone), zonder git: via de GitHub-API.
# De repo wordt precies gelijk aan deze map (wat hier weg is, verdwijnt ook daar). Daarna bouwt GitHub Actions de .ipa.
# Gebruik:  .\iphone\push.ps1 -Message "Wat er veranderd is"   (met -Tag v0.1.0 ook een release)
param(
  [string]$Message = 'Bijgewerkt',
  [string]$Tag = '',
  [string]$Repo = 'wesssaa/W.S.P-iPhone'
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path $PSScriptRoot).Path
$gh = 'gh'
$tmp = Join-Path ([IO.Path]::GetTempPath()) 'ichthus-push.json'

function Api($method, $path, $body) {
  if ($body) {
    [IO.File]::WriteAllText($tmp, ($body | ConvertTo-Json -Depth 6 -Compress), (New-Object Text.UTF8Encoding $false))
    $r = & $gh api -X $method $path --input $tmp
  } else { $r = & $gh api -X $method $path }
  if ($LASTEXITCODE -ne 0) { throw "GitHub-API mislukt: $method $path" }
  $r | ConvertFrom-Json
}

$head = Api GET "repos/$Repo/git/ref/heads/main"
$parent = $head.object.sha

$tree = @()
Get-ChildItem $root -Recurse -File -Force | ForEach-Object {
  $rel = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
  $blob = Api POST "repos/$Repo/git/blobs" @{ content = [Convert]::ToBase64String([IO.File]::ReadAllBytes($_.FullName)); encoding = 'base64' }
  $tree += @{ path = $rel; mode = '100644'; type = 'blob'; sha = $blob.sha }
}
$t = Api POST "repos/$Repo/git/trees" @{ tree = $tree }
$c = Api POST "repos/$Repo/git/commits" @{ message = $Message; tree = $t.sha; parents = @($parent) }
Api PATCH "repos/$Repo/git/refs/heads/main" @{ sha = $c.sha } | Out-Null
"Commit $($c.sha.Substring(0, 7)) staat op main ($($tree.Count) bestanden)"

if ($Tag) {
  Api POST "repos/$Repo/git/refs" @{ ref = "refs/tags/$Tag"; sha = $c.sha } | Out-Null
  "Tag $Tag gemaakt: GitHub bouwt nu de release"
}
"Bekijk de build: https://github.com/$Repo/actions"
