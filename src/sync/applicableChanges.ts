import { SyncDirection } from '../types';
import { Changeset, SyncChange } from './types';

const CONTENT_TYPES: ReadonlySet<SyncChange['type']> = new Set([
  'create',
  'update',
  'complete',
  'delete',
]);

/**
 * Keep only identity-only changes (reconcile). Drops every content change
 * (create/update/complete/delete) so the side it belongs to is never written.
 */
function reconcileOnly(changes: SyncChange[]): SyncChange[] {
  return changes.filter((c) => !CONTENT_TYPES.has(c.type));
}

/**
 * Filter a changeset to the changes that should actually be applied for the
 * given sync direction. `reconcile` entries are kept on both sides regardless
 * of direction — they carry no content and only link IDs (de-duplication).
 *
 * Conflicts are not filtered here: direction forces the conflict strategy in
 * SyncEngine so a resolved conflict always lands on the applicable side. Do
 * not add conflict filtering here — it would duplicate that strategy logic.
 */
export function applicableChanges(changeset: Changeset, direction: SyncDirection): Changeset {
  if (direction === 'pull') {
    return { ...changeset, toCalDAV: reconcileOnly(changeset.toCalDAV) };
  }
  if (direction === 'push') {
    return { ...changeset, toObsidian: reconcileOnly(changeset.toObsidian) };
  }
  return changeset;
}
