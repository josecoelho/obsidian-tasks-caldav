import { CommonTask } from '../sync/types';

export interface RecurrenceCompletion {
  isCompletion: boolean;
  reason: 'status-completed' | 'date-bumped' | 'none';
}

const NO_COMPLETION: RecurrenceCompletion = { isCompletion: false, reason: 'none' };

export function detectRecurrenceCompletion(
  current: CommonTask,
  baseline: CommonTask,
): RecurrenceCompletion {
  if (!current.recurrenceRule) {
    return NO_COMPLETION;
  }

  if (baseline.status !== 'DONE' && current.status === 'DONE') {
    return { isCompletion: true, reason: 'status-completed' };
  }

  return NO_COMPLETION;
}
