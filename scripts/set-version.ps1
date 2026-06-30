param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidatePattern('^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$')]
  [string]$Version
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Content
  )

  [System.IO.File]::WriteAllText($Path, $Content, $script:utf8NoBom)
}

function Update-RegexVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Pattern,
    [Parameter(Mandatory = $true)]
    [string]$Replacement
  )

  $content = Get-Content -Raw -Encoding UTF8 $Path
  $content = [regex]::Replace($content, $Pattern, $Replacement, 1)
  Write-Utf8NoBom -Path $Path -Content $content
}

Update-RegexVersion `
  -Path (Join-Path $repoRoot "package.json") `
  -Pattern '("version"\s*:\s*)".+?"' `
  -Replacement "`${1}`"$Version`""

Update-RegexVersion `
  -Path (Join-Path $repoRoot "ui\package.json") `
  -Pattern '("version"\s*:\s*)".+?"' `
  -Replacement "`${1}`"$Version`""

Update-RegexVersion `
  -Path (Join-Path $repoRoot "src-tauri\tauri.conf.json") `
  -Pattern '("version"\s*:\s*)".+?"' `
  -Replacement "`${1}`"$Version`""

Update-RegexVersion `
  -Path (Join-Path $repoRoot "src-tauri\Cargo.toml") `
  -Pattern '(?m)^version = ".+?"' `
  -Replacement "version = `"$Version`""

Update-RegexVersion `
  -Path (Join-Path $repoRoot "backend\pyproject.toml") `
  -Pattern '(?m)^version = ".+?"' `
  -Replacement "version = `"$Version`""

Write-Host "Version synchronized to $Version"
