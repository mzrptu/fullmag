#!/usr/bin/env bash
set -euo pipefail

declare -A PKG_LABELS=(
  [pango]="libpango1.0-dev"
  [gdk-pixbuf-2.0]="libgdk-pixbuf-2.0-dev"
  [atk]="libatk1.0-dev"
  [gtk+-3.0]="libgtk-3-dev"
  [webkit2gtk-4.1]="libwebkit2gtk-4.1-dev"
  [libsoup-3.0]="libsoup-3.0-dev"
)

missing=0

echo "Linux desktop dependency check"
echo "=============================="
for pkg in pango gdk-pixbuf-2.0 atk gtk+-3.0 webkit2gtk-4.1 libsoup-3.0; do
  if pkg-config --exists "$pkg"; then
    echo "ok  $pkg"
  else
    echo "miss $pkg  (Ubuntu package: ${PKG_LABELS[$pkg]})"
    missing=1
  fi
done

if [[ "$missing" -eq 1 ]]; then
  cat <<'EOF'

Suggested host install command on Ubuntu/Debian:
  sudo apt-get update && sudo apt-get install -y \
    libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
    librsvg2-dev libgdk-pixbuf-2.0-dev libatk1.0-dev libpango1.0-dev libsoup-3.0-dev

Alternative:
  just build-desktop-container
EOF
  exit 1
fi

echo
echo "All required pkg-config desktop dependencies are present."
