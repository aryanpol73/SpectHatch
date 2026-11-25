import { readFile } from 'node:fs/promises';
const receipt = JSON.parse(await readFile(process.argv[2], 'utf8'));
const clean = (value) => String(value).replace(/[\r\n|<>]/g, ' ');
console.log('## SpecHatch build receipt\n');
console.log(
  clean(receipt.project) +
    ' · ' +
    receipt.tests.length +
    ' workflows · ' +
    receipt.requestCount +
    ' replay API requests · ' +
    receipt.misses +
    ' unexpected requests\n',
);
console.log('| Workflow | Live | Static |\n|---|---:|---:|');
for (const t of receipt.tests)
  console.log('| ' + clean(t.title) + ' | ' + t.liveMs + ' ms | ' + t.replayMs + ' ms |');
console.log('\nBuild ID: ' + clean(receipt.buildId));
