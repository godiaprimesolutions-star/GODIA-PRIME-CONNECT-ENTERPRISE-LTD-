import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const out = resolve(root, 'dist');
await mkdir(out, { recursive: true });
await copyFile(resolve(root, 'index.html'), resolve(out, 'index.html'));
await writeFile(resolve(out, '_headers'), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), geolocation=(self), microphone=()\n\n/index.html\n  Cache-Control: no-cache\n`);
console.log('Built GODIA PRIME CONNECT frontend into dist/.');
