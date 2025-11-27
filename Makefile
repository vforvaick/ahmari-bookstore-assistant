.PHONY: help build up down logs restart clean init-db

help:
	@echo "Available commands:"
	@echo "  make init-db   - Initialize database schema"
	@echo "  make build     - Build Docker images"
	@echo "  make up        - Start all services"
	@echo "  make down      - Stop all services"
	@echo "  make logs      - Show logs (all services)"
	@echo "  make restart   - Restart all services"
	@echo "  make clean     - Remove containers, volumes, and images"

init-db:
	@echo "Initializing database..."
	cd database && npm install && npm run init
	@echo "✓ Database initialized"

build:
	docker-compose build

up:
	docker-compose up -d

down:
	docker-compose down

logs:
	docker-compose logs -f

restart:
	docker-compose restart

clean:
	docker-compose down -v
	docker system prune -f
