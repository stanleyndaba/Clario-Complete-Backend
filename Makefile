.PHONY: up down logs smoke smoke-ps

up:
	docker compose up -d --build

down:
	docker compose down -v

logs:
	docker compose logs -f | cat

smoke:
	bash scripts/smoke.sh

smoke-ps:
	powershell -ExecutionPolicy Bypass -File scripts/smoke.ps1



