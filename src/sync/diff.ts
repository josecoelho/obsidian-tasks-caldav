import { CommonTask, Changeset, SyncChange, Conflict, ConflictStrategy } from './types';
import { detectRecurrenceCompletion } from '../caldav/recurrenceDetector';

/**
 * Compare two CommonTasks for equality across all synced fields.
 */
export function tasksEqual(a: CommonTask, b: CommonTask): boolean {
  return (
    a.title === b.title &&
    a.status === b.status &&
    a.dueDate === b.dueDate &&
    a.startDate === b.startDate &&
    a.scheduledDate === b.scheduledDate &&
    a.completedDate === b.completedDate &&
    a.priority === b.priority &&
    a.recurrenceRule === b.recurrenceRule &&
    a.body === b.body &&
    a.tags.length === b.tags.length &&
    a.tags.every((tag, i) => tag === b.tags[i])
  );
}

function resolveChangeType(current: CommonTask, baseline: CommonTask): 'update' | 'complete' {
  if (baseline.status !== 'DONE' && current.status === 'DONE') {
    return 'complete';
  }
  const recurrence = detectRecurrenceCompletion(current, baseline);
  if (recurrence.isCompletion) {
    return 'complete';
  }
  return 'update';
}

/**
 * Pure three-way diff function.
 *
 * Compares the current state on both sides against a shared baseline
 * to determine what changed and where changes should be applied.
 *
 * @param obsidian  Current Obsidian tasks
 * @param caldav    Current CalDAV tasks
 * @param baseline  Snapshot from last successful sync
 * @param strategy  How to resolve conflicts when both sides changed
 */
export function diff(
  obsidian: CommonTask[],
  caldav: CommonTask[],
  baseline: CommonTask[],
  strategy: ConflictStrategy,
): Changeset {
  const obsidianByUid = new Map(obsidian.map(t => [t.uid, t]));
  const caldavByUid = new Map(caldav.map(t => [t.uid, t]));
  const baselineByUid = new Map(baseline.map(t => [t.uid, t]));

  const allUids = new Set([
    ...obsidianByUid.keys(),
    ...caldavByUid.keys(),
    ...baselineByUid.keys(),
  ]);

  const toObsidian: SyncChange[] = [];
  const toCalDAV: SyncChange[] = [];
  const conflicts: Conflict[] = [];

  const reconciledUids = reconcileOrphans(
    obsidianByUid, caldavByUid, baselineByUid, toObsidian, toCalDAV,
  );
  for (const uid of reconciledUids) {
    allUids.delete(uid);
  }

  for (const uid of allUids) {
    const obs = obsidianByUid.get(uid);
    const cal = caldavByUid.get(uid);
    const base = baselineByUid.get(uid);

    if (obs && cal && base) {
      // Task exists in all three — check for changes
      const obsChanged = !tasksEqual(obs, base);
      const calChanged = !tasksEqual(cal, base);

      if (obsChanged && calChanged) {
        if (tasksEqual(obs, cal)) {
          // Convergent edit: both sides arrived at the same value, nothing to do.
          // Baseline catches up on the next successful sync.
          continue;
        }
        // Conflict: both sides modified
        if (strategy === 'obsidian-wins') {
          toCalDAV.push({ type: resolveChangeType(obs, base), task: obs, previousVersion: base });
        } else {
          toObsidian.push({ type: resolveChangeType(cal, base), task: cal, previousVersion: base });
        }
        conflicts.push({
          uid,
          obsidianVersion: obs,
          caldavVersion: cal,
          baselineVersion: base,
        });
      } else if (obsChanged) {
        toCalDAV.push({ type: resolveChangeType(obs, base), task: obs, previousVersion: base });
      } else if (calChanged) {
        toObsidian.push({ type: resolveChangeType(cal, base), task: cal, previousVersion: base });
      }
      // Neither changed — no-op

    } else if (obs && !cal && !base) {
      // New task from Obsidian
      toCalDAV.push({ type: 'create', task: obs });

    } else if (!obs && cal && !base) {
      // New task from CalDAV
      toObsidian.push({ type: 'create', task: cal });

    } else if (obs && !cal && base) {
      // Deleted on CalDAV side
      toObsidian.push({ type: 'delete', task: obs });

    } else if (!obs && cal && base) {
      // Deleted on Obsidian side
      toCalDAV.push({ type: 'delete', task: cal });

    } else if (obs && cal && !base) {
      // Both sides have it but no baseline — treat as new from both sides
      // This can happen on first sync. Use strategy to pick winner.
      if (strategy === 'obsidian-wins') {
        toCalDAV.push({ type: 'update', task: obs });
      } else {
        toObsidian.push({ type: 'update', task: cal });
      }

    } else if (!obs && !cal && base) {
      // Deleted on both sides — no-op, just clean baseline
    }
  }

  return { toObsidian, toCalDAV, conflicts };
}

function reconcileOrphans(
  obsidianByUid: Map<string, CommonTask>,
  caldavByUid: Map<string, CommonTask>,
  baselineByUid: Map<string, CommonTask>,
  toObsidian: SyncChange[],
  toCalDAV: SyncChange[],
): Set<string> {
  const reconciledUids = new Set<string>();

  const obsOrphans: CommonTask[] = [];
  for (const [uid, task] of obsidianByUid) {
    if (!caldavByUid.has(uid) && !baselineByUid.has(uid)) {
      obsOrphans.push(task);
    }
  }

  const calOrphanPool = new Map<string, CommonTask>();
  for (const [uid, task] of caldavByUid) {
    if (!obsidianByUid.has(uid) && !baselineByUid.has(uid)) {
      calOrphanPool.set(uid, task);
    }
  }

  for (const obsTask of obsOrphans) {
    for (const [calUid, calTask] of calOrphanPool) {
      if (tasksEqual(obsTask, calTask)) {
        toObsidian.push({ type: 'reconcile', task: obsTask, counterpartUid: calUid });
        toCalDAV.push({ type: 'reconcile', task: calTask, counterpartUid: obsTask.uid });
        reconciledUids.add(obsTask.uid);
        reconciledUids.add(calUid);
        calOrphanPool.delete(calUid);
        break;
      }
    }
  }

  return reconciledUids;
}
