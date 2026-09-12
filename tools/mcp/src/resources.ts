import { existsSync, readFileSync } from 'node:fs';

// npm archives carry their contracts beside the compiled code. A source checkout
// and the existing container layout continue to read the canonical repository files.
export function readContractResource(name: 'capabilities.json' | 'openapi.json'): any {
  const bundled = new URL(`./data/${name}`, import.meta.url);
  const checkout = new URL(name === 'capabilities.json' ? '../../capabilities.json' : '../../../contracts/openapi.json', import.meta.url);
  return JSON.parse(readFileSync(existsSync(bundled) ? bundled : checkout, 'utf8'));
}
