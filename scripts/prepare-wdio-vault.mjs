import { execSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';

execSync('npm run build', { stdio: 'inherit' });

const dests = [
  'test/wdio/vault/.obsidian/plugins/tasks-caldav-sync',
  'test/wdio/vault-dataview/.obsidian/plugins/tasks-caldav-sync',
];
for (const dest of dests) {
  mkdirSync(dest, { recursive: true });
  for (const f of ['main.js', 'manifest.json', 'styles.css']) {
    cpSync(f, `${dest}/${f}`);
  }
}
console.log('wdio fixture vaults prepared');
