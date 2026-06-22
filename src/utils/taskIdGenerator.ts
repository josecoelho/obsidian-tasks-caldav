/**
 * Generates compact, ULID-style task IDs: a 3-character day code followed by
 * 7 characters of cryptographic randomness, all in Crockford-style base32.
 *
 * - 10 characters total, opaque — carries no meaning beyond uniqueness
 * - day code (days since 2024-01-01) keeps IDs lexicographically sortable by day
 * - 35 random bits per day make same-day collisions negligible, fixing the
 *   birthday-paradox duplicates of the old 12-bit YYYYMMDD-xxx scheme (#115)
 */

// Crockford-style base32: no i/l/o/u, so IDs are unambiguous and file/URL-safe.
const BASE32 = '0123456789abcdefghjkmnpqrstvwxyz';
const MS_PER_DAY = 86_400_000;
const EPOCH_DAY = Math.floor(Date.UTC(2024, 0, 1) / MS_PER_DAY);

function toBase32(value: number, width: number): string {
  let out = '';
  for (let i = 0; i < width; i++) {
    out = BASE32[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

/**
 * Generate a 10-character ULID-style task ID (e.g. "0s8k7p2qx9").
 * @returns A task ID: 3-char day code + 7-char crypto-random base32 string
 */
export function generateTaskId(): string {
  const dayCode = toBase32(Math.floor(Date.now() / MS_PER_DAY) - EPOCH_DAY, 3);

  const bytes = crypto.getRandomValues(new Uint8Array(7));
  let randomPart = '';
  for (const byte of bytes) randomPart += BASE32[byte & 31];

  return dayCode + randomPart;
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
 * Validate task ID format. Accepts the current 10-character base32 format and
 * the legacy YYYYMMDD-xxx format, since old IDs remain valid in existing vaults.
 * @param id The task ID to validate
 * @returns true if valid, false otherwise
 */
export function isValidTaskId(id: string): boolean {
  return /^[0-9a-hjkmnp-tv-z]{10}$/.test(id) || /^\d{8}-[0-9a-f]{3}$/.test(id);
}
