/**
 * Minimal obsidian stub for E2E tests.
 * E2E tests use FetchHttpClient so should never touch Obsidian APIs.
 * If this gets called, something is wrong.
 */
export const requestUrl = () => {
  throw new Error('requestUrl should not be called in E2E tests — use FetchHttpClient');
};
