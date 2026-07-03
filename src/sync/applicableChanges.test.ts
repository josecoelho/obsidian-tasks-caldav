import { applicableChanges } from './applicableChanges';
import { Changeset, CommonTask, SyncChange } from './types';

function task(uid: string): CommonTask {
  return {
    uid,
    title: uid,
    status: 'TODO',
    dueDate: null,
    startDate: null,
    scheduledDate: null,
    completedDate: null,
    priority: 'none',
    tags: [],
    recurrenceRule: '',
    body: '',
  };
}

function change(type: SyncChange['type'], uid: string): SyncChange {
  return { type, task: task(uid) };
}

function makeChangeset(): Changeset {
  return {
    toObsidian: [change('create', 'o-create'), change('reconcile', 'o-recon')],
    toCalDAV: [change('update', 'c-update'), change('delete', 'c-delete'), change('reconcile', 'c-recon')],
    conflicts: [
      { uid: 'x', obsidianVersion: task('x'), caldavVersion: task('x'), baselineVersion: task('x') },
    ],
  };
}

describe('applicableChanges', () => {
  it('bidirectional: returns the changeset unchanged', () => {
    const cs = makeChangeset();
    const result = applicableChanges(cs, 'bidirectional');
    expect(result).toBe(cs);
    expect(result.toObsidian).toEqual(cs.toObsidian);
    expect(result.toCalDAV).toEqual(cs.toCalDAV);
    expect(result.conflicts).toEqual(cs.conflicts);
  });

  it('pull: drops toCalDAV content changes but keeps reconcile and toObsidian', () => {
    const result = applicableChanges(makeChangeset(), 'pull');
    expect(result.toObsidian.map(c => c.type)).toEqual(['create', 'reconcile']);
    expect(result.toCalDAV.map(c => c.type)).toEqual(['reconcile']);
    expect(result.conflicts).toHaveLength(1);
  });

  it('push: drops toObsidian content changes but keeps reconcile and toCalDAV', () => {
    const result = applicableChanges(makeChangeset(), 'push');
    expect(result.toObsidian.map(c => c.type)).toEqual(['reconcile']);
    expect(result.toCalDAV.map(c => c.type)).toEqual(['update', 'delete', 'reconcile']);
    expect(result.conflicts).toHaveLength(1);
  });

  it('does not mutate the input changeset', () => {
    const cs = makeChangeset();
    applicableChanges(cs, 'pull');
    expect(cs.toCalDAV.map(c => c.type)).toEqual(['update', 'delete', 'reconcile']);
  });
});
