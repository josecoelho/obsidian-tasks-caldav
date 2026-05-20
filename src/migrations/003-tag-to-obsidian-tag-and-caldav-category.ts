import { Migration } from './migrationRunner';

/**
 * Splits the single `tag` field on each CalendarMapping into two fields:
 * `obsidianTag` (filters push) and `caldavCategory` (filters pull). Either
 * empty means "no filter that direction."
 *
 * For users who set the intermediate `filterByServerCategory: false` flag
 * (unreleased), translate that into an empty `caldavCategory` so pull
 * stays unfiltered.
 */
export const tagToObsidianTagAndCaldavCategory: Migration = {
  name: '003-tag-to-obsidian-tag-and-caldav-category',
  run(_app, settings) {
    for (const cal of settings.calendars) {
      const legacy = cal as unknown as { tag?: string; filterByServerCategory?: boolean };
      if (legacy.tag === undefined || cal.obsidianTag !== undefined) continue;

      cal.obsidianTag = legacy.tag;
      cal.caldavCategory = legacy.filterByServerCategory === false ? '' : legacy.tag;
      delete legacy.tag;
      delete legacy.filterByServerCategory;
    }
    return Promise.resolve();
  },
};
