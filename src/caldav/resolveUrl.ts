/**
 * Resolve a CalDAV href — absolute, absolute-path, or relative — into an
 * absolute URL against the given base URL.
 */
export function resolveUrl(href: string, base: string): string {
  return new URL(href, base).href;
}
