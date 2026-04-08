# Obsidian Link in CalDAV Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When enabled, embed an `obsidian://open` link in each synced CalDAV task (both URL property and DESCRIPTION first line), and strip it on sync-back.

**Architecture:** Add `obsidianUrl?: string` to `CommonTask`. ObsidianAdapter populates it during normalize (when setting enabled). VTODOMapper writes it to `URL` property and prepends to DESCRIPTION on outbound; strips `obsidian://open?vault=` lines from body on inbound. New toggle in settings (default: false).

**Tech Stack:** TypeScript, Jest, Obsidian API (`app.vault.getName()`)

---

### Task 1: Add `obsidianUrl` to CommonTask

**Files:**
- Modify: `src/sync/types.ts:4-16`

- [ ] **Step 1: Add the optional field**

In `src/sync/types.ts`, add `obsidianUrl` to the `CommonTask` interface:

```typescript
export interface CommonTask {
  uid: string;
  title: string;
  status: TaskStatus;
  dueDate: string | null;       // 'YYYY-MM-DD'
  startDate: string | null;     // 'YYYY-MM-DD'
  scheduledDate: string | null; // 'YYYY-MM-DD'
  completedDate: string | null; // 'YYYY-MM-DD'
  priority: TaskPriority;
  tags: string[];               // without # prefix
  recurrenceRule: string;       // RRULE string or ''
  body: string;                 // multi-line body text, '' = no body
  obsidianUrl?: string;         // obsidian://open link, set by ObsidianAdapter when enabled
}
```

- [ ] **Step 2: Run tests to verify nothing breaks**

Run: `npm test`
Expected: All existing tests pass (the field is optional, no existing code sets it).

- [ ] **Step 3: Commit**

```bash
git add src/sync/types.ts
git commit -m "feat(types): add obsidianUrl field to CommonTask"
```

---

### Task 2: Add `includeObsidianLink` to settings

**Files:**
- Modify: `src/types.ts:9-29`
- Modify: `main.ts:215-266` (settings UI, behavior section)

- [ ] **Step 1: Add the setting field and default**

In `src/types.ts`, add to `CalDAVSettings` interface:

```typescript
export interface CalDAVSettings {
  calendars: CalendarMapping[];
  syncInterval: number;
  newTasksDestination: string;
  newTasksSection?: string;
  requireManualConflictResolution: boolean;
  autoResolveObsidianWins: boolean;
  syncCompletedTasks: boolean;
  deleteBehavior: 'ask' | 'deleteCalDAV' | 'deleteObsidian' | 'keepBoth';
  includeObsidianLink: boolean;
}
```

Add to `DEFAULT_CALDAV_SETTINGS`:

```typescript
export const DEFAULT_CALDAV_SETTINGS: CalDAVSettings = {
  calendars: [],
  syncInterval: 5,
  newTasksDestination: 'Inbox.md',
  newTasksSection: undefined,
  requireManualConflictResolution: true,
  autoResolveObsidianWins: false,
  syncCompletedTasks: false,
  deleteBehavior: 'ask',
  includeObsidianLink: false,
};
```

- [ ] **Step 2: Add the toggle to the settings UI**

In `main.ts`, inside the `display()` method, add after the "New tasks destination" setting (after line 242, before "Conflict resolution" heading):

```typescript
    new Setting(containerEl)
      .setName('Include Obsidian link in CalDAV tasks')
      .setDesc('Add an obsidian:// link to each synced task so you can open it from your CalDAV client')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.includeObsidianLink)
        .onChange(async (value) => {
          this.plugin.settings.includeObsidianLink = value;
          await this.plugin.saveSettings();
        }));
```

- [ ] **Step 3: Run tests to verify nothing breaks**

