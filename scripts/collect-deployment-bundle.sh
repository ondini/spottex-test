#!/usr/bin/env bash
# Collect everything a new production host needs that git deliberately does not
# carry: the platform's production environment, the energy backend's own .env
# (including HF_TOKEN, without which model_sync blocks every forecasting
# service), and the Codex credential the invoice parser mounts.
#
# The bundle is validated before it is written -- a handover that is missing a
# key or still carries a template placeholder fails here rather than at 3am on a
# machine nobody can log into. Output is encrypted; it is a pile of secrets.
#
#   scripts/collect-deployment-bundle.sh [-o OUT_DIR] [-b BACKEND_DIR] [--force]
#
# Passphrase comes from BUNDLE_PASSPHRASE, or is prompted for. Send it over a
# different channel than the bundle itself.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT"
BACKEND_DIR="${SPOTTEX_BACKEND_DIR:-/home/web/spottex_backend_new}"
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    -o|--out) OUT_DIR="$2"; shift 2 ;;
    -b|--backend) BACKEND_DIR="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }
command -v tar >/dev/null || { echo "tar is required" >&2; exit 1; }

PROBLEMS=()
note_problem() { PROBLEMS+=("$1"); }

# Read a key out of a KEY=VALUE file without sourcing it -- these files are not
# guaranteed to be valid shell, and sourcing them would execute their contents.
env_get() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  sed -n "s/^${key}=//p" "$file" | tail -n 1
}

is_placeholder() {
  case "$1" in
    ""|*REPLACE*|*replace-with*|*DOPLNIT*|*GENERATED_*|*SEM_VLOZTE*|*changeme*|*CHANGEME*|*your-*|*xxx*) return 0 ;;
    *) return 1 ;;
  esac
}

require_key() {
  local file="$1" key="$2" label="$3"
  local value; value="$(env_get "$file" "$key")"
  if is_placeholder "$value"; then
    note_problem "$label: $key is empty or still a placeholder"
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------- platform env

PLATFORM_ENV=""
for candidate in "$REPO_ROOT/.env.production" "$REPO_ROOT/Secrets/spottex.production.env"; do
  [ -f "$candidate" ] && { PLATFORM_ENV="$candidate"; break; }
done
[ -n "$PLATFORM_ENV" ] || { echo "No .env.production or Secrets/spottex.production.env found" >&2; exit 1; }

for key in APP_URL AUTH_URL AUTH_SECRET APP_ENCRYPTION_KEY INTERNAL_JOB_TOKEN \
           DATABASE_URL DATABASE_ADMIN_URL EMAIL_FROM \
           POSTGRES_PASSWORD POSTGRES_APP_PASSWORD POSTGRES_BACKUP_PASSWORD \
           BACKUP_ENCRYPTION_PASSPHRASE; do
  require_key "$PLATFORM_ENV" "$key" "platform" || true
done

APP_URL_VALUE="$(env_get "$PLATFORM_ENV" APP_URL)"
case "$APP_URL_VALUE" in
  https://*) ;;
  "") ;;
  *) note_problem "platform: APP_URL must be https, production startup validation rejects anything else" ;;
esac

# APP_ENCRYPTION_KEY has to decode to exactly 32 bytes or the crypto helpers refuse to run.
ENC_KEY="$(env_get "$PLATFORM_ENV" APP_ENCRYPTION_KEY)"
if ! is_placeholder "$ENC_KEY"; then
  KEY_BYTES="$(printf '%s' "$ENC_KEY" | openssl base64 -d -A 2>/dev/null | wc -c || echo 0)"
  [ "$KEY_BYTES" = "32" ] || note_problem "platform: APP_ENCRYPTION_KEY decodes to ${KEY_BYTES} bytes, must be exactly 32"
fi

# Distinct credentials, per the least-privilege split the production stack relies on.
OWNER_PW="$(env_get "$PLATFORM_ENV" POSTGRES_PASSWORD)"
APP_PW="$(env_get "$PLATFORM_ENV" POSTGRES_APP_PASSWORD)"
BACKUP_PW="$(env_get "$PLATFORM_ENV" POSTGRES_BACKUP_PASSWORD)"
BACKUP_PASS="$(env_get "$PLATFORM_ENV" BACKUP_ENCRYPTION_PASSPHRASE)"
if [ "$OWNER_PW" = "$APP_PW" ] || [ "$OWNER_PW" = "$BACKUP_PW" ] || [ "$APP_PW" = "$BACKUP_PW" ]; then
  note_problem "platform: the owner, app and backup database passwords must all differ"
fi
[ "$OWNER_PW" != "$BACKUP_PASS" ] || note_problem "platform: BACKUP_ENCRYPTION_PASSPHRASE must differ from the database password"

