import os from 'node:os';

/**
 * Tailscale hands every machine an address in the 100.64.0.0/10 carrier-grade
 * NAT range. Binding to that address exposes the app to your tailnet without
 * also exposing it to whatever café wifi you are on.
 */
export function tailscaleAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && isCgnat(address.address)) return address.address;
    }
  }
  return null;
}

function isCgnat(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

/** `HTTP_HOST=tailscale` resolves at startup; anything else is used verbatim. */
export function resolveHost(host) {
  if (host !== 'tailscale') return host;

  const address = tailscaleAddress();
  if (!address) {
    throw new Error(
      'HTTP_HOST=tailscale 但找不到 Tailscale 介面。\n' +
        '請先確認 Tailscale 已啟動（`tailscale status`），或把 HTTP_HOST 改回 127.0.0.1。',
    );
  }
  return address;
}
