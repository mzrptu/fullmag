#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_ROOT="${REPO_ROOT}/.fullmag/dist"
BUNDLE_NAME="fullmag-linux-x86_64-portable"
BUNDLE_ROOT="${DIST_ROOT}/${BUNDLE_NAME}"
VERSION_JSON="${BUNDLE_ROOT}/share/version.json"

require_file() {
  local path="$1"
  [[ -e "$path" ]] || {
    echo "Missing required path: $path" >&2
    exit 1
  }
}

require_tool() {
  local tool="$1"
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Missing required tool: $tool" >&2
    exit 1
  }
}

require_file "${BUNDLE_ROOT}"
require_file "${VERSION_JSON}"
require_tool python3

MAKESELF_BIN="${MAKESELF_BIN:-$(command -v makeself || true)}"
MAKESELF_HEADER="${MAKESELF_HEADER:-}"

if [[ -z "${MAKESELF_BIN}" ]]; then
  echo "Missing required tool: makeself" >&2
  exit 1
fi
if [[ -n "${MAKESELF_HEADER}" ]]; then
  require_file "${MAKESELF_HEADER}"
fi

VERSION="$(python3 - <<'PY' "${VERSION_JSON}"
import json, sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text())
print(payload.get("git_short") or payload.get("built_at_utc") or "0.1.0-preprod")
PY
)"

INSTALLER_ROOT="${DIST_ROOT}/installer-linux"
PAYLOAD_ROOT="${INSTALLER_ROOT}/payload"
RUN_PATH="${DIST_ROOT}/fullmag-${VERSION}-linux-x86_64.run"

rm -rf "${INSTALLER_ROOT}"
mkdir -p "${PAYLOAD_ROOT}"
tar -C "${BUNDLE_ROOT}" -cf - . | tar -C "${PAYLOAD_ROOT}" -xf -

cat > "${PAYLOAD_ROOT}/install.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

DEFAULT_PREFIX="${HOME}/.local/fullmag"
read -r -p "Installation directory [${DEFAULT_PREFIX}]: " PREFIX
PREFIX="${PREFIX:-$DEFAULT_PREFIX}"
mkdir -p "${PREFIX}"

cp -a bin lib python web packages runtimes examples share README.md .fullmag "${PREFIX}/"

if [[ -f "${PREFIX}/share/fullmag.desktop" ]]; then
  sed -i "s|__INSTALL_PREFIX__|${PREFIX}|g" "${PREFIX}/share/fullmag.desktop"
fi

cat > "${PREFIX}/uninstall.sh" <<UNEOF
#!/usr/bin/env bash
set -euo pipefail
rm -rf "${PREFIX}"
echo "Removed ${PREFIX}"
UNEOF
chmod +x "${PREFIX}/uninstall.sh"

echo
echo "Fullmag installed to ${PREFIX}"
echo "Add to PATH:"
echo "  export PATH=\"${PREFIX}/bin:\$PATH\""
echo
echo "Run:"
echo "  ${PREFIX}/bin/fullmag ui"
EOF
chmod +x "${PAYLOAD_ROOT}/install.sh"

rm -f "${RUN_PATH}"
MAKESELF_ARGS=(--zstd)
if [[ -n "${MAKESELF_HEADER}" ]]; then
  MAKESELF_ARGS+=(--header "${MAKESELF_HEADER}")
fi
"${MAKESELF_BIN}" \
  "${MAKESELF_ARGS[@]}" \
  "${PAYLOAD_ROOT}" \
  "${RUN_PATH}" \
  "Fullmag ${VERSION} Installer" \
  ./install.sh

echo "Created Linux installer:"
echo "  ${RUN_PATH}"
