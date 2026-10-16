/**
 * Testes de validação física — cada caso executa um cenário demonstrativo e
 * verifica métricas numéricas (não apenas "sucesso").
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_CASES, runValidation } from '../src/sim/validation/suite';

describe('Validação física do simulador', () => {
  for (const c of VALIDATION_CASES) {
    it(`${c.id} — ${c.title}`, () => {
      const r = runValidation(c);
      const table = r.metrics.map((m) => `  ${m.pass ? '✓' : '✗'} ${m.name} = ${Number.isFinite(m.value) ? m.value.toPrecision(6) : m.value} ${m.unit} [${m.criterion}]`).join('\n');
      console.log(`${r.id} ${r.title}\n${table}`);
      for (const m of r.metrics) expect(m.pass, `${m.name} = ${m.value} ${m.unit} (critério: ${m.criterion})`).toBe(true);
    });
  }
});
