import { generatePublicId, PUBLIC_ID_PATTERN } from './public-id.util';

describe('generatePublicId', () => {
  it('should generate an id with exactly 11 characters', () => {
    expect(generatePublicId()).toHaveLength(11);
  });

  it('should only use URL-safe characters', () => {
    for (let i = 0; i < 1000; i++) {
      expect(generatePublicId()).toMatch(PUBLIC_ID_PATTERN);
    }
  });

  it('should not repeat ids across 10000 generations', () => {
    const ids = new Set(Array.from({ length: 10000 }, generatePublicId));

    expect(ids.size).toBe(10000);
  });
});
