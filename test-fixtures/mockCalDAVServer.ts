/**
 * Stateful mock CalDAV server that intercepts requestUrl calls.
 *
 * Routes requests to fixture-based responses without any real HTTP.
 * Tracks VTODOs in memory so create/update/delete change state
 * and subsequent fetches reflect those changes.
 */
import { requestUrl } from 'obsidian';
import * as crypto from 'crypto';
import {
	FIXTURE_SERVER,
	VtodoFixture,
	CalendarFixture,
	loadVtodo,
	buildPrincipalResponse,
	buildCalendarHomeResponse,
	buildCalendarListResponse,
	buildVtodoResponse,
} from './fixtureLoader';

interface MockConfig {
	serverUrl?: string;
	username?: string;
	password?: string;
	calendarName?: string;
}

interface StoredVtodo {
	icalData: string;
	etag: string;
}

interface MockRequest {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	throw?: boolean;
}

interface MockResponse {
	status: number;
	text: string;
	headers: Record<string, string>;
}

export class MockCalDAVServer {
	private serverUrl: string;
	private username: string;
	private password: string;
	private calendarName: string;

	private vtodos: Map<string, StoredVtodo> = new Map();
	private calendars: CalendarFixture[];
	private etagCounter = 0;

	constructor(config: MockConfig = {}) {
		this.serverUrl = config.serverUrl ?? FIXTURE_SERVER.baseUrl;
		this.username = config.username ?? FIXTURE_SERVER.username;
		this.password = config.password ?? FIXTURE_SERVER.password;
		this.calendarName = config.calendarName ?? FIXTURE_SERVER.calendarName;

		// Default calendar list: one VTODO calendar with the configured name
		this.calendars = [
			{
				path: FIXTURE_SERVER.calendarPath,
				displayName: this.calendarName,
				componentType: 'VTODO',
			},
		];
	}

	// ── Setup ──

	/** Load a VTODO from test-fixtures/vtodos/{name}.ics */
	addVtodo(name: string): void {
		const fixture = loadVtodo(name);
		this.vtodos.set(fixture.uid, {
			icalData: fixture.icalData,
			etag: fixture.etag,
		});
	}

	/** Add a VTODO from raw iCal data */
	addVtodoRaw(uid: string, icalData: string, etag?: string): void {
		this.vtodos.set(uid, {
			icalData,
			etag: etag ?? this.generateEtag(icalData),
		});
	}

	/** Override the calendar list */
	setCalendars(calendars: CalendarFixture[]): void {
		this.calendars = calendars;
	}

	// ── Install/Teardown ──

	/** Wire requestUrl mock to this server */
	install(): void {
		(requestUrl as jest.Mock).mockImplementation(
			(params: MockRequest) => this.handleRequest(params)
		);
	}

	/** Clear state and restore mock */
	reset(): void {
		this.vtodos.clear();
		this.etagCounter = 0;
		(requestUrl as jest.Mock).mockReset();
	}

	// ── Core request handler ──

	handleRequest(params: MockRequest): MockResponse {
		const { url, method = 'GET', headers = {}, body = '' } = params;
		const upperMethod = method.toUpperCase();

		// PROPFIND — discovery
		if (upperMethod === 'PROPFIND') {
			return this.handlePropfind(url, headers, body);
		}

		// REPORT — fetch VTODOs
		if (upperMethod === 'REPORT') {
			return this.handleReport(url);
		}

		// PUT — create or update
		if (upperMethod === 'PUT') {
			return this.handlePut(url, headers, body);
		}

		// DELETE
		if (upperMethod === 'DELETE') {
			return this.handleDelete(url, headers);
		}

		return { status: 405, text: 'Method Not Allowed', headers: {} };
	}

	// ── PROPFIND routing ──

	private handlePropfind(url: string, headers: Record<string, string>, body: string): MockResponse {
		const parsedUrl = new URL(url);
		const path = parsedUrl.pathname;

		// Well-known CalDAV endpoint
		if (path === '/.well-known/caldav') {
			return this.respondXml(207, buildPrincipalResponse(
				'/.well-known/caldav',
				FIXTURE_SERVER.principalPath,
			));
		}

		// Principal → calendar-home-set
		if (path.includes('/principals/')) {
			return this.respondXml(207, buildCalendarHomeResponse(
				FIXTURE_SERVER.principalPath,
				FIXTURE_SERVER.calendarHomePath,
			));
		}

		// Calendar home → calendar list (Depth: 1)
		if (path.includes('/calendars/') && (headers['Depth'] === '1' || headers['depth'] === '1')) {
			return this.respondXml(207, buildCalendarListResponse(this.calendars));
		}

		// Fallback: treat as principal discovery on the server root
		if (body.includes('current-user-principal')) {
			return this.respondXml(207, buildPrincipalResponse(
				path,
				FIXTURE_SERVER.principalPath,
			));
		}

		return { status: 404, text: 'Not Found', headers: {} };
	}

