import { diff, tasksEqual } from './diff';
import { CommonTask } from './types';

function makeCommonTask(overrides: Partial<CommonTask> = {}): CommonTask {
  return {
    uid: 'task-001',
    title: 'Default task',
    status: 'TODO',
    dueDate: null,
    startDate: null,
    scheduledDate: null,
    completedDate: null,
    priority: 'none',
    tags: [],
    recurrenceRule: '',
    body: '',
    ...overrides,
  };
}

describe('tasksEqual', () => {
  it('should return true for identical tasks', () => {
    const a = makeCommonTask();
    const b = makeCommonTask();
    expect(tasksEqual(a, b)).toBe(true);
  });

  it('should detect description change', () => {
    const a = makeCommonTask({ title: 'Task A' });
    const b = makeCommonTask({ title: 'Task B' });
    expect(tasksEqual(a, b)).toBe(false);
  });

  it('should detect status change', () => {
    const a = makeCommonTask({ status: 'TODO' });
    const b = makeCommonTask({ status: 'DONE' });
    expect(tasksEqual(a, b)).toBe(false);
  });

  it('should detect date changes', () => {
    const a = makeCommonTask({ dueDate: '2025-01-15' });
    const b = makeCommonTask({ dueDate: '2025-01-16' });
    expect(tasksEqual(a, b)).toBe(false);
  });

  it('should detect priority change', () => {
    const a = makeCommonTask({ priority: 'high' });
    const b = makeCommonTask({ priority: 'low' });
    expect(tasksEqual(a, b)).toBe(false);
  });

  it('should detect tag changes', () => {
    const a = makeCommonTask({ tags: ['sync'] });
    const b = makeCommonTask({ tags: ['sync', 'work'] });
    expect(tasksEqual(a, b)).toBe(false);
  });

  it('should detect tag order changes', () => {
    const a = makeCommonTask({ tags: ['a', 'b'] });
    const b = makeCommonTask({ tags: ['b', 'a'] });
    expect(tasksEqual(a, b)).toBe(false);
  });

  it('should handle null vs non-null dates', () => {
    const a = makeCommonTask({ dueDate: null });
    const b = makeCommonTask({ dueDate: '2025-01-15' });
    expect(tasksEqual(a, b)).toBe(false);
  });

  it('ignores startDate differences — 🛫 is local-only and never syncs', () => {
    const a = makeCommonTask({ startDate: '2026-07-01' });
    const b = makeCommonTask({ startDate: null });
    expect(tasksEqual(a, b)).toBe(true);
  });

  it('should detect body change', () => {
    const a = makeCommonTask({ body: 'Note A' });
    const b = makeCommonTask({ body: 'Note B' });
    expect(tasksEqual(a, b)).toBe(false);
  });

  it('should treat empty body as equal', () => {
    const a = makeCommonTask({ body: '' });
    const b = makeCommonTask({ body: '' });
    expect(tasksEqual(a, b)).toBe(true);
  });

  it('should detect body added where there was none', () => {
    const a = makeCommonTask({ body: '' });
    const b = makeCommonTask({ body: 'New note' });
    expect(tasksEqual(a, b)).toBe(false);
  });
});

