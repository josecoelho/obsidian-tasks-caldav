import { Migration } from './migrationRunner';

/**
 * Splits the single `tag` field on each CalendarMapping into two fields:
 * `obsidianTag` (filters push) and `caldavCategory` (filters pull). Either
 * empty means "no filter that direction." Pre-1.3 installs only had the
 * single tag, so seeding both new fields with it preserves prior behavior.
 */
export const tagToObsidianTagAndCaldavCategory: Migration = {
  name: '003-tag-to-obsidian-tag-and-caldav-category',
  run(_app, settings) {
    for (const cal of settings.calendars) {
      const legacy = cal as unknown as { tag?: string };
      if (legacy.tag === undefined) continue;

      cal.obsidianTag = legacy.tag;
      cal.caldavCategory = legacy.tag;
      delete legacy.tag;
    }
    return Promise.resolve();
  },
};
