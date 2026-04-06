# escape=`
FROM mcr.microsoft.com/windows/servercore:ltsc2022

SHELL ["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';"]

# --- Chocolatey ---
RUN Set-ExecutionPolicy Bypass -Scope Process -Force; `
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12; `
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# --- Base toolchain (git, node, rust, wix, python, just) ---
RUN choco install -y git nodejs-lts rustup.install wixtoolset python just

# --- MSVC Build Tools (provides link.exe / cl.exe required by Rust MSVC targets) ---
RUN choco install -y visualstudio2022buildtools --package-parameters `
    "'--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --norestart'"

# --- Persist PATH for all subsequent RUN layers and the container entrypoint ---
RUN $newPaths = @( `
      'C:\Users\ContainerAdministrator\.cargo\bin', `
      'C:\Program Files\nodejs', `
      'C:\Program Files (x86)\WiX Toolset v3.11\bin', `
      'C:\ProgramData\chocolatey\bin' `
    ); `
    $pythonDir = (Get-ChildItem 'C:\Python*' -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1); `
    if ($pythonDir) { $newPaths += $pythonDir.FullName; $newPaths += (Join-Path $pythonDir.FullName 'Scripts') }; `
    $current = [Environment]::GetEnvironmentVariable('Path', 'Machine'); `
    $merged = (($newPaths + ($current -split ';')) | Where-Object { $_ } | Select-Object -Unique) -join ';'; `
    [Environment]::SetEnvironmentVariable('Path', $merged, 'Machine')

# --- Global npm packages + cargo-wix ---
RUN cargo --version; `
    rustup --version; `
    npm install -g pnpm; `
    cargo install cargo-wix

WORKDIR C:\workspace\fullmag
