import { Changeset, SyncChange } from './types';

export interface DeleteGuardCounts {
  obsidianCount: number;
  caldavCount: number;
  baselineCount: number;
}

export interface DeleteGuardResult {
  changes: Changeset;
  warnings: string[];
}

/**
 * Baselines at or below this size are exempt from the empty-side guard: a
 * user genuinely clearing a tiny list is indistinguishable from an anomaly,
 * and the blast radius is small either way.
 */
const MIN_BASELINE_FOR_GUARD = 3;

/** Per-cycle delete cap floor; the effective cap is max(floor, baseline/2). */
const DELETE_CAP_FLOOR = 10;

const isDelete = (c: SyncChange): boolean => c.type === 'delete';

/**
 * Suppress delete batches that look like one side went blind rather than the
 * user deleting tasks. Suppressed deletes are removed from the changeset
 * BEFORE apply and BEFORE the baseline update, so the affected tasks stay in
 * baseline and the same deletes are re-derived (and re-judged) next sync —
 * fail closed, no data loss, retried loudly.
 *
 * Two triggers, applied independently per side:
 * - the source side reported zero tasks while the baseline is populated
 *   (a transient empty CalDAV REPORT, or a blind vault adapter — the
 *   2026-07-24 mass-deletion incident direction), or
 * - the delete batch exceeds max(10, half the baseline) in one cycle.
 */
export function guardDeletes(changeset: Changeset, counts: DeleteGuardCounts): DeleteGuardResult {
  const warnings: string[] = [];
  const cap = Math.max(DELETE_CAP_FLOOR, Math.ceil(counts.baselineCount / 2));

  const guardSide = (
    changes: SyncChange[],
    sourceEmpty: boolean,
    sourceName: string,
    sideName: string,
  ): SyncChange[] => {
    const deletes = changes.filter(isDelete).length;
    if (deletes === 0) return changes;

    if (sourceEmpty && counts.baselineCount > MIN_BASELINE_FOR_GUARD) {
      warnings.push(
        `${sourceName} reported 0 tasks while baseline holds ${counts.baselineCount} — suppressed ${deletes} ${sideName} delete(s)`,
      );
      return changes.filter((c) => !isDelete(c));
    }

    if (deletes > cap) {
      warnings.push(
        `delete batch of ${deletes} exceeds per-cycle cap ${cap} — suppressed ${sideName} delete(s)`,
      );
      return changes.filter((c) => !isDelete(c));
    }

    return changes;
  };

  return {
    changes: {
      ...changeset,
      toObsidian: guardSide(changeset.toObsidian, counts.caldavCount === 0, 'CalDAV', 'toObsidian'),
      toCalDAV: guardSide(changeset.toCalDAV, counts.obsidianCount === 0, 'Obsidian', 'toCalDAV'),
    },
    warnings,
  };
}
