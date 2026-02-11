import { App, requestUrl } from 'obsidian';
import { CalDAVSettings } from '../types';
import { CalDAVClientDirect } from './calDAVClientDirect';
import { VTODOMapper } from './vtodoMapper';

interface CapturedExchange {
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

const TEST_UID = 'obsidian-dump-test-001';
const DUMP_DIR = '.caldav-sync/test-caldav-requests';

function redactHeaders(headers: Record<string, string>): Record<string, string> {
	const redacted = { ...headers };
	if (redacted['Authorization']) {
		redacted['Authorization'] = redacted['Authorization'].replace(/Basic .+/, 'Basic <REDACTED>');
	}
	return redacted;
}

async function capturedRequest(
	step: string,
	description: string,
	method: string,
	url: string,
	headers: Record<string, string>,
	body?: string
): Promise<{ exchange: CapturedExchange; response: { status: number; text: string; headers: Record<string, string> } }> {
	const response = await requestUrl({
		url,
		method,
		headers,
		body,
		throw: false
	});

	const responseHeaders: Record<string, string> = {};
	if (response.headers) {
		for (const [k, v] of Object.entries(response.headers)) {
			responseHeaders[k] = String(v);
		}
	}

	const exchange: CapturedExchange = {
		step,
		description,
		timestamp: new Date().toISOString(),
		request: {
			method,
			url,
			headers: redactHeaders(headers),
			...(body ? { body } : {})
		},
		response: {
			status: response.status,
			headers: responseHeaders,
			body: response.text
		}
	};

	return { exchange, response: { status: response.status, text: response.text, headers: responseHeaders } };
}

function buildTestVTODO(uid: string, completed: boolean): string {
	const now = new Date();
	const dtstamp = formatDateTimeUTC(now);
	const tomorrow = new Date(now);
	tomorrow.setDate(tomorrow.getDate() + 1);
	const dueDate = formatDateOnly(tomorrow);
	const startDate = formatDateOnly(now);

	const lines: string[] = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Obsidian//Tasks CalDAV Sync//EN',
		'BEGIN:VTODO',
		`UID:${uid}`,
		`DTSTAMP:${dtstamp}`,
		`LAST-MODIFIED:${dtstamp}`,
		'SUMMARY:Dump test task — all fields',
		completed ? 'STATUS:COMPLETED' : 'STATUS:NEEDS-ACTION',
		`DUE;VALUE=DATE:${dueDate}`,
		`DTSTART;VALUE=DATE:${startDate}`,
		completed ? 'PRIORITY:1' : 'PRIORITY:5',
		'CATEGORIES:sync,test,dump',
		'DESCRIPTION:Test task created by CalDAV request dumper for fixture generation.',
		'RRULE:FREQ=WEEKLY;BYDAY=MO',
	];

	if (completed) {
		lines.push(`COMPLETED:${dtstamp}`);
		lines.push('PERCENT-COMPLETE:100');
	}

	lines.push('END:VTODO');
	lines.push('END:VCALENDAR');

	return lines.join('\r\n');
}

function formatDateTimeUTC(date: Date): string {
	const y = date.getUTCFullYear();
	const m = String(date.getUTCMonth() + 1).padStart(2, '0');
	const d = String(date.getUTCDate()).padStart(2, '0');
	const h = String(date.getUTCHours()).padStart(2, '0');
	const mi = String(date.getUTCMinutes()).padStart(2, '0');
	const s = String(date.getUTCSeconds()).padStart(2, '0');
	return `${y}${m}${d}T${h}${mi}${s}Z`;
}

function formatDateOnly(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}${m}${d}`;
}

/**
 * Dump all CalDAV request/response exchanges to JSON fixture files.
 * Performs: discovery → fetch → create → fetch → update → fetch → delete → fetch
 */
export async function dumpCalDAVRequests(app: App, settings: CalDAVSettings): Promise<string> {
	const log: string[] = [];
	const exchanges: CapturedExchange[] = [];
	const mapper = new VTODOMapper();

	const authHeader = 'Basic ' + btoa(`${settings.username}:${settings.password}`);
	const xmlHeaders = {
		'Authorization': authHeader,
		'Content-Type': 'application/xml; charset=utf-8',
		'Depth': '0'
	};

	const propfindPrincipalBody = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:current-user-principal />
  </d:prop>
</d:propfind>`;

	const propfindHomeBody = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-home-set />
  </d:prop>
