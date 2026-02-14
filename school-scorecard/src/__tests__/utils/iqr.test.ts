import { iqr, quartiles } from '@/lib/utils/iqr';

describe('iqr', () => {
  it('returns 0 for less than 2 elements', () => {
    expect(iqr([])).toBe(0);
    expect(iqr([1])).toBe(0);
  });

  it('returns Q3 - Q1', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = quartiles(values);
    expect(result.iqr).toBe(iqr(values));
    expect(result.q3 - result.q1).toBe(result.iqr);
  });
});
