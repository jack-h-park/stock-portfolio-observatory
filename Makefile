# Stock Observatory macOS launchd deployment flow.
PLIST_LABEL := com.jackpark.stock-observatory
PLIST_SRC   := deploy/$(PLIST_LABEL).plist
PLIST_DST   := $(HOME)/Library/LaunchAgents/$(PLIST_LABEL).plist
PORT        := 3101

# launchd needs an absolute pnpm path + explicit PATH because it does not run a
# login shell. Resolve these on the target machine during install-service.
PNPM_BIN := $(shell command -v pnpm)
NODE_BIN := $(dir $(shell command -v node))

.PHONY: install ingest dev build start stop restart redeploy status wait-listen install-service uninstall-service logs typecheck

install:
	pnpm install

ingest:
	pnpm ingest

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

uninstall-service:
	-launchctl unload $(PLIST_DST)
	rm -f $(PLIST_DST)

logs:
	tail -f logs/observatory.out.log logs/observatory.err.log
