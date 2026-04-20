SHELL := /bin/sh

.DEFAULT_GOAL := help

# Apfelstrudel - Bun-based live coding music environment with AI agent
#
# IMPORTANT: Always use `make <target>` instead of invoking bun directly.
# This ensures reproducibility and consistent behavior across environments.
#
# See `make help` for available targets.

BUN ?= bun
PORT ?= 3000

.PHONY: help
help: ## Show targets
	@grep -E '^[a-zA-Z0-9_.-]+:.*?##' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "%-18s %s\n", $$1, $$2}'

# =============================================================================
# Dependency install
# =============================================================================

.PHONY: install
install: ## Install project dependencies
	$(BUN) install

.PHONY: install-dev
install-dev: install ## Install dev dependencies (same as install for bun)

# =============================================================================
# Development
# =============================================================================

.PHONY: dev
dev: build-client-dev ## Start development server with hot reload
	$(BUN) run dev

.PHONY: start
start: build-client-dev ## Start production server (debug bundle)
	$(BUN) run start

.PHONY: build
build: build-client ## Build for production
	$(BUN) run build

.PHONY: build-client
build-client: vendor ## Bundle frontend TypeScript to public/app.js
	$(BUN) build src/client/app.ts \
	  --outdir public \
	  --entry-naming app.js \
	  --target browser \
	  --format esm \
	  --packages=external \
	  --minify \
	  --sourcemap \
	  --external:@strudel/web \
	  --external:@strudel/mini \
	  --external:@strudel/webaudio \
	  --external:@strudel/core \
	  --external:@strudel/draw \
	  --external:@strudel/codemirror \
	  --external:preact \
	  --external:preact/hooks \
	  --external:htm

.PHONY: build-client-dev
build-client-dev: vendor ## Bundle frontend TypeScript (unminified, with sourcemaps)
	$(BUN) build src/client/app.ts \
	  --outdir public \
	  --entry-naming app.js \
	  --target browser \
	  --format esm \
	  --packages=external \
	  --sourcemap=inline \
	  --no-minify \
	  --define DEV=true \
	  --external:@strudel/web \
	  --external:@strudel/mini \
	  --external:@strudel/webaudio \
	  --external:@strudel/core \
	  --external:@strudel/draw \
	  --external:@strudel/codemirror \
	  --external:preact \
	  --external:preact/hooks \
	  --external:htm

# =============================================================================
# Quality
# =============================================================================

.PHONY: lint
lint: ## Run linters (biome)
	$(BUN) run lint

.PHONY: format
format: ## Format code (biome)
	$(BUN) run format

.PHONY: typecheck
typecheck: ## Run TypeScript type checking
	$(BUN) run typecheck

.PHONY: test
test: ## Run tests
	$(BUN) test

.PHONY: test-watch
test-watch: ## Run tests in watch mode
	$(BUN) test --watch

.PHONY: coverage
coverage: ## Run tests with coverage
	$(BUN) test --coverage

.PHONY: check
check: lint typecheck test ## Run full validation pipeline

# =============================================================================
# Cleanup
# =============================================================================

.PHONY: clean
clean: ## Remove build artifacts and caches
	rm -rf dist/ .turbo/ node_modules/.cache/

.PHONY: clean-all
clean-all: clean ## Remove all generated files including node_modules
	rm -rf node_modules/ bun.lockb

# =============================================================================
# Vendor frontend dependencies
# =============================================================================

VENDOR_DIR := public/vendor

