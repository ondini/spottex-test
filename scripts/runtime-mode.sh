#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root_dir"

dev_env="Secrets/spottex.development.env"
prod_env=".env.production"

case "${1:-status}" in
  dev)
    docker compose --env-file "$dev_env" -f deploy/compose.dev.yml up -d --build
    docker compose --env-file "$dev_env" -f deploy/compose.dev.yml port app 3004
    ;;
  prod)
    docker compose --env-file "$prod_env" -f deploy/compose.prod.yml up -d --build
    docker compose --env-file "$prod_env" -f deploy/compose.prod.yml port app 3004
    ;;
  both)
    "$0" dev
    "$0" prod
    ;;
  status)
    docker ps -a --filter label=com.docker.compose.project=spottex-platform-dev \
      --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
    docker ps -a --filter label=com.docker.compose.project=spottex-platform \
      --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
    ;;
  logs-dev)
    docker compose --env-file "$dev_env" -f deploy/compose.dev.yml logs -f app analysis-worker jobs
    ;;
  logs-prod)
    docker compose --env-file "$prod_env" -f deploy/compose.prod.yml logs -f app analysis-worker jobs
    ;;
  *)
    echo "Usage: $0 {dev|prod|both|status|logs-dev|logs-prod}" >&2
    exit 2
    ;;
esac
