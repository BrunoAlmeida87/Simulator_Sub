import { VALIDATION_CASES, runValidation } from '../src/sim/validation/suite';
const only = process.argv[2];
for (const c of VALIDATION_CASES) {
  if (only && !c.id.includes(only)) continue;
  const r = runValidation(c);
  console.log(`${r.passed ? 'OK ' : 'FALHA'} ${r.id} ${r.title} (${r.durationMs.toFixed(0)} ms)`);
  for (const m of r.metrics) console.log(`   ${m.pass ? '✓' : '✗'} ${m.name}: ${Number.isFinite(m.value) ? m.value.toPrecision(5) : m.value} ${m.unit}  [${m.criterion}]`);
}
