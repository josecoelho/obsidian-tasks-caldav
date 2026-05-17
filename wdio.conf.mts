import path from 'node:path';

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
