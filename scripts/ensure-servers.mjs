/**
 * Ensure Radicale and Vikunja are reachable. If not, start them via docker compose.
 * Exits cleanly if all servers are already running (from any worktree).
 */

const SERVERS = [
  { name: 'radicale', url: 'http://localhost:5232/.web/' },
  { name: 'vikunja', url: 'http://localhost:3457/api/v1/info' },
];
const TIMEOUT_MS = 2000;

async function isReachable(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const results = await Promise.all(
    SERVERS.map(async (s) => ({ ...s, up: await isReachable(s.url) }))
  );

  const allUp = results.every((r) => r.up);
  if (allUp) {
    console.log('[servers] All servers already running');
    return;
  }

  for (const r of results) {
    console.log(`[servers] ${r.name}: ${r.up ? 'running' : 'not reachable'}`);
  }

  console.log('[servers] Starting via docker compose...');
  const { execSync } = await import('child_process');
  try {
    execSync('docker compose up -d --wait', { stdio: 'inherit' });
  } catch {
    // If docker compose fails, check if they came up anyway
    const recheck = await Promise.all(
      SERVERS.map(async (s) => ({ ...s, up: await isReachable(s.url) }))
    );
    if (recheck.every((r) => r.up)) {
      console.log('[servers] All servers running (started by another project)');
      return;
    }
    process.exit(1);
  }
}

main();
