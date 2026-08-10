#!/bin/sh
set -eu

reject_placeholder() {
  name="$1"
  value="$2"
  lowered="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  case "$lowered" in
    \<*\>|*replace*|*change-me*|*changeme*|*placeholder*|*example*|*your-*|*dev-only*|*spottex_dev*)
      echo "$name contains a public placeholder" >&2
      exit 1
      ;;
  esac
}

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required}"

if [ "${#POSTGRES_PASSWORD}" -lt 20 ]; then
  echo "POSTGRES_PASSWORD must contain at least 20 characters" >&2
  exit 1
fi
if [ "${#BACKUP_ENCRYPTION_PASSPHRASE}" -lt 32 ]; then
  echo "BACKUP_ENCRYPTION_PASSPHRASE must contain at least 32 characters" >&2
  exit 1
fi
reject_placeholder POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
reject_placeholder BACKUP_ENCRYPTION_PASSPHRASE "$BACKUP_ENCRYPTION_PASSPHRASE"

if [ "$POSTGRES_PASSWORD" = "$BACKUP_ENCRYPTION_PASSPHRASE" ]; then
  echo "POSTGRES_PASSWORD and BACKUP_ENCRYPTION_PASSPHRASE must be different" >&2
  exit 1
fi

exec "$@"