</d:propfind>`;

	const propfindCalendarsBody = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname />
    <d:resourcetype />
    <c:supported-calendar-component-set />
  </d:prop>
</d:propfind>`;

	const reportBody = `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VTODO" />
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

	function addLog(msg: string) {
		const ts = new Date().toISOString();
		log.push(`[${ts}] ${msg}`);
		console.log(`[CalDAV Dump] ${msg}`);
	}

	// Ensure dump directory exists
	const adapter = app.vault.adapter;
	if (!(await adapter.exists(DUMP_DIR))) {
		await adapter.mkdir(DUMP_DIR);
	}

	async function saveExchange(exchange: CapturedExchange) {
		exchanges.push(exchange);
		const path = `${DUMP_DIR}/${exchange.step}.json`;
		await adapter.write(path, JSON.stringify(exchange, null, 2));
		addLog(`  Saved ${path} (${exchange.response.status})`);
	}

	try {
		// ── Step 1: Well-known discovery ──
		addLog('Step 1: PROPFIND well-known CalDAV endpoint');
		const baseUrl = new URL(settings.serverUrl);
		const wellKnownUrl = `${baseUrl.protocol}//${baseUrl.host}/.well-known/caldav`;

		const wk = await capturedRequest(
			'01-propfind-well-known',
			'Discover CalDAV via /.well-known/caldav',
			'PROPFIND',
			wellKnownUrl,
			xmlHeaders,
			propfindPrincipalBody
		);
		await saveExchange(wk.exchange);

		let principalXml: string;
		let principalContextUrl: string;

		if (wk.response.status === 207) {
			addLog('  Well-known succeeded');
			principalXml = wk.response.text;
			principalContextUrl = wellKnownUrl;
		} else {
			// Step 1b: Fallback to direct PROPFIND
			addLog('  Well-known failed, trying direct PROPFIND');
			const direct = await capturedRequest(
				'01b-propfind-direct',
				'Fallback: PROPFIND on server URL for current-user-principal',
				'PROPFIND',
				settings.serverUrl,
				xmlHeaders,
				propfindPrincipalBody
			);
			await saveExchange(direct.exchange);

			if (direct.response.status !== 207) {
				throw new Error(`PROPFIND failed: ${direct.response.status}`);
			}

			principalXml = direct.response.text;
			principalContextUrl = settings.serverUrl;
		}

		// Extract principal URL
		const principalMatch = principalXml.match(/<d:current-user-principal>\s*<d:href>([^<]+)<\/d:href>/);
		if (!principalMatch) {
			throw new Error('Could not find current-user-principal in response');
		}
		let principalUrl = principalMatch[1];
		if (!principalUrl.startsWith('http')) {
			const pu = new URL(principalContextUrl);
			principalUrl = `${pu.protocol}//${pu.host}${principalUrl}`;
		}
		addLog(`  Principal URL: ${principalUrl}`);

		// ── Step 2: Get calendar-home-set ──
		addLog('Step 2: PROPFIND principal for calendar-home-set');
		const step2 = await capturedRequest(
			'02-propfind-principal',
			'Get calendar-home-set from principal',
			'PROPFIND',
			principalUrl,
			xmlHeaders,
			propfindHomeBody
		);
		await saveExchange(step2.exchange);

		if (step2.response.status !== 207) {
			throw new Error(`Failed to get calendar-home-set: ${step2.response.status}`);
		}

		const homeMatch = step2.response.text.match(/<c:calendar-home-set>\s*<d:href>([^<]+)<\/d:href>/);
		if (!homeMatch) {
			throw new Error('Could not find calendar-home-set in principal response');
		}
		let homeUrl = homeMatch[1];
		if (!homeUrl.startsWith('http')) {
			const hu = new URL(principalUrl);
			homeUrl = `${hu.protocol}//${hu.host}${homeUrl}`;
		}
		addLog(`  Calendar home: ${homeUrl}`);

		// ── Step 3: List calendars ──
		addLog('Step 3: PROPFIND calendars (Depth: 1)');
		const step3 = await capturedRequest(
			'03-propfind-calendars',
			'List calendars (Depth: 1)',
			'PROPFIND',
			homeUrl,
			{ ...xmlHeaders, 'Depth': '1' },
			propfindCalendarsBody
		);
		await saveExchange(step3.exchange);

		if (step3.response.status !== 207) {
			throw new Error(`PROPFIND calendars failed: ${step3.response.status}`);
		}

		const calendars = CalDAVClientDirect.parseCalendarsFromXML(step3.response.text, settings.serverUrl);
		addLog(`  Found ${calendars.length} calendars: ${calendars.map(c => c.displayName).join(', ')}`);

		const calendar = calendars.find(c => c.displayName === settings.calendarName);
		if (!calendar) {
			throw new Error(`Calendar '${settings.calendarName}' not found. Available: ${calendars.map(c => c.displayName).join(', ')}`);
		}
		const calendarUrl = calendar.url;
		addLog(`  Using calendar: ${calendarUrl}`);

		const reportHeaders = {
			'Authorization': authHeader,
			'Content-Type': 'application/xml; charset=utf-8',
			'Depth': '1'
		};

		// ── Step 4: Fetch all VTODOs (initial state) ──
		addLog('Step 4: REPORT fetch all VTODOs (initial state)');
		const step4 = await capturedRequest(
			'04-report-fetch-vtodos',
			'Fetch all VTODOs from calendar',
			'REPORT',
			calendarUrl,
			reportHeaders,
			reportBody
		);
		await saveExchange(step4.exchange);

		const initialVtodos = CalDAVClientDirect.parseVTODOsFromXML(step4.response.text, settings.serverUrl);
		addLog(`  Found ${initialVtodos.length} VTODOs`);

		// Clean up any leftover test VTODO from previous run
		const existing = initialVtodos.find(v => mapper.extractUID(v.data) === TEST_UID);
		if (existing) {
			addLog(`  Cleaning up leftover test VTODO (${TEST_UID})`);
			const deleteHeaders: Record<string, string> = { 'Authorization': authHeader };
			if (existing.etag) {
				deleteHeaders['If-Match'] = `"${existing.etag}"`;
			}
			await requestUrl({ url: existing.url, method: 'DELETE', headers: deleteHeaders, throw: false });
		}

		// ── Step 5: Create test VTODO ──
		addLog('Step 5: PUT create test VTODO');
		const vtodoData = buildTestVTODO(TEST_UID, false);
		const createUrl = `${calendarUrl.replace(/\/+$/, '')}/${TEST_UID}.ics`;
		const step5 = await capturedRequest(
			'05-put-create-vtodo',
			'Create test VTODO with all fields',
			'PUT',
			createUrl,
			{
				'Authorization': authHeader,
				'Content-Type': 'text/calendar; charset=utf-8',
				'If-None-Match': '*'
			},
			vtodoData
		);
		await saveExchange(step5.exchange);

		if (step5.response.status !== 201 && step5.response.status !== 204) {
			throw new Error(`Create VTODO failed: ${step5.response.status}`);
		}
		addLog(`  Created (${step5.response.status})`);

		// ── Step 6: Fetch after create ──
		addLog('Step 6: REPORT fetch after create');
		const step6 = await capturedRequest(
			'06-report-fetch-after-create',
			'Fetch all VTODOs after creating test task',
			'REPORT',
			calendarUrl,
			reportHeaders,
			reportBody
		);
		await saveExchange(step6.exchange);

		const afterCreateVtodos = CalDAVClientDirect.parseVTODOsFromXML(step6.response.text, settings.serverUrl);
		const created = afterCreateVtodos.find(v => mapper.extractUID(v.data) === TEST_UID);
		if (!created) {
			throw new Error('Test VTODO not found after creation');
		}
		addLog(`  Test VTODO found, etag: ${created.etag}`);

		// ── Step 7: Update test VTODO (mark completed, change priority) ──
		addLog('Step 7: PUT update test VTODO (completed + priority 1)');
		const updatedVtodoData = buildTestVTODO(TEST_UID, true);
		const updateHeaders: Record<string, string> = {
			'Authorization': authHeader,
			'Content-Type': 'text/calendar; charset=utf-8'
		};
		if (created.etag) {
			updateHeaders['If-Match'] = `"${created.etag}"`;
		}
		const step7 = await capturedRequest(
			'07-put-update-vtodo',
			'Update test VTODO — mark completed, change priority',
			'PUT',
			created.url,
			updateHeaders,
			updatedVtodoData
		);
		await saveExchange(step7.exchange);

		if (step7.response.status !== 204 && step7.response.status !== 200) {
			throw new Error(`Update VTODO failed: ${step7.response.status}`);
		}
		addLog(`  Updated (${step7.response.status})`);

		// ── Step 8: Fetch after update ──
		addLog('Step 8: REPORT fetch after update');
		const step8 = await capturedRequest(
			'08-report-fetch-after-update',
			'Fetch all VTODOs after updating test task',
			'REPORT',
			calendarUrl,
			reportHeaders,
			reportBody
		);
		await saveExchange(step8.exchange);

		const afterUpdateVtodos = CalDAVClientDirect.parseVTODOsFromXML(step8.response.text, settings.serverUrl);
		const updated = afterUpdateVtodos.find(v => mapper.extractUID(v.data) === TEST_UID);
		if (!updated) {
			throw new Error('Test VTODO not found after update');
		}
		addLog(`  Updated VTODO found, etag: ${updated.etag}`);

		// ── Step 9: Delete test VTODO ──
		addLog('Step 9: DELETE test VTODO');
		const deleteHeaders: Record<string, string> = { 'Authorization': authHeader };
		if (updated.etag) {
			deleteHeaders['If-Match'] = `"${updated.etag}"`;
		}
		const step9 = await capturedRequest(
			'09-delete-vtodo',
			'Delete test VTODO',
			'DELETE',
			updated.url,
			deleteHeaders
		);
		await saveExchange(step9.exchange);

		if (step9.response.status !== 204 && step9.response.status !== 200) {
			throw new Error(`Delete VTODO failed: ${step9.response.status}`);
		}
		addLog(`  Deleted (${step9.response.status})`);

		// ── Step 10: Fetch after delete (confirm cleanup) ──
		addLog('Step 10: REPORT fetch after delete (confirm cleanup)');
		const step10 = await capturedRequest(
			'10-report-fetch-after-delete',
			'Final state — confirm test VTODO is gone',
			'REPORT',
			calendarUrl,
			reportHeaders,
			reportBody
		);
		await saveExchange(step10.exchange);

		const finalVtodos = CalDAVClientDirect.parseVTODOsFromXML(step10.response.text, settings.serverUrl);
		const stillExists = finalVtodos.find(v => mapper.extractUID(v.data) === TEST_UID);
		if (stillExists) {
			addLog('  WARNING: Test VTODO still exists after delete!');
		} else {
			addLog('  Confirmed: test VTODO deleted');
		}
		addLog(`  Final VTODO count: ${finalVtodos.length}`);

		// ── Write dump log ──
		const summary = `CalDAV Request Dump — ${new Date().toISOString()}
Server: ${settings.serverUrl}
Calendar: ${settings.calendarName}
Files: ${exchanges.length} exchanges saved

${log.join('\n')}
`;
		await adapter.write(`${DUMP_DIR}/dump-log.txt`, summary);

		const result = `Dump complete: ${exchanges.length} exchanges saved to ${DUMP_DIR}/`;
		addLog(result);
		return result;

	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		addLog(`ERROR: ${errMsg}`);

		// Save log even on failure
		const summary = `CalDAV Request Dump (FAILED) — ${new Date().toISOString()}
Server: ${settings.serverUrl}
Error: ${errMsg}

${log.join('\n')}
`;
		try {
			await adapter.write(`${DUMP_DIR}/dump-log.txt`, summary);
		} catch { /* ignore write failure */ }

		throw new Error(`Dump failed: ${errMsg}`);
	}
}
