import { guardDeletes } from './deleteGuard';
import { Changeset, SyncChange, CommonTask } from './types';

function change(type: SyncChange['type'], uid: string): SyncChange {
  return { type, task: { uid, title: uid } as unknown as CommonTask };
}

function changeset(toObsidian: SyncChange[], toCalDAV: SyncChange[]): Changeset {
  return { toObsidian, toCalDAV, conflicts: [] };
}

describe('guardDeletes', () => {
  it('passes changes through untouched when nothing is suspicious', () => {
    const cs = changeset(
      [change('delete', 'a'), change('create', 'b')],
      [change('delete', 'c'), change('update', 'd')],
    );

    const result = guardDeletes(cs, { obsidianCount: 20, caldavCount: 20, baselineCount: 20 });

    expect(result.changes).toEqual(cs);
    expect(result.warnings).toEqual([]);
  });

  it('suppresses toObsidian deletes when the CalDAV report is empty and baseline is populated', () => {
    // A transient empty server REPORT must not wipe the vault's task lines.
    const cs = changeset(
      [change('delete', 'a'), change('delete', 'b'), change('create', 'c')],
      [],
    );

    const result = guardDeletes(cs, { obsidianCount: 20, caldavCount: 0, baselineCount: 20 });

    expect(result.changes.toObsidian.map((c) => c.type)).toEqual(['create']);
    expect(result.warnings).toHaveLength(1);
  });

  it('allows toObsidian deletes when the CalDAV report is empty but baseline is tiny', () => {
    // A user genuinely emptying a 2-task list is not an anomaly.
    const cs = changeset([change('delete', 'a'), change('delete', 'b')], []);

    const result = guardDeletes(cs, { obsidianCount: 2, caldavCount: 0, baselineCount: 2 });

    expect(result.changes.toObsidian).toHaveLength(2);
    expect(result.warnings).toEqual([]);
  });

  it('suppresses toCalDAV deletes when the Obsidian view is empty and baseline is populated', () => {
    // The 2026-07-24 incident direction: a blind vault adapter must not
    // push a DELETE for every baseline task to the server.
    const cs = changeset([], Array.from({ length: 25 }, (_, i) => change('delete', `t${i}`)));

    const result = guardDeletes(cs, { obsidianCount: 0, caldavCount: 25, baselineCount: 25 });

    expect(result.changes.toCalDAV).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it('suppresses deletes exceeding the per-cycle cap of max(10, half the baseline)', () => {
    const deletes = Array.from({ length: 12 }, (_, i) => change('delete', `t${i}`));
    const cs = changeset(deletes, []);

    // baseline 20 → cap max(10, 10) = 10; 12 deletes exceeds it
    const result = guardDeletes(cs, { obsidianCount: 8, caldavCount: 8, baselineCount: 20 });

    expect(result.changes.toObsidian).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it('allows delete batches under the cap', () => {
    const deletes = Array.from({ length: 9 }, (_, i) => change('delete', `t${i}`));
    const cs = changeset(deletes, []);

    const result = guardDeletes(cs, { obsidianCount: 30, caldavCount: 21, baselineCount: 30 });

    expect(result.changes.toObsidian).toHaveLength(9);
    expect(result.warnings).toEqual([]);
  });
});
