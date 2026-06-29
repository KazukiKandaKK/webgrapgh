#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# webgrapgh sidecar setup script
# ============================================================================
# Deploys the webgrapgh observability stack as a sidecar to monitor all
# Docker containers running on this host.
#
# Usage:
#   ./setup.sh              # Default: dashboard on :13000, backend on :18080
#   ./setup.sh --port 9000  # Custom dashboard port
#   ./setup.sh --stop       # Stop the sidecar stack
#   ./setup.sh --status     # Show running status
#   ./setup.sh --uninstall  # Remove containers, volumes, and images
#
# Requirements:
#   - Docker Engine (with Compose V2 plugin)
#   - Access to /var/run/docker.sock
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.sidecar.yml"
PROJECT_NAME="webgrapgh-sidecar"

# Defaults
DASHBOARD_PORT="${DASHBOARD_PORT:-13000}"
BACKEND_PORT="${BACKEND_PORT:-18080}"
COLLECT_HZ="${COLLECT_HZ:-1}"
ACTION="up"

usage() {
    cat <<EOF
webgrapgh sidecar — container observability for any Docker host

Usage:
  $(basename "$0") [options]

Options:
  --port PORT        Dashboard port (default: 13000)
  --backend-port P   Backend API port (default: 18080)
  --collect-hz HZ    Collection frequency in Hz (default: 1)
  --stop             Stop the sidecar stack
  --status           Show container status
  --logs             Follow sidecar logs
  --uninstall        Remove all sidecar containers, volumes, and images
  -h, --help         Show this help

Examples:
  # Start with defaults (dashboard at http://localhost:13000)
  ./setup.sh

  # Custom ports
  ./setup.sh --port 9000 --backend-port 9080

  # Stop the stack
  ./setup.sh --stop

  # View logs
  ./setup.sh --logs
EOF
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --port)
            DASHBOARD_PORT="$2"
            shift 2
            ;;
        --backend-port)
            BACKEND_PORT="$2"
            shift 2
            ;;
        --collect-hz)
            COLLECT_HZ="$2"
            shift 2
            ;;
        --stop)
            ACTION="stop"
            shift
            ;;
        --status)
            ACTION="status"
            shift
            ;;
        --logs)
            ACTION="logs"
            shift
            ;;
        --uninstall)
            ACTION="uninstall"
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage
            ;;
    esac
done

compose() {
    DASHBOARD_PORT="$DASHBOARD_PORT" \
    BACKEND_PORT="$BACKEND_PORT" \
    COLLECT_HZ="$COLLECT_HZ" \
    ALLOWED_ORIGINS="http://localhost:${DASHBOARD_PORT}" \
    VITE_API_BASE="http://localhost:${BACKEND_PORT}" \
    VITE_WS_URL="ws://localhost:${BACKEND_PORT}/ws" \
    VITE_WS_LOGS_URL="ws://localhost:${BACKEND_PORT}/ws/logs" \
    docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
}

case "$ACTION" in
    up)
        echo "==> Checking prerequisites..."
        if ! command -v docker &>/dev/null; then
            echo "ERROR: docker not found. Install Docker Engine first." >&2
            exit 1
        fi
        if ! docker info &>/dev/null; then
            echo "ERROR: Cannot connect to Docker daemon. Is it running?" >&2
            exit 1
        fi
        if [[ ! -S /var/run/docker.sock ]]; then
            echo "ERROR: /var/run/docker.sock not found." >&2
            exit 1
        fi

        echo "==> Starting webgrapgh sidecar stack..."
        echo "    Dashboard:  http://localhost:${DASHBOARD_PORT}"
        echo "    Backend:    http://localhost:${BACKEND_PORT}"
        echo "    Collect Hz: ${COLLECT_HZ}"
        echo ""

        compose up -d --build --remove-orphans

        echo ""
        echo "==> Done! Open http://localhost:${DASHBOARD_PORT} in your browser."
        echo "    The Containers screen (#/containers) shows live metrics for"
        echo "    all running Docker containers on this host."
        echo ""
        echo "    Stop:      $(basename "$0") --stop"
        echo "    Logs:      $(basename "$0") --logs"
        echo "    Uninstall: $(basename "$0") --uninstall"
        ;;
    stop)
        echo "==> Stopping webgrapgh sidecar stack..."
        compose down
        echo "==> Stopped. Data is preserved in the volume."
        ;;
    status)
        compose ps
        ;;
    logs)
        compose logs -f --tail=50
        ;;
    uninstall)
        echo "==> Removing webgrapgh sidecar (containers + volumes + images)..."
        compose down -v --rmi local
        echo "==> Uninstalled."
        ;;
esac