	// ── REPORT routing ──

	private handleReport(url: string): MockResponse {
		const vtodoFixtures: VtodoFixture[] = [];
		for (const [uid, stored] of this.vtodos) {
			vtodoFixtures.push({
				uid,
				etag: stored.etag,
				icalData: stored.icalData,
			});
		}
		return this.respondXml(207, buildVtodoResponse(vtodoFixtures));
	}

	// ── PUT routing (create / update) ──

	private handlePut(url: string, headers: Record<string, string>, body: string): MockResponse {
		const uid = this.extractUidFromUrl(url);
		if (!uid) {
			return { status: 400, text: 'Bad Request: cannot determine UID from URL', headers: {} };
		}

		const ifNoneMatch = headers['If-None-Match'] || headers['if-none-match'];
		const ifMatch = headers['If-Match'] || headers['if-match'];

		// Create: If-None-Match: *
		if (ifNoneMatch === '*') {
			if (this.vtodos.has(uid)) {
				return { status: 412, text: 'Precondition Failed: VTODO already exists', headers: {} };
			}
			const etag = this.generateEtag(body);
			this.vtodos.set(uid, { icalData: body, etag });
			return {
				status: 201,
				text: 'Created',
				headers: { 'ETag': `"${etag}"` },
			};
		}

		// Update: If-Match: "etag"
		if (ifMatch) {
			const existing = this.vtodos.get(uid);
			if (!existing) {
				return { status: 404, text: 'Not Found', headers: {} };
			}
			const expectedEtag = ifMatch.replace(/"/g, '');
			if (existing.etag !== expectedEtag) {
				return { status: 412, text: 'Precondition Failed: ETag mismatch', headers: {} };
			}
			const newEtag = this.generateEtag(body);
			this.vtodos.set(uid, { icalData: body, etag: newEtag });
			return {
				status: 204,
				text: '',
				headers: { 'ETag': `"${newEtag}"` },
			};
		}

		// No precondition headers — unconditional PUT (update or create)
		const etag = this.generateEtag(body);
		const isCreate = !this.vtodos.has(uid);
		this.vtodos.set(uid, { icalData: body, etag });
		return {
			status: isCreate ? 201 : 204,
			text: '',
			headers: { 'ETag': `"${etag}"` },
		};
	}

	// ── DELETE routing ──

	private handleDelete(url: string, headers: Record<string, string>): MockResponse {
		const uid = this.extractUidFromUrl(url);
		if (!uid) {
			return { status: 400, text: 'Bad Request', headers: {} };
		}

		const existing = this.vtodos.get(uid);
		if (!existing) {
			return { status: 404, text: 'Not Found', headers: {} };
		}

		const ifMatch = headers['If-Match'] || headers['if-match'];
		if (ifMatch) {
			const expectedEtag = ifMatch.replace(/"/g, '');
			if (existing.etag !== expectedEtag) {
				return { status: 412, text: 'Precondition Failed: ETag mismatch', headers: {} };
			}
		}

		this.vtodos.delete(uid);
		return { status: 204, text: '', headers: {} };
	}

	// ── Helpers ──

	private respondXml(status: number, body: string): MockResponse {
		return {
			status,
			text: body,
			headers: { 'Content-Type': 'application/xml; charset=utf-8' },
		};
	}

	private generateEtag(content: string): string {
		this.etagCounter++;
		const hash = crypto.createHash('sha1').update(content).digest('hex').substring(0, 12);
		return `${hash}-${this.etagCounter}`;
	}

	private extractUidFromUrl(url: string): string | null {
		// URL pattern: .../uid.ics
		const match = url.match(/\/([^/]+)\.ics$/);
		return match ? match[1] : null;
	}

	/** Get current VTODO count (for assertions) */
	get vtodoCount(): number {
		return this.vtodos.size;
	}

	/** Get stored etag for a UID (for assertions) */
	getEtag(uid: string): string | undefined {
		return this.vtodos.get(uid)?.etag;
	}

	/** Check if a UID exists in the store */
	hasVtodo(uid: string): boolean {
		return this.vtodos.has(uid);
	}
}
