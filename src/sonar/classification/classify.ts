import { LIBRARY } from '../sources/signatures';
export function classify(measured: number[]): { category: string; confidence: number } {
  if (measured.length < 2) return { category: 'Indeterminado', confidence: 0 };
  const scores = Object.values(LIBRARY)
    .map((s) => {
      let best = 0;
      for (let scale = 0.7; scale < 1.5; scale += 0.02) {
        const matches = s.tones.filter((f) => measured.some((p) => Math.abs(p - f * scale) < 3)).length;
        best = Math.max(best, matches / Math.max(s.tones.length, measured.length));
      }
      return { category: s.category, score: best };
    })
    .sort((a, b) => b.score - a.score);
  const confidence = Math.min(0.85, scores[0].score * Math.max(0, scores[0].score - scores[1].score + 0.2));
  return { category: confidence < 0.15 ? 'Indeterminado' : scores[0].category, confidence };
}