.PHONY: vendor
vendor: ## Build and vendor frontend dependencies from local node_modules
	@echo "Vendoring frontend dependencies..."
	@mkdir -p $(VENDOR_DIR)/preact $(VENDOR_DIR)/htm $(VENDOR_DIR)/strudel
	@echo "Bundling Preact..."
	$(BUN) build node_modules/preact/dist/preact.module.js \
	  --target=browser --format=esm --minify --sourcemap \
	  --outfile=$(VENDOR_DIR)/preact/preact.mjs
	$(BUN) build node_modules/preact/hooks/dist/hooks.module.js \
	  --target=browser --format=esm --minify --sourcemap \
	  --outfile=$(VENDOR_DIR)/preact/hooks.mjs
	@echo "Bundling HTM..."
	$(BUN) build node_modules/htm/dist/htm.js \
	  --target=browser --format=esm --minify --sourcemap \
	  --outfile=$(VENDOR_DIR)/htm/htm.mjs
	@echo "Bundling Strudel (web, mini, webaudio, core)..."
	$(BUN) build node_modules/@strudel/web/dist/index.mjs \
	  --target=browser --format=esm --minify \
	  --outfile=$(VENDOR_DIR)/strudel/web.mjs
	@# core.mjs: re-export everything from web.mjs plus the two symbols web.mjs doesn't export
	@echo 'export * from "./web.mjs";' > $(VENDOR_DIR)/strudel/core.mjs
	@echo 'const _logKey = "strudel.log";' >> $(VENDOR_DIR)/strudel/core.mjs
	@echo 'let _lastMsg, _lastTime, _throttle = 1000;' >> $(VENDOR_DIR)/strudel/core.mjs
	@echo 'export function logger(msg, type, data = {}) {' >> $(VENDOR_DIR)/strudel/core.mjs
	@echo '  const now = performance.now();' >> $(VENDOR_DIR)/strudel/core.mjs
	@echo '  if (_lastMsg === msg && now - _lastTime < _throttle) return;' >> $(VENDOR_DIR)/strudel/core.mjs
	@echo '  _lastMsg = msg; _lastTime = now;' >> $(VENDOR_DIR)/strudel/core.mjs
	@echo '  console.log("%c" + msg, "background-color:black;color:white;border-radius:15px");' >> $(VENDOR_DIR)/strudel/core.mjs
	@echo '  if (typeof document !== "undefined" && typeof CustomEvent !== "undefined")' >> $(VENDOR_DIR)/strudel/core.mjs
	@echo '    document.dispatchEvent(new CustomEvent(_logKey, { detail: { message: msg, type, data } }));' >> $(VENDOR_DIR)/strudel/core.mjs
	@echo '}' >> $(VENDOR_DIR)/strudel/core.mjs
	@echo 'export function errorLogger(err, context = "cyclist") {' >> $(VENDOR_DIR)/strudel/core.mjs
	@echo '  logger("[" + context + "] error: " + err.message, "error");' >> $(VENDOR_DIR)/strudel/core.mjs
	@echo '}' >> $(VENDOR_DIR)/strudel/core.mjs
	$(BUN) build node_modules/superdough/dist/index.mjs \
	  --target=browser --format=esm --minify \
	  --outfile=$(VENDOR_DIR)/strudel/superdough.mjs
	$(BUN) build node_modules/supradough/dist/index.mjs \
	  --target=browser --format=esm --minify \
	  --outfile=$(VENDOR_DIR)/strudel/supradough.mjs
	$(BUN) build node_modules/@strudel/draw/dist/index.mjs \
	  --target=browser --format=esm --minify \
	  --packages=external \
	  --outfile=$(VENDOR_DIR)/strudel/draw.mjs
	$(BUN) build node_modules/@strudel/mini/dist/index.mjs \
	  --target=browser --format=esm --minify \
	  --packages=external \
	  --outfile=$(VENDOR_DIR)/strudel/mini.mjs
	$(BUN) build node_modules/@strudel/webaudio/dist/index.mjs \
	  --target=browser --format=esm --minify \
	  --packages=external \
	  --outfile=$(VENDOR_DIR)/strudel/webaudio.mjs
	$(BUN) build node_modules/@strudel/codemirror/dist/index.mjs \
	  --target=browser --format=esm --minify \
	  --external=@strudel/core --external=@strudel/draw \
	  --outfile=$(VENDOR_DIR)/strudel/codemirror.mjs
	@# Copy Strudel assets (clockworker)
	@mkdir -p $(VENDOR_DIR)/strudel/assets
	@cp node_modules/@strudel/web/dist/assets/* $(VENDOR_DIR)/strudel/assets/ || true
	@cp node_modules/@strudel/core/dist/assets/* $(VENDOR_DIR)/strudel/assets/ || true
	@echo "✓ Vendored dependencies to $(VENDOR_DIR)/"

.PHONY: vendor-clean
vendor-clean: ## Remove vendored frontend dependencies
	rm -rf $(VENDOR_DIR)/preact $(VENDOR_DIR)/htm $(VENDOR_DIR)/strudel

# =============================================================================
# Docker (optional)
# =============================================================================

IMAGE_NAME ?= apfelstrudel
IMAGE_TAG ?= latest

.PHONY: docker-build
docker-build: ## Build Docker image
	docker build -t $(IMAGE_NAME):$(IMAGE_TAG) .

.PHONY: docker-run
docker-run: ## Run Docker container
	docker run -it --rm -p $(PORT):$(PORT) \
		-e OPENAI_API_KEY \
		-e AZURE_OPENAI_ENDPOINT \
		-e AZURE_OPENAI_KEY \
		-e AZURE_OPENAI_DEPLOYMENT \
		-e APFELSTRUDEL_PROVIDER \
		-e APFELSTRUDEL_MODEL \
		-e APFELSTRUDEL_LMSTUDIO_HOST \
		$(IMAGE_NAME):$(IMAGE_TAG)

# =============================================================================
# Utilities
# =============================================================================

.PHONY: outdated
outdated: ## Check for outdated dependencies
	$(BUN) outdated

.PHONY: update
update: ## Update dependencies
	$(BUN) update

.PHONY: env-check
env-check: ## Verify required environment variables
	@echo "Checking environment variables..."
	@if [ -z "$$OPENAI_API_KEY" ] && [ -z "$$AZURE_OPENAI_KEY" ] && [ "$$APFELSTRUDEL_PROVIDER" != "lmstudio" ]; then \
		echo "⚠️  Warning: Neither OPENAI_API_KEY nor AZURE_OPENAI_KEY is set, and provider is not lmstudio"; \
		echo "   Set one of these for the agent to work"; \
	else \
		echo "✓ LLM provider configured"; \
	fi
