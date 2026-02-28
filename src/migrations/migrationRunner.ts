import { App } from 'obsidian';
import { CalDAVSettings } from '../types';
import { mappingJsonToIdMapping } from './001-mapping-json-to-id-mapping';
import { flatStorageToPerCalendar } from './002-flat-storage-to-per-calendar';

export interface Migration {
  name: string;
  run(app: App, settings: CalDAVSettings): Promise<void>;
}

const migrations: Migration[] = [
  mappingJsonToIdMapping,
  flatStorageToPerCalendar,
];

export async function runMigrations(app: App, settings: CalDAVSettings): Promise<void> {
  for (const migration of migrations) {
    await migration.run(app, settings);
  }
}
