# Stock Observatory macOS launchd deployment flow.
PLIST_LABEL := com.jackpark.stock-observatory
PLIST_SRC   := deploy/$(PLIST_LABEL).plist
PLIST_DST   := $(HOME)/Library/LaunchAgents/$(PLIST_LABEL).plist
REFRESH_LABEL := $(PLIST_LABEL).refresh
REFRESH_PLIST_SRC := deploy/$(REFRESH_LABEL).plist
REFRESH_PLIST_DST := $(HOME)/Library/LaunchAgents/$(REFRESH_LABEL).plist
PUSH_LABEL := $(PLIST_LABEL).push-sources
PUSH_PLIST_SRC := deploy/$(PUSH_LABEL).plist
PUSH_PLIST_DST := $(HOME)/Library/LaunchAgents/$(PUSH_LABEL).plist
PORT        := 3101

# Nothing that runs this Makefile unattended sources a login profile: not
# launchd, not Hermes cron, and not `ssh host 'make redeploy'`. On hermes-runner
# pnpm and node live in the user prefix, so a bare `pnpm` in a recipe is only
# found when a human is at an interactive shell. Resolve both explicitly, from
# the same candidate directories as deploy/hermes/observatory-refresh-cron.sh,
# and use the resolved paths in the recipes as well as in the plists.
TOOL_DIRS := $(HOME)/.local/bin /opt/homebrew/bin /usr/local/bin
find-tool = $(firstword $(shell command -v $(1) 2>/dev/null) \
                       $(wildcard $(foreach d,$(TOOL_DIRS),$(d)/$(1))))
PNPM_BIN := $(call find-tool,pnpm)
NODE_EXE := $(call find-tool,node)
NODE_BIN := $(dir $(NODE_EXE))

# pnpm spawns node and the package scripts spawn it again, so an absolute pnpm
# is not enough on its own — node's directory has to be on PATH for the children.
PNPM := PATH="$(NODE_BIN):$$PATH" $(PNPM_BIN)

.PHONY: install ingest refresh dev build start stop restart redeploy status refresh-status wait-listen require-tools install-service install-refresh-service uninstall-service uninstall-refresh-service install-push-service uninstall-push-service push-status push-sources file-downloads file-downloads-dry logs typecheck

# Every pnpm-invoking target depends on this, so a stripped PATH fails here —
# before a target has done anything — instead of part-way through.
require-tools:
	@test -n "$(PNPM_BIN)" || { \
	  echo "pnpm not found: not on PATH, and not in $(TOOL_DIRS)."; \
	  echo "A non-interactive shell (ssh, launchd, cron) does not source your login profile."; \
	  exit 1; }
	@test -n "$(NODE_EXE)" || { \
	  echo "node not found: not on PATH, and not in $(TOOL_DIRS)."; \
	  exit 1; }

install: require-tools
	$(PNPM) install

ingest: require-tools
	$(PNPM) ingest

refresh: require-tools
	$(PNPM) refresh

dev: require-tools
	$(PNPM) dev

build: require-tools
	$(PNPM) build

start: require-tools
	$(PNPM) start

typecheck: require-tools
	$(PNPM) typecheck

stop:
	-launchctl unload $(PLIST_DST) 2>/dev/null
	-lsof -ti tcp:$(PORT) | xargs kill 2>/dev/null || true

status:
	@launchctl list | grep $(PLIST_LABEL) || echo "$(PLIST_LABEL): not loaded"
	@lsof -i tcp:$(PORT) -sTCP:LISTEN 2>/dev/null || echo "port $(PORT): not listening"

wait-listen:
	@for i in $$(seq 1 15); do \
	  lsof -i tcp:$(PORT) -sTCP:LISTEN -n -P >/dev/null 2>&1 && exit 0; \
	  sleep 1; \
	done; \
	echo "warning: :$(PORT) still not listening after 15s -- check 'make logs'"

restart:
	launchctl kickstart -k gui/$(shell id -u)/$(PLIST_LABEL)
	@$(MAKE) wait-listen
	@$(MAKE) status

# The pull has to come first — the build builds what was pulled — so any failure
# after it leaves the checkout on new code while the running `next start` keeps
# serving the old build, and nothing reports the disagreement. Two guards:
# require-tools runs BEFORE the pull, so the failure that actually happened
# (pnpm missing over ssh) can no longer reach that state; and anything that does
# fail after the pull says the state is mixed and prints the way back.
#
# Schema and snapshot formulas ship with the app. Refresh before restart so
# hermes-runner never serves a new reader against pre-migration trend rows.
redeploy: require-tools
	@set -e; \
	before=$$(git rev-parse HEAD); \
	git pull --ff-only; \
	after=$$(git rev-parse HEAD); \
	fail() { \
	  echo ""; \
	  echo "*** redeploy FAILED at: $$1"; \
	  if [ "$$before" != "$$after" ]; then \
	    echo "*** MIXED STATE — the checkout is at $$after, but :$(PORT) is still"; \
	    echo "*** serving the build from $$before. Source and served app disagree."; \
	    echo "*** Fix forward by re-running 'make redeploy', or roll the checkout back:"; \
	    echo "***   git -C $(CURDIR) reset --hard $$before"; \
	  else \
	    echo "*** Checkout unchanged ($$before) and the service was not restarted."; \
	  fi; \
	  exit 1; \
	}; \
	$(PNPM) build   || fail "pnpm build"; \
	$(PNPM) refresh || fail "pnpm refresh"; \
	launchctl kickstart -k gui/$(shell id -u)/$(PLIST_LABEL) || fail "launchctl kickstart"
	@$(MAKE) wait-listen
	@$(MAKE) status

