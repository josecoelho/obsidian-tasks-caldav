import { RRule } from 'rrule';
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

  if (isDateBumpCompletion(current, baseline)) {
    return { isCompletion: true, reason: 'date-bumped' };
  }

  return NO_COMPLETION;
}

function formatDateUTC(date: Date): string {
  return date.toISOString().split('T')[0];
}

function isDateBumpCompletion(current: CommonTask, baseline: CommonTask): boolean {
  if (current.status !== 'TODO') return false;
  if (!baseline.dueDate || !current.dueDate) return false;
  if (baseline.dueDate === current.dueDate) return false;

  const baseDate = new Date(baseline.dueDate + 'T00:00:00Z');
  const currentDate = new Date(current.dueDate + 'T00:00:00Z');
  if (currentDate <= baseDate) return false;

  try {
    const rule = RRule.fromString(`RRULE:${current.recurrenceRule}`);
    const ruleWithStart = new RRule({ ...rule.origOptions, dtstart: baseDate });
    const nextDates = ruleWithStart.between(baseDate, new Date(currentDate.getTime() + 86400000), true);
    const nextAfterBase = nextDates.find(d => d.getTime() > baseDate.getTime());
    if (!nextAfterBase) return false;
    return formatDateUTC(nextAfterBase) === current.dueDate;
  } catch {
    return false;
  }
}
