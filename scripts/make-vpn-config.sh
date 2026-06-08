#!/usr/bin/env bash
# make-vpn-config.sh
# Generates a WireGuard config that routes everything through ProtonVPN
# EXCEPT MongoDB Atlas + Jina + Groq, so the FYP backend can still talk
# to its dependencies while the Python scraper is tunnelled.
#
# Usage:
#   1) Download a ProtonVPN WireGuard config from
#        https://account.protonvpn.com/downloads -> WireGuard configuration
#      Save it as protonvpn-base.conf in this directory.
#   2) Run:
#        bash make-vpn-config.sh
#   3) Bring the tunnel up:
#        sudo wg-quick up ./univana-vpn.conf
#      Bring it down:
#        sudo wg-quick down ./univana-vpn.conf
#
# Re-run this script if Mongo Atlas stops working (Atlas rotates IPs every
# few weeks).

set -euo pipefail
cd "$(dirname "$0")"

BASE="protonvpn-base.conf"
OUT="univana-vpn.conf"

if [[ ! -f "$BASE" ]]; then
  echo "ERROR: $BASE not found. Download a ProtonVPN WireGuard config and save it as $BASE in this directory."
  exit 1
fi

# --- detect local gateway + interface (skip tunnels so we get the real ISP gw) ---
GATEWAY_LINE=$(ip route show default | grep -vE 'dev (tun|wg|proton)' | awk 'NR==1')
GW_IP=$(awk '{print $3}' <<<"$GATEWAY_LINE")
GW_DEV=$(awk '{print $5}' <<<"$GATEWAY_LINE")

if [[ -z "$GW_IP" || -z "$GW_DEV" ]]; then
  echo "ERROR: could not detect LAN gateway. Run 'ip route show default' and check manually."
  exit 1
fi

echo "LAN gateway:      $GW_IP"
echo "LAN interface:    $GW_DEV"
echo

# --- resolve MongoDB Atlas cluster IPs ---
CLUSTER="cluster0.owfatog.mongodb.net"
echo "Resolving Mongo SRV records for $CLUSTER ..."

# Atlas uses SRV: _mongodb._tcp.<cluster>. Resolve SRV -> shard hostnames -> A.
SHARDS=$(dig +short srv "_mongodb._tcp.$CLUSTER" | awk '{print $4}' | sed 's/\.$//' | sort -u)

if [[ -z "$SHARDS" ]]; then
  # Fallback: resolve the cluster name directly (some clusters expose A records)
  SHARDS="$CLUSTER"
fi

MONGO_IPS=()
for shard in $SHARDS; do
  for ip in $(dig +short A "$shard" | grep -E '^[0-9.]+$' | sort -u); do
    MONGO_IPS+=("$ip")
  done
done

if [[ ${#MONGO_IPS[@]} -eq 0 ]]; then
  echo "ERROR: could not resolve any Mongo IPs."
  exit 1
fi

# Dedup
MONGO_IPS=($(printf '%s\n' "${MONGO_IPS[@]}" | sort -u))

echo "Mongo Atlas IPs:"
printf '  %s\n' "${MONGO_IPS[@]}"
echo

# --- (optional) resolve Jina + Groq so AI calls don't go through VPN either ---
EXTRA_HOSTS=("api.jina.ai" "api.groq.com")
EXTRA_IPS=()
for h in "${EXTRA_HOSTS[@]}"; do
  for ip in $(dig +short A "$h" | grep -E '^[0-9.]+$' | sort -u); do
    EXTRA_IPS+=("$ip")
  done
done
EXTRA_IPS=($(printf '%s\n' "${EXTRA_IPS[@]}" | sort -u))

if [[ ${#EXTRA_IPS[@]} -gt 0 ]]; then
  echo "Extra bypass IPs (Jina + Groq):"
  printf '  %s\n' "${EXTRA_IPS[@]}"
  echo
fi

# --- build PostUp / PostDown lines ---
POST_UP=""
POST_DOWN=""
for ip in "${MONGO_IPS[@]}" "${EXTRA_IPS[@]}"; do
  POST_UP+="PostUp = ip route add ${ip}/32 via ${GW_IP} dev ${GW_DEV}"$'\n'
  POST_DOWN+="PostDown = ip route del ${ip}/32 via ${GW_IP} dev ${GW_DEV} || true"$'\n'
done

# --- emit the new config ---
{
  # Take everything from the base file up to but not including [Peer]
  awk '/^\[Peer\]/{exit} {print}' "$BASE"

  # Inject the bypass routes
  echo "$POST_UP$POST_DOWN"

  # Then re-emit [Peer] and everything after
  awk '/^\[Peer\]/{p=1} p{print}' "$BASE"
} > "$OUT.tmp"

mv "$OUT.tmp" "$OUT"

echo "Wrote $OUT"
echo
echo "Bring tunnel UP:   sudo wg-quick up   $(pwd)/$OUT"
echo "Bring tunnel DOWN: sudo wg-quick down $(pwd)/$OUT"
