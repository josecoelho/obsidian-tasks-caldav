#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// One-command release. master is branch-protected (PR required, signed
// commits, Copilot review) with no bypass, so this script never pushes
// to master. It bumps the version files on a release/<version> branch,
// opens a PR, and enables auto-merge. The rest is fully in CI:
//
//   PR merges to master (GitHub signs the squash commit)
//     -> release-tag.yml sees the manifest.json version change,
//        creates the GitHub release as a pre-release, and calls
//        release.yml to build, attest, upload, and promote.
//
// For stable X.Y.Z versions, release.yml promotes to the latest stable
// release. For pre-release versions with a SemVer suffix (e.g.
// 1.3.0-beta.1), release.yml skips that promotion step — the release
// stays as a pre-release so BRAT beta-channel testers pick it up but
// stable Obsidian community users do not. This script also skips the
// versions.json update for pre-releases (that file only gates stable
// updates via Obsidian's community catalog).
//
// It builds and uploads NOTHING locally. Obsidian ignores pre-releases,
// so there is never a public window with missing assets.
//
//   npm run release 1.1.8                  stable bump -> PR -> auto-merge
//   npm run release 1.3.0-beta.1           pre-release (BRAT testers)
//   npm run release 1.1.8 -- --skip-checks  skip the local preflight
//
// Requires the `gh` CLI, authenticated.

const args = process.argv.slice(2);
const skipChecks = args.includes('--skip-checks');
const version = args.find((arg) => !arg.startsWith('-'));

if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
	console.error('Usage: npm run release <version>   (e.g. 1.1.8, or 1.3.0-beta.1 for a BRAT pre-release — no "v" prefix)');
	process.exit(1);
}
const isPrerelease = version.includes('-');

const branch = `release/${version}`;
const git = (...gitArgs) => execFileSync('git', gitArgs, { encoding: 'utf8' }).trim();
const fail = (message) => {
	console.error(`Error: ${message}`);
	process.exit(1);
};

if (git('branch', '--show-current') !== 'master') {
	fail('must be on master.');
}
if (git('status', '--porcelain', '--ignore-submodules')) {
	fail('working tree is not clean. Commit or stash first.');
}

git('fetch', 'origin', 'master', '--quiet');
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/master')) {
	fail('local master is not in sync with origin/master. Reconcile (git pull / reset) before releasing.');
}

try {
	execFileSync('gh', ['release', 'view', version], { stdio: 'ignore' });
	fail(`release ${version} already exists. Bump to a new version.`);
} catch {
	// No existing release — expected.
}

const branchExists = (ref) => {
	try {
		execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
};
if (branchExists(branch) || branchExists(`origin/${branch}`)) {
	fail(`branch ${branch} already exists. Delete it or pick a new version.`);
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, data) => writeFileSync(file, JSON.stringify(data, null, '\t') + '\n');

const manifest = readJson('manifest.json');
const pkg = readJson('package.json');
const versions = readJson('versions.json');

manifest.version = version;
pkg.version = version;
// versions.json only gates stable updates via Obsidian's community catalog;
// adding pre-release entries would pollute it.
if (!isPrerelease) {
	versions[version] = manifest.minAppVersion;
}

git('checkout', '-b', branch);

writeJson('manifest.json', manifest);
writeJson('package.json', pkg);
if (!isPrerelease) {
	writeJson('versions.json', versions);
}

if (!skipChecks) {
	console.log('Running preflight (lint, typecheck, unit tests)...');
	const run = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { stdio: 'inherit' });
	run('npm', ['run', 'lint']);
	run('npx', ['tsc', '-noEmit', '-skipLibCheck']);
	run('npm', ['run', 'test:unit']);
}

const filesToCommit = isPrerelease
	? ['manifest.json', 'package.json']
	: ['manifest.json', 'package.json', 'versions.json'];
git('add', ...filesToCommit);
git('commit', '-m', `chore: bump version to ${version}`);
git('push', '-u', 'origin', branch);

const prBody = isPrerelease
	? `Pre-release version bump to \`${version}\`.\n\n` +
		'When this merges, `release-tag.yml` creates the GitHub release ' +
		'(pre-release) and `release.yml` builds, attests, and uploads the ' +
		'assets. The release stays as a pre-release for BRAT testers; stable ' +
		'Obsidian community users are unaffected.'
	: `Version bump to \`${version}\`.\n\n` +
		'When this merges, `release-tag.yml` creates the GitHub release ' +
		'(pre-release) and `release.yml` builds, attests, uploads the ' +
		'assets, and promotes it to the latest stable release.';

const prUrl = execFileSync('gh', [
	'pr', 'create',
	'--base', 'master',
	'--head', branch,
	'--title', `chore: release ${version}`,
	'--body', prBody,
], { encoding: 'utf8' }).trim();

git('checkout', 'master');

let autoMerge = true;
try {
	// Squash so master gets a single GitHub-signed commit (required_signatures).
	execFileSync('gh', ['pr', 'merge', prUrl, '--auto', '--squash'], { stdio: 'inherit' });
} catch {
	autoMerge = false;
}

console.log(`\nRelease PR for ${version} opened: ${prUrl}`);
if (autoMerge) {
	console.log('Auto-merge (squash) is enabled — it merges once required');
	console.log('checks and review pass, then CI creates and publishes the release.');
} else {
	console.log('Could not enable auto-merge (repo setting may be off).');
	console.log('Merge the PR with "Squash and merge" once checks/review pass;');
	console.log('CI then creates and publishes the release automatically.');
}
