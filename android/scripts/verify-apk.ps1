param(
  [string]$ApkPath = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$sdkRoot = "D:\Android\Sdk"
$jdkRoot = "D:\Android\jdk-17\jdk-17.0.20+8"
$aapt = Join-Path $sdkRoot "build-tools\36.0.0\aapt.exe"
$apksigner = Join-Path $sdkRoot "build-tools\36.0.0\apksigner.bat"
$jar = Join-Path $jdkRoot "bin\jar.exe"

if ([string]::IsNullOrWhiteSpace($ApkPath)) {
  $ApkPath = Join-Path $projectRoot "app\build\outputs\apk\debug\app-debug.apk"
}

foreach ($required in @($ApkPath, $aapt, $apksigner, $jar)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "APK verification input is missing: $required"
  }
}

$apk = (Resolve-Path -LiteralPath $ApkPath).Path
$env:JAVA_HOME = $jdkRoot

$badging = (& $aapt dump badging $apk) -join "`n"
if ($LASTEXITCODE -ne 0) { throw "aapt badging inspection failed" }
$permissionDump = (& $aapt dump permissions $apk) -join "`n"
if ($LASTEXITCODE -ne 0) { throw "aapt permission inspection failed" }
$entries = @(& $jar tf $apk)
if ($LASTEXITCODE -ne 0) { throw "APK entry inspection failed" }

$packageMatch = [regex]::Match($badging, "package: name='([^']+)'")
if (-not $packageMatch.Success) { throw "APK package name is missing" }
$packageName = $packageMatch.Groups[1].Value

foreach ($expected in @(
  "compileSdkVersion='36'",
  "sdkVersion:'24'",
  "targetSdkVersion:'36'",
  "launchable-activity: name='org.tradelayer.mobile.MainActivity'"
)) {
  if (-not $badging.Contains($expected)) { throw "APK badging is missing: $expected" }
}

$permissions = [regex]::Matches($permissionDump, "uses-permission: name='([^']+)'") |
  ForEach-Object { $_.Groups[1].Value } |
  Sort-Object -Unique
$expectedPermissions = @(
  "android.permission.INTERNET",
  "com.termux.permission.RUN_COMMAND",
  "$packageName.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"
) | Sort-Object
if (($permissions -join "`n") -ne ($expectedPermissions -join "`n")) {
  throw "Unexpected APK permissions: $($permissions -join ', ')"
}

$requiredEntries = @(
  "assets/mobile/agent-unavailable.html",
  "assets/tlweb/index.html",
  "assets/tlweb/mobile-overrides.css",
  "assets/tlweb/tlweb-package-manifest.json"
)
foreach ($entry in $requiredEntries) {
  if ($entries -notcontains $entry) { throw "Required APK asset is missing: $entry" }
}
if (-not ($entries | Where-Object { $_ -match '^assets/tlweb/main-[A-Z0-9]+\.js$' })) {
  throw "The packaged TL Web main bundle is missing"
}
foreach ($entry in $entries) {
  if ($entry.EndsWith(".map") -or
      $entry.EndsWith(".gguf") -or
      $entry.EndsWith(".safetensors") -or
      $entry.EndsWith("adapter_model.bin") -or
      $entry.StartsWith("assets/tlweb/assets/algos/tl/") -or
      $entry -match '^assets/tlweb/assets/algos/(manifest|package|package-lock)\.json$') {
    throw "Forbidden TL Web artifact entered the APK: $entry"
  }
}

& $apksigner verify --verbose $apk | Out-Null
if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed" }

$file = Get-Item -LiteralPath $apk
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $apk).Hash
[pscustomobject]@{
  ok = $true
  schema = "tradelayer_mobile_apk_security_v1"
  apk = $file.FullName
  bytes = $file.Length
  sha256 = $hash
  package = $packageName
  compileSdk = 36
  targetSdk = 36
  minSdk = 24
  permissions = $permissions
  bundledEntries = $entries.Count
  modelBundled = $false
} | ConvertTo-Json -Depth 4
