#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// One-command release. Bumps the version files, commits, pushes master,
// and creates the GitHub release as a pre-release. It builds and uploads
// NOTHING locally — the `release` workflow (trigger: release: published)
// builds, attests, uploads the assets, and then promotes the pre-release
// to the latest stable release. Obsidian ignores pre-releases, so there
// is never a public window with missing assets.
//
//   npm run release 1.1.8                 bump -> push -> create release
//   npm run release 1.1.8 -- --skip-checks   skip the local preflight
//
// Requires the `gh` CLI, authenticated.

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

try {
	execFileSync('gh', ['release', 'view', version], { stdio: 'ignore' });
	console.error(`Error: release ${version} already exists. Bump to a new version.`);
	process.exit(1);
} catch {
	// No existing release — expected.
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

execFileSync('gh', [
	'release', 'create', version,
	'--target', 'master',
	'--title', version,
	'--generate-notes',
	'--prerelease',
], { stdio: 'inherit' });

console.log(`\nRelease ${version} created as a pre-release.`);
console.log('The release workflow is now building, attesting, and uploading');
console.log('assets, then promoting it to the latest stable release.');
