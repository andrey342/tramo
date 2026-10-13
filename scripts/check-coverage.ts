// The global coverage gate: merges what the unit, integration and e2e runs covered (each writes a
// coverage-final.json) and fails below the thresholds. Unit runs alone cannot meet it, since
// persistence and HTTP are only exercised by the other two.
//   pnpm coverage:check [dir ...]   (default: coverage/unit coverage/int coverage/e2e)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createCoverageMap } from 'istanbul-lib-coverage';

const THRESHOLDS = { statements: 80, lines: 80, functions: 80, branches: 70 } as const;

const dirs = process.argv.slice(2);
const sources = dirs.length > 0 ? dirs : ['coverage/unit', 'coverage/int', 'coverage/e2e'];

const map = createCoverageMap({});
for (const dir of sources) {
  const file = join(dir, 'coverage-final.json');
  if (!existsSync(file)) {
    process.stderr.write(`coverage: ${file} is missing; run that suite with coverage first\n`);
    process.exit(1);
  }
  map.merge(JSON.parse(readFileSync(file, 'utf8')) as Parameters<typeof map.merge>[0]);
}

const summary = map.getCoverageSummary();
let failed = false;
for (const [metric, minimum] of Object.entries(THRESHOLDS)) {
  const { pct, covered, total } = summary[metric as keyof typeof THRESHOLDS];
  const ok = pct >= minimum;
  failed ||= !ok;
  process.stdout.write(
    `${ok ? 'ok  ' : 'FAIL'} ${metric.padEnd(10)} ${pct.toFixed(2).padStart(6)} % ` +
      `(${String(covered)}/${String(total)}, minimum ${String(minimum)} %)\n`,
  );
}
process.stdout.write(`${String(map.files().length)} files from ${sources.join(', ')}\n`);
process.exitCode = failed ? 1 : 0;
