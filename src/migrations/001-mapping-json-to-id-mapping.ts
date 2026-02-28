import { normalizePath } from 'obsidian';
import { Migration } from './migrationRunner';
import { IdMapping } from '../types';

export const mappingJsonToIdMapping: Migration = {
  name: '001-mapping-json-to-id-mapping',
  async run(app) {
    const adapter = app.vault.adapter;
    const oldPath = normalizePath('.caldav-sync/mapping.json');

    if (!(await adapter.exists(oldPath))) return;

    const idMappingPath = normalizePath('.caldav-sync/id-mapping.json');
    if (await adapter.exists(idMappingPath)) {
      await adapter.remove(oldPath);
      return;
    }

    const content = await adapter.read(oldPath);
    const oldMapping = JSON.parse(content) as {
      tasks: Record<string, { caldavUID: string }>;
    };

    if (!oldMapping.tasks || Object.keys(oldMapping.tasks).length === 0) {
      await adapter.remove(oldPath);
      return;
    }

    const migrated: IdMapping = {
      taskIdToCaldavUid: {},
      caldavUidToTaskId: {},
    };

    for (const [taskId, taskMapping] of Object.entries(oldMapping.tasks)) {
      migrated.taskIdToCaldavUid[taskId] = taskMapping.caldavUID;
      migrated.caldavUidToTaskId[taskMapping.caldavUID] = taskId;
    }

    await adapter.write(idMappingPath, JSON.stringify(migrated, null, 2));
    await adapter.remove(oldPath);
  },
};
