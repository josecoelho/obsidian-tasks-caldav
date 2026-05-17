/**
 * Ensure E2E servers are reachable. If not, start them via docker compose.
 * Exits cleanly if all required servers are already running.
 *
 * Usage:
 *   node ensure-servers.mjs           # Check/start all servers
 *   node ensure-servers.mjs --only radicale  # Check/start only radicale
 */

const SERVERS = [
  { name: 'radicale', url: 'http://localhost:5232/.web/' },
  { name: 'vikunja', url: 'http://localhost:3457/api/v1/info' },
  { name: 'nextcloud', url: 'http://localhost:8080/status.php' },
  { name: 'baikal', url: 'http://localhost:8081/admin/' },
];
const TIMEOUT_MS = 2000;

function parseArgs() {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf('--only');
  if (onlyIdx !== -1 && args[onlyIdx + 1]) {
    return args[onlyIdx + 1];
  }
  return null;
}

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
  const only = parseArgs();
  const servers = only
    ? SERVERS.filter((s) => s.name === only)
    : SERVERS;

  if (only && servers.length === 0) {
    console.error(`[servers] Unknown server: ${only}`);
    process.exit(1);
  }

  const results = await Promise.all(
    servers.map(async (s) => ({ ...s, up: await isReachable(s.url) }))
  );

  const allUp = results.every((r) => r.up);
  if (allUp) {
    console.log(`[servers] ${only ? only : 'All servers'} already running`);
    return;
  }

  for (const r of results) {
    console.log(`[servers] ${r.name}: ${r.up ? 'running' : 'not reachable'}`);
  }

  console.log('[servers] Starting via docker compose...');
  const { execSync } = await import('child_process');
  const serviceNames = only ? only : servers.map((s) => s.name).join(' ');
  try {
    execSync(`docker compose up -d --wait ${serviceNames}`, { stdio: 'inherit' });
  } catch {
    // If docker compose fails, check if they came up anyway
    const recheck = await Promise.all(
      servers.map(async (s) => ({ ...s, up: await isReachable(s.url) }))
    );
    if (recheck.every((r) => r.up)) {
      console.log('[servers] All required servers running (started by another project)');
      return;
    }
    process.exit(1);
  }
}

main();
