/**
 * Generates human-readable task IDs: YYYYMMDD-xxxx, a local calendar date and
 * a 4-character random hex suffix.
 *
 * Uniqueness comes from the caller-supplied `usedIds` set, not from entropy
 * alone: candidates already in the set are re-rolled, so same-vault collisions
 * are impossible by construction (issue #115). The 65,536/day space only has
 * to cover the cross-device window between generating an ID and syncing it.
 */

/**
 * Generate a task ID like "20260703-a4f3", guaranteed absent from `usedIds`.
 * The returned ID is added to the set so sequential calls never collide.
 * If a day's suffix space is ever exhausted, the suffix grows a character.
 */
export function generateTaskId(usedIds?: Set<string>): string {
  const datePart = localDatePart();
  let width = 4;
  let attempts = 0;
  for (;;) {
    const id = `${datePart}-${randomHex(width)}`;
    if (!usedIds?.has(id)) {
      usedIds?.add(id);
      return id;
    }
    if (++attempts >= 16) {
      width++;
      attempts = 0;
    }
  }
}

function localDatePart(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}${month}${day}`;
}

function randomHex(width: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(width / 2)));
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out.slice(0, width);
}

/**
 * Extract task ID from raw markdown text.
 * Supports emoji format (🆔 xxx) and Dataview format ([id::xxx]).
 * Used for scanning file lines outside the obsidian-tasks cache.
 * @param taskText The full task text
 * @returns The task ID if found, null otherwise
 */
export function extractTaskId(taskText: string): string | null {
  // Emoji format: 🆔 xxx
  const emojiMatch = taskText.match(/🆔\s*(\S+)/);
  if (emojiMatch) return emojiMatch[1];

  // Dataview format: [id::xxx] (backwards compat)
  const dvMatch = taskText.match(/\[id::([^\]]+)\]/);
  if (dvMatch) return dvMatch[1];

  return null;
}

/**
 * Validate task ID format: a date followed by a hex suffix — 3 chars in
 * legacy IDs, 4 in current ones, longer only on day-space overflow.
 */
export function isValidTaskId(id: string): boolean {
  return /^\d{8}-[0-9a-f]{3,}$/.test(id);
}