install-service: require-tools build
	mkdir -p $(HOME)/Library/LaunchAgents logs
	sed -e "s|__WORKDIR__|$(CURDIR)|g" -e "s|__HOME__|$(HOME)|g" \
	    -e "s|__PNPM__|$(PNPM_BIN)|g" -e "s|__NODE_BIN__|$(NODE_BIN)|g" $(PLIST_SRC) > $(PLIST_DST)
	launchctl unload $(PLIST_DST) 2>/dev/null || true
	launchctl load $(PLIST_DST)
	@echo "installed: $(PLIST_DST) -> http://localhost:$(PORT) (pnpm: $(PNPM_BIN))"

# The six-hourly refresh moved back to Hermes cron on 2026-08-29 (see README,
# "Scheduled refresh"): launchd delivers nothing when a run fails, and one did for
# three days unnoticed. This target is the way back if that judgement changes.
#
# Only one scheduler may own the refresh — both write the same SQLite database and
# the same data/refresh-runs.json. Installing this means pausing the cron job in the
# same breath:  hermes -p trader cron pause observatory-refresh
install-refresh-service: require-tools
	mkdir -p $(HOME)/Library/LaunchAgents logs
	sed -e "s|__WORKDIR__|$(CURDIR)|g" -e "s|__HOME__|$(HOME)|g" \
		-e "s|__PNPM__|$(PNPM_BIN)|g" -e "s|__NODE_BIN__|$(NODE_BIN)|g" $(REFRESH_PLIST_SRC) > $(REFRESH_PLIST_DST)
	launchctl bootout gui/$(shell id -u)/$(REFRESH_LABEL) 2>/dev/null || true
	launchctl bootstrap gui/$(shell id -u) $(REFRESH_PLIST_DST)
	launchctl kickstart -k gui/$(shell id -u)/$(REFRESH_LABEL)
	@echo "installed: $(REFRESH_PLIST_DST) -> refresh every 6 hours"

uninstall-service:
	-launchctl unload $(PLIST_DST)
	rm -f $(PLIST_DST)

uninstall-refresh-service:
	-launchctl bootout gui/$(shell id -u)/$(REFRESH_LABEL)
	rm -f $(REFRESH_PLIST_DST)

refresh-status:
	@launchctl print gui/$(shell id -u)/$(REFRESH_LABEL) 2>/dev/null | grep -E 'state|runs|last exit code|path' || echo "$(REFRESH_LABEL): not loaded"

logs:
	tail -f logs/observatory.out.log logs/observatory.err.log

# Runs on the LAPTOP, not the refresh host: broker exports land wherever the
# browser was logged in. Hourly rather than on file-change — rsync is idempotent,
# so an unchanged tree costs seconds, while an event arrives once and is lost to
# a sleeping laptop, a dropped network, or a half-written download.
install-push-service:
	mkdir -p $(HOME)/Library/LaunchAgents logs
	sed -e "s|__WORKDIR__|$(CURDIR)|g" $(PUSH_PLIST_SRC) > $(PUSH_PLIST_DST)
	-launchctl bootout gui/$(shell id -u)/$(PUSH_LABEL) 2>/dev/null
	launchctl bootstrap gui/$(shell id -u) $(PUSH_PLIST_DST)
	@echo "installed: $(PUSH_PLIST_DST) (hourly; log: $(CURDIR)/logs/push-sources.log)"

uninstall-push-service:
	-launchctl bootout gui/$(shell id -u)/$(PUSH_LABEL)
	rm -f $(PUSH_PLIST_DST)

push-status:
	@launchctl print gui/$(shell id -u)/$(PUSH_LABEL) 2>/dev/null | grep -E 'state|runs|last exit code|path' || echo "$(PUSH_LABEL): not loaded"

push-sources:
	./scripts/push-sources.sh

# Identify whatever is in $(STOCK_DATA_DIR)/inbox by its CONTENTS, rename it to
# the convention in docs/data-sources.md and move it to the directory that owns
# it. The hourly push runs this first, so this target is for the impatient and
# for the dry run — which is worth doing every time, since it prints the same
# plan and moves nothing.
file-downloads-dry: require-tools
	$(PNPM) file:downloads --dry-run

file-downloads: require-tools
	$(PNPM) file:downloads
