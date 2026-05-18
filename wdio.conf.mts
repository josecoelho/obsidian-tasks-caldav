import path from 'node:path';

// Pin a non-UTC zone so completion-date timezone behavior (issue #43) is
// exercised deterministically in the real Obsidian/Electron process. Auckland
// is UTC+13 in January, far from UTC, so a UTC COMPLETED on the previous day
// must still render as today's local date. Overridable via the TZ env var.
process.env.TZ = process.env.TZ || 'Pacific/Auckland';

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',
  reporters: ['obsidian'],
  services: ['obsidian'],
  specs: ['./test/wdio/specs/**/*.e2e.ts'],
  maxInstances: 1,
  capabilities: [{
    browserName: 'obsidian',
    browserVersion: 'latest',
    'wdio:obsidianOptions': {
      installerVersion: 'latest',
      plugins: [
        path.resolve('test/wdio/vault/.obsidian/plugins/tasks-caldav-sync'),
        { id: 'obsidian-tasks-plugin' },
      ],
      vault: path.resolve('test/wdio/vault'),
    },
  }],
  cacheDir: path.resolve('.obsidian-cache'),
  mochaOpts: { ui: 'bdd', timeout: 120000 },
  logLevel: 'warn',
};
