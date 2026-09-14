/**
 * Copies the compiled library next to the demo page.
 *
 * The page imports `./lib/index.js` as plain ES modules, so what it runs is the
 * very output `npm install` ships. `npm run demo` chains the build and this
 * copy.
 */
import { cp, mkdir, rm } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const target = new URL('demo/lib/', root);

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(new URL('dist/', root), target, { recursive: true });

console.log('demo/lib updated — serve the demo folder over http, not file://');
