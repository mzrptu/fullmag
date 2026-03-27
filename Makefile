.PHONY: up down shell fmt check cargo-check cargo-test web-install web-build-static py-install py-test repo-check smoke install-cli install-cli-dev show-cli-path control-room control-room-stop fem-gpu-build fem-gpu-shell fem-gpu-check fem-gpu-test fem-gpu-native-test

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

web-build-static:
	@set -e; \
	if command -v pnpm >/dev/null 2>&1; then \
		PNPM_CMD="pnpm"; \
	elif command -v corepack >/dev/null 2>&1; then \
		PNPM_CMD="corepack pnpm"; \
	else \
		echo "Neither pnpm nor corepack is available on PATH." >&2; \
		exit 127; \
	fi; \
	if [ ! -d "apps/web/node_modules" ] && [ ! -d "node_modules" ]; then \
		$$PNPM_CMD install --dir apps/web; \
	fi; \
	rm -rf apps/web/out .fullmag/local/web.new; \
	$$PNPM_CMD --dir apps/web build; \
	mkdir -p .fullmag/local; \
	cp -a apps/web/out .fullmag/local/web.new; \
	touch .fullmag/local/web.new/.build-stamp; \
	rm -rf .fullmag/local/web; \
	mv .fullmag/local/web.new .fullmag/local/web; \
	echo "Installed static control room:"; \
	echo "  $(PWD)/.fullmag/local/web"

py-install:
	docker compose run --rm --no-deps dev bash -lc "python3 -m venv .venv && . .venv/bin/activate && pip install -e 'packages/fullmag-py[meshing]'"

py-test:
	docker compose run --rm --no-deps dev bash -lc "python3 -m venv .venv && . .venv/bin/activate && pip install -e 'packages/fullmag-py[meshing]' && python -m unittest discover -s packages/fullmag-py/tests -v"

repo-check:
	docker compose run --rm --no-deps dev python3 scripts/check_repo_consistency.py

smoke:
	docker compose run --rm --no-deps dev bash -lc "python3 -m venv .venv && . .venv/bin/activate && pip install -e 'packages/fullmag-py[meshing]' && /usr/local/cargo/bin/cargo build -p fullmag-cli --bin fullmag && python scripts/run_python_ir_smoke.py --cli target/debug/fullmag"

install-cli: INSTALL_STATIC_WEB=1
install-cli-dev: INSTALL_STATIC_WEB=0

install-cli install-cli-dev:
	mkdir -p .fullmag/local
	@set -e; \
	if [ -x "/usr/local/cuda/bin/nvcc" ] && [ -x "$$HOME/.local/bin/cmake" ]; then \
		echo "Installing Rust launcher with CUDA support..."; \
		FULLMAG_CMAKE="$$HOME/.local/bin/cmake" CARGO_TARGET_DIR=.fullmag/target cargo +nightly build -p fullmag-cli --release --features cuda; \
		FULLMAG_CMAKE="$$HOME/.local/bin/cmake" CARGO_TARGET_DIR=.fullmag/target cargo +nightly build -p fullmag-api --release --features cuda; \
		mkdir -p .fullmag/local/lib; \
		src_dir=$$(find .fullmag/target -path '*native-build/backends/fdm' -type d | head -n 1); \
		if [ -n "$$src_dir" ]; then cp -a $$src_dir/libfullmag_fdm.so* .fullmag/local/lib/; fi; \
	else \
		echo "Installing Rust launcher without CUDA support..."; \
		CARGO_TARGET_DIR=.fullmag/target cargo +nightly build -p fullmag-cli --release; \
		CARGO_TARGET_DIR=.fullmag/target cargo +nightly build -p fullmag-api --release; \
	fi
	@mkdir -p .fullmag/local/bin
	@cp .fullmag/target/release/fullmag .fullmag/local/bin/fullmag-bin.new
	@mv -f .fullmag/local/bin/fullmag-bin.new .fullmag/local/bin/fullmag-bin
	@cp .fullmag/target/release/fullmag-api .fullmag/local/bin/fullmag-api.new
	@mv -f .fullmag/local/bin/fullmag-api.new .fullmag/local/bin/fullmag-api
	@printf '%s\n' '#!/usr/bin/env bash' \
		'SELF_DIR="$$(cd "$$(dirname "$$0")" && pwd)"' \
		'export LD_LIBRARY_PATH="$$SELF_DIR/../lib$${LD_LIBRARY_PATH:+:$$LD_LIBRARY_PATH}"' \
		'exec "$$SELF_DIR/fullmag-bin" "$$@"' \
		> .fullmag/local/bin/fullmag
	@chmod +x .fullmag/local/bin/fullmag
	@if [ "$(INSTALL_STATIC_WEB)" = "1" ]; then $(MAKE) web-build-static; fi
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

fem-gpu-build:
	docker compose --profile fem-gpu build fem-gpu

fem-gpu-shell:
	docker compose --profile fem-gpu run --rm fem-gpu bash

fem-gpu-check:
	docker compose --profile fem-gpu run --rm --no-deps fem-gpu bash -lc "FULLMAG_USE_MFEM_STACK=ON cargo +nightly check -p fullmag-runner -p fullmag-cli -p fullmag-api --features 'fem-gpu cuda'"

fem-gpu-test:
	docker compose --profile fem-gpu run --rm --no-deps fem-gpu bash -lc "FULLMAG_USE_MFEM_STACK=ON cargo +nightly test -p fullmag-runner --features fem-gpu native_fem -- --nocapture"

fem-gpu-native-test:
	docker compose --profile fem-gpu run --rm --no-deps fem-gpu bash -lc "FULLMAG_USE_MFEM_STACK=ON cargo +nightly test -p fullmag-runner --features fem-gpu native_fem::tests::native_fem_exchange_only_matches_cpu_reference_when_mfem_stack_is_available -- --nocapture"