# Conditional requirements -- only demanded when the corresponding mode is on.
if [ -z "$(env_get "$PLATFORM_ENV" RESEND_API_KEY)" ]; then
  for key in SMTP_HOST SMTP_USER SMTP_PASSWORD; do
    require_key "$PLATFORM_ENV" "$key" "platform (no RESEND_API_KEY, so SMTP is the transport)" || true
  done
fi
if [ "$(env_get "$PLATFORM_ENV" PAYMENT_PROVIDER)" = "GOPAY" ]; then
  for key in GOPAY_CLIENT_ID GOPAY_CLIENT_SECRET GOPAY_GO_ID GOPAY_API_URL; do
    require_key "$PLATFORM_ENV" "$key" "platform (PAYMENT_PROVIDER=GOPAY)" || true
  done
fi

COSTS_URL="$(env_get "$PLATFORM_ENV" COSTS_INTERNAL_API_URL)"
if [ -n "$COSTS_URL" ]; then
  require_key "$PLATFORM_ENV" COSTS_INTERNAL_API_KEY "platform (costs catalog configured)" || true
  case "$COSTS_URL" in
    *localhost*|*127.0.0.1*|*costs-api*)
      note_problem "platform: COSTS_INTERNAL_API_URL points at a same-host name; the catalog stays on its own machine and is reached through the WireGuard tunnel" ;;
  esac
else
  echo "note: COSTS_INTERNAL_API_URL is empty -- the catalog will be disabled, the app still runs" >&2
fi

LEGACY_URL="$(env_get "$PLATFORM_ENV" SPOTTEX_LEGACY_API_URL)"
if [ -n "$LEGACY_URL" ]; then
  require_key "$PLATFORM_ENV" SPOTTEX_LEGACY_FERNET_KEY "platform (legacy API configured)" || true
  case "$LEGACY_URL" in
    https://*) ;;
    *) [ "$(env_get "$PLATFORM_ENV" ALLOW_INSECURE_LEGACY_HTTP)" = "true" ] \
         || note_problem "platform: SPOTTEX_LEGACY_API_URL must be https unless ALLOW_INSECURE_LEGACY_HTTP=true is set deliberately" ;;
  esac
fi

# ----------------------------------------------------------------- backend env

BACKEND_ENV="$BACKEND_DIR/.env"
[ -f "$BACKEND_ENV" ] || note_problem "backend: $BACKEND_ENV not found (set --backend or SPOTTEX_BACKEND_DIR)"
if [ -f "$BACKEND_ENV" ]; then
  for key in FERNET_KEY CIPHERING_KEY DATABASE_URL CELERY_BROKER_URL HF_TOKEN; do
    require_key "$BACKEND_ENV" "$key" "backend" || true
  done
fi

# ---------------------------------------------------------------- codex secret

# The parser keeps the Codex credential on the machine that owns it and is
# reached over the tunnel with a token, so the receiving host needs the URL and
# the token -- never the credential itself. It is deliberately not collected.
if [ "$(env_get "$PLATFORM_ENV" ENERGY_INVOICE_AI_ENABLED)" = "true" ]; then
  PARSER_URL="$(env_get "$PLATFORM_ENV" INVOICE_PARSER_URL)"
  if is_placeholder "$PARSER_URL"; then
    note_problem "invoice parser: ENERGY_INVOICE_AI_ENABLED=true but INVOICE_PARSER_URL is unset"
  else
    PARSER_HOST="${PARSER_URL#*://}"; PARSER_HOST="${PARSER_HOST%%[:/]*}"
    case "$PARSER_HOST" in
      127.0.0.1|localhost|::1)
        echo "note: INVOICE_PARSER_URL is loopback, so the target host is expected to run the parser itself" >&2 ;;
      *)
        PARSER_TOKEN="$(env_get "$PLATFORM_ENV" INVOICE_PARSER_TOKEN)"
        if [ "${#PARSER_TOKEN}" -lt 32 ]; then
          note_problem "invoice parser: INVOICE_PARSER_TOKEN must be at least 32 characters when the parser is remote -- the coordinator refuses to start without it, and an untokened parser lets anyone on the tunnel drive a Codex agent"
        fi ;;
    esac
  fi
fi

# Only the host that actually runs the parser profile needs the credential, and
# that host is not the one receiving this bundle.
CODEX_AUTH="$(env_get "$PLATFORM_ENV" CODEX_AUTH_FILE)"
if [ -n "$CODEX_AUTH" ]; then
  echo "note: CODEX_AUTH_FILE is set in this environment; it is deliberately NOT bundled." >&2
  echo "      The parser stays on the machine that owns the credential." >&2
fi
CODEX_AUTH=""

# ------------------------------------------------------------------- reporting

