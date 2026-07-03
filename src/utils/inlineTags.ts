/**
 * Inline #tag handling shared by both mappers (issue #114). A CommonTask
 * title must never carry a #tag — tags live in `tags[]` and are re-emitted
 * on serialization, so a tag left in the title gains a copy every sync.
 *
 * Matches tags in any script (#house, #프로그램/자바, #café), including
 * nested tags (#work/java), but not numeric references like #42.
 */
const INLINE_TAG = /#[\p{L}][\p{L}\p{N}_/-]*/gu;

/** Remove inline tags and collapse the whitespace they leave behind. */
export function stripInlineTags(text: string): string {
  return text.replace(INLINE_TAG, '').replace(/\s+/g, ' ').trim();
}

/** Inline tags found in the text, without the # prefix. */
export function extractInlineTags(text: string): string[] {
  return Array.from(text.matchAll(INLINE_TAG), (m) => m[0].slice(1));
}
