/**
 * Shared helpers for the sync identifier tags on each side of the bridge:
 * `obsidianTag` (markdown side) and `caldavCategory` (VTODO side). Each
 * adapter strips its identifier on read and injects it on write so the diff
 * layer never sees the identifier in CommonTask.tags.
 */

/** Bare, lowercased form used for matching. Treats leading `#` and whitespace as noise. */
export function normalizeTagIdentifier(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/^#/, '');
}

/** Removes any tag matching the identifier (case-insensitive, `#`-prefix-agnostic). */
export function stripTagIdentifier(tags: string[], identifier: string): string[] {
  const id = normalizeTagIdentifier(identifier);
  if (!id) return tags;
  return tags.filter((t) => normalizeTagIdentifier(t) !== id);
}

/**
 * Returns `tags` unchanged if it already contains the identifier (any case,
 * with or without `#`). Otherwise appends the identifier in bare form
 * (whitespace trimmed, leading `#` removed).
 */
export function injectTagIdentifier(tags: string[], identifier: string): string[] {
  const id = normalizeTagIdentifier(identifier);
  if (!id) return tags;
  if (tags.some((t) => normalizeTagIdentifier(t) === id)) return tags;
  return [...tags, identifier.trim().replace(/^#/, '')];
}
