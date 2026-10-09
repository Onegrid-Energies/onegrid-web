// Seeds content/*.json from the text currently in src/index.html.
//
// Existing values are never overwritten, so this is safe to run after adding
// new data-cms annotations: only the new fields are filled in.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extract } from './template.mjs';
import { readContent } from './content.mjs';

const template = await readFile('src/index.html', 'utf8');
const extracted = extract(template);
const existing = await readContent();

function fillMissing(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (!(key in target)) target[key] = value;
    else if (value && typeof value === 'object' && !Array.isArray(value)) fillMissing(target[key], value);
  }
  return target;
}

await mkdir('content', { recursive: true });
for (const [name, values] of Object.entries(extracted)) {
  const merged = fillMissing(existing[name] ?? {}, values);
  await writeFile(`content/${name}.json`, `${JSON.stringify(merged, null, 2)}\n`);
}
console.log(`Updated ${Object.keys(extracted).map(name => `content/${name}.json`).join(', ')}`);
