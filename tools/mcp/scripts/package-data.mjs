import { cp, mkdir } from 'node:fs/promises';

const output = new URL('../dist/data/', import.meta.url);
await mkdir(output, { recursive: true });
await cp(new URL('../../capabilities.json', import.meta.url), new URL('capabilities.json', output));
await cp(new URL('../../../contracts/openapi.json', import.meta.url), new URL('openapi.json', output));
