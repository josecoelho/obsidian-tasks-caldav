/**
 * Generates unique, human-readable task IDs using timestamp-based format
 * Format: YYYYMMDD-xxx where xxx is a random 3-character hex string
 *
 * This provides:
 * - Human readability: dates are visible at a glance
 * - Sortability: lexicographic order matches chronological order
 * - Collision resistance: ~65k combinations per day
 */

/**
 * Generate a timestamp-based task ID
 * @returns A task ID in format YYYYMMDD-xxx (e.g., 20250105-a4f)
 */
export function generateTaskId(): string {
  const now = new Date();

  // Format date as YYYYMMDD
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const datePart = `${year}${month}${day}`;

  // Generate 3-character random hex string
  const randomPart = Math.floor(Math.random() * 4096).toString(16).padStart(3, '0');

  return `${datePart}-${randomPart}`;
}

/**
 * Extract task ID from task text
 * Looks for ID in format [id::YYYYMMDD-xxx]
 * @param taskText The full task text
 * @returns The task ID if found, null otherwise
 */
export function extractTaskId(taskText: string): string | null {
  const match = taskText.match(/\[id::([^\]]+)\]/);
  return match ? match[1] : null;
}

/**
 * Inject task ID into task text if not already present
 * @param taskText The original task text
 * @returns Task text with ID injected (or original if ID already present)
 */
export function ensureTaskId(taskText: string): { text: string; id: string; modified: boolean } {
  const existingId = extractTaskId(taskText);

  if (existingId) {
    return { text: taskText, id: existingId, modified: false };
  }

  const newId = generateTaskId();
  const textWithId = `${taskText} [id::${newId}]`;

  return { text: textWithId, id: newId, modified: true };
}

/**
 * Validate task ID format
 * @param id The task ID to validate
 * @returns true if valid, false otherwise
 */
export function isValidTaskId(id: string): boolean {
  return /^\d{8}-[0-9a-f]{3}$/.test(id);
}
