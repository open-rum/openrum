.DEFAULT_GOAL := help

.PHONY: help bootstrap dev build test typecheck format lint check workspace go-workspace compose-config compose-up compose-down

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "; printf "OpenRUM development commands:\n\n"} /^[a-zA-Z_-]+:.*## / {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

bootstrap: ## Install JavaScript workspace dependencies
	pnpm install

dev: ## Start the web console in development mode
	pnpm run dev

build: ## Build every workspace package that exposes a build script
	pnpm run build

test: ## Run every workspace package test script
	pnpm run test

typecheck: ## Type-check every workspace package
	pnpm run typecheck

format: ## Format frontend, protocol, configuration, and Go source files
	pnpm run format

lint: ## Lint frontend and vet Go source files
	pnpm run lint

check: ## Run the complete local CI quality gate
	pnpm run check

workspace: ## List JavaScript workspace packages
	pnpm run workspace:list

go-workspace: ## Validate the Go workspace file
	go work edit -json >/dev/null

compose-config: ## Validate the local dependency Compose configuration
	docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml config --quiet

compose-up: ## Start local dependencies and wait for health checks
	docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml up -d --wait

compose-down: ## Stop local dependencies without deleting data volumes
	docker compose --env-file deploy/compose/.env.example -f deploy/compose/docker-compose.yml down
