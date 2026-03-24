.PHONY: up down shell fmt check cargo-check cargo-test web-install py-install py-test repo-check smoke install-cli show-cli-path control-room control-room-stop

up:
	docker compose up -d postgres minio nats dev

down:
	docker compose down

shell:
	docker compose exec dev bash

fmt:
	docker compose exec dev cargo fmt --all

check:
	docker compose exec dev cargo check --workspace

cargo-check:
	docker compose run --rm --no-deps dev cargo check --workspace

cargo-test:
	docker compose run --rm --no-deps dev cargo test --workspace

web-install:
	docker compose run --rm --no-deps dev pnpm install --dir apps/web

py-install:
	docker compose run --rm --no-deps dev bash -lc "python3 -m venv .venv && . .venv/bin/activate && pip install -e packages/fullmag-py"

py-test:
	docker compose run --rm --no-deps dev bash -lc "python3 -m venv .venv && . .venv/bin/activate && pip install -e packages/fullmag-py && python -m unittest discover -s packages/fullmag-py/tests -v"

repo-check:
	docker compose run --rm --no-deps dev python3 scripts/check_repo_consistency.py

smoke:
	docker compose run --rm --no-deps dev bash -lc "python3 -m venv .venv && . .venv/bin/activate && pip install -e packages/fullmag-py && /usr/local/cargo/bin/cargo build -p fullmag-cli --bin fullmag && python scripts/run_python_ir_smoke.py --cli target/debug/fullmag"

install-cli:
	mkdir -p .fullmag/local
	@if [ -x "/usr/local/cuda/bin/nvcc" ] && [ -x "$$HOME/.local/bin/cmake" ]; then \
		echo "Installing Rust launcher with CUDA support..."; \
		FULLMAG_CMAKE="$$HOME/.local/bin/cmake" CARGO_TARGET_DIR=.fullmag/target cargo +nightly install --path crates/fullmag-cli --root .fullmag/local --force --features cuda; \
		mkdir -p .fullmag/local/lib; \
		src_dir=$$(find .fullmag/target -path '*native-build/backends/fdm' -type d | head -n 1); \
		if [ -n "$$src_dir" ]; then cp -a $$src_dir/libfullmag_fdm.so* .fullmag/local/lib/; fi; \
	else \
		echo "Installing Rust launcher without CUDA support..."; \
		CARGO_TARGET_DIR=.fullmag/target cargo +nightly install --path crates/fullmag-cli --root .fullmag/local --force; \
	fi
	@mv .fullmag/local/bin/fullmag .fullmag/local/bin/fullmag-bin
	@printf '%s\n' '#!/usr/bin/env bash' \
		'SELF_DIR="$$(cd "$$(dirname "$$0")" && pwd)"' \
		'export LD_LIBRARY_PATH="$$SELF_DIR/../lib$${LD_LIBRARY_PATH:+:$$LD_LIBRARY_PATH}"' \
		'exec "$$SELF_DIR/fullmag-bin" "$$@"' \
		> .fullmag/local/bin/fullmag
	@chmod +x .fullmag/local/bin/fullmag
	@echo ""
	@echo "Installed repo-local launcher:"
	@echo "  $(PWD)/.fullmag/local/bin/fullmag"
	@echo ""
	@echo "Add it to PATH for this shell:"
	@echo "  export PATH=\"$(PWD)/.fullmag/local/bin:\$$PATH\""

show-cli-path:
	@echo "$(PWD)/.fullmag/local/bin/fullmag"

control-room:
	./scripts/dev-control-room.sh

control-room-stop:
	./scripts/stop-control-room.sh
