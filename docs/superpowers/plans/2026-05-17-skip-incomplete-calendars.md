# Skip Incomplete Calendars (issue #72) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a blank/incomplete calendar config from crashing sync with the cryptic `Failed to construct 'URL': Invalid URL`; skip it and show a clear notice instead.

**Architecture:** A pure, unit-tested helper reports which required fields a `CalendarMapping` is missing. `main.ts`'s `initializeEngines()` consumes it: incomplete calendars are skipped (no `SyncEngine` created) and summarized in one notice; fully-configured calendars sync unchanged.

**Tech Stack:** TypeScript, Jest (unit project), Obsidian plugin API.

**Root cause (verified):** `CalDAVClientDirect` constructor path calls `new URL(this.config.serverUrl)` (`src/caldav/calDAVClientDirect.ts:75`). For an unconfigured calendar `serverUrl === ""`, and `new URL("")` throws `Failed to construct 'URL': Invalid URL`. `SyncEngine.buildErrorResult` wraps it as `` [${calendarName}] Sync failed: … ``, producing the exact issue title `[] Sync failed: Failed to construct 'URL': Invalid URL`. The reporter's etesync-dav calendar works; the failure was a second, entirely blank calendar created via "Add calendar".

---

### Task 1: Pure calendar-config validation helper

**Files:**
- Create: `src/utils/calendarConfig.ts`
- Test: `src/utils/calendarConfig.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { missingCalendarFields, isCalendarConfigured } from './calendarConfig';
import { CalendarMapping } from '../types';

const full: CalendarMapping = {
  tag: '#todo',
  calendarName: 'J ToDo',
  serverUrl: 'http://localhost:37358/',
  username: 'username@mail.com',
  password: 'secret',
};

describe('calendarConfig', () => {
  it('reports no missing fields for a fully configured calendar', () => {
    expect(missingCalendarFields(full)).toEqual([]);
    expect(isCalendarConfigured(full)).toBe(true);
  });

  it('lists every missing field for a blank calendar (issue #72)', () => {
    const blank: CalendarMapping = { tag: '', calendarName: '', serverUrl: '', username: '', password: '' };
    expect(missingCalendarFields(blank)).toEqual(['server URL', 'username', 'calendar name']);
    expect(isCalendarConfigured(blank)).toBe(false);
  });

  it('treats whitespace-only values as missing', () => {
    const ws: CalendarMapping = { ...full, serverUrl: '   ' };
    expect(missingCalendarFields(ws)).toEqual(['server URL']);
    expect(isCalendarConfigured(ws)).toBe(false);
  });

  it('does not require tag or password', () => {
    const noTagNoPass: CalendarMapping = { ...full, tag: '', password: '' };
    expect(isCalendarConfigured(noTagNoPass)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects unit src/utils/calendarConfig.test.ts`
Expected: FAIL — cannot find module `./calendarConfig`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { CalendarMapping } from '../types';

/** Calendar fields that must be set before a sync can be attempted, in display order. */
const REQUIRED_FIELDS: ReadonlyArray<{ key: keyof CalendarMapping; label: string }> = [
  { key: 'serverUrl', label: 'server URL' },
  { key: 'username', label: 'username' },
  { key: 'calendarName', label: 'calendar name' },
];

/** Labels of required fields that are empty (or whitespace-only). Empty array when fully configured. */
export function missingCalendarFields(calendar: CalendarMapping): string[] {
  return REQUIRED_FIELDS
    .filter(({ key }) => calendar[key].trim() === '')
    .map(({ label }) => label);
}

/** True when a calendar has every field required to attempt a sync. */
export function isCalendarConfigured(calendar: CalendarMapping): boolean {
  return missingCalendarFields(calendar).length === 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects unit src/utils/calendarConfig.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/calendarConfig.ts src/utils/calendarConfig.test.ts
git commit -m "feat: add calendar-config completeness helper (#72)"
```

---

### Task 2: Skip incomplete calendars with a clear notice

**Files:**
- Modify: `main.ts:1-8` (imports), `main.ts:151-163` (`initializeEngines`)

- [ ] **Step 1: Add imports**

Add `CalendarMapping` to the existing `./src/types` import and import the new helper:

```typescript
import { CalDAVSettings, DEFAULT_CALDAV_SETTINGS, CalendarMapping } from './src/types';
import { missingCalendarFields } from './src/utils/calendarConfig';
```

- [ ] **Step 2: Replace `initializeEngines` and add private helpers**

Replace the existing `initializeEngines` method (currently `main.ts:151-163`) with:

```typescript
	private async initializeEngines(): Promise<void> {
		this.syncEngines = [];
		const skipped: string[] = [];
		let configuredCount = 0;
		for (let index = 0; index < this.settings.calendars.length; index++) {
			const calendar = this.settings.calendars[index];
			const missing = missingCalendarFields(calendar);
			if (missing.length > 0) {
				skipped.push(this.describeIncompleteCalendar(calendar, index, missing));
				continue;
			}
			configuredCount++;
			const engine = new SyncEngine(this.app, calendar, this.settings);
			const ready = await engine.initialize();
			if (ready) {
				this.syncEngines.push(engine);
			}
		}
		this.notifySkippedCalendars(skipped);
		if (this.syncEngines.length === 0 && configuredCount > 0) {
			new Notice('Sync failed: tasks plugin not available');
		}
	}

	private describeIncompleteCalendar(calendar: CalendarMapping, index: number, missing: string[]): string {
		const name = calendar.calendarName.trim() || calendar.serverUrl.trim() || `Calendar ${index + 1}`;
		return `${name} (missing ${missing.join(', ')})`;
	}

	private notifySkippedCalendars(skipped: string[]): void {
		if (skipped.length === 0) {
			return;
		}
		const noun = skipped.length === 1 ? 'calendar' : 'calendars';
		new Notice(`Skipped ${skipped.length} incomplete ${noun}: ${skipped.join('; ')}. Configure in settings.`, 8000);
	}
```

Rationale: the prior `syncEngines.length === 0 && calendars.length > 0` check would have shown the misleading "tasks plugin not available" notice when every calendar is merely incomplete. Gating on `configuredCount > 0` keeps that notice for the genuine tasks-plugin case while the skipped-calendars notice covers incomplete configs.

- [ ] **Step 3: Type-check and lint**

Run: `npm run build && npm run lint`
Expected: no type errors, no lint errors.

- [ ] **Step 4: Commit**

```bash
git add main.ts
git commit -m "fix: skip incomplete calendars instead of crashing with Invalid URL (#72)"
```

---

### Task 3: Full verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all unit + e2e tests pass, coverage thresholds met.

- [ ] **Step 2: Commit any incidental fixes (only if needed)**

```bash
git add -A && git commit -m "test: verify incomplete-calendar handling (#72)"
```

---

## Self-Review

- **Spec coverage:** Blank-config crash → Task 1 (detect) + Task 2 (skip + notice). Misleading fallback notice → Task 2 Step 2. Regression test → Task 1 tests. etesync e2e → out of scope per user decision.
- **Placeholder scan:** none.
- **Type consistency:** `missingCalendarFields`/`isCalendarConfigured` signatures match between Task 1 and Task 2; `CalendarMapping` imported where used.
