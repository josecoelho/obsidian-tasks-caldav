/**
 * Ensure Radicale is reachable. If not, start it via docker compose.
 * Exits cleanly if the server is already running (from any worktree).
 */

const RADICALE_URL = 'http://localhost:5232/.web/';
const TIMEOUT_MS = 2000;

async function isReachable() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(RADICALE_URL, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  if (await isReachable()) {
    console.log('[radicale] Already running on :5232');
    return;
  }

  console.log('[radicale] Starting via docker compose...');
  const { execSync } = await import('child_process');
  try {
    execSync('docker compose up -d --wait', { stdio: 'inherit' });
  } catch {
    // If docker compose fails (port taken by another compose project), check again
    if (await isReachable()) {
      console.log('[radicale] Already running (started by another project)');
      return;
    }
    process.exit(1);
  }
}

main();
