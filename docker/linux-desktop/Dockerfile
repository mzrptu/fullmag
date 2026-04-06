FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    build-essential \
    binutils \
    curl \
    git \
    just \
    jq \
    makeself \
    pkg-config \
    ripgrep \
    libgtk-3-dev \
    libwebkit2gtk-4.1-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    patchelf \
    ca-certificates \
    nodejs \
    npm \
    python3 \
    python3-dev \
    python3-venv \
    python3-pip \
    zstd \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

RUN curl https://sh.rustup.rs -sSf | bash -s -- -y --profile minimal --default-toolchain stable
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /workspace/fullmag
