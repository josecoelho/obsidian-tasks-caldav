import { browser, expect } from '@wdio/globals';

describe('wdio harness bootstrap', function () {
  it('loads Obsidian with both plugins enabled', async function () {
    const ids = await browser.executeObsidian(({ app }) =>
      Object.keys((app as any).plugins.plugins),
    );
    expect(ids).toContain('tasks-caldav-sync');
    expect(ids).toContain('obsidian-tasks-plugin');
  });
});
