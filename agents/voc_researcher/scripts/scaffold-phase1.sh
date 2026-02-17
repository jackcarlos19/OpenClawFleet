#!/usr/bin/env bash

set -euo pipefail

# Phase 1 environment foundation directories from BLUEPRINT.md
ROOT_DIR="${1:-.}"

DIRS=(
  "prompts"
  "data"
  "insights"
  "briefs"
  "logs"
  "docs"
)

for dir in "${DIRS[@]}"; do
  mkdir -p "${ROOT_DIR}/${dir}"
done

echo "Created Phase 1 directories under ${ROOT_DIR}:"
for dir in "${DIRS[@]}"; do
  echo "- ${dir}/"
done
