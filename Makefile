.PHONY: install ingest dev build typecheck

install:
	pnpm install

ingest:
	pnpm ingest

dev:
	pnpm dev

build:
	pnpm build

typecheck:
	pnpm typecheck
