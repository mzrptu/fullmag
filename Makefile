.PHONY: up down shell fmt check cargo-check cargo-test web-install py-install py-test repo-check smoke

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
	docker compose run --rm --no-deps dev python3 -m pip install -e packages/fullmag-py

py-test:
	docker compose run --rm --no-deps dev bash -lc "python3 -m pip install -e packages/fullmag-py && python3 -m unittest discover -s packages/fullmag-py/tests -v"

repo-check:
	docker compose run --rm --no-deps dev python3 scripts/check_repo_consistency.py

smoke:
	docker compose run --rm --no-deps dev bash -lc "python3 -m pip install -e packages/fullmag-py && cargo build -p fullmag-cli && python3 scripts/run_python_ir_smoke.py --cli target/debug/fullmag-cli"
