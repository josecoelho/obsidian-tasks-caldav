import { App } from 'obsidian';
import { CalDAVSettings } from '../types';
import { mappingJsonToIdMapping } from './001-mapping-json-to-id-mapping';
import { flatStorageToPerCalendar } from './002-flat-storage-to-per-calendar';
import { tagToObsidianTagAndCaldavCategory } from './003-tag-to-obsidian-tag-and-caldav-category';

export interface Migration {
  name: string;
  run(app: App, settings: CalDAVSettings): Promise<void>;
}

const registeredMigrations: Migration[] = [
  mappingJsonToIdMapping,
  flatStorageToPerCalendar,
  tagToObsidianTagAndCaldavCategory,
];

let activeMigrations: Migration[] = registeredMigrations;

/**
 * Runs every registered migration whose name is not already recorded in
 * `settings.appliedMigrations`. On success the migration's name is appended to
 * the set. A failing migration aborts the chain and is NOT recorded, so it
 * retries on the next plugin load. Returns `true` iff at least one migration
 * was applied during this call, allowing the caller to skip a redundant
 * settings write when nothing changed.
 */
export async function runMigrations(app: App, settings: CalDAVSettings): Promise<boolean> {
  const applied = new Set(settings.appliedMigrations ?? []);
  let ran = false;

  try {
    for (const migration of activeMigrations) {
      if (applied.has(migration.name)) continue;
      await migration.run(app, settings);
      applied.add(migration.name);
      ran = true;
    }
  } finally {
    if (ran) {
      settings.appliedMigrations = Array.from(applied);
    }
  }

  return ran;
}

/** Test-only: replace the registered migration list. */
export function __setMigrationsForTesting(migrations: Migration[]): void {
  activeMigrations = migrations;
}

/** Test-only: restore the production migration list. */
export function __resetMigrationsForTesting(): void {
  activeMigrations = registeredMigrations;
}
