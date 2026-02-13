import { CommonTask, Changeset, SyncChange, Conflict, ConflictStrategy } from './types';

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
    a.notes === b.notes &&
    a.tags.length === b.tags.length &&
    a.tags.every((tag, i) => tag === b.tags[i])
  );
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

  for (const uid of allUids) {
    const obs = obsidianByUid.get(uid);
    const cal = caldavByUid.get(uid);
    const base = baselineByUid.get(uid);

    const inObs = obs !== undefined;
    const inCal = cal !== undefined;
    const inBase = base !== undefined;

    if (inObs && inCal && inBase) {
      // Task exists in all three — check for changes
      const obsChanged = !tasksEqual(obs!, base!);
      const calChanged = !tasksEqual(cal!, base!);

      if (obsChanged && calChanged) {
        // Conflict: both sides modified
        if (strategy === 'obsidian-wins') {
          toCalDAV.push({ type: 'update', task: obs!, previousVersion: base! });
        } else {
          toObsidian.push({ type: 'update', task: cal!, previousVersion: base! });
        }
        conflicts.push({
          uid,
          obsidianVersion: obs!,
          caldavVersion: cal!,
          baselineVersion: base!,
        });
      } else if (obsChanged) {
        toCalDAV.push({ type: 'update', task: obs!, previousVersion: base! });
      } else if (calChanged) {
        toObsidian.push({ type: 'update', task: cal!, previousVersion: base! });
      }
      // Neither changed — no-op

    } else if (inObs && !inCal && !inBase) {
      // New task from Obsidian
      toCalDAV.push({ type: 'create', task: obs! });

    } else if (!inObs && inCal && !inBase) {
      // New task from CalDAV
      toObsidian.push({ type: 'create', task: cal! });

    } else if (inObs && !inCal && inBase) {
      // Deleted on CalDAV side
      toObsidian.push({ type: 'delete', task: obs! });

    } else if (!inObs && inCal && inBase) {
      // Deleted on Obsidian side
      toCalDAV.push({ type: 'delete', task: cal! });

    } else if (inObs && inCal && !inBase) {
      // Both sides have it but no baseline — treat as new from both sides
      // This can happen on first sync. Use strategy to pick winner.
      if (strategy === 'obsidian-wins') {
        toCalDAV.push({ type: 'update', task: obs! });
      } else {
        toObsidian.push({ type: 'update', task: cal! });
      }

    } else if (!inObs && !inCal && inBase) {
      // Deleted on both sides — no-op, just clean baseline
    }
  }

  return { toObsidian, toCalDAV, conflicts };
}
