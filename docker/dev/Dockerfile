FROM rust:1.86-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV PNPM_HOME=/pnpm
ENV PATH=/root/.cargo/bin:${PNPM_HOME}:${PATH}

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    clang \
    cmake \
    curl \
    git \
    nodejs \
    npm \
    pkg-config \
    python3 \
    python3-dev \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN git config --global --add safe.directory /workspace
RUN npm install -g pnpm@10.8.1

WORKDIR /workspace
