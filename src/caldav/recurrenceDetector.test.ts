import { CommonTask } from '../sync/types';
import { detectRecurrenceCompletion } from './recurrenceDetector';

function makeTask(overrides: Partial<CommonTask> = {}): CommonTask {
  return {
    uid: 'task-001',
    title: 'Weekly review',
    status: 'TODO',
    dueDate: '2026-02-17',
    startDate: null,
    scheduledDate: null,
    completedDate: null,
    priority: 'none',
    tags: [],
    recurrenceRule: 'FREQ=WEEKLY',
    body: '',
    ...overrides,
  };
}

describe('detectRecurrenceCompletion', () => {
  it('detects completion when recurring task status changes to DONE', () => {
    const baseline = makeTask({ status: 'TODO' });
    const current = makeTask({ status: 'DONE' });

    const result = detectRecurrenceCompletion(current, baseline);

    expect(result).toEqual({ isCompletion: true, reason: 'status-completed' });
  });

  it('does not detect completion for non-recurring task', () => {
    const baseline = makeTask({ status: 'TODO', recurrenceRule: '' });
    const current = makeTask({ status: 'DONE', recurrenceRule: '' });

    const result = detectRecurrenceCompletion(current, baseline);

    expect(result).toEqual({ isCompletion: false, reason: 'none' });
  });

  it('does not detect completion when status did not change', () => {
    const baseline = makeTask({ status: 'TODO' });
    const current = makeTask({ status: 'TODO' });

    const result = detectRecurrenceCompletion(current, baseline);

    expect(result).toEqual({ isCompletion: false, reason: 'none' });
  });

  it('does not detect completion when baseline was already DONE', () => {
    const baseline = makeTask({ status: 'DONE' });
    const current = makeTask({ status: 'DONE' });

    const result = detectRecurrenceCompletion(current, baseline);

    expect(result).toEqual({ isCompletion: false, reason: 'none' });
  });

  describe('date-bump detection', () => {
    it('detects completion when weekly task due date moves +7 days', () => {
      const baseline = makeTask({ dueDate: '2026-02-17' });
      const current = makeTask({ dueDate: '2026-02-24' });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result).toEqual({ isCompletion: true, reason: 'date-bumped' });
    });

    it('detects completion when monthly task due date moves +1 month', () => {
      const baseline = makeTask({ dueDate: '2026-02-17', recurrenceRule: 'FREQ=MONTHLY' });
      const current = makeTask({ dueDate: '2026-03-17', recurrenceRule: 'FREQ=MONTHLY' });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result).toEqual({ isCompletion: true, reason: 'date-bumped' });
    });

    it('detects completion when daily task due date moves +1 day', () => {
      const baseline = makeTask({ dueDate: '2026-02-17', recurrenceRule: 'FREQ=DAILY' });
      const current = makeTask({ dueDate: '2026-02-18', recurrenceRule: 'FREQ=DAILY' });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result).toEqual({ isCompletion: true, reason: 'date-bumped' });
    });

    it('does not detect when date moves to arbitrary value', () => {
      const baseline = makeTask({ dueDate: '2026-02-17' });
      const current = makeTask({ dueDate: '2026-02-20' });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result).toEqual({ isCompletion: false, reason: 'none' });
    });

    it('does not detect when date moves backward', () => {
      const baseline = makeTask({ dueDate: '2026-02-17' });
      const current = makeTask({ dueDate: '2026-02-10' });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result).toEqual({ isCompletion: false, reason: 'none' });
    });

    it('does not detect on non-recurring task', () => {
      const baseline = makeTask({ dueDate: '2026-02-17', recurrenceRule: '' });
      const current = makeTask({ dueDate: '2026-02-24', recurrenceRule: '' });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result).toEqual({ isCompletion: false, reason: 'none' });
    });

    it('does not detect when due dates are identical', () => {
      const baseline = makeTask({ dueDate: '2026-02-17' });
      const current = makeTask({ dueDate: '2026-02-17' });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result).toEqual({ isCompletion: false, reason: 'none' });
    });

    it('does not detect when baseline has no due date', () => {
      const baseline = makeTask({ dueDate: null });
      const current = makeTask({ dueDate: '2026-02-24' });

      const result = detectRecurrenceCompletion(current, baseline);

      expect(result).toEqual({ isCompletion: false, reason: 'none' });
    });
  });
});
