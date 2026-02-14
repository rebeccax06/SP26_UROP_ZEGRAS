import { median } from '@/lib/utils/median';

describe('median', () => {
  it('returns 0 for empty array', () => {
    expect(median([])).toBe(0);
  });

  it('returns single element', () => {
    expect(median([5])).toBe(5);
  });

  it('returns middle for odd length', () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
  });

  it('returns average of two middles for even length', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('handles unsorted input', () => {
    expect(median([5, 1, 3, 2, 4])).toBe(3);
  });
});
