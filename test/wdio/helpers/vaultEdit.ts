import { browser } from '@wdio/globals';

/** Append a line to a vault file (newline-separated). */
export async function appendTaskLine(filePath: string, line: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, args) => {
    const f = app.vault.getAbstractFileByPath(args.filePath);
    const body = await app.vault.read(f as any);
    await app.vault.modify(f as any, body + `\n${args.line}`);
  }, { filePath, line });
}

/** Replace the first occurrence of `from` with `to` in a vault file. */
export async function replaceInFile(filePath: string, from: string, to: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, args) => {
    const f = app.vault.getAbstractFileByPath(args.filePath);
    const body = await app.vault.read(f as any);
    await app.vault.modify(f as any, body.replace(args.from, args.to));
  }, { filePath, from, to });
}

/** Remove every line containing `text` from a vault file. */
export async function removeLineContaining(filePath: string, text: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, args) => {
    const f = app.vault.getAbstractFileByPath(args.filePath);
    const body = await app.vault.read(f as any);
    const kept = body.split('\n').filter((l: string) => !l.includes(args.text)).join('\n');
    await app.vault.modify(f as any, kept);
  }, { filePath, text });
}
