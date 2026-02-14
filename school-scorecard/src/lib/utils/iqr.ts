/**
 * Compute IQR (interquartile range) = Q3 - Q1.
 * Uses same quartile definition as typical box plot.
 */
export function iqr(values: number[]): number {
  if (values.length < 2) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const q1Idx = Math.floor(n * 0.25);
  const q3Idx = Math.floor(n * 0.75);
  const q1 = sorted[q1Idx] ?? 0;
  const q3 = sorted[q3Idx] ?? 0;
  return q3 - q1;
}

export function quartiles(values: number[]): { q1: number; q3: number; iqr: number } {
  if (values.length === 0) return { q1: 0, q3: 0, iqr: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const q1Idx = Math.floor(n * 0.25);
  const q3Idx = Math.floor(n * 0.75);
  const q1 = sorted[q1Idx] ?? 0;
  const q3 = sorted[q3Idx] ?? 0;
  return { q1, q3, iqr: q3 - q1 };
}
