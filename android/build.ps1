param(
  [switch]$Release,
  [string]$BitAgentUrl = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$jdkRoot = "D:\Android\jdk-17\jdk-17.0.20+8"
$sdkRoot = "D:\Android\Sdk"
$gradleUserHome = "D:\Android\gradle-user-home"
$gradle = Join-Path $projectRoot "gradlew.bat"

foreach ($required in @(
  (Join-Path $jdkRoot "bin\java.exe"),
  (Join-Path $sdkRoot "platforms\android-36\android.jar"),
  $gradle
)) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "Required Android tool is missing: $required"
  }
}

$env:JAVA_HOME = $jdkRoot
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:GRADLE_USER_HOME = $gradleUserHome
$env:Path = "$jdkRoot\bin;$sdkRoot\platform-tools;$env:Path"

Push-Location $projectRoot
try {
  node .\scripts\verify-project.mjs
  if ($LASTEXITCODE -ne 0) { throw "Android source security verification failed" }

  & $gradle --no-daemon testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest
  if ($LASTEXITCODE -ne 0) { throw "Android debug verification failed" }

  & .\scripts\verify-apk.ps1
  if ($LASTEXITCODE -ne 0) { throw "Android APK security verification failed" }

  if ($Release) {
    if ([string]::IsNullOrWhiteSpace($BitAgentUrl)) {
      throw "-Release requires an HTTPS origin or http://127.0.0.1:8787"
    }
    # AGP 9.2 creates unit-test tasks only for debug in this project. The common JVM tests
    # already ran above; release still gets its own lint, R8, resource shrink, and APK build.
    & $gradle --no-daemon lintRelease assembleRelease "-PbitagentUrl=$BitAgentUrl"
    if ($LASTEXITCODE -ne 0) { throw "Android release verification failed" }
  }
} finally {
  Pop-Location
}
