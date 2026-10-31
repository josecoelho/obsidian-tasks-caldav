/**
 * Inline #tag handling shared by both mappers (issue #114). A CommonTask
 * title must never carry a #tag — tags live in `tags[]` and are re-emitted
 * on serialization, so a tag left in the title gains a copy every sync.
 *
 * Matches tags in any script (#house, #프로그램/자바, #café), including
 * nested tags (#work/java), but not numeric references like #42.
 */
const TAG_NAME = '[\\p{L}][\\p{L}\\p{N}_/-]*';
const INLINE_TAG = new RegExp(`#${TAG_NAME}`, 'gu');
const LEADING_TAG_NAME = new RegExp(`^${TAG_NAME}`, 'u');

/** Remove inline tags and collapse the whitespace they leave behind. */
export function stripInlineTags(text: string): string {
  return text.replace(INLINE_TAG, '').replace(/\s+/g, ' ').trim();
}

/** Inline tags found in the text, without the # prefix. */
export function extractInlineTags(text: string): string[] {
  return Array.from(text.matchAll(INLINE_TAG), (m) => m[0].slice(1));
}

/**
 * Bare name of a tag reported by obsidian-tasks, cut to what INLINE_TAG
 * matches — or null when it isn't a tag by that rule. obsidian-tasks reads
 * any `#` run up to whitespace or a few punctuation marks as a tag (`#42`,
 * `#123;`), which the title keeps; re-emitting those from tags[] would
 * append another copy on every sync.
 */
export function inlineTagName(tag: string): string | null {
  return tag.replace(/^#/, '').match(LEADING_TAG_NAME)?.[0] ?? null;
}
