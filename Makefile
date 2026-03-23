.PHONY: up down shell fmt check cargo-check web-install

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

web-install:
	docker compose run --rm --no-deps dev pnpm install --dir apps/web