Run: `npm test`
Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts main.ts
git commit -m "feat(settings): add includeObsidianLink toggle (default: false)"
```

---

### Task 3: VTODOMapper — strip obsidian links on inbound

**Files:**
- Modify: `src/caldav/VTODOMapper.ts:85-103`
- Test: `src/caldav/vtodoMapper.test.ts`

- [ ] **Step 1: Write failing tests for stripping**

Add to `src/caldav/vtodoMapper.test.ts`, inside the `vtodoToTask` describe block:

```typescript
  describe('obsidian link stripping', () => {
    it('should strip obsidian:// link from first line of DESCRIPTION', () => {
      const vtodo: CalendarObject = {
        url: '/cal/test.ics',
        data: [
          'BEGIN:VCALENDAR',
          'BEGIN:VTODO',
          'UID:strip-test-1',
          'SUMMARY:Test task',
          'DESCRIPTION:obsidian://open?vault=Notes&file=Tasks.md\\nActual body text',
          'STATUS:NEEDS-ACTION',
          'END:VTODO',
          'END:VCALENDAR',
        ].join('\r\n'),
      };

      const result = mapper.vtodoToTask(vtodo);
      expect(result.body).toBe('Actual body text');
    });

    it('should strip obsidian:// link followed by blank line', () => {
      const vtodo: CalendarObject = {
        url: '/cal/test.ics',
        data: [
          'BEGIN:VCALENDAR',
          'BEGIN:VTODO',
          'UID:strip-test-2',
          'SUMMARY:Test task',
          'DESCRIPTION:obsidian://open?vault=My%20Vault&file=Projects%2Ftasks.md\\n\\nReal body here',
          'STATUS:NEEDS-ACTION',
          'END:VTODO',
          'END:VCALENDAR',
        ].join('\r\n'),
      };

      const result = mapper.vtodoToTask(vtodo);
      expect(result.body).toBe('Real body here');
    });

    it('should return empty body when DESCRIPTION is only an obsidian link', () => {
      const vtodo: CalendarObject = {
        url: '/cal/test.ics',
        data: [
          'BEGIN:VCALENDAR',
          'BEGIN:VTODO',
          'UID:strip-test-3',
          'SUMMARY:Test task',
          'DESCRIPTION:obsidian://open?vault=Notes&file=Tasks.md',
          'STATUS:NEEDS-ACTION',
          'END:VTODO',
          'END:VCALENDAR',
        ].join('\r\n'),
      };

      const result = mapper.vtodoToTask(vtodo);
      expect(result.body).toBe('');
    });

    it('should not strip obsidian links that are not at start of a line', () => {
      const vtodo: CalendarObject = {
        url: '/cal/test.ics',
        data: [
          'BEGIN:VCALENDAR',
          'BEGIN:VTODO',
          'UID:strip-test-4',
          'SUMMARY:Test task',
          'DESCRIPTION:See obsidian://open?vault=Notes&file=Tasks.md for details',
          'STATUS:NEEDS-ACTION',
          'END:VTODO',
          'END:VCALENDAR',
        ].join('\r\n'),
      };

      const result = mapper.vtodoToTask(vtodo);
      expect(result.body).toBe('See obsidian://open?vault=Notes&file=Tasks.md for details');
    });

    it('should preserve body without obsidian links unchanged', () => {
      const vtodo: CalendarObject = {
        url: '/cal/test.ics',
        data: [
          'BEGIN:VCALENDAR',
          'BEGIN:VTODO',
          'UID:strip-test-5',
          'SUMMARY:Test task',
          'DESCRIPTION:Just a normal body',
          'STATUS:NEEDS-ACTION',
          'END:VTODO',
          'END:VCALENDAR',
        ].join('\r\n'),
      };

      const result = mapper.vtodoToTask(vtodo);
      expect(result.body).toBe('Just a normal body');
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/caldav/vtodoMapper.test.ts --testNamePattern="obsidian link stripping" -v`
Expected: First test fails (link not stripped yet).

- [ ] **Step 3: Implement the stripping logic**

In `src/caldav/VTODOMapper.ts`, add a private method:

```typescript
  private stripObsidianLinks(body: string): string {
    const lines = body.split('\n');
    const filtered = lines.filter(line => !line.match(/^obsidian:\/\/open\?vault=/));
    // Remove leading blank lines left after stripping
    const trimmed = filtered.join('\n').replace(/^\n+/, '');
    return trimmed;
  }
```

Then update `vtodoToTask` to use it. Change line 101 from:

```typescript
      body: this.extractRawProperty(data, 'DESCRIPTION') || '',
```

to:

```typescript
      body: this.stripObsidianLinks(this.extractRawProperty(data, 'DESCRIPTION') || ''),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/caldav/vtodoMapper.test.ts --testNamePattern="obsidian link stripping" -v`
Expected: All 5 tests pass.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/caldav/VTODOMapper.ts src/caldav/vtodoMapper.test.ts
git commit -m "feat(vtodo): strip obsidian:// links from DESCRIPTION on inbound sync"
```

---

### Task 4: VTODOMapper — write obsidian link on outbound

**Files:**
- Modify: `src/caldav/VTODOMapper.ts:25-79`
- Test: `src/caldav/vtodoMapper.test.ts`

- [ ] **Step 1: Write failing tests for URL property and DESCRIPTION prepend**

Add to `src/caldav/vtodoMapper.test.ts`, inside the `taskToVTODO` describe block:

```typescript
  describe('obsidian link embedding', () => {
    const baseTask: Omit<CommonTask, 'uid'> = {
      title: 'Test task',
      status: 'TODO' as TaskStatus,
      dueDate: null,
      startDate: null,
      scheduledDate: null,
      completedDate: null,
      priority: 'none' as TaskPriority,
      tags: [],
      recurrenceRule: '',
      body: '',
    };

    it('should add URL property when obsidianUrl is set', () => {
      const task = { ...baseTask, obsidianUrl: 'obsidian://open?vault=Notes&file=Tasks.md' };
      const vtodo = mapper.taskToVTODO(task, 'url-test-1');
      expect(vtodo).toContain('URL:obsidian://open?vault=Notes&file=Tasks.md');
    });

    it('should prepend obsidian link to DESCRIPTION when obsidianUrl is set and body exists', () => {
      const task = { ...baseTask, obsidianUrl: 'obsidian://open?vault=Notes&file=Tasks.md', body: 'My notes' };
      const vtodo = mapper.taskToVTODO(task, 'url-test-2');
      expect(vtodo).toContain('DESCRIPTION:obsidian://open?vault=Notes&file=Tasks.md\\n\\nMy notes');
    });

    it('should set DESCRIPTION to obsidian link when obsidianUrl is set and body is empty', () => {
      const task = { ...baseTask, obsidianUrl: 'obsidian://open?vault=Notes&file=Tasks.md', body: '' };
      const vtodo = mapper.taskToVTODO(task, 'url-test-3');
      expect(vtodo).toContain('DESCRIPTION:obsidian://open?vault=Notes&file=Tasks.md');
      // Should not have trailing \n\n
      expect(vtodo).not.toContain('DESCRIPTION:obsidian://open?vault=Notes&file=Tasks.md\\n');
    });

    it('should not add URL property when obsidianUrl is not set', () => {
      const vtodo = mapper.taskToVTODO(baseTask, 'url-test-4');
      expect(vtodo).not.toMatch(/^URL:/m);
    });

    it('should handle obsidianUrl with encoded characters', () => {
      const task = { ...baseTask, obsidianUrl: 'obsidian://open?vault=My%20Vault&file=Projects%2Ftodo.md' };
      const vtodo = mapper.taskToVTODO(task, 'url-test-5');
      expect(vtodo).toContain('URL:obsidian://open?vault=My%20Vault&file=Projects%2Ftodo.md');
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/caldav/vtodoMapper.test.ts --testNamePattern="obsidian link embedding" -v`
Expected: Tests fail — URL property not written, DESCRIPTION not prepended.

- [ ] **Step 3: Implement the outbound logic**

In `src/caldav/VTODOMapper.ts`, update `taskToVTODO`. The method receives `Omit<CommonTask, 'uid'>` which now includes the optional `obsidianUrl`.

After the DESCRIPTION block (line 40), add the URL property:

```typescript
    // Description (body text), with optional obsidian link prepended
    const description = this.buildDescription(task.body, task.obsidianUrl);
    if (description) {
      lines.push(`DESCRIPTION:${this.escapeText(description)}`);
    }

    // Obsidian vault link
    if (task.obsidianUrl) {
      lines.push(`URL:${task.obsidianUrl}`);
    }
```

Replace the existing DESCRIPTION block (lines 37-40):

```typescript
    // Description (body text)
    if (task.body) {
      lines.push(`DESCRIPTION:${this.escapeText(task.body)}`);
    }
```

Add the `buildDescription` private method:

```typescript
  private buildDescription(body: string, obsidianUrl?: string): string {
    if (!obsidianUrl && !body) return '';
    if (!obsidianUrl) return body;
    if (!body) return obsidianUrl;
    return `${obsidianUrl}\n\n${body}`;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/caldav/vtodoMapper.test.ts --testNamePattern="obsidian link embedding" -v`
Expected: All 5 tests pass.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/caldav/VTODOMapper.ts src/caldav/vtodoMapper.test.ts
git commit -m "feat(vtodo): write obsidian URL property and prepend link to DESCRIPTION"
```

---

### Task 5: ObsidianAdapter — populate obsidianUrl during normalize

**Files:**
- Modify: `src/sync/obsidianAdapter.ts:17-21,57-72`
- Test: `src/sync/obsidianAdapter.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/sync/obsidianAdapter.test.ts`:

```typescript
describe('obsidianUrl population', () => {
  it('should set obsidianUrl when includeObsidianLink is true', () => {
    const settings: ObsidianSyncSettings = {
      syncTag: 'sync',
      newTasksDestination: 'Inbox.md',
      includeObsidianLink: true,
      vaultName: 'TestVault',
    };
    const adapter = new ObsidianAdapter(dummyWrapper, settings);
    const inputs: TaskWithBody[] = [{
      task: {
        description: 'Test task',
        status: { configuration: { symbol: ' ', name: 'Todo', type: 'TODO' } },
        isDone: false,
        priority: '0',
        tags: [],
        taskLocation: { _tasksFile: { _path: 'Projects/tasks.md' }, _lineNumber: 5 },
        originalMarkdown: '- [ ] Test task',
        createdDate: null,
        startDate: null,
        scheduledDate: null,
        dueDate: null,
        doneDate: null,
        cancelledDate: null,
        recurrence: null,
        id: 'test-id-1',
      },
      body: '',
    }];

    const result = adapter.normalize(inputs, (task) => task.id || null);
    expect(result[0].obsidianUrl).toBe('obsidian://open?vault=TestVault&file=Projects%2Ftasks.md');
  });

  it('should not set obsidianUrl when includeObsidianLink is false', () => {
    const settings: ObsidianSyncSettings = {
      syncTag: 'sync',
      newTasksDestination: 'Inbox.md',
      includeObsidianLink: false,
      vaultName: 'TestVault',
    };
    const adapter = new ObsidianAdapter(dummyWrapper, settings);
    const inputs: TaskWithBody[] = [{
      task: {
        description: 'Test task',
        status: { configuration: { symbol: ' ', name: 'Todo', type: 'TODO' } },
        isDone: false,
        priority: '0',
        tags: [],
        taskLocation: { _tasksFile: { _path: 'Projects/tasks.md' }, _lineNumber: 5 },
        originalMarkdown: '- [ ] Test task',
        createdDate: null,
        startDate: null,
        scheduledDate: null,
        dueDate: null,
        doneDate: null,
        cancelledDate: null,
        recurrence: null,
        id: 'test-id-2',
      },
      body: '',
    }];

    const result = adapter.normalize(inputs, (task) => task.id || null);
    expect(result[0].obsidianUrl).toBeUndefined();
  });

  it('should encode vault name and file path with spaces', () => {
    const settings: ObsidianSyncSettings = {
      syncTag: 'sync',
      newTasksDestination: 'Inbox.md',
      includeObsidianLink: true,
      vaultName: 'My Vault',
    };
    const adapter = new ObsidianAdapter(dummyWrapper, settings);
    const inputs: TaskWithBody[] = [{
      task: {
        description: 'Test task',
        status: { configuration: { symbol: ' ', name: 'Todo', type: 'TODO' } },
        isDone: false,
        priority: '0',
        tags: [],
        taskLocation: { _tasksFile: { _path: 'My Folder/tasks file.md' }, _lineNumber: 1 },
        originalMarkdown: '- [ ] Test task',
        createdDate: null,
        startDate: null,
        scheduledDate: null,
        dueDate: null,
        doneDate: null,
        cancelledDate: null,
        recurrence: null,
        id: 'test-id-3',
      },
      body: '',
    }];

    const result = adapter.normalize(inputs, (task) => task.id || null);
    expect(result[0].obsidianUrl).toBe('obsidian://open?vault=My%20Vault&file=My%20Folder%2Ftasks%20file.md');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/sync/obsidianAdapter.test.ts --testNamePattern="obsidianUrl population" -v`
Expected: Tests fail — `includeObsidianLink` and `vaultName` not in settings type, `obsidianUrl` not set.

- [ ] **Step 3: Update ObsidianSyncSettings and normalize**

In `src/sync/obsidianAdapter.ts`, update the settings interface:

```typescript
export interface ObsidianSyncSettings {
  syncTag?: string;
  newTasksDestination: string;
  newTasksSection?: string;
  includeObsidianLink?: boolean;
  vaultName?: string;
}
```

Update `normalize` to build the obsidian URL:

```typescript
  normalize(
    inputs: TaskWithBody[],
    extractId: (task: ObsidianTask) => string | null,
  ): CommonTask[] {
    const tasks: CommonTask[] = [];
    this.tasksById = new Map();

    for (const { task, body } of inputs) {
      const taskId = extractId(task) ?? generateTaskId();
      this.tasksById.set(taskId, task);
      const common = this.mapper.toCommonTask(task, taskId, body);

      if (this.settings.includeObsidianLink && this.settings.vaultName) {
        common.obsidianUrl = this.buildObsidianUrl(
          this.settings.vaultName,
          task.taskLocation._tasksFile._path,
        );
      }

      tasks.push(common);
    }

    return tasks;
  }

  private buildObsidianUrl(vaultName: string, filePath: string): string {
    return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(filePath)}`;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/sync/obsidianAdapter.test.ts --testNamePattern="obsidianUrl population" -v`
Expected: All 3 tests pass.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/sync/obsidianAdapter.ts src/sync/obsidianAdapter.test.ts
git commit -m "feat(obsidian-adapter): populate obsidianUrl during normalize when enabled"
```

---

### Task 6: Wire vault name through SyncEngine

**Files:**
- Modify: `src/sync/syncEngine.ts:46-50`

- [ ] **Step 1: Pass vault name and setting to ObsidianAdapter**

In `src/sync/syncEngine.ts`, update the ObsidianAdapter construction (lines 46-50) to pass the new fields:

```typescript
    this.obsidianAdapter = new ObsidianAdapter(wrapper, {
      syncTag: calendar.tag,
      newTasksDestination: settings.newTasksDestination,
      newTasksSection: settings.newTasksSection,
      includeObsidianLink: settings.includeObsidianLink,
      vaultName: app.vault.getName(),
    });
```

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass. (SyncEngine tests mock the adapters so this wiring change doesn't break anything.)

- [ ] **Step 3: Commit**

```bash
git add src/sync/syncEngine.ts
git commit -m "feat(sync-engine): pass includeObsidianLink and vaultName to ObsidianAdapter"
```

---

### Task 7: Round-trip integration test

**Files:**
- Test: `src/caldav/vtodoMapper.test.ts`

- [ ] **Step 1: Write a round-trip test**

Add to `src/caldav/vtodoMapper.test.ts`:

```typescript
describe('obsidian link round-trip', () => {
  it('should survive round-trip: body with link outbound, stripped inbound', () => {
    const originalBody = 'Meeting notes from standup';
    const obsidianUrl = 'obsidian://open?vault=Work&file=Meetings%2Fstandup.md';

    // Outbound: task with obsidianUrl
    const outboundTask: Omit<CommonTask, 'uid'> = {
      title: 'Review standup notes',
      status: 'TODO' as TaskStatus,
      dueDate: null,
      startDate: null,
      scheduledDate: null,
      completedDate: null,
      priority: 'none' as TaskPriority,
      tags: [],
      recurrenceRule: '',
      body: originalBody,
      obsidianUrl,
    };

    const vtodoString = mapper.taskToVTODO(outboundTask, 'roundtrip-1');

    // Verify outbound contains both URL and DESCRIPTION with link
    expect(vtodoString).toContain('URL:obsidian://open?vault=Work&file=Meetings%2Fstandup.md');
    expect(vtodoString).toMatch(/DESCRIPTION:.*obsidian:\/\/open/);

    // Inbound: parse the VTODO back
    const vtodo: CalendarObject = { url: '/cal/roundtrip.ics', data: vtodoString };
    const parsed = mapper.vtodoToTask(vtodo);

    // Body should be clean — no obsidian link
    expect(parsed.body).toBe(originalBody);
  });

  it('should survive round-trip with empty body', () => {
    const obsidianUrl = 'obsidian://open?vault=Notes&file=Tasks.md';

    const outboundTask: Omit<CommonTask, 'uid'> = {
      title: 'Simple task',
      status: 'TODO' as TaskStatus,
      dueDate: null,
      startDate: null,
      scheduledDate: null,
      completedDate: null,
      priority: 'none' as TaskPriority,
      tags: [],
      recurrenceRule: '',
      body: '',
      obsidianUrl,
    };

    const vtodoString = mapper.taskToVTODO(outboundTask, 'roundtrip-2');
    const vtodo: CalendarObject = { url: '/cal/roundtrip.ics', data: vtodoString };
    const parsed = mapper.vtodoToTask(vtodo);

    expect(parsed.body).toBe('');
  });
});
```

- [ ] **Step 2: Run the round-trip tests**

Run: `npx jest src/caldav/vtodoMapper.test.ts --testNamePattern="obsidian link round-trip" -v`
Expected: Both tests pass.

- [ ] **Step 3: Run full test suite with coverage**

Run: `npm test`
Expected: All tests pass, coverage thresholds met.

- [ ] **Step 4: Commit**

```bash
git add src/caldav/vtodoMapper.test.ts
git commit -m "test: add obsidian link round-trip integration tests"
```
