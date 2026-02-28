import { normalizePath } from 'obsidian';
import { Migration } from './migrationRunner';
import { calendarStorageId } from '../utils/calendarStorageId';

const SYNC_FILES = ['state.json', 'baseline.json', 'id-mapping.json'];

export const flatStorageToPerCalendar: Migration = {
  name: '002-flat-storage-to-per-calendar',
  async run(app, settings) {
    if (settings.calendars.length === 0) return;

    const adapter = app.vault.adapter;
    const rootDir = '.caldav-sync';
    const cal = settings.calendars[0];
    const storageId = calendarStorageId(cal.serverUrl, cal.calendarName);
    const targetDir = normalizePath(`${rootDir}/calendars/${storageId}`);

    const rootExists = await Promise.all(
      SYNC_FILES.map(f => adapter.exists(normalizePath(`${rootDir}/${f}`))),
    );
    if (!rootExists.some(Boolean)) return;

    await ensureDirectory(adapter, targetDir);

    for (let i = 0; i < SYNC_FILES.length; i++) {
      if (!rootExists[i]) continue;

      const src = normalizePath(`${rootDir}/${SYNC_FILES[i]}`);
      const dst = normalizePath(`${targetDir}/${SYNC_FILES[i]}`);

      if (!(await adapter.exists(dst))) {
        const content = await adapter.read(src);
        await adapter.write(dst, content);
      }

      await adapter.remove(src);
    }
  },
};

async function ensureDirectory(
  adapter: { exists(path: string): Promise<boolean>; mkdir(path: string): Promise<void> },
  dir: string,
): Promise<void> {
  const parts = dir.split('/');
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await adapter.exists(current))) {
      await adapter.mkdir(current);
    }
  }
}
