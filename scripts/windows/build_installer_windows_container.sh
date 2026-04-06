#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

command -v docker >/dev/null 2>&1 || {
  echo "Missing required command: docker" >&2
  exit 1
}

DOCKER_OS="$(docker info --format '{{.OSType}}' 2>/dev/null || true)"
if [[ "${DOCKER_OS}" != "windows" ]]; then
  cat >&2 <<'EOF'
Windows MSI build requires Docker running in Windows container mode.
This command cannot run against a Linux Docker daemon.

Run this recipe on:
  - a self-hosted Windows machine with Docker Desktop in Windows container mode
  - or the configured self-hosted GitHub Actions runner

Equivalent PowerShell entrypoint:
  scripts/windows/build_installer_windows_container.ps1
EOF
  exit 1
fi

if command -v pwsh >/dev/null 2>&1; then
  exec pwsh -NoLogo -NoProfile -File "${REPO_ROOT}/scripts/windows/build_installer_windows_container.ps1"
fi

if command -v powershell.exe >/dev/null 2>&1; then
  exec powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "${REPO_ROOT}\\scripts\\windows\\build_installer_windows_container.ps1"
fi

echo "Missing PowerShell host executable (pwsh or powershell.exe)." >&2
exit 1
