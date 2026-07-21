// Obsidian runs in Electron, where `DOMParser` is a browser global. Jest runs
// in Node's default environment, which has no `DOMParser`, so shipped code that
// relies on the global would fail under test. Inject a spec-compliant XML
// `DOMParser` (from @xmldom/xmldom, a devDependency) as the global for tests.
// Production ships zero XML dependency and uses Electron's native `DOMParser`.
import { DOMParser } from '@xmldom/xmldom';

(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = DOMParser;
