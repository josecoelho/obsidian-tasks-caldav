import { execSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';

execSync('npm run build', { stdio: 'inherit' });

const dest = 'test/wdio/vault/.obsidian/plugins/tasks-caldav-sync';
mkdirSync(dest, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css']) {
  cpSync(f, `${dest}/${f}`);
}
console.log('wdio fixture vault prepared');
