import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const { validateLevel } = await import('../src/game/level.ts');
const dir = 'levels';
let fail = 0;
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  const L = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  try { validateLevel(L); console.log(`✓ ${f}`); }
  catch (e) { fail++; console.error(`✗ ${f}: ${e.message}`); }
}
process.exit(fail ? 1 : 0);
