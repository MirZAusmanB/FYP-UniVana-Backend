#!/usr/bin/env bash
# vpn-bypass.sh
# When the ProtonVPN GUI app is connected (OpenVPN/IKEv2), use this script
# to pin MongoDB Atlas + Jina + Groq traffic to the real LAN gateway so the
# UniVana backend stays connected. Everything else (browser, the Python
# scraper, etc.) keeps going through the VPN tunnel as normal.
#
# Usage:
#   1) Connect ProtonVPN through its GUI app (Germany or NL preferred).
#   2) sudo bash vpn-bypass.sh up      # install bypass routes
#   3) Run the scrapers via the admin dashboard.
#   4) sudo bash vpn-bypass.sh down    # remove bypass routes when done
#      (also auto-removed when you disconnect the VPN.)
#
# Re-run "up" if Mongo stops working — Atlas rotates IPs every few weeks.

set -euo pipefail

ACTION="${1:-up}"
STATE_FILE="/tmp/univana-vpn-bypass.routes"

# Hosts whose traffic must skip the VPN.
HOSTS=(
  "cluster0.owfatog.mongodb.net"
  "api.jina.ai"
  "api.groq.com"
)

resolve_lan_gateway() {
  # Match a default route that does NOT go through a tunnel device.
  local line
  line=$(ip route show default | grep -vE 'dev (tun|wg|proton|ppp|univana)' | awk 'NR==1')
  if [[ -z "$line" ]]; then
    echo "ERROR: no non-VPN default route. Make sure your LAN/WiFi is up." >&2
    exit 1
  fi
  GW_IP=$(awk '{print $3}' <<<"$line")
  GW_DEV=$(awk '{print $5}' <<<"$line")
}

resolve_atlas_ips() {
  local shards
  shards=$(dig +short srv "_mongodb._tcp.cluster0.owfatog.mongodb.net" \
    | awk '{print $4}' | sed 's/\.$//' | sort -u)
  if [[ -z "$shards" ]]; then
    echo "cluster0.owfatog.mongodb.net"
    return
  fi
  for s in $shards; do
    dig +short A "$s" | grep -E '^[0-9.]+$'
  done | sort -u
}

resolve_host_ips() {
  local h="$1"
  if [[ "$h" == *"mongodb.net" ]]; then
    resolve_atlas_ips
  else
    dig +short A "$h" | grep -E '^[0-9.]+$' | sort -u
  fi
}

collect_ips() {
  local all=()
  for h in "${HOSTS[@]}"; do
    while read -r ip; do
      [[ -n "$ip" ]] && all+=("$ip")
    done < <(resolve_host_ips "$h")
  done
  printf '%s\n' "${all[@]}" | sort -u
}

case "$ACTION" in
  up)
    resolve_lan_gateway
    echo "LAN gateway: $GW_IP via $GW_DEV"

    ips=$(collect_ips)
    if [[ -z "$ips" ]]; then
      echo "ERROR: could not resolve any bypass IPs. Are you online?" >&2
      exit 1
    fi

    : > "$STATE_FILE"
    while read -r ip; do
      [[ -z "$ip" ]] && continue
      if ip route replace "${ip}/32" via "$GW_IP" dev "$GW_DEV" 2>/dev/null; then
        echo "  + ${ip}/32 via $GW_IP dev $GW_DEV"
        echo "$ip" >> "$STATE_FILE"
      else
        echo "  ! failed to add $ip" >&2
      fi
    done <<<"$ips"

    echo
    echo "Done. Test with:"
    echo "  curl -s ifconfig.me                # VPN IP"
    echo "  nc -zv cluster0.owfatog.mongodb.net 27017   # direct"
    ;;

  down)
    if [[ ! -f "$STATE_FILE" ]]; then
      echo "No state file. Nothing to remove (or routes already gone with VPN disconnect)."
      exit 0
    fi
    resolve_lan_gateway || true
    while read -r ip; do
      [[ -z "$ip" ]] && continue
      if ip route del "${ip}/32" 2>/dev/null; then
        echo "  - ${ip}/32"
      fi
    done < "$STATE_FILE"
    rm -f "$STATE_FILE"
    echo "Done."
    ;;

  *)
    echo "Usage: sudo bash $0 {up|down}"
    exit 1
    ;;
esac
