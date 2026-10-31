import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url));
const frontendDirectory = resolve(scriptDirectory, '..');
const packageJson = JSON.parse(readFileSync(resolve(frontendDirectory, 'package.json'), 'utf8'));
const version = typeof packageJson.version === 'string' ? packageJson.version.trim() : '';

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('Set a valid semantic version in frontend/package.json before building.');
}

writeFileSync(resolve(frontendDirectory, 'public/app-version.json'), `${JSON.stringify({ version })}\n`);
