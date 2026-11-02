#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p assets/wasm
BASE="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21"
download() {
  echo "Загружаю $2"
  curl --fail --location --retry 2 --connect-timeout 15 --output "$2.tmp" "$1" || { rm -f "$2.tmp"; echo "Ошибка загрузки $2. Проверьте подключение к интернету."; exit 1; }
  test -s "$2.tmp" || { echo "Ошибка: пустой файл $2"; exit 1; }
  mv "$2.tmp" "$2"
}
download "$BASE/vision_bundle.mjs" assets/vision_bundle.mjs
for name in vision_wasm_internal.js vision_wasm_internal.wasm vision_wasm_nosimd_internal.js vision_wasm_nosimd_internal.wasm; do
  download "$BASE/wasm/$name" "assets/wasm/$name"
done
download "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task" assets/hand_landmarker.task
echo "Готово: файлы распознавания загружены. Теперь можно запускать START_MAC.command без интернета."
read -r -p "Нажмите Enter для выхода... " _
