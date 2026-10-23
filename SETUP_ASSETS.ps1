$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force -Path 'assets\wasm' | Out-Null
$files = @(
  @('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs', 'assets\vision_bundle.mjs'),
  @('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/vision_wasm_internal.js', 'assets\wasm\vision_wasm_internal.js'),
  @('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/vision_wasm_internal.wasm', 'assets\wasm\vision_wasm_internal.wasm'),
  @('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/vision_wasm_nosimd_internal.js', 'assets\wasm\vision_wasm_nosimd_internal.js'),
  @('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/vision_wasm_nosimd_internal.wasm', 'assets\wasm\vision_wasm_nosimd_internal.wasm'),
  @('https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', 'assets\hand_landmarker.task')
)
foreach ($item in $files) {
  Write-Host "Downloading $($item[1]) ..."
  Invoke-WebRequest -Uri $item[0] -OutFile $item[1] -UseBasicParsing
}
Write-Host 'Готово. Теперь можно запускать START.bat. После установки интернет не нужен.' -ForegroundColor Green
Read-Host 'Press Enter to exit'
