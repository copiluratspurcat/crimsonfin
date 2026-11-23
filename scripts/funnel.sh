#!/usr/bin/env bash
set -euo pipefail
PORT="${PORT:-8099}"
FUNNEL_PORT="${FUNNEL_PORT:-8443}"
case "${1:-help}" in
  on)  echo "Enabling public HTTPS Funnel for localhost:${PORT}"; tailscale funnel --bg --yes --https="${FUNNEL_PORT}" "127.0.0.1:${PORT}" ;;
  off) echo "Disabling public Funnel"; tailscale funnel --https="${FUNNEL_PORT}" off ;;
  status) tailscale funnel status ;;
  check) echo "Local health:"; curl -fsS "http://127.0.0.1:${PORT}/api/health"; echo; echo "Public Funnel status:"; tailscale funnel status ;;
  *) echo 'Usage: scripts/funnel.sh {on|off|status|check}'; exit 1;;
esac
