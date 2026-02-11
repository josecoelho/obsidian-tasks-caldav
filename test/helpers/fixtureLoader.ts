/**
 * CalDAV test fixture loader and response builder.
 *
 * Builds mock CalDAV responses from Mustache templates + individual VTODO .ics files.
 * VTODOs in fixtures/vtodos/ are real server content (structure, formatting, quirks).
 * Templates in fixtures/templates/ provide the XML envelopes.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as Mustache from 'mustache';

// ── Directory paths ──

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');
const TEMPLATES_DIR = path.join(FIXTURES_DIR, 'templates');
const VTODOS_DIR = path.join(FIXTURES_DIR, 'vtodos');

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
	return Mustache.render(template, vars);
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

function extractUIDFromIcal(data: string): string {
	const match = data.match(/^UID:(.+)$/m);
	return match ? match[1].trim() : '';
}
