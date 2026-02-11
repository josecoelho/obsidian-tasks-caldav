import { requestUrl } from 'obsidian';
import { CalDAVClientDirect } from './calDAVClientDirect';
import { VTODOMapper } from './vtodoMapper';
import { CalDAVSettings } from '../types';
import { MockCalDAVServer } from '../../test-fixtures/mockCalDAVServer';
import { FIXTURE_SERVER, CalendarFixture } from '../../test-fixtures/fixtureLoader';

const mockSettings: CalDAVSettings = {
	serverUrl: FIXTURE_SERVER.baseUrl,
	username: FIXTURE_SERVER.username,
	password: FIXTURE_SERVER.password,
	calendarName: FIXTURE_SERVER.calendarName,
	syncTag: '',
	syncInterval: 5,
	newTasksDestination: 'Inbox.md',
	newTasksSection: '',
	requireManualConflictResolution: false,
	autoResolveObsidianWins: true,
	syncCompletedTasks: true,
	deleteBehavior: 'ask',
};

describe('CalDAVClientDirect integration (mock server)', () => {
	let server: MockCalDAVServer;
	let client: CalDAVClientDirect;
	const mapper = new VTODOMapper();

	beforeEach(() => {
		server = new MockCalDAVServer();
		server.install();
		client = new CalDAVClientDirect(mockSettings);
	});

	afterEach(() => {
		server.reset();
	});

	// ── Discovery flow (connect) ──

	describe('connect — discovery flow', () => {
		it('discovers calendar via well-known → principal → calendar-home → calendar list', async () => {
			await client.connect();
			expect(client.isConnected()).toBe(true);
		});

		it('finds VTODO-supporting calendar among mixed calendar types', async () => {
			server.setCalendars([
				{ path: '/dav/calendars/user/user@example.com/events/', displayName: 'Events', componentType: 'VEVENT' },
				{ path: FIXTURE_SERVER.calendarPath, displayName: FIXTURE_SERVER.calendarName, componentType: 'VTODO' },
				{ path: '/dav/calendars/user/user@example.com/work/', displayName: 'Work', componentType: 'VEVENT' },
			]);
			await client.connect();
			expect(client.isConnected()).toBe(true);
		});

		it('throws when calendar name not found', async () => {
			const settings = { ...mockSettings, calendarName: 'Nonexistent' };
			const badClient = new CalDAVClientDirect(settings);
			await expect(badClient.connect()).rejects.toThrow("Calendar 'Nonexistent' not found");
		});

		it('verifies correct auth header is sent', async () => {
			await client.connect();
			const calls = (requestUrl as jest.Mock).mock.calls;
			expect(calls.length).toBeGreaterThan(0);
			const firstCall = calls[0][0];
			expect(firstCall.headers.Authorization).toMatch(/^Basic /);
			const decoded = atob(firstCall.headers.Authorization.replace('Basic ', ''));
			expect(decoded).toBe(`${FIXTURE_SERVER.username}:${FIXTURE_SERVER.password}`);
		});
	});

	// ── Fetch VTODOs ──

	describe('fetchVTODOs — with real fixture data', () => {
		beforeEach(async () => {
			await client.connect();
		});

		it('returns empty array when no VTODOs on server', async () => {
			const vtodos = await client.fetchVTODOs();
			expect(vtodos).toHaveLength(0);
		});

		it('parses simple Apple iOS completed task', async () => {
			server.addVtodo('2133451409859410883');
			const vtodos = await client.fetchVTODOs();

			expect(vtodos).toHaveLength(1);
			expect(vtodos[0].etag).toBeDefined();
			expect(vtodos[0].url).toContain('2133451409859410883.ics');
			expect(vtodos[0].data).toContain('BEGIN:VTODO');

			const task = mapper.vtodoToTask(vtodos[0]);
			expect(task.description).toBe('Compras');
			expect(task.status).toBe('DONE');
			expect(task.priority).toBe('medium');
		});

		it('parses Apple iOS task with VALARM', async () => {
			server.addVtodo('1376780597664424489');
			const vtodos = await client.fetchVTODOs();

			expect(vtodos).toHaveLength(1);
			const task = mapper.vtodoToTask(vtodos[0]);
			expect(task.description).toBe('Pedir remedio');
			expect(task.status).toBe('DONE');
			expect(task.dueDate).toBe('2025-11-19');
			expect(task.scheduledDate).toBe('2025-11-19');
		});

		it('parses DAVx5 recurring task with RRULE', async () => {
			server.addVtodo('173401913834894838');
			const vtodos = await client.fetchVTODOs();

			const task = mapper.vtodoToTask(vtodos[0]);
			expect(task.description).toBe('DUMP-existing-task');
			expect(task.status).toBe('TODO');
			expect(task.recurrenceRule).toBe('FREQ=DAILY');
			expect(task.dueDate).toBe('2026-02-15');
			expect(task.scheduledDate).toBe('2026-02-14');
			expect(task.tags).toContain('sync');
			expect(task.priority).toBe('lowest');
		});

		it('parses Obsidian-synced completed task', async () => {
			server.addVtodo('obsidian-20251107-099');
			const vtodos = await client.fetchVTODOs();

			const task = mapper.vtodoToTask(vtodos[0]);
			expect(task.status).toBe('DONE');
			expect(task.tags).toContain('sync');
			expect(task.completedDate).toBeDefined();
		});

		it('parses task with multiple CATEGORIES lines', async () => {
			server.addVtodo('obsidian-dump-test-001-created');
			const vtodos = await client.fetchVTODOs();

			const task = mapper.vtodoToTask(vtodos[0]);
			expect(task.description).toBe('Dump test task — all fields');
			expect(task.tags).toContain('sync');
			expect(task.tags).toContain('test');
			expect(task.tags).toContain('dump');
			expect(task.tags).toHaveLength(3);
		});

		it('parses multiple diverse VTODOs in a single fetch', async () => {
			server.addVtodo('2133451409859410883');
			server.addVtodo('1376780597664424489');
			server.addVtodo('173401913834894838');
			server.addVtodo('obsidian-20251107-099');
			server.addVtodo('obsidian-dump-test-001-created');

			const vtodos = await client.fetchVTODOs();
			expect(vtodos).toHaveLength(5);

			// Each should have distinct UIDs
			const uids = vtodos.map(v => mapper.extractUID(v.data));
			expect(new Set(uids).size).toBe(5);
		});

		it('returns correct URLs and etags for each VTODO', async () => {
			server.addVtodo('2133451409859410883');
			server.addVtodo('173401913834894838');

			const vtodos = await client.fetchVTODOs();
			for (const vtodo of vtodos) {
				expect(vtodo.url).toMatch(/^https:\/\/caldav\.example\.com\/.+\.ics$/);
				expect(vtodo.etag).toBeDefined();
				expect(vtodo.etag).not.toBe('');
			}
		});
	});

	// ── Create VTODO ──

	describe('createVTODO', () => {
		beforeEach(async () => {
			await client.connect();
		});

		it('creates a VTODO via PUT with If-None-Match', async () => {
			const uid = 'integration-test-create-001';
			const vtodoData = mapper.taskToVTODO({
				description: 'Test created task',
				status: 'TODO',
				dueDate: '2026-03-01',
				scheduledDate: null,
				startDate: null,
				completedDate: null,
				priority: 'medium',
				recurrenceRule: '',
				tags: ['test'],
			}, uid);

			await client.createVTODO(vtodoData, uid);

			// Verify it's on the server
			expect(server.hasVtodo(uid)).toBe(true);
		});

		it('created VTODO appears in subsequent fetch', async () => {
			const uid = 'integration-test-create-002';
			const vtodoData = mapper.taskToVTODO({
				description: 'Fetchable after create',
				status: 'TODO',
				dueDate: null,
				scheduledDate: null,
				startDate: null,
				completedDate: null,
				priority: 'none',
				recurrenceRule: '',
				tags: [],
			}, uid);

			await client.createVTODO(vtodoData, uid);
			const vtodos = await client.fetchVTODOs();

			expect(vtodos).toHaveLength(1);
			const task = mapper.vtodoToTask(vtodos[0]);
			expect(task.description).toBe('Fetchable after create');
		});

		it('sends correct request parameters', async () => {
			const uid = 'integration-test-create-003';
			const vtodoData = mapper.taskToVTODO({
				description: 'Check headers',
				status: 'TODO',
				dueDate: null,
				scheduledDate: null,
				startDate: null,
				completedDate: null,
				priority: 'none',
				recurrenceRule: '',
				tags: [],
			}, uid);

			await client.createVTODO(vtodoData, uid);

			// Find the PUT call
			const calls = (requestUrl as jest.Mock).mock.calls;
			const putCall = calls.find((c: any[]) => c[0].method === 'PUT');
			expect(putCall).toBeDefined();
			expect(putCall![0].headers['If-None-Match']).toBe('*');
			expect(putCall![0].headers['Content-Type']).toBe('text/calendar; charset=utf-8');
			expect(putCall![0].url).toContain(`${uid}.ics`);
		});
	});

	// ── Update VTODO ──

	describe('updateVTODO', () => {
		beforeEach(async () => {
			await client.connect();
		});

		it('updates a VTODO via PUT with If-Match etag', async () => {
			server.addVtodo('2133451409859410883');
			const vtodos = await client.fetchVTODOs();
			const original = vtodos[0];

			const newData = mapper.taskToVTODO({
				description: 'Updated task',
				status: 'DONE',
				dueDate: null,
				scheduledDate: null,
				startDate: null,
				completedDate: '2026-02-12T10:00:00Z',
				priority: 'high',
				recurrenceRule: '',
				tags: [],
			}, mapper.extractUID(original.data));

			await client.updateVTODO(original, newData);

			// Verify updated content in fetch
			const updated = await client.fetchVTODOs();
			expect(updated).toHaveLength(1);
			const task = mapper.vtodoToTask(updated[0]);
			expect(task.description).toBe('Updated task');
			expect(task.priority).toBe('high');
		});

		it('etag changes after update', async () => {
			server.addVtodo('2133451409859410883');
			const before = await client.fetchVTODOs();
			const originalEtag = before[0].etag;

			const newData = mapper.taskToVTODO({
				description: 'Changed',
				status: 'TODO',
				dueDate: null,
				scheduledDate: null,
				startDate: null,
				completedDate: null,
				priority: 'none',
				recurrenceRule: '',
				tags: [],
			}, mapper.extractUID(before[0].data));

			await client.updateVTODO(before[0], newData);

			const after = await client.fetchVTODOs();
			expect(after[0].etag).not.toBe(originalEtag);
		});
	});

	// ── Delete VTODO ──

	describe('deleteVTODO', () => {
		beforeEach(async () => {
			await client.connect();
		});

		it('deletes a VTODO and it disappears from fetch', async () => {
			server.addVtodo('2133451409859410883');
			server.addVtodo('173401913834894838');
			expect(server.vtodoCount).toBe(2);

			const vtodos = await client.fetchVTODOs();
			const toDelete = vtodos.find(v => mapper.extractUID(v.data) === '2133451409859410883')!;

			await client.deleteVTODO(toDelete);

			const remaining = await client.fetchVTODOs();
			expect(remaining).toHaveLength(1);
			expect(mapper.extractUID(remaining[0].data)).toBe('173401913834894838');
		});

		it('sends DELETE with If-Match header', async () => {
			server.addVtodo('2133451409859410883');
			const vtodos = await client.fetchVTODOs();

			await client.deleteVTODO(vtodos[0]);

			const calls = (requestUrl as jest.Mock).mock.calls;
			const deleteCall = calls.find((c: any[]) => c[0].method === 'DELETE');
			expect(deleteCall).toBeDefined();
			expect(deleteCall![0].headers['If-Match']).toBeDefined();
		});
	});

	// ── Full lifecycle ──

	describe('full lifecycle: connect → fetch → create → fetch → update → fetch → delete → fetch', () => {
		it('mirrors the dump sequence end-to-end', async () => {
			// Step 1: Connect
			await client.connect();
			expect(client.isConnected()).toBe(true);

			// Step 2: Initial fetch — empty
			let vtodos = await client.fetchVTODOs();
			expect(vtodos).toHaveLength(0);

			// Step 3: Create a VTODO
			const uid = 'lifecycle-test-001';
			const createData = mapper.taskToVTODO({
				description: 'Lifecycle test task',
				status: 'TODO',
				dueDate: '2026-03-15',
				scheduledDate: '2026-03-14',
				startDate: null,
				completedDate: null,
				priority: 'medium',
				recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
				tags: ['sync', 'test'],
			}, uid);
			await client.createVTODO(createData, uid);

			// Step 4: Fetch after create
			vtodos = await client.fetchVTODOs();
			expect(vtodos).toHaveLength(1);
			let task = mapper.vtodoToTask(vtodos[0]);
			expect(task.description).toBe('Lifecycle test task');
			expect(task.status).toBe('TODO');
			expect(task.dueDate).toBe('2026-03-15');
			expect(task.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO');

			// Step 5: Update — mark as completed
			const updateData = mapper.taskToVTODO({
				description: 'Lifecycle test task',
				status: 'DONE',
				dueDate: '2026-03-15',
				scheduledDate: '2026-03-14',
				startDate: null,
				completedDate: '2026-03-15T14:30:00Z',
				priority: 'highest',
				recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
				tags: ['sync', 'test'],
			}, uid);
			await client.updateVTODO(vtodos[0], updateData);

			// Step 6: Fetch after update
			vtodos = await client.fetchVTODOs();
			expect(vtodos).toHaveLength(1);
			task = mapper.vtodoToTask(vtodos[0]);
			expect(task.status).toBe('DONE');
			expect(task.priority).toBe('highest');
			expect(task.completedDate).toBeDefined();

			// Step 7: Delete
			await client.deleteVTODO(vtodos[0]);

			// Step 8: Fetch after delete — empty again
			vtodos = await client.fetchVTODOs();
			expect(vtodos).toHaveLength(0);
		});
	});

	// ── Round-trip parsing ──

	describe('round-trip parsing: VTODO fixture → ObsidianTask → VTODO', () => {
		beforeEach(async () => {
			await client.connect();
		});

		it('round-trips simple completed Apple task', async () => {
			server.addVtodo('2133451409859410883');
			const vtodos = await client.fetchVTODOs();
			const task = mapper.vtodoToTask(vtodos[0]);

			// Convert back
			const uid = mapper.extractUID(vtodos[0].data);
			const regenerated = mapper.taskToVTODO(task, uid);

			// Key fields survive round-trip
			expect(regenerated).toContain('SUMMARY:Compras');
			expect(regenerated).toContain('STATUS:COMPLETED');
			expect(regenerated).toContain(`UID:${uid}`);
		});

		it('round-trips recurring DAVx5 task with all fields', async () => {
			server.addVtodo('173401913834894838');
			const vtodos = await client.fetchVTODOs();
			const task = mapper.vtodoToTask(vtodos[0]);
			const uid = mapper.extractUID(vtodos[0].data);

			expect(task.description).toBe('DUMP-existing-task');
			expect(task.recurrenceRule).toBe('FREQ=DAILY');
			expect(task.tags).toContain('sync');
			expect(task.dueDate).toBe('2026-02-15');
			expect(task.scheduledDate).toBe('2026-02-14');

			const regenerated = mapper.taskToVTODO(task, uid);
			expect(regenerated).toContain('RRULE:FREQ=DAILY');
			expect(regenerated).toContain('CATEGORIES:sync');
			expect(regenerated).toContain('DUE;VALUE=DATE:20260215');
			expect(regenerated).toContain('DTSTART;VALUE=DATE:20260214');
		});

		it('round-trips task with multiple categories', async () => {
			server.addVtodo('obsidian-dump-test-001-created');
			const vtodos = await client.fetchVTODOs();
			const task = mapper.vtodoToTask(vtodos[0]);
			const uid = mapper.extractUID(vtodos[0].data);

			expect(task.tags).toEqual(['sync', 'test', 'dump']);

			const regenerated = mapper.taskToVTODO(task, uid);
			// Our mapper outputs comma-separated categories
			expect(regenerated).toContain('CATEGORIES:sync,test,dump');
		});

		it('round-trips task with VALARM (alarm is stripped — not part of ObsidianTask)', async () => {
			server.addVtodo('1376780597664424489');
			const vtodos = await client.fetchVTODOs();
			const task = mapper.vtodoToTask(vtodos[0]);
			const uid = mapper.extractUID(vtodos[0].data);

			// VALARM is not part of ObsidianTask, so it won't round-trip
			expect(task.description).toBe('Pedir remedio');
			const regenerated = mapper.taskToVTODO(task, uid);
			expect(regenerated).not.toContain('VALARM');
			// But core fields survive
			expect(regenerated).toContain('SUMMARY:Pedir remedio');
			expect(regenerated).toContain('STATUS:COMPLETED');
		});
	});

	// ── Error handling ──

	describe('error handling', () => {
		it('rejects fetch before connect', async () => {
			await expect(client.fetchVTODOs()).rejects.toThrow('Not connected');
		});

		it('rejects create before connect', async () => {
			await expect(client.createVTODO('data', 'uid')).rejects.toThrow('Not connected');
		});
	});
});
