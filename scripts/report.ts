/**
 * Gera docs/VALIDACAO.md executando a suíte de validação física.
 * Uso: npm run report
 */
import { writeFileSync } from 'node:fs';
import { VALIDATION_CASES, runValidation } from '../src/sim/validation/suite';

const lines: string[] = [];
lines.push('# Relatório de validação física');
lines.push('');
lines.push(`Gerado automaticamente por \`npm run report\` em ${new Date().toISOString()}.`);
lines.push('');
lines.push('Cada caso executa um cenário demonstrativo independente e compara **métricas numéricas** com critérios objetivos. Os mesmos casos são executados por `npm test` (Vitest) e pela tela **Validação** do simulador.');
lines.push('');
const results = VALIDATION_CASES.map((c) => ({ c, r: runValidation(c) }));
const ok = results.filter((x) => x.r.passed).length;
lines.push(`**Resultado: ${ok} / ${results.length} casos aprovados.**`);
lines.push('');
for (const { c, r } of results) {
  lines.push(`## ${r.passed ? '✅' : '❌'} ${c.title}`);
  lines.push('');
  lines.push(c.description);
  lines.push('');
  lines.push('| Métrica | Valor | Unidade | Critério | OK |');
  lines.push('|---|---:|---|---|:-:|');
  for (const m of r.metrics) {
    const v = Number.isFinite(m.value) ? (Math.abs(m.value) >= 1e5 || (Math.abs(m.value) < 1e-3 && m.value !== 0) ? m.value.toExponential(3) : m.value.toFixed(4)) : '—';
    lines.push(`| ${m.name} | ${v} | ${m.unit} | ${m.criterion} | ${m.pass ? '✓' : '✗'} |`);
  }
  lines.push('');
  lines.push(`> ${r.notes} (tempo de execução: ${r.durationMs.toFixed(0)} ms)`);
  lines.push('');
}
writeFileSync('docs/VALIDACAO.md', lines.join('\n'));
console.log(`docs/VALIDACAO.md: ${ok}/${results.length} aprovados`);
if (ok !== results.length) process.exit(1);
