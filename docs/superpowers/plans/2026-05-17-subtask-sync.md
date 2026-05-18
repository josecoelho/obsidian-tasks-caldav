# Subtask sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync Todoist-style indented subtasks between obsidian-tasks and CalDAV using `RELATED-TO;RELTYPE=PARENT`, bidirectionally, with cascade delete.

**Architecture:** Add `parentUid` (parent's *sync UID*) to `CommonTask`. Mappers translate it to/from the native format (markdown indentation ↔ VTODO `RELATED-TO`); adapters resolve sync-UID ↔ CalDAV-UID at the I/O edge via `IdMapping`. Re-parenting flows through the existing three-way diff. Cascade delete is a pure post-diff expansion in `SyncEngine`.

**Tech Stack:** TypeScript, Jest (`unit`/`e2e` projects), esbuild, Radicale (Docker) for E2E, wdio for Obsidian smoke.

**Spec:** `docs/superpowers/specs/2026-05-17-subtask-sync-design.md`

**Implementation note on the `parentUid` type:** The spec says `parentUid: string | null`. To avoid touching ~25 files that build `CommonTask` literals, it is declared **optional** (`parentUid?: string | null`) and treated as `null` when absent. All equality/serialization normalizes with `?? null`. This is the same pattern the codebase already uses for `obsidianUrl?`.

---

## Task 1: Add `parentUid` to `CommonTask` and `tasksEqual`

**Files:**
- Modify: `src/sync/types.ts`
- Modify: `src/sync/diff.ts`
- Test: `src/sync/diff.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe('tasksEqual', ...)` block in `src/sync/diff.test.ts`:

```ts
  it('should detect parentUid change', () => {
    const a = makeCommonTask({ parentUid: 'parent-1' });
    const b = makeCommonTask({ parentUid: 'parent-2' });
    expect(tasksEqual(a, b)).toBe(false);
  });

  it('should treat missing parentUid as equal to null', () => {
    const a = makeCommonTask({ parentUid: null });
    const b = makeCommonTask();
    expect(tasksEqual(a, b)).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects unit src/sync/diff.test.ts -t "parentUid"`
Expected: FAIL — `tasksEqual` ignores `parentUid`, second assertion of first test passes but the first test fails (returns `true`).

- [ ] **Step 3: Implement**

In `src/sync/types.ts`, add to the `CommonTask` interface, immediately after the `obsidianUrl?: string;` line:

```ts
  // Parent task's sync UID for subtask hierarchy. null/absent = top-level.
  // Maps to VTODO RELATED-TO;RELTYPE=PARENT on the CalDAV side.
  parentUid?: string | null;
```

In `src/sync/diff.ts`, in `tasksEqual`, add this line inside the returned `&&` chain (before the closing `tags` comparison):

```ts
    (a.parentUid ?? null) === (b.parentUid ?? null) &&
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects unit src/sync/diff.test.ts`
Expected: PASS (all diff tests).

- [ ] **Step 5: Commit**

```bash
git add src/sync/types.ts src/sync/diff.ts src/sync/diff.test.ts
git commit -m "feat: add parentUid to CommonTask and tasksEqual (#61)"
```

---

## Task 2: VTODOMapper emits `RELATED-TO;RELTYPE=PARENT`

**Files:**
- Modify: `src/caldav/vtodoMapper.ts`
- Test: `src/caldav/vtodoMapper.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/caldav/vtodoMapper.test.ts` inside the top-level `describe('VTODOMapper', ...)`:

```ts
  describe('taskToVTODO RELATED-TO', () => {
    const mapper = new VTODOMapper();
    const base = {
      title: 'Child', status: 'TODO' as const, dueDate: null, startDate: null,
      scheduledDate: null, completedDate: null, priority: 'none' as const,
      tags: [], recurrenceRule: '', body: '',
    };

    it('emits RELATED-TO;RELTYPE=PARENT when a parent CalDAV UID is given', () => {
      const ical = mapper.taskToVTODO(base, 'child-uid', 'parent-uid');
      expect(ical).toContain('RELATED-TO;RELTYPE=PARENT:parent-uid');
    });

    it('omits RELATED-TO when no parent is given', () => {
      const ical = mapper.taskToVTODO(base, 'child-uid');
      expect(ical).not.toContain('RELATED-TO');
    });

    it('omits RELATED-TO when parent is null', () => {
      const ical = mapper.taskToVTODO(base, 'child-uid', null);
      expect(ical).not.toContain('RELATED-TO');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects unit src/caldav/vtodoMapper.test.ts -t "taskToVTODO RELATED-TO"`
Expected: FAIL — `taskToVTODO` takes only 2 args; third is ignored, no `RELATED-TO` emitted.

- [ ] **Step 3: Implement**

In `src/caldav/vtodoMapper.ts`, change the `taskToVTODO` signature and add the property. Replace the signature line:

```ts
  taskToVTODO(task: Omit<CommonTask, 'uid'>, uid: string): string {
```

with:

```ts
  taskToVTODO(task: Omit<CommonTask, 'uid'>, uid: string, parentCaldavUid?: string | null): string {
```

Then, immediately **before** the `lines.push('END:VTODO');` line, add:

```ts
    if (parentCaldavUid) {
      lines.push(`RELATED-TO;RELTYPE=PARENT:${parentCaldavUid}`);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects unit src/caldav/vtodoMapper.test.ts`
Expected: PASS (all vtodoMapper tests).

- [ ] **Step 5: Commit**

```bash
git add src/caldav/vtodoMapper.ts src/caldav/vtodoMapper.test.ts
git commit -m "feat: VTODOMapper emits RELATED-TO PARENT (#61)"
```

---

## Task 3: VTODOMapper parses `RELATED-TO` into `parentUid`

**Files:**
- Modify: `src/caldav/vtodoMapper.ts`
- Test: `src/caldav/vtodoMapper.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/caldav/vtodoMapper.test.ts`:

```ts
  describe('vtodoToTask RELATED-TO', () => {
    const mapper = new VTODOMapper();
    const wrap = (props: string) =>
      ({ data: `BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:c1\r\nSUMMARY:Child\r\n${props}END:VTODO\r\nEND:VCALENDAR`, url: '' });

    it('parses RELATED-TO;RELTYPE=PARENT', () => {
      const t = mapper.vtodoToTask(wrap('RELATED-TO;RELTYPE=PARENT:p1\r\n'));
      expect(t.parentUid).toBe('p1');
    });

    it('parses bare RELATED-TO as PARENT (RFC default)', () => {
      const t = mapper.vtodoToTask(wrap('RELATED-TO:p2\r\n'));
      expect(t.parentUid).toBe('p2');
    });

    it('ignores RELTYPE=CHILD and RELTYPE=SIBLING', () => {
      const t = mapper.vtodoToTask(wrap('RELATED-TO;RELTYPE=CHILD:c9\r\nRELATED-TO;RELTYPE=SIBLING:s9\r\n'));
      expect(t.parentUid ?? null).toBeNull();
    });

    it('is null when no RELATED-TO present', () => {
      const t = mapper.vtodoToTask(wrap(''));
      expect(t.parentUid ?? null).toBeNull();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects unit src/caldav/vtodoMapper.test.ts -t "vtodoToTask RELATED-TO"`
Expected: FAIL — `parentUid` is `undefined`; the first two tests fail.

- [ ] **Step 3: Implement**

In `src/caldav/vtodoMapper.ts`, in `vtodoToTask`, add `parentUid` to the returned object (e.g. after the `body:` line):

```ts
      parentUid: this.extractRelatedParent(data),
```

Add this private method (place it near `extractUID`):

```ts
  /**
   * Extract the parent UID from a RELATED-TO property.
   * RELTYPE=PARENT or an absent RELTYPE (RFC 5545 default) is treated as the
   * parent link. RELTYPE=CHILD / RELTYPE=SIBLING are ignored.
   */
  private extractRelatedParent(data: string): string | null {
    const regex = /^RELATED-TO(;[^:]*)?:(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(data)) !== null) {
      const params = (match[1] ?? '').toUpperCase();
      const reltypeMatch = params.match(/RELTYPE=([A-Z]+)/);
      const reltype = reltypeMatch ? reltypeMatch[1] : 'PARENT';
      if (reltype === 'PARENT') {
        return match[2].trim();
      }
    }
    return null;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects unit src/caldav/vtodoMapper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/caldav/vtodoMapper.ts src/caldav/vtodoMapper.test.ts
git commit -m "feat: VTODOMapper parses RELATED-TO into parentUid (#61)"
```

---

## Task 4: CalDAVAdapter resolves `parentUid` ↔ CalDAV UID

**Files:**
- Modify: `src/sync/caldavAdapter.ts`
- Test: `src/sync/caldavAdapter.test.ts`

- [ ] **Step 1: Write the failing test**

Open `src/sync/caldavAdapter.test.ts`, find how existing tests construct the adapter, a fake `CalDAVClient`, and an `IdMapping` (reuse the file's existing helpers/fakes — do not invent new ones). Add:

```ts
  describe('parentUid resolution', () => {
    it('normalize maps a parent CalDAV UID to the parent sync UID', () => {
      const idMapping = { taskIdToCaldavUid: {}, caldavUidToTaskId: { 'cal-parent': 'obs-parent' } };
      const adapter = new CalDAVAdapter(/* existing fake client from this file */);
      const vtodos = [{
        url: '', data: 'BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:cal-child\r\nSUMMARY:Child\r\nRELATED-TO;RELTYPE=PARENT:cal-parent\r\nEND:VTODO\r\nEND:VCALENDAR',
      }];
      const [task] = adapter.normalize(vtodos, idMapping);
      expect(task.parentUid).toBe('obs-parent');
    });

    it('normalize falls back to raw CalDAV UID when parent is unmapped', () => {
      const idMapping = { taskIdToCaldavUid: {}, caldavUidToTaskId: {} };
      const adapter = new CalDAVAdapter(/* existing fake client */);
      const vtodos = [{
        url: '', data: 'BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:cal-child\r\nSUMMARY:Child\r\nRELATED-TO;RELTYPE=PARENT:cal-parent\r\nEND:VTODO\r\nEND:VCALENDAR',
      }];
      const [task] = adapter.normalize(vtodos, idMapping);
      expect(task.parentUid).toBe('cal-parent');
    });
  });
```

(Use the exact `CalDAVAdapter`/client construction style already present in this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects unit src/sync/caldavAdapter.test.ts -t "parentUid resolution"`
Expected: FAIL — `task.parentUid` is the raw CalDAV UID (or undefined) in the first test.

- [ ] **Step 3: Implement**

In `src/sync/caldavAdapter.ts`:

a) Change `toCommonTask` to accept and apply the resolved parent. Replace the method body:

```ts
  toCommonTask(vtodo: CalendarObject, uid: string, parentUid: string | null): CommonTask {
    const parsed = this.mapper.vtodoToTask(vtodo);

    return {
      ...parsed,
      uid,
      parentUid,
      completedDate: parsed.completedDate ? parsed.completedDate.split('T')[0] : null,
    };
  }
```

b) In `normalize`, resolve the parent before pushing:

```ts
      const uid = idMapping.caldavUidToTaskId[caldavUid] ?? caldavUid;
      const parsedParent = this.mapper.vtodoToTask(vtodo).parentUid ?? null;
      const parentUid = parsedParent
        ? (idMapping.caldavUidToTaskId[parsedParent] ?? parsedParent)
        : null;
      tasks.push(this.toCommonTask(vtodo, uid, parentUid));
```

c) Change `fromCommonTask` to forward a resolved parent CalDAV UID:

```ts
  fromCommonTask(task: CommonTask, caldavUID: string, parentCaldavUid: string | null): string {
    return this.mapper.taskToVTODO(task, caldavUID, parentCaldavUid);
  }
```

d) In `applyChanges`, inside the `for (const change of changes)` loop, immediately after `const caldavUID = this.resolveCaldavUid(change.task.uid, idMapping);` add:

```ts
      const parentCaldavUid = change.task.parentUid
        ? (idMapping.taskIdToCaldavUid[change.task.parentUid] ?? change.task.parentUid)
        : null;
```

Then update the three `this.fromCommonTask(...)` call sites (`create`, `update`, `complete`) to pass `parentCaldavUid` as the third argument.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects unit src/sync/caldavAdapter.test.ts`
Expected: PASS (all caldavAdapter tests; fix any compile errors in existing tests that called `toCommonTask`/`fromCommonTask` with the old arity by passing `null`).

- [ ] **Step 5: Commit**

```bash
git add src/sync/caldavAdapter.ts src/sync/caldavAdapter.test.ts
git commit -m "feat: CalDAVAdapter resolves parentUid via IdMapping (#61)"
```

---

## Task 5: `isTaskLine` predicate + body extraction stops at subtasks

**Files:**
- Modify: `src/tasks/obsidianTasksWrapper.ts`
- Test: `src/tasks/obsidianTasksWrapper.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/tasks/obsidianTasksWrapper.test.ts`, find the existing `describe` for `extractBodyFromFile` (or how the wrapper is constructed in this file) and add:

```ts
  describe('extractBodyFromFile with subtasks', () => {
    it('treats indented checkbox lines as subtasks, not body', () => {
      const wrapper = makeWrapper(); // use this file's existing wrapper factory
      const content = [
        '- [ ] Parent 🆔 p1 #sync',
        '    - this is body',
        '    - [ ] Child task',
        '    - more body after child',
      ].join('\n');
      expect(wrapper.extractBodyFromFile(content, 0)).toBe('this is body');
    });

    it('returns empty body when the first indented line is a subtask', () => {
      const wrapper = makeWrapper();
      const content = ['- [ ] Parent 🆔 p1 #sync', '    - [ ] Child'].join('\n');
      expect(wrapper.extractBodyFromFile(content, 0)).toBe('');
    });
  });
```

If the file has no wrapper factory, construct it the same way the nearest existing test does.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects unit src/tasks/obsidianTasksWrapper.test.ts -t "extractBodyFromFile with subtasks"`
Expected: FAIL — current regex captures `[ ] Child task` into the body.

- [ ] **Step 3: Implement**

In `src/tasks/obsidianTasksWrapper.ts`, add a module-level helper near the top (after imports):

```ts
/** True when a line is a list checkbox task (any indent), e.g. "- [ ] x" or "1. [x] y". */
export function isTaskLine(line: string): boolean {
  return /^\s*(?:[-*+]|\d+\.)\s+\[.\]\s/.test(line);
}
```

In `extractBodyFromFile`, replace the loop body so it stops at task lines:

```ts
        for (let i = taskLineIndex + 1; i < lines.length; i++) {
            if (isTaskLine(lines[i])) break;
            const match = lines[i].match(/^(?:\s{2,}|\t)- (.*)$/);
            if (!match) break;
            noteLines.push(match[1]);
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects unit src/tasks/obsidianTasksWrapper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tasks/obsidianTasksWrapper.ts src/tasks/obsidianTasksWrapper.test.ts
git commit -m "feat: body extraction stops at indented subtasks (#61)"
```

---

## Task 6: Per-file parent map on `TaskWithBody`

**Files:**
- Modify: `src/tasks/obsidianTasksWrapper.ts`
- Test: `src/tasks/obsidianTasksWrapper.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/tasks/obsidianTasksWrapper.test.ts`. Use the file's existing pattern for mocking `app.vault` reads and `getAllTasks()`; model the new test on the closest existing `getAllTasksWithBody` test:

```ts
  describe('parent map', () => {
    it('sets parentTask to the nearest shallower checkbox ancestor', async () => {
      // Arrange a vault file:
      //   - [ ] Parent 🆔 p1 #sync
      //       - [ ] Child 🆔 c1
      //           - [ ] Grandchild 🆔 g1
      // and stub getAllTasks() to return the three tasks with matching
      // originalMarkdown + taskLocation._path, exactly as existing tests do.
      const result = await wrapper.getAllTasksWithBody();
      const byId = new Map(result.map(r => [r.task.id, r]));
      expect(byId.get('p1')!.parentTask).toBeNull();
      expect(byId.get('c1')!.parentTask!.id).toBe('p1');
      expect(byId.get('g1')!.parentTask!.id).toBe('c1');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects unit src/tasks/obsidianTasksWrapper.test.ts -t "parent map"`
Expected: FAIL — `TaskWithBody` has no `parentTask` (compile error or `undefined`).

- [ ] **Step 3: Implement**

In `src/tasks/obsidianTasksWrapper.ts`:

a) Extend the interface:

```ts
export interface TaskWithBody {
    task: ObsidianTask;
    body: string;
    parentTask: ObsidianTask | null;
}
```

b) In `loadBodies`, within the `for (const [filePath, fileTasks] of tasksByFile)` block, after `const lines = content.split('\n');`, compute per-file structural parents. Replace the inner `for (const task of fileTasks)` loop with:

```ts
                const lineOf = (t: ObsidianTask) =>
                    lines.findIndex(l => l.trim() === t.originalMarkdown.trim());
                const indentOf = (idx: number) =>
                    idx < 0 ? -1 : (lines[idx].match(/^\s*/)?.[0].length ?? 0);

                const located = fileTasks
                    .map(task => ({ task, line: lineOf(task) }))
                    .sort((a, b) => a.line - b.line);

                for (let i = 0; i < located.length; i++) {
                    const { task, line } = located[i];
                    if (line === -1) {
                        result.push({ task, body: '', parentTask: null });
                        continue;
                    }
                    const myIndent = indentOf(line);
                    let parentTask: ObsidianTask | null = null;
                    for (let j = i - 1; j >= 0; j--) {
                        if (located[j].line !== -1 && indentOf(located[j].line) < myIndent) {
                            parentTask = located[j].task;
                            break;
                        }
                    }
                    result.push({
                        task,
                        body: this.extractBodyFromFile(content, line),
                        parentTask,
                    });
                }
```

c) In the early-return / catch branches of `loadBodies` that push `{ task, body: '' }`, add `parentTask: null` to each (there are three such sites: file-not-found, line-not-found is now handled above, and the `catch`). Search for `result.push({ task, body: '' })` and make each `result.push({ task, body: '', parentTask: null })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects unit src/tasks/obsidianTasksWrapper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tasks/obsidianTasksWrapper.ts src/tasks/obsidianTasksWrapper.test.ts
git commit -m "feat: compute structural parent map per file (#61)"
```

---

## Task 7: Sync-tag inheritance through ancestors

**Files:**
- Modify: `src/tasks/obsidianTasksWrapper.ts`
- Test: `src/tasks/obsidianTasksWrapper.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/tasks/obsidianTasksWrapper.test.ts`:

```ts
  describe('filterByTag inheritance', () => {
    const tagged = (over: Partial<ObsidianTask>) =>
      ({ tags: ['#sync'], id: '', originalMarkdown: '', taskLocation: { _tasksFile: { _path: 'a.md' }, _lineNumber: 0 }, ...over } as unknown as ObsidianTask);
    const plain = (over: Partial<ObsidianTask>) =>
      ({ tags: [], id: '', originalMarkdown: '', taskLocation: { _tasksFile: { _path: 'a.md' }, _lineNumber: 0 }, ...over } as unknown as ObsidianTask);

    it('keeps an untagged child when an ancestor carries the sync tag', () => {
      const parent = tagged({ id: 'p1' });
      const child = plain({ id: 'c1' });
      const grandchild = plain({ id: 'g1' });
      const inputs = [
        { task: parent, body: '', parentTask: null },
        { task: child, body: '', parentTask: parent },
        { task: grandchild, body: '', parentTask: child },
      ];
      const kept = wrapper.filterByTag(inputs, '#sync').map(i => i.task.id);
      expect(kept.sort()).toEqual(['c1', 'g1', 'p1']);
    });

    it('drops an untagged task whose ancestors are also untagged', () => {
      const parent = plain({ id: 'p1' });
      const child = plain({ id: 'c1' });
      const inputs = [
        { task: parent, body: '', parentTask: null },
        { task: child, body: '', parentTask: parent },
      ];
      expect(wrapper.filterByTag(inputs, '#sync')).toHaveLength(0);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects unit src/tasks/obsidianTasksWrapper.test.ts -t "filterByTag inheritance"`
Expected: FAIL — current `filterByTag` checks only the task's own tags, so `c1`/`g1` are dropped.

- [ ] **Step 3: Implement**

In `src/tasks/obsidianTasksWrapper.ts`, replace the `filterByTag` body:

```ts
    filterByTag(inputs: TaskWithBody[], syncTag?: string): TaskWithBody[] {
        if (!syncTag || syncTag.trim() === '') return inputs;

        const tagLower = syncTag.toLowerCase().replace(/^#/, '');
        const hasOwnTag = (task: ObsidianTask) =>
            !!task.tags && task.tags.some(t => t.toLowerCase().replace(/^#/, '') === tagLower);

        const byTask = new Map<ObsidianTask, TaskWithBody>(inputs.map(i => [i.task, i]));

        const eligible = new Map<ObsidianTask, boolean>();
        const isEligible = (input: TaskWithBody): boolean => {
            const cached = eligible.get(input.task);
            if (cached !== undefined) return cached;
            eligible.set(input.task, false); // cycle guard
            const parentInput = input.parentTask ? byTask.get(input.parentTask) : undefined;
            const result = hasOwnTag(input.task) || (parentInput ? isEligible(parentInput) : false);
            eligible.set(input.task, result);
            return result;
        };

        return inputs.filter(isEligible);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects unit src/tasks/obsidianTasksWrapper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tasks/obsidianTasksWrapper.ts src/tasks/obsidianTasksWrapper.test.ts
git commit -m "feat: sync-tag inheritance through ancestors (#61)"
```

---

## Task 8: ObsidianAdapter resolves structural parent → `parentUid`

**Files:**
- Modify: `src/sync/obsidianAdapter.ts`
- Test: `src/sync/obsidianAdapter.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/sync/obsidianAdapter.test.ts` (reuse the file's existing adapter/wrapper construction and `normalize` test style):

```ts
  describe('normalize parentUid', () => {
    it('sets parentUid to the assigned id of the structural parent', () => {
      const parent = { id: 'p1', description: 'Parent', tags: ['#sync'],
        status: { configuration: { symbol: ' ', name: 'Todo', type: 'TODO' } },
        isDone: false, priority: '0', recurrence: null,
        taskLocation: { _tasksFile: { _path: 'a.md' }, _lineNumber: 0 },
        originalMarkdown: '- [ ] Parent 🆔 p1 #sync',
        createdDate: null, startDate: null, scheduledDate: null,
        dueDate: null, doneDate: null, cancelledDate: null } as unknown as ObsidianTask;
      const child = { ...parent, id: 'c1', description: 'Child',
        originalMarkdown: '    - [ ] Child 🆔 c1' } as unknown as ObsidianTask;

      const adapter = makeAdapter(); // existing factory in this test file
      const tasks = adapter.normalize(
        [
          { task: parent, body: '', parentTask: null },
          { task: child, body: '', parentTask: parent },
        ],
        (t) => (t.id && t.id.length > 0 ? t.id : null),
      );
      const byUid = new Map(tasks.map(t => [t.uid, t]));
      expect(byUid.get('p1')!.parentUid ?? null).toBeNull();
      expect(byUid.get('c1')!.parentUid).toBe('p1');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects unit src/sync/obsidianAdapter.test.ts -t "normalize parentUid"`
Expected: FAIL — `parentUid` is `undefined` for `c1`.

- [ ] **Step 3: Implement**

In `src/sync/obsidianAdapter.ts`, rewrite `normalize` to do a second pass. Replace the method:

```ts
	normalize(
		inputs: TaskWithBody[],
		extractId: (task: ObsidianTask) => string | null,
	): CommonTask[] {
		this.tasksById = new Map();
		const idByTask = new Map<ObsidianTask, string>();
		const pending: Array<{ common: CommonTask; parentTask: ObsidianTask | null }> = [];

		for (const { task, body, parentTask } of inputs) {
			const taskId = extractId(task) ?? generateTaskId();
			this.tasksById.set(taskId, task);
			idByTask.set(task, taskId);
			const common = this.mapper.toCommonTask(task, taskId, body);

			if (this.settings.includeObsidianLink && this.settings.getVaultName) {
				common.obsidianUrl = this.buildObsidianUrl(
					this.settings.getVaultName(),
					task.taskLocation._tasksFile._path,
				);
			}

			pending.push({ common, parentTask });
		}

		for (const { common, parentTask } of pending) {
			common.parentUid = parentTask ? (idByTask.get(parentTask) ?? null) : null;
		}

		return pending.map(p => p.common);
	}
```

(Note: `extractId` for the parent is irrelevant here — the parent is in the same batch, so `idByTask` already holds its assigned id.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects unit src/sync/obsidianAdapter.test.ts`
Expected: PASS (fix any existing `normalize` tests that pass `TaskWithBody` literals without `parentTask` by adding `parentTask: null`).

- [ ] **Step 5: Commit**

```bash
git add src/sync/obsidianAdapter.ts src/sync/obsidianAdapter.test.ts
git commit -m "feat: ObsidianAdapter resolves structural parent to parentUid (#61)"
```

---

## Task 9: Indentation-preserving update in the vault

**Files:**
- Modify: `src/tasks/obsidianTasksWrapper.ts`
- Test: `src/tasks/obsidianTasksWrapper.test.ts`

**Why:** A synced child line is indented. `updateTaskInVault` matches the line by trimmed equality and replaces it with `newContent` produced indent-agnostically by `ObsidianMapper.toMarkdown`. We must re-apply the original line's indentation and stop the body-replacement loop at child task lines (so a parent update never eats its children).

- [ ] **Step 1: Write the failing test**

Add to `src/tasks/obsidianTasksWrapper.test.ts` (model on the existing `updateTaskInVault` tests and their `app.vault` mock):

```ts
  describe('updateTaskInVault preserves indentation', () => {
    it('keeps the child indent and does not consume child lines when updating the parent', async () => {
      const file = makeMockFileWithContent([
        '- [ ] Parent 🆔 p1 #sync',
        '    - body line',
        '    - [ ] Child 🆔 c1',
      ].join('\n'));
      // child task object whose originalMarkdown is the trimmed child line
      await wrapper.updateTaskInVault(childTask /* originalMarkdown '- [ ] Child 🆔 c1' */, '- [x] Child 🆔 c1');
      const written = lastWrittenContent();
      expect(written).toContain('    - [x] Child 🆔 c1');
      expect(written).toContain('- [ ] Parent 🆔 p1 #sync');
      expect(written).toContain('    - body line');
    });

    it('replacing the parent stops at the child task line', async () => {
      const file = makeMockFileWithContent([
        '- [ ] Parent 🆔 p1 #sync',
        '    - body line',
        '    - [ ] Child 🆔 c1',
      ].join('\n'));
      await wrapper.updateTaskInVault(parentTask /* originalMarkdown '- [ ] Parent 🆔 p1 #sync' */, '- [x] Parent 🆔 p1 #sync');
      const written = lastWrittenContent();
      expect(written).toContain('    - [ ] Child 🆔 c1'); // child untouched
    });
  });
```

Use the file's existing mock helpers; the names above (`makeMockFileWithContent`, `lastWrittenContent`, `childTask`, `parentTask`) are placeholders for whatever the nearest existing `updateTaskInVault` test uses — match that style exactly.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects unit src/tasks/obsidianTasksWrapper.test.ts -t "updateTaskInVault preserves indentation"`
Expected: FAIL — child written without indent; parent replace consumes the child line as "note".

- [ ] **Step 3: Implement**

In `src/tasks/obsidianTasksWrapper.ts`, in `updateTaskInVault`, after `if (taskIndex === -1) { ... }`, capture the indent and bound the body loop with `isTaskLine`:

```ts
        const originalIndent = lines[taskIndex].match(/^\s*/)?.[0] ?? '';

        let noteLineCount = 0;
        for (let i = taskIndex + 1; i < lines.length; i++) {
            if (isTaskLine(lines[i])) break;
            if (/^(?:\s{2,}|\t)- /.test(lines[i])) {
                noteLineCount++;
            } else {
                break;
            }
        }

        const newLines = newContent.split('\n').map(l => originalIndent + l);
        lines.splice(taskIndex, 1 + noteLineCount, ...newLines);
```

(Replace the existing `noteLineCount` loop and the `newContent.split('\n')` / `splice` lines with the block above.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects unit src/tasks/obsidianTasksWrapper.test.ts`
Expected: PASS. If any existing top-level (indent `''`) update test now fails because body lines get double-indented, note `originalIndent` is `''` for top-level tasks so `'' + l === l` — those are unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/tasks/obsidianTasksWrapper.ts src/tasks/obsidianTasksWrapper.test.ts
git commit -m "feat: preserve task indentation on vault update (#61)"
```

---

## Task 10: Create CalDAV-origin subtasks nested under their parent

**Files:**
- Modify: `src/tasks/obsidianTasksWrapper.ts`
- Modify: `src/sync/obsidianAdapter.ts`
- Test: `src/tasks/obsidianTasksWrapper.test.ts`
- Test: `src/sync/obsidianAdapter.test.ts`

- [ ] **Step 1: Write the failing test (wrapper insert)**

Add to `src/tasks/obsidianTasksWrapper.test.ts`:

```ts
  describe('insertSubtask', () => {
    it('inserts the child indented under the parent, after the parent body', async () => {
      const content = ['- [ ] Parent 🆔 p1 #sync', '    - parent body'].join('\n');
      const file = makeMockFileWithContent(content); // existing helper
      // parentTask.originalMarkdown === '- [ ] Parent 🆔 p1 #sync', _path of the file
      await wrapper.insertSubtask(parentTask, '- [ ] Child 🆔 c1');
      const written = lastWrittenContent();
      expect(written).toBe([
        '- [ ] Parent 🆔 p1 #sync',
        '    - parent body',
        '    - [ ] Child 🆔 c1',
      ].join('\n'));
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects unit src/tasks/obsidianTasksWrapper.test.ts -t "insertSubtask"`
Expected: FAIL — `wrapper.insertSubtask` is not a function.

- [ ] **Step 3: Implement the wrapper method**

In `src/tasks/obsidianTasksWrapper.ts`, add:

```ts
    /**
     * Insert a child task line indented one level under `parentTask`,
     * placed after the parent's body lines and any existing subtasks.
     */
    async insertSubtask(parentTask: ObsidianTask, childMarkdown: string): Promise<void> {
        const filePath = parentTask.taskLocation._tasksFile._path;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!file || !(file instanceof TFile)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        const parentIndex = lines.findIndex(
            l => l.trim() === parentTask.originalMarkdown.trim(),
        );
        if (parentIndex === -1) {
            throw new Error(`Could not find parent in file: ${parentTask.originalMarkdown}`);
        }

        const parentIndent = lines[parentIndex].match(/^\s*/)?.[0] ?? '';
        const childIndent = parentIndent + '    ';

        let insertAt = parentIndex + 1;
        for (let i = parentIndex + 1; i < lines.length; i++) {
            const indent = lines[i].match(/^\s*/)?.[0] ?? '';
            if (indent.length > parentIndent.length && lines[i].trim() !== '') {
                insertAt = i + 1;
            } else {
                break;
            }
        }

        const childLines = childMarkdown.split('\n').map(l => childIndent + l);
        lines.splice(insertAt, 0, ...childLines);
        await this.app.vault.modify(file, lines.join('\n'));
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects unit src/tasks/obsidianTasksWrapper.test.ts -t "insertSubtask"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tasks/obsidianTasksWrapper.ts src/tasks/obsidianTasksWrapper.test.ts
git commit -m "feat: insertSubtask writes child nested under parent (#61)"
```

- [ ] **Step 6: Write the failing test (adapter ordering + nested create)**

Add to `src/sync/obsidianAdapter.test.ts`:

```ts
  describe('applyChanges subtask creates', () => {
    it('creates parent before child and writes the child under the parent', async () => {
      // Use the file's existing wrapper spy/mock. Expect createTask called for the
      // parent, then insertSubtask called for the child with the created parent task.
      const changes = [
        { type: 'create', task: { ...baseCommonTask, uid: 'cal-child', parentUid: 'cal-parent' } },
        { type: 'create', task: { ...baseCommonTask, uid: 'cal-parent', parentUid: null } },
      ] as SyncChange[];

      await adapter.applyChanges(changes);

      expect(wrapper.createTask).toHaveBeenCalledTimes(1);          // only the parent
      expect(wrapper.insertSubtask).toHaveBeenCalledTimes(1);       // the child
    });
  });
```

Match the exact spy/mocking approach already used by other `applyChanges` tests in this file.

- [ ] **Step 7: Run test to verify it fails**

Run: `npx jest --selectProjects unit src/sync/obsidianAdapter.test.ts -t "applyChanges subtask creates"`
Expected: FAIL — both creates currently go through `createTask`; no ordering, no `insertSubtask`.

- [ ] **Step 8: Implement adapter ordering + nested create**

In `src/sync/obsidianAdapter.ts`, in `applyChanges`, before the `for (const change of changes)` loop, topologically order creates parent-first and prepare a within-batch map:

```ts
		const orderedChanges = this.orderCreatesParentFirst(changes);
		const createdIdByUid = new Map<string, { taskId: string; created: ObsidianTask | null }>();
```

Iterate `orderedChanges` instead of `changes`. Replace the `case "create":` block with:

```ts
					case "create": {
						const taskId = generateTaskId();
						const taskWithId: CommonTask = { ...change.task, uid: taskId, parentUid: null };
						const markdown = this.mapper.toMarkdown(taskWithId, this.settings.syncTag);

						const parentEntry = change.task.parentUid
							? createdIdByUid.get(change.task.parentUid)
							: undefined;
						const existingParent = change.task.parentUid
							? this.wrapper.findTaskById(
								createdIdByUid.get(change.task.parentUid)?.taskId
								?? change.task.parentUid)
							: null;
						const parentTask = parentEntry?.created ?? existingParent;

						if (parentTask) {
							await this.wrapper.insertSubtask(parentTask, markdown);
						} else {
							await this.wrapper.createTask(
								markdown,
								this.settings.newTasksDestination,
								this.settings.newTasksSection,
							);
						}

						const created = this.wrapper.findTaskById(taskId);
						createdIdByUid.set(change.task.uid, { taskId, created });
						createdMappings.push({ taskId, caldavUID: change.task.uid });
						break;
					}
```

Add the ordering helper as a private method:

```ts
	/**
	 * Stable-order changes so that a create whose parent is also being created
	 * appears after its parent. Non-create changes keep their relative order.
	 */
	private orderCreatesParentFirst(changes: SyncChange[]): SyncChange[] {
		const creates = changes.filter(c => c.type === "create");
		const others = changes.filter(c => c.type !== "create");
		const byUid = new Map(creates.map(c => [c.task.uid, c]));
		const ordered: SyncChange[] = [];
		const visited = new Set<string>();
		const visit = (c: SyncChange) => {
			if (visited.has(c.task.uid)) return;
			visited.add(c.task.uid);
			const parentUid = c.task.parentUid;
			if (parentUid && byUid.has(parentUid)) visit(byUid.get(parentUid)!);
			ordered.push(c);
		};
		for (const c of creates) visit(c);
		return [...ordered, ...others];
	}
```

> Note: `findTaskById` reads the live obsidian-tasks cache, which is not refreshed mid-sync in unit mocks. The test mocks `findTaskById`/`insertSubtask`; in production, a parent created earlier in the same batch may not yet be in the cache, so `insertSubtask` falls back to `createTask`-style placement only when no parent is resolvable. This is acceptable: the relationship is still carried by `parentUid` → `RELATED-TO` on the CalDAV side and re-nested on the next sync once the cache includes the parent. Document this limitation in the spec's "Ordering" section if not already implied.

- [ ] **Step 9: Run test to verify it passes**

Run: `npx jest --selectProjects unit src/sync/obsidianAdapter.test.ts`
Expected: PASS (adjust any prior `applyChanges` tests for the new ordering/no-op-on-non-create — ordering is stable for single creates).

- [ ] **Step 10: Commit**

```bash
git add src/sync/obsidianAdapter.ts src/sync/obsidianAdapter.test.ts
git commit -m "feat: create CalDAV-origin subtasks nested under parent (#61)"
```

---

## Task 11: Cascade delete via `expandSubtreeDeletes`

**Files:**
- Modify: `src/sync/diff.ts`
- Modify: `src/sync/syncEngine.ts`
- Test: `src/sync/diff.test.ts`
- Test: `src/sync/syncEngine.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/sync/diff.test.ts`:

```ts
describe('expandSubtreeDeletes', () => {
  it('expands a parent delete into deletes for the whole subtree', () => {
    const parent = makeCommonTask({ uid: 'p1' });
    const child = makeCommonTask({ uid: 'c1', parentUid: 'p1' });
    const grand = makeCommonTask({ uid: 'g1', parentUid: 'c1' });
    const sibling = makeCommonTask({ uid: 's1' });

    const changeset = { toObsidian: [], toCalDAV: [{ type: 'delete', task: parent }], conflicts: [] } as Changeset;
    const tasksByUid = new Map([['p1', parent], ['c1', child], ['g1', grand], ['s1', sibling]]);

    const out = expandSubtreeDeletes(changeset, tasksByUid);

    const deletedUids = out.toCalDAV.filter(c => c.type === 'delete').map(c => c.task.uid).sort();
    expect(deletedUids).toEqual(['c1', 'g1', 'p1']);
  });

  it('does not duplicate an already-present child delete', () => {
    const parent = makeCommonTask({ uid: 'p1' });
    const child = makeCommonTask({ uid: 'c1', parentUid: 'p1' });
    const changeset = {
      toObsidian: [],
      toCalDAV: [{ type: 'delete', task: parent }, { type: 'delete', task: child }],
      conflicts: [],
    } as Changeset;
    const out = expandSubtreeDeletes(changeset, new Map([['p1', parent], ['c1', child]]));
    expect(out.toCalDAV.filter(c => c.task.uid === 'c1')).toHaveLength(1);
  });
});
```

Add `Changeset` to the existing import from `./types` in this test file if not already imported.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --selectProjects unit src/sync/diff.test.ts -t "expandSubtreeDeletes"`
Expected: FAIL — `expandSubtreeDeletes` is not exported.

- [ ] **Step 3: Implement in `src/sync/diff.ts`**

Append:

```ts
/**
 * Expand every `delete` change into deletes for its entire descendant subtree,
 * on the same side. `tasksByUid` is the union of currently-known tasks
 * (current side + baseline) used to resolve parent→child adjacency.
 */
export function expandSubtreeDeletes(
  changeset: Changeset,
  tasksByUid: Map<string, CommonTask>,
): Changeset {
  const childrenOf = new Map<string, CommonTask[]>();
  for (const task of tasksByUid.values()) {
    const p = task.parentUid ?? null;
    if (!p) continue;
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p)!.push(task);
  }

  const expand = (changes: SyncChange[]): SyncChange[] => {
    const present = new Set(changes.filter(c => c.type === 'delete').map(c => c.task.uid));
    const extra: SyncChange[] = [];
    const queue = [...present];
    while (queue.length > 0) {
      const uid = queue.shift()!;
      for (const child of childrenOf.get(uid) ?? []) {
        if (present.has(child.uid)) continue;
        present.add(child.uid);
        extra.push({ type: 'delete', task: child });
        queue.push(child.uid);
      }
    }
    return [...changes, ...extra];
  };

  return {
    toObsidian: expand(changeset.toObsidian),
    toCalDAV: expand(changeset.toCalDAV),
    conflicts: changeset.conflicts,
  };
}
```

Ensure `Changeset` is in the existing `./types` import at the top of `diff.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --selectProjects unit src/sync/diff.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into SyncEngine**

In `src/sync/syncEngine.ts`, add `expandSubtreeDeletes` to the existing `import { diff } from './diff'` (→ `import { diff, expandSubtreeDeletes } from './diff'`). Immediately after the line `const changeset = diff(obsidianTasks, caldavTasks, baseline, this.conflictStrategy());`, insert:

```ts
			const tasksByUid = new Map<string, CommonTask>();
			for (const t of [...baseline, ...caldavTasks, ...obsidianTasks]) tasksByUid.set(t.uid, t);
			const expandedChangeset = expandSubtreeDeletes(changeset, tasksByUid);
```

Then replace every subsequent use of `changeset` in that method with `expandedChangeset` (the `dryRun` return, both `applyChanges` calls, `updateIdMapping`, `persistState`, `buildResult`).

- [ ] **Step 6: Run the sync engine tests**

Run: `npx jest --selectProjects unit src/sync/syncEngine.test.ts`
Expected: PASS. If a test asserts on `changeset` contents through a delete path, update its expectation to include cascaded child deletes (this is the intended new behavior).

- [ ] **Step 7: Commit**

```bash
git add src/sync/diff.ts src/sync/syncEngine.ts src/sync/diff.test.ts src/sync/syncEngine.test.ts
git commit -m "feat: cascade delete subtree on parent delete (#61)"
```

---

## Task 12: E2E round-trip against real Radicale

**Files:**
- Create: `test/e2e/subtaskSync.e2e.test.ts`

- [ ] **Step 1: Write the test**

Model this file on `test/e2e/caldavAdapter.e2e.test.ts` (same imports, `FetchHttpClient`, `createIsolatedCalendar()` helper, client construction). The test:

```ts
// Imports + isolated-calendar setup copied from caldavAdapter.e2e.test.ts.

describe('subtask sync (Radicale)', () => {
  it('round-trips RELATED-TO;RELTYPE=PARENT', async () => {
    const idMapping = { taskIdToCaldavUid: {}, caldavUidToTaskId: {} };
    const parent = { uid: 'p1', title: 'Parent', status: 'TODO', dueDate: null,
      startDate: null, scheduledDate: null, completedDate: null, priority: 'none',
      tags: ['sync'], recurrenceRule: '', body: '', parentUid: null } as CommonTask;
    const child = { ...parent, uid: 'c1', title: 'Child', parentUid: 'p1' };

    await adapter.applyChanges([
      { type: 'create', task: parent },
      { type: 'create', task: child },
    ], idMapping);

    const fetched = await adapter.fetchTasks('sync', idMapping);
    const fetchedChild = fetched.find(t => t.title === 'Child')!;
    expect(fetchedChild.parentUid).toBe('p1');
  });

  it('cascade-deletes children when the parent is deleted', async () => {
    // create parent+child as above, then applyChanges a delete of the parent
    // expanded via expandSubtreeDeletes, then assert fetchTasks returns neither.
  });
});
```

Fill the second test body using `expandSubtreeDeletes` exactly as `SyncEngine` does, and the file's isolated-calendar teardown.

- [ ] **Step 2: Run it**

Run: `npm run test:e2e:radicale -- --testPathPatterns='test/e2e/subtaskSync'`
Expected: PASS (Docker Radicale auto-started by `ensure-servers.mjs`).

- [ ] **Step 3: Commit**

```bash
git add test/e2e/subtaskSync.e2e.test.ts
git commit -m "test: e2e subtask round-trip and cascade delete on Radicale (#61)"
```

---

## Task 13: wdio Obsidian smoke — parent + one subtask

**Files:**
- Modify: the wdio spec file under `test/wdio/` that holds the four happy-path scenarios (identify via `ls test/wdio/`)

- [ ] **Step 1: Add the scenario**

Following the existing wdio scenario style in that file, add a fifth happy-path test: in the Obsidian vault, write a parent task with one indented `- [ ]` subtask under it (both under the sync tag inheritance), run the plugin sync command, then assert via the CalDAV client that the child VTODO contains `RELATED-TO;RELTYPE=PARENT:<parent-uid>`. Reuse the existing helpers in that spec for triggering sync and reading CalDAV.

`test/wdio/vault/.obsidian/plugins/tasks-caldav-sync/data.json` needs **no** change — no settings fields were added (verify against `src/types.ts`).

- [ ] **Step 2: Run it**

Run: `npm run test:wdio`
Expected: PASS (first run downloads an Obsidian binary into `.obsidian-cache/`; requires Docker).

- [ ] **Step 3: Commit**

```bash
git add test/wdio
git commit -m "test: wdio smoke for parent + subtask sync (#61)"
```

---

## Task 14: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: no errors. Fix any (sentence-case UI text, no `any`, no floating promises).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: `tsc -noEmit` clean, esbuild succeeds.

- [ ] **Step 3: Full test suite + coverage**

Run: `npm test`
Expected: all unit + E2E pass; coverage thresholds for `src/sync` (80/80), `src/caldav` (80/70), `src/tasks` (80/80) hold. Add focused unit tests for any newly-uncovered branches (e.g., `extractRelatedParent` CHILD-ignore path, `expandSubtreeDeletes` cycle/no-parent path, `orderCreatesParentFirst` with only non-creates) until thresholds pass.

- [ ] **Step 4: Update issue + README if user-facing**

Add a short "Subtasks" subsection to `README.md` (sentence case) describing: indented subtasks under a synced task sync as CalDAV subtasks (`RELATED-TO PARENT`); arbitrary depth; deleting a parent deletes its subtree; `dependsOn`/cross-note not yet supported.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: document subtask sync; final verification (#61)"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** §2 data model → Task 1; §3 Obsidian (isTaskLine/body → Task 5; parent map → Task 6; inheritance → Task 7; normalize → Task 8; indent preservation → Task 9) ; §4 CalDAV → Tasks 2–4; §5 ordering → Tasks 8 & 10; §6 cascade delete → Task 11; testing → Tasks 12–14. No spec section is unimplemented.
- **`parentUid` optionality** is deliberate (see header note) — every comparison/serialization normalizes with `?? null`.
- When editing existing tests that build `TaskWithBody` or call `toCommonTask`/`fromCommonTask`/`taskToVTODO`, add the new `parentTask: null` / third argument; the compiler will point to each site.