describe('diff', () => {
  describe('no changes', () => {
    it('should produce empty changeset when everything is identical', () => {
      const task = makeCommonTask({ uid: 'task-1' });
      const result = diff([task], [task], [task], 'caldav-wins');

      expect(result.toObsidian).toHaveLength(0);
      expect(result.toCalDAV).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should produce empty changeset for empty inputs', () => {
      const result = diff([], [], [], 'caldav-wins');

      expect(result.toObsidian).toHaveLength(0);
      expect(result.toCalDAV).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
    });
  });

  describe('creates', () => {
    it('should detect new task from Obsidian', () => {
      const newTask = makeCommonTask({ uid: 'new-obs' });
      const result = diff([newTask], [], [], 'caldav-wins');

      expect(result.toCalDAV).toHaveLength(1);
      expect(result.toCalDAV[0].type).toBe('create');
      expect(result.toCalDAV[0].task.uid).toBe('new-obs');
      expect(result.toObsidian).toHaveLength(0);
    });

    it('should detect new task from CalDAV', () => {
      const newTask = makeCommonTask({ uid: 'new-cal' });
      const result = diff([], [newTask], [], 'caldav-wins');

      expect(result.toObsidian).toHaveLength(1);
      expect(result.toObsidian[0].type).toBe('create');
      expect(result.toObsidian[0].task.uid).toBe('new-cal');
      expect(result.toCalDAV).toHaveLength(0);
    });
  });

  describe('updates', () => {
    it('should detect task updated in Obsidian only', () => {
      const baseline = makeCommonTask({ uid: 't1', title: 'Original' });
      const obsidian = makeCommonTask({ uid: 't1', title: 'Modified in Obsidian' });
      const caldav = makeCommonTask({ uid: 't1', title: 'Original' });

      const result = diff([obsidian], [caldav], [baseline], 'caldav-wins');

      expect(result.toCalDAV).toHaveLength(1);
      expect(result.toCalDAV[0].type).toBe('update');
      expect(result.toCalDAV[0].task.title).toBe('Modified in Obsidian');
      expect(result.toCalDAV[0].previousVersion).toEqual(baseline);
      expect(result.toObsidian).toHaveLength(0);
    });

    it('should detect task updated in CalDAV only', () => {
      const baseline = makeCommonTask({ uid: 't1', title: 'Original' });
      const obsidian = makeCommonTask({ uid: 't1', title: 'Original' });
      const caldav = makeCommonTask({ uid: 't1', title: 'Modified in CalDAV' });

      const result = diff([obsidian], [caldav], [baseline], 'caldav-wins');

      expect(result.toObsidian).toHaveLength(1);
      expect(result.toObsidian[0].type).toBe('update');
      expect(result.toObsidian[0].task.title).toBe('Modified in CalDAV');
      expect(result.toCalDAV).toHaveLength(0);
    });

    it('should detect status change to DONE as complete', () => {
      const baseline = makeCommonTask({ uid: 't1', status: 'TODO' });
      const obsidian = makeCommonTask({ uid: 't1', status: 'DONE', completedDate: '2025-01-15' });
      const caldav = makeCommonTask({ uid: 't1', status: 'TODO' });

      const result = diff([obsidian], [caldav], [baseline], 'caldav-wins');

      expect(result.toCalDAV).toHaveLength(1);
      expect(result.toCalDAV[0].type).toBe('complete');
      expect(result.toCalDAV[0].task.status).toBe('DONE');
    });
  });

  describe('deletes', () => {
    it('should detect task deleted from CalDAV', () => {
      const baseline = makeCommonTask({ uid: 't1' });
      const obsidian = makeCommonTask({ uid: 't1' });

      const result = diff([obsidian], [], [baseline], 'caldav-wins');

      expect(result.toObsidian).toHaveLength(1);
      expect(result.toObsidian[0].type).toBe('delete');
      expect(result.toObsidian[0].task.uid).toBe('t1');
      expect(result.toCalDAV).toHaveLength(0);
    });

    it('should detect task deleted from Obsidian', () => {
      const baseline = makeCommonTask({ uid: 't1' });
      const caldav = makeCommonTask({ uid: 't1' });

      const result = diff([], [caldav], [baseline], 'caldav-wins');

      expect(result.toCalDAV).toHaveLength(1);
      expect(result.toCalDAV[0].type).toBe('delete');
      expect(result.toCalDAV[0].task.uid).toBe('t1');
      expect(result.toObsidian).toHaveLength(0);
    });

    it('should produce no changes when deleted on both sides', () => {
      const baseline = makeCommonTask({ uid: 't1' });

      const result = diff([], [], [baseline], 'caldav-wins');

      expect(result.toObsidian).toHaveLength(0);
      expect(result.toCalDAV).toHaveLength(0);
    });
  });

  describe('conflicts', () => {
    it('should detect conflict when both sides modified', () => {
      const baseline = makeCommonTask({ uid: 't1', title: 'Original' });
      const obsidian = makeCommonTask({ uid: 't1', title: 'Modified in Obsidian' });
      const caldav = makeCommonTask({ uid: 't1', title: 'Modified in CalDAV' });

      const result = diff([obsidian], [caldav], [baseline], 'caldav-wins');

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].uid).toBe('t1');
      expect(result.conflicts[0].obsidianVersion.title).toBe('Modified in Obsidian');
      expect(result.conflicts[0].caldavVersion.title).toBe('Modified in CalDAV');
      expect(result.conflicts[0].baselineVersion.title).toBe('Original');
    });

    it('should resolve conflict with caldav-wins strategy', () => {
      const baseline = makeCommonTask({ uid: 't1', title: 'Original' });
      const obsidian = makeCommonTask({ uid: 't1', title: 'Obsidian version' });
      const caldav = makeCommonTask({ uid: 't1', title: 'CalDAV version' });

      const result = diff([obsidian], [caldav], [baseline], 'caldav-wins');

      // CalDAV wins: push CalDAV version to Obsidian
      expect(result.toObsidian).toHaveLength(1);
      expect(result.toObsidian[0].type).toBe('update');
      expect(result.toObsidian[0].task.title).toBe('CalDAV version');
      expect(result.toCalDAV).toHaveLength(0);
    });

    it('should resolve conflict with obsidian-wins strategy', () => {
      const baseline = makeCommonTask({ uid: 't1', title: 'Original' });
      const obsidian = makeCommonTask({ uid: 't1', title: 'Obsidian version' });
      const caldav = makeCommonTask({ uid: 't1', title: 'CalDAV version' });

      const result = diff([obsidian], [caldav], [baseline], 'obsidian-wins');

      // Obsidian wins: push Obsidian version to CalDAV
      expect(result.toCalDAV).toHaveLength(1);
      expect(result.toCalDAV[0].type).toBe('update');
      expect(result.toCalDAV[0].task.title).toBe('Obsidian version');
      expect(result.toObsidian).toHaveLength(0);
    });
  });

  describe('convergent edits', () => {
    it('should not conflict when both sides edit title to the same value', () => {
      const baseline = makeCommonTask({ uid: 't1', title: 'Original' });
      const obsidian = makeCommonTask({ uid: 't1', title: 'Buy bread' });
      const caldav = makeCommonTask({ uid: 't1', title: 'Buy bread' });

      const result = diff([obsidian], [caldav], [baseline], 'caldav-wins');

      expect(result.toObsidian).toHaveLength(0);
      expect(result.toCalDAV).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should not conflict when both sides add the same tag', () => {
      const baseline = makeCommonTask({ uid: 't1', tags: [] });
      const obsidian = makeCommonTask({ uid: 't1', tags: ['urgent'] });
      const caldav = makeCommonTask({ uid: 't1', tags: ['urgent'] });

      const result = diff([obsidian], [caldav], [baseline], 'caldav-wins');

      expect(result.toObsidian).toHaveLength(0);
      expect(result.toCalDAV).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should not conflict when both sides mark the task DONE', () => {
      const baseline = makeCommonTask({ uid: 't1', status: 'TODO' });
      const obsidian = makeCommonTask({ uid: 't1', status: 'DONE', completedDate: '2025-01-15' });
      const caldav = makeCommonTask({ uid: 't1', status: 'DONE', completedDate: '2025-01-15' });

      const result = diff([obsidian], [caldav], [baseline], 'caldav-wins');

      expect(result.toObsidian).toHaveLength(0);
      expect(result.toCalDAV).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should still conflict when both sides edit but to different values', () => {
      const baseline = makeCommonTask({ uid: 't1', title: 'Original' });
      const obsidian = makeCommonTask({ uid: 't1', title: 'Obsidian version' });
      const caldav = makeCommonTask({ uid: 't1', title: 'CalDAV version' });

      const result = diff([obsidian], [caldav], [baseline], 'caldav-wins');

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].uid).toBe('t1');
    });
  });

  describe('first sync (both sides present, no baseline)', () => {
    it('should use caldav-wins strategy when no baseline exists', () => {
      const obsidian = makeCommonTask({ uid: 't1', title: 'Obsidian' });
      const caldav = makeCommonTask({ uid: 't1', title: 'CalDAV' });

      const result = diff([obsidian], [caldav], [], 'caldav-wins');

      expect(result.toObsidian).toHaveLength(1);
      expect(result.toObsidian[0].task.title).toBe('CalDAV');
    });

    it('should use obsidian-wins strategy when no baseline exists', () => {
      const obsidian = makeCommonTask({ uid: 't1', title: 'Obsidian' });
      const caldav = makeCommonTask({ uid: 't1', title: 'CalDAV' });

      const result = diff([obsidian], [caldav], [], 'obsidian-wins');

      expect(result.toCalDAV).toHaveLength(1);
      expect(result.toCalDAV[0].task.title).toBe('Obsidian');
    });
  });

  describe('mixed scenarios', () => {
    it('should handle creates + updates + deletes + conflicts simultaneously', () => {
      const baseline = [
        makeCommonTask({ uid: 'unchanged', title: 'Same on both sides' }),
        makeCommonTask({ uid: 'obs-updated', title: 'Original' }),
        makeCommonTask({ uid: 'cal-updated', title: 'Original' }),
        makeCommonTask({ uid: 'conflict', title: 'Original' }),
        makeCommonTask({ uid: 'del-from-cal', title: 'Will be deleted from CalDAV' }),
        makeCommonTask({ uid: 'del-from-obs', title: 'Will be deleted from Obsidian' }),
      ];

      const obsidian = [
        makeCommonTask({ uid: 'unchanged', title: 'Same on both sides' }),
        makeCommonTask({ uid: 'obs-updated', title: 'Updated in Obsidian' }),
        makeCommonTask({ uid: 'cal-updated', title: 'Original' }),
        makeCommonTask({ uid: 'conflict', title: 'Obsidian conflict' }),
        makeCommonTask({ uid: 'del-from-cal', title: 'Will be deleted from CalDAV' }),
        // del-from-obs is missing
        makeCommonTask({ uid: 'new-from-obs', title: 'Brand new from Obsidian' }),
      ];

      const caldav = [
        makeCommonTask({ uid: 'unchanged', title: 'Same on both sides' }),
        makeCommonTask({ uid: 'obs-updated', title: 'Original' }),
        makeCommonTask({ uid: 'cal-updated', title: 'Updated in CalDAV' }),
        makeCommonTask({ uid: 'conflict', title: 'CalDAV conflict' }),
        // del-from-cal is missing
        makeCommonTask({ uid: 'del-from-obs', title: 'Will be deleted from Obsidian' }),
        makeCommonTask({ uid: 'new-from-cal', title: 'Brand new from CalDAV' }),
      ];

      const result = diff(obsidian, caldav, baseline, 'caldav-wins');

      // Creates
      const calCreates = result.toCalDAV.filter(c => c.type === 'create');
      const obsCreates = result.toObsidian.filter(c => c.type === 'create');
      expect(calCreates).toHaveLength(1);
      expect(calCreates[0].task.uid).toBe('new-from-obs');
      expect(obsCreates).toHaveLength(1);
      expect(obsCreates[0].task.uid).toBe('new-from-cal');

      // Updates (non-conflict)
      const calUpdates = result.toCalDAV.filter(c => c.type === 'update');
      const obsUpdates = result.toObsidian.filter(c => c.type === 'update');
      expect(calUpdates).toHaveLength(1);
      expect(calUpdates[0].task.uid).toBe('obs-updated');
      // CalDAV-wins conflict resolved + cal-updated
      expect(obsUpdates).toHaveLength(2);
      const obsUpdateUids = obsUpdates.map(u => u.task.uid).sort();
      expect(obsUpdateUids).toEqual(['cal-updated', 'conflict']);

      // Deletes
      const calDeletes = result.toCalDAV.filter(c => c.type === 'delete');
      const obsDeletes = result.toObsidian.filter(c => c.type === 'delete');
      expect(calDeletes).toHaveLength(1);
      expect(calDeletes[0].task.uid).toBe('del-from-obs');
      expect(obsDeletes).toHaveLength(1);
      expect(obsDeletes[0].task.uid).toBe('del-from-cal');

      // Conflicts
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].uid).toBe('conflict');
    });

    it('should handle multiple tasks of the same type', () => {
      const newObs1 = makeCommonTask({ uid: 'new-1', title: 'New 1' });
      const newObs2 = makeCommonTask({ uid: 'new-2', title: 'New 2' });
      const newCal1 = makeCommonTask({ uid: 'new-3', title: 'New 3' });

      const result = diff([newObs1, newObs2], [newCal1], [], 'caldav-wins');

      expect(result.toCalDAV.filter(c => c.type === 'create')).toHaveLength(2);
      expect(result.toObsidian.filter(c => c.type === 'create')).toHaveLength(1);
    });
  });

  describe('reconciliation', () => {
    it('should reconcile orphans with identical content instead of creating duplicates', () => {
      const obsTask = makeCommonTask({ uid: 'obs-1', title: 'Buy milk', status: 'TODO' });
      const calTask = makeCommonTask({ uid: 'cal-1', title: 'Buy milk', status: 'TODO' });

      const result = diff([obsTask], [calTask], [], 'caldav-wins');

      const obsReconciles = result.toObsidian.filter(c => c.type === 'reconcile');
      const calReconciles = result.toCalDAV.filter(c => c.type === 'reconcile');
      expect(obsReconciles).toHaveLength(1);
      expect(obsReconciles[0].task.uid).toBe('obs-1');
      expect(obsReconciles[0].counterpartUid).toBe('cal-1');
      expect(calReconciles).toHaveLength(1);
      expect(calReconciles[0].task.uid).toBe('cal-1');
      expect(calReconciles[0].counterpartUid).toBe('obs-1');

      expect(result.toObsidian.filter(c => c.type === 'create')).toHaveLength(0);
      expect(result.toCalDAV.filter(c => c.type === 'create')).toHaveLength(0);
    });

    it('should not reconcile orphans with different content', () => {
      const obsTask = makeCommonTask({ uid: 'obs-1', title: 'Buy milk' });
      const calTask = makeCommonTask({ uid: 'cal-1', title: 'Buy eggs' });

      const result = diff([obsTask], [calTask], [], 'caldav-wins');

      expect(result.toObsidian.filter(c => c.type === 'reconcile')).toHaveLength(0);
      expect(result.toCalDAV.filter(c => c.type === 'reconcile')).toHaveLength(0);
    });

    it('should reconcile multiple matching pairs', () => {
      const obs1 = makeCommonTask({ uid: 'obs-1', title: 'Task A' });
      const obs2 = makeCommonTask({ uid: 'obs-2', title: 'Task B' });
      const cal1 = makeCommonTask({ uid: 'cal-1', title: 'Task A' });
      const cal2 = makeCommonTask({ uid: 'cal-2', title: 'Task B' });

      const result = diff([obs1, obs2], [cal1, cal2], [], 'caldav-wins');

      expect(result.toObsidian.filter(c => c.type === 'reconcile')).toHaveLength(2);
      expect(result.toCalDAV.filter(c => c.type === 'reconcile')).toHaveLength(2);
      expect(result.toObsidian.filter(c => c.type === 'create')).toHaveLength(0);
      expect(result.toCalDAV.filter(c => c.type === 'create')).toHaveLength(0);
    });

    it('should not reconcile tasks that have a baseline (only orphans)', () => {
      const baseline = makeCommonTask({ uid: 'obs-1', title: 'Task A' });
      const obsTask = makeCommonTask({ uid: 'obs-1', title: 'Task A' });
      const calTask = makeCommonTask({ uid: 'cal-new', title: 'Task A' });

      const result = diff([obsTask], [calTask], [baseline], 'caldav-wins');

      expect(result.toObsidian.filter(c => c.type === 'create')).toHaveLength(1);
      expect(result.toObsidian.filter(c => c.type === 'reconcile')).toHaveLength(0);
    });

    it('should handle mix of reconcilable and non-reconcilable orphans', () => {
      const obs1 = makeCommonTask({ uid: 'obs-1', title: 'Matching task' });
      const obs2 = makeCommonTask({ uid: 'obs-2', title: 'Only in Obsidian' });
      const cal1 = makeCommonTask({ uid: 'cal-1', title: 'Matching task' });
      const cal2 = makeCommonTask({ uid: 'cal-2', title: 'Only in CalDAV' });

      const result = diff([obs1, obs2], [cal1, cal2], [], 'caldav-wins');

      expect(result.toObsidian.filter(c => c.type === 'reconcile')).toHaveLength(1);
      expect(result.toCalDAV.filter(c => c.type === 'reconcile')).toHaveLength(1);
      expect(result.toCalDAV.filter(c => c.type === 'create')).toHaveLength(1);
      expect(result.toObsidian.filter(c => c.type === 'create')).toHaveLength(1);
    });

    it('should pick first match when multiple CalDAV tasks match one Obsidian task', () => {
      const obs1 = makeCommonTask({ uid: 'obs-1', title: 'Duplicate' });
      const cal1 = makeCommonTask({ uid: 'cal-1', title: 'Duplicate' });
      const cal2 = makeCommonTask({ uid: 'cal-2', title: 'Duplicate' });

      const result = diff([obs1], [cal1, cal2], [], 'caldav-wins');

      expect(result.toObsidian.filter(c => c.type === 'reconcile')).toHaveLength(1);
      expect(result.toCalDAV.filter(c => c.type === 'reconcile')).toHaveLength(1);
    });
  });

  describe('completion detection', () => {
    it('should emit complete when CalDAV marks recurring task as DONE', () => {
      const baseline = makeCommonTask({ uid: 't1', status: 'TODO', recurrenceRule: 'FREQ=WEEKLY', dueDate: '2025-01-13' });
      const obsidian = makeCommonTask({ uid: 't1', status: 'TODO', recurrenceRule: 'FREQ=WEEKLY', dueDate: '2025-01-13' });
      const caldav = makeCommonTask({ uid: 't1', status: 'DONE', recurrenceRule: 'FREQ=WEEKLY', dueDate: '2025-01-13', completedDate: '2025-01-13' });

      const result = diff([obsidian], [caldav], [baseline], 'caldav-wins');

      expect(result.toObsidian).toHaveLength(1);
      expect(result.toObsidian[0].type).toBe('complete');
      expect(result.toObsidian[0].task.status).toBe('DONE');
    });

    it('should emit complete when CalDAV bumps recurring task due date', () => {
      const baseline = makeCommonTask({ uid: 't1', status: 'TODO', recurrenceRule: 'FREQ=WEEKLY', dueDate: '2025-01-13' });
      const obsidian = makeCommonTask({ uid: 't1', status: 'TODO', recurrenceRule: 'FREQ=WEEKLY', dueDate: '2025-01-13' });
      const caldav = makeCommonTask({ uid: 't1', status: 'TODO', recurrenceRule: 'FREQ=WEEKLY', dueDate: '2025-01-20' });

      const result = diff([obsidian], [caldav], [baseline], 'caldav-wins');

      expect(result.toObsidian).toHaveLength(1);
      expect(result.toObsidian[0].type).toBe('complete');
      expect(result.toObsidian[0].task.dueDate).toBe('2025-01-20');
    });

    it('should emit complete when CalDAV marks non-recurring task as DONE', () => {
      const baseline = makeCommonTask({ uid: 't1', status: 'TODO', recurrenceRule: '' });
      const obsidian = makeCommonTask({ uid: 't1', status: 'TODO', recurrenceRule: '' });
      const caldav = makeCommonTask({ uid: 't1', status: 'DONE', recurrenceRule: '', completedDate: '2025-01-15' });

      const result = diff([obsidian], [caldav], [baseline], 'caldav-wins');

      expect(result.toObsidian).toHaveLength(1);
      expect(result.toObsidian[0].type).toBe('complete');
      expect(result.toObsidian[0].task.status).toBe('DONE');
    });

    it('should emit complete when Obsidian marks recurring task as DONE', () => {
      const baseline = makeCommonTask({ uid: 't1', status: 'TODO', recurrenceRule: 'FREQ=WEEKLY', dueDate: '2025-01-13' });
      const obsidian = makeCommonTask({ uid: 't1', status: 'DONE', recurrenceRule: 'FREQ=WEEKLY', dueDate: '2025-01-13', completedDate: '2025-01-13' });
      const caldav = makeCommonTask({ uid: 't1', status: 'TODO', recurrenceRule: 'FREQ=WEEKLY', dueDate: '2025-01-13' });

      const result = diff([obsidian], [caldav], [baseline], 'caldav-wins');

      expect(result.toCalDAV).toHaveLength(1);
      expect(result.toCalDAV[0].type).toBe('complete');
      expect(result.toCalDAV[0].task.status).toBe('DONE');
    });

    it('should emit update for non-status non-date changes', () => {
      const baseline = makeCommonTask({ uid: 't1', title: 'Original', recurrenceRule: 'FREQ=WEEKLY', dueDate: '2025-01-13' });
      const obsidian = makeCommonTask({ uid: 't1', title: 'Original', recurrenceRule: 'FREQ=WEEKLY', dueDate: '2025-01-13' });
      const caldav = makeCommonTask({ uid: 't1', title: 'Renamed', recurrenceRule: 'FREQ=WEEKLY', dueDate: '2025-01-13' });

      const result = diff([obsidian], [caldav], [baseline], 'caldav-wins');

      expect(result.toObsidian).toHaveLength(1);
      expect(result.toObsidian[0].type).toBe('update');
    });
  });
});
