# Host entry point for the Docker workflow — needs only `make` + `docker compose`.
# npm is never required on the host; it runs only inside the container.
#
#   make build           build the image (first run, and after dep changes)
#   make test            run the Vitest suite in a container
#   make dev             start the app at http://localhost:3000 (hot reload)
#
# See README "Docker local testing" for details.

.DEFAULT_GOAL := help
.PHONY: help build dev test test-coverage typecheck lint shell down

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

build: ## Build the Docker image (re-run after package-lock.json changes)
	docker compose build

dev: ## Start the app at http://localhost:3000 with hot reload (needs .env.local)
	docker compose up dev

test: ## Run the Vitest suite in a container (no .env.local needed)
	docker compose run --rm test

test-coverage: ## Run tests + v8 coverage report
	docker compose run --rm test npm run test:coverage

typecheck: ## Run tsc --noEmit in a container
	docker compose run --rm test npm run typecheck

lint: ## Run ESLint in a container
	docker compose run --rm test npm run lint

shell: ## Open a shell inside the container for debugging
	docker compose run --rm test bash

down: ## Stop and remove the dev container
	docker compose down
