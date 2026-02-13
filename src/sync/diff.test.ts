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
    notes: '',
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

  it('should detect notes change', () => {
    const a = makeCommonTask({ notes: 'Note A' });
    const b = makeCommonTask({ notes: 'Note B' });
    expect(tasksEqual(a, b)).toBe(false);
  });

  it('should treat empty notes as equal', () => {
    const a = makeCommonTask({ notes: '' });
    const b = makeCommonTask({ notes: '' });
    expect(tasksEqual(a, b)).toBe(true);
  });

  it('should detect notes added where there were none', () => {
    const a = makeCommonTask({ notes: '' });
    const b = makeCommonTask({ notes: 'New note' });
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

    it('should detect status change as update', () => {
      const baseline = makeCommonTask({ uid: 't1', status: 'TODO' });
      const obsidian = makeCommonTask({ uid: 't1', status: 'DONE', completedDate: '2025-01-15' });
      const caldav = makeCommonTask({ uid: 't1', status: 'TODO' });

      const result = diff([obsidian], [caldav], [baseline], 'caldav-wins');

      expect(result.toCalDAV).toHaveLength(1);
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
});