if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  echo >&2
  echo "Incomplete handover -- ${#PROBLEMS[@]} problem(s):" >&2
  for p in "${PROBLEMS[@]}"; do echo "  - $p" >&2; done
  echo >&2
  if [ "$FORCE" -ne 1 ]; then
    echo "Refusing to write a bundle that will not deploy. Fix the above, or pass --force" >&2
    echo "if you know the receiving side supplies these values themselves." >&2
    exit 1
  fi
  echo "--force given; writing the bundle anyway." >&2
fi

# --------------------------------------------------------------------- collect

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
umask 077
mkdir -p "$STAGE/bundle"

cp "$PLATFORM_ENV" "$STAGE/bundle/platform.env.production"
[ -f "$BACKEND_ENV" ] && cp "$BACKEND_ENV" "$STAGE/bundle/backend.env"
[ -n "$CODEX_AUTH" ] && [ -f "$CODEX_AUTH" ] && cp "$CODEX_AUTH" "$STAGE/bundle/codex-auth.json"

cat > "$STAGE/bundle/README.md" <<'MANUAL'
# Spottex — handover bundle

Everything here is secret. It is what git deliberately does not carry.

## Contents

- `platform.env.production` — Next.js platform. Copy to the repository root of
  `spottex-test` as `.env.production`.
- `backend.env` — energy backend. Copy to the root of the `spottex_backend`
  checkout as `.env`. `HF_TOKEN` matters: `reframed-cz/PV_pred` is private and
  `model_sync` gates every forecasting service, so without it neither
  `control_broadcaster` nor `invertor_updater` starts at all.
The Codex credential is **not** here and should not be asked for. The invoice
parser stays on the machine that owns it and is reached over the tunnel with
`INVOICE_PARSER_URL` and `INVOICE_PARSER_TOKEN`, the same arrangement as the
costs catalog. Run it with `docker compose --profile invoice-parser up -d`
only on that machine.

Deployment steps are in `README.md` of the platform repository, section
"Nasazení na nový stroj".

## Not in this bundle — arrange separately

- **WireGuard peer configuration.** The costs catalog stays on its own machine.
  This host needs its own peer keys; `COSTS_INTERNAL_API_URL` must resolve
  inside the tunnel and never over the public internet. If it is left empty the
  catalog is simply disabled and the rest of the platform still runs.
- **DNS and TLS.** A reverse proxy owns the public hostname, the certificate,
  request limits and security headers. Production forces
  `TRUST_PROXY_HEADERS=true`, so that proxy must discard client-supplied
  `X-Forwarded-For` / `X-Real-IP` and set authoritative values itself.
- **Database roles.** `scripts/grant-db-role.ts` creates the limited app role
  and the read-only backup role. The owner URL must never reach the application
  container.
- **Off-site backups.** The backup volume is not off-site. Export the encrypted
  `*.dump.enc` files, keep `BACKUP_ENCRYPTION_PASSPHRASE` in a different system
  from the files, and rehearse a restore into a disposable database.
- **A rollback plan** for both the application image and the migrations, agreed
  before the first deploy rather than during the first incident.
MANUAL

# Manifest lists key names only. Never values -- this is meant to be readable
# over the same channel you used to arrange the handover.
{
  echo "# Bundle manifest"
  echo
  echo "## Files"
  ( cd "$STAGE/bundle" && ls -1 )
  echo
  echo "## Keys present (names only, no values)"
  for f in "$STAGE"/bundle/*.env*; do
    [ -f "$f" ] || continue
    echo "### $(basename "$f")"
    sed -nE 's/^([A-Za-z_][A-Za-z0-9_]*)=.*/  \1/p' "$f" | sort
  done
} > "$STAGE/bundle/MANIFEST.md"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$OUT_DIR/spottex-handover-$STAMP.tar.gz.enc"
mkdir -p "$OUT_DIR"

if [ -z "${BUNDLE_PASSPHRASE:-}" ]; then
  read -r -s -p "Passphrase for the bundle: " BUNDLE_PASSPHRASE; echo
  read -r -s -p "Repeat: " REPEAT; echo
  [ "$BUNDLE_PASSPHRASE" = "$REPEAT" ] || { echo "Passphrases differ" >&2; exit 1; }
fi
[ "${#BUNDLE_PASSPHRASE}" -ge 20 ] || { echo "Passphrase must be at least 20 characters" >&2; exit 1; }

tar -C "$STAGE" -czf - bundle \
  | BP="$BUNDLE_PASSPHRASE" openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
      -pass env:BP -out "$OUT_FILE"
chmod 600 "$OUT_FILE"

echo
echo "Wrote $OUT_FILE"
echo
cat "$STAGE/bundle/MANIFEST.md"
echo
echo "Decrypt with:"
echo "  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in $(basename "$OUT_FILE") | tar -xzf -"
echo
echo "Send the passphrase over a different channel than the bundle."
