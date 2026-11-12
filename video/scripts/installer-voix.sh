#!/bin/sh
# Installe la synthèse vocale locale (une fois) : Piper dans .venv-voix/ et la
# voix française fr_FR-siwis-medium dans voix/modele/ (≈ 63 Mo, non versionnée).
# Sources : PyPI (piper-tts) et le dépôt public rhasspy/piper-voices.
set -eu
cd "$(dirname "$0")/.."
if [ ! -x .venv-voix/bin/python ]; then
  python3 -m venv .venv-voix
  .venv-voix/bin/pip install --quiet "piper-tts==1.8.0"
fi
mkdir -p voix/modele
BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium
for f in fr_FR-siwis-medium.onnx fr_FR-siwis-medium.onnx.json MODEL_CARD; do
  [ -s "voix/modele/$f" ] || curl -fsSL -o "voix/modele/$f" "$BASE/$f"
done
echo "Voix prête : voix/modele/fr_FR-siwis-medium.onnx"
