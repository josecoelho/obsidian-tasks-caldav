/**
 * CalDAV test fixture loader and response builder.
 *
 * Two modes of use:
 * 1. Load captured exchanges from caldav-responses/ (full request+response pairs)
 * 2. Build mock responses from templates + individual VTODO .ics files
 *
 * VTODOs in vtodos/ contain real server content (structure, formatting, quirks).
 * Templates in templates/ provide the XML envelopes.
 */
import * as fs from 'fs';
import * as path from 'path';

// ── Directory paths ──

const FIXTURES_DIR = path.join(__dirname, 'caldav-responses');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const VTODOS_DIR = path.join(__dirname, 'vtodos');

// ── Server constants (match sanitized fixture data) ──

export const FIXTURE_SERVER = {
	baseUrl: 'https://caldav.example.com',
	username: 'user@example.com',
	password: 'test-password',
	calendarName: 'Reminders',
	principalPath: '/dav/principals/user/user@example.com/',
	calendarHomePath: '/dav/calendars/user/user@example.com/',
	calendarPath: '/dav/calendars/user/user@example.com/CAL-VTODO-001/',
};

// ── Types ──

export interface CapturedExchange {
	step: string;
	description: string;
	timestamp: string;
	request: {
		method: string;
		url: string;
		headers: Record<string, string>;
		body?: string;
	};
	response: {
		status: number;
		headers: Record<string, string>;
		body: string;
	};
}

export interface VtodoFixture {
	uid: string;
	etag: string;
	icalData: string;
}

export interface CalendarFixture {
	path: string;
	displayName: string;
	componentType: 'VTODO' | 'VEVENT';
}

// ── Template loading ──

function loadTemplate(category: string, name: string): string {
	return fs.readFileSync(path.join(TEMPLATES_DIR, category, name), 'utf-8');
}

function fillTemplate(template: string, vars: Record<string, string>): string {
	let result = template;
	for (const [key, value] of Object.entries(vars)) {
		result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
	}
	return result;
}

// ── Request templates ──

export function requestPropfindPrincipal(): string {
	return loadTemplate('requests', 'propfind-principal.xml');
}

export function requestPropfindCalendarHome(): string {
	return loadTemplate('requests', 'propfind-calendar-home.xml');
}

export function requestPropfindCalendars(): string {
	return loadTemplate('requests', 'propfind-calendars.xml');
}

export function requestReportVtodos(): string {
	return loadTemplate('requests', 'report-vtodos.xml');
}

// ── Response builders ──

/** Build a principal discovery response (PROPFIND well-known or direct) */
export function buildPrincipalResponse(
	contextPath: string = '/dav/calendars',
	principalPath: string = FIXTURE_SERVER.principalPath,
): string {
	return fillTemplate(
		loadTemplate('responses', 'multistatus-principal.xml'),
		{ contextPath, principalPath },
	);
}

/** Build a calendar-home-set response */
export function buildCalendarHomeResponse(
	principalPath: string = FIXTURE_SERVER.principalPath,
	calendarHomePath: string = FIXTURE_SERVER.calendarHomePath,
): string {
	return fillTemplate(
		loadTemplate('responses', 'multistatus-calendar-home.xml'),
		{ principalPath, calendarHomePath },
	);
}

/** Build a calendar list response from calendar definitions */
export function buildCalendarListResponse(calendars: CalendarFixture[]): string {
	const entryTemplate = loadTemplate('responses', 'multistatus-calendar-entry.xml');
	const entries = calendars.map(cal =>
		fillTemplate(entryTemplate, {
			calendarPath: cal.path,
			displayName: cal.displayName,
			componentType: cal.componentType,
		})
	).join('\n');

	return fillTemplate(
		loadTemplate('responses', 'multistatus-wrapper.xml'),
		{ entries },
	);
}

/** Build a VTODO REPORT response from VTODO fixtures */
export function buildVtodoResponse(vtodos: VtodoFixture[]): string {
	const entryTemplate = loadTemplate('responses', 'multistatus-vtodo-entry.xml');
	const entries = vtodos.map(vtodo => {
		const uid = extractUIDFromIcal(vtodo.icalData);
		return fillTemplate(entryTemplate, {
			vtodoPath: `${FIXTURE_SERVER.calendarPath}${uid}.ics`,
			etag: vtodo.etag,
			icalData: vtodo.icalData,
		});
	}).join('\n');

	return fillTemplate(
		loadTemplate('responses', 'multistatus-wrapper.xml'),
		{ entries },
	);
}

// ── VTODO .ics loading ──

/** Load a VTODO .ics file by name (without extension) */
export function loadVtodo(name: string): VtodoFixture {
	const icalData = fs.readFileSync(path.join(VTODOS_DIR, `${name}.ics`), 'utf-8');
	const uid = extractUIDFromIcal(icalData);
	return {
		uid,
		etag: `etag-${uid}`,
		icalData,
	};
}

/** Load all VTODO .ics files from vtodos/ */
export function loadAllVtodos(): VtodoFixture[] {
	return fs.readdirSync(VTODOS_DIR)
		.filter(f => f.endsWith('.ics'))
		.map(f => loadVtodo(f.replace('.ics', '')));
}

function extractUIDFromIcal(data: string): string {
	const match = data.match(/^UID:(.+)$/m);
	return match ? match[1].trim() : '';
}

// ── Captured exchange loading (from caldav-responses/) ──

function loadCapturedExchange(filename: string): CapturedExchange {
	const filePath = path.join(FIXTURES_DIR, filename);
	return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function loadWellKnownDiscovery(): CapturedExchange {
	return loadCapturedExchange('01-propfind-well-known.json');
}

export function loadPrincipalDiscovery(): CapturedExchange {
	return loadCapturedExchange('02-propfind-principal.json');
}

export function loadCalendarList(): CapturedExchange {
	return loadCapturedExchange('03-propfind-calendars.json');
}

export function loadInitialVtodos(): CapturedExchange {
	return loadCapturedExchange('04-report-fetch-vtodos.json');
}

export function loadCreateVtodo(): CapturedExchange {
	return loadCapturedExchange('05-put-create-vtodo.json');
}

export function loadVtodosAfterCreate(): CapturedExchange {
	return loadCapturedExchange('06-report-fetch-after-create.json');
}

export function loadUpdateVtodo(): CapturedExchange {
	return loadCapturedExchange('07-put-update-vtodo.json');
}

export function loadVtodosAfterUpdate(): CapturedExchange {
	return loadCapturedExchange('08-report-fetch-after-update.json');
}

export function loadDeleteVtodo(): CapturedExchange {
	return loadCapturedExchange('09-delete-vtodo.json');
}

export function loadVtodosAfterDelete(): CapturedExchange {
	return loadCapturedExchange('10-report-fetch-after-delete.json');
}

export function loadDiscoverySequence(): CapturedExchange[] {
	return [loadWellKnownDiscovery(), loadPrincipalDiscovery(), loadCalendarList()];
}

export function loadAllFixtures(): Record<string, CapturedExchange> {
	const fixtures: Record<string, CapturedExchange> = {};
	const files = fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'));
	for (const file of files) {
		const exchange = loadCapturedExchange(file);
		fixtures[exchange.step] = exchange;
	}
	return fixtures;
}
