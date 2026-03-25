#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_ROOT="${REPO_ROOT}/.fullmag/dist/fullmag-host"

mkdir -p "${DIST_ROOT}"
rm -rf "${DIST_ROOT}/bin" "${DIST_ROOT}/lib" "${DIST_ROOT}/runtimes"

if [[ ! -x "${REPO_ROOT}/.fullmag/local/bin/fullmag" ]]; then
  echo "Missing local launcher. Run 'just build fullmag' first." >&2
  exit 1
fi

mkdir -p "${DIST_ROOT}/bin" "${DIST_ROOT}/lib"
cp -a "${REPO_ROOT}/.fullmag/local/bin/fullmag" "${DIST_ROOT}/bin/"
cp -a "${REPO_ROOT}/.fullmag/local/bin/fullmag-bin" "${DIST_ROOT}/bin/"

if [[ -d "${REPO_ROOT}/.fullmag/local/lib" ]]; then
  cp -a "${REPO_ROOT}/.fullmag/local/lib/." "${DIST_ROOT}/lib/"
fi

if [[ -d "${REPO_ROOT}/.fullmag/runtimes/fem-gpu-host" ]]; then
  mkdir -p "${DIST_ROOT}/runtimes"
  cp -a "${REPO_ROOT}/.fullmag/runtimes/fem-gpu-host" "${DIST_ROOT}/runtimes/"
fi

cat > "${DIST_ROOT}/README.md" <<EOF
# Fullmag host package staging directory

This directory is a host-side packaging/staging artifact.

Contents:

- \`bin/fullmag\` — public launcher wrapper
- \`bin/fullmag-bin\` — launcher binary
- \`lib/\` — colocated runtime libraries needed by the local launcher path
- optional \`runtimes/fem-gpu-host/\` — exported heavy managed runtime bundle

Run with:

\`\`\`bash
export PATH="${DIST_ROOT}/bin:\$PATH"
fullmag examples/py_layer_hole_relax_150nm.py --until 5e-10
\`\`\`
EOF

echo "Created host package staging directory:"
echo "  ${DIST_ROOT}"
