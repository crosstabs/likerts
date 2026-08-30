#!/usr/bin/env node

import { buildBrowserAttestationBundle, verifyBrowserAttestationBundle } from '../server/browser-attestation-bundle.js';

function usage() {
  process.stderr.write([
    'Usage:',
    '  node scripts/build-browser-attestation-bundle.mjs --attestation <file> --artifact-directory <dir> --output <dir>',
    '  node scripts/build-browser-attestation-bundle.mjs --verify <bundle-dir>',
    '',
  ].join('\n'));
}

function option(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? '' : args[index + 1] || '';
}

const args = process.argv.slice(2);
try {
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    process.exit(0);
  }
  const verifyDirectory = option(args, '--verify');
  const result = verifyDirectory
    ? await verifyBrowserAttestationBundle(verifyDirectory)
    : await buildBrowserAttestationBundle({
      attestationPath: option(args, '--attestation'),
      artifactDirectory: option(args, '--artifact-directory'),
      outputDirectory: option(args, '--output'),
    });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  if (!args.length) usage();
  process.stderr.write(`${error?.code || 'BUNDLE_FAILED'}: ${error?.message || error}\n`);
  process.exitCode = 1;
}
