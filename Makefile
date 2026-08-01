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

# launchd needs an absolute pnpm path + explicit PATH because it does not run a
# login shell. Resolve these on the target machine during install-service.
PNPM_BIN := $(shell command -v pnpm)
NODE_BIN := $(dir $(shell command -v node))

.PHONY: install ingest refresh dev build start stop restart redeploy status refresh-status wait-listen install-service install-refresh-service uninstall-service uninstall-refresh-service install-push-service uninstall-push-service push-status push-sources file-downloads file-downloads-dry logs typecheck

install:
	pnpm install

ingest:
	pnpm ingest

refresh:
	pnpm refresh

dev:
	pnpm dev

build:
	pnpm build

start:
	pnpm start

typecheck:
	pnpm typecheck

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

redeploy:
	git pull --ff-only
	pnpm build
	launchctl kickstart -k gui/$(shell id -u)/$(PLIST_LABEL)
	@$(MAKE) wait-listen
	@$(MAKE) status

install-service: build
	@test -n "$(PNPM_BIN)" || { echo "pnpm not found on PATH -- cannot generate plist"; exit 1; }
	mkdir -p $(HOME)/Library/LaunchAgents logs
	sed -e "s|__WORKDIR__|$(CURDIR)|g" -e "s|__HOME__|$(HOME)|g" \
	    -e "s|__PNPM__|$(PNPM_BIN)|g" -e "s|__NODE_BIN__|$(NODE_BIN)|g" $(PLIST_SRC) > $(PLIST_DST)
	launchctl unload $(PLIST_DST) 2>/dev/null || true
	launchctl load $(PLIST_DST)
	@echo "installed: $(PLIST_DST) -> http://localhost:$(PORT) (pnpm: $(PNPM_BIN))"

install-refresh-service:
	@test -n "$(PNPM_BIN)" || { echo "pnpm not found on PATH -- cannot generate plist"; exit 1; }
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
file-downloads-dry:
	pnpm file:downloads --dry-run

file-downloads:
	pnpm file:downloads
