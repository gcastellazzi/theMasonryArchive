#!/usr/bin/env bash
# Avvia il sito in locale con il pannello Admin: bash tools/dev.sh
#
# Usa il Node.js di sistema se c'e'; altrimenti quello che Hermes porta con se'
# in ~/.hermes/tools (sul portatile dei bot non ce n'e' un altro). Servono
# Node.js >= 22.13 e le dipendenze in node_modules (npm ci la prima volta).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! command -v npm >/dev/null 2>&1; then
  hermes_node=$(ls -d "$HOME"/.hermes/tools/node-*/bin 2>/dev/null | sort -V | tail -1 || true)
  if [[ -z "$hermes_node" ]]; then
    echo "Node.js non trovato: installalo (>= 22.13) oppure installa Hermes." >&2
    exit 1
  fi
  export PATH="$hermes_node:$PATH"
fi

[[ -d node_modules ]] || npm ci
exec npm run dev
