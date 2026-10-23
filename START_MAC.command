#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo "Не найден Python 3. Установите Python 3 и повторите запуск."
  read -r -p "Нажмите Enter... " _
  exit 1
fi
if [[ ! -s assets/vision_bundle.mjs || ! -s assets/hand_landmarker.task ]]; then
  echo "Файлы распознавания не найдены. Для игры с камерой сначала выполните SETUP_MAC.command."
  echo "Играть мышью можно и без этих файлов."
  read -r -p "Нажмите Enter для продолжения... " _
fi
(sleep 1; open 'http://localhost:8767') &
python3 server.py
