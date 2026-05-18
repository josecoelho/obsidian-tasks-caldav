#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Prepares a release without building or publishing anything locally.
// It bumps the version files, commits, and pushes master. The GitHub
// Actions `release` workflow builds, attests, and uploads the assets
// once you publish the release in the GitHub UI.
//
//   npm run release 1.1.8                 bump -> commit -> push master
//   npm run release 1.1.8 -- --skip-checks   skip the local preflight

const args = process.argv.slice(2);
const skipChecks = args.includes('--skip-checks');
const version = args.find((arg) => !arg.startsWith('-'));

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
	console.error('Usage: npm run release <version>   (e.g. 1.1.8 — no "v" prefix)');
	process.exit(1);
}

const git = (...gitArgs) => execFileSync('git', gitArgs, { encoding: 'utf8' }).trim();

if (git('branch', '--show-current') !== 'master') {
	console.error('Error: must be on master.');
	process.exit(1);
}
if (git('status', '--porcelain', '--ignore-submodules')) {
	console.error('Error: working tree is not clean. Commit or stash first.');
	process.exit(1);
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, data) => writeFileSync(file, JSON.stringify(data, null, '\t') + '\n');

const manifest = readJson('manifest.json');
const pkg = readJson('package.json');
const versions = readJson('versions.json');

manifest.version = version;
pkg.version = version;
versions[version] = manifest.minAppVersion;

writeJson('manifest.json', manifest);
writeJson('package.json', pkg);
writeJson('versions.json', versions);

if (!skipChecks) {
	console.log('Running preflight (lint, typecheck, unit tests)...');
	const run = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { stdio: 'inherit' });
	run('npm', ['run', 'lint']);
	run('npx', ['tsc', '-noEmit', '-skipLibCheck']);
	run('npm', ['run', 'test:unit']);
}

git('add', 'manifest.json', 'package.json', 'versions.json');
git('commit', '-m', `chore: bump version to ${version}`);
git('push', 'origin', 'master');

const slug = git('remote', 'get-url', 'origin')
	.replace(/^git@github\.com:/, '')
	.replace(/^https:\/\/github\.com\//, '')
	.replace(/\.git$/, '');

console.log(`\nVersion ${version} committed and pushed to master.\n`);
console.log('Next: publish the release in GitHub (tag = version, target = master):');
console.log(`  https://github.com/${slug}/releases/new?tag=${version}&target=master\n`);
console.log('The release workflow will build, attest, and upload the assets.');
