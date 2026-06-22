import {
  generateTaskId,
  extractTaskId,
  isValidTaskId
} from './taskIdGenerator';

describe('taskIdGenerator', () => {
  describe('generateTaskId', () => {
    afterEach(() => jest.restoreAllMocks());

    it('generates a 10-character base32 id', () => {
      expect(generateTaskId()).toMatch(/^[0-9a-hjkmnp-tv-z]{10}$/);
    });

    it('shares a 3-character day prefix for ids generated the same day', () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 5, 22, 9));

      const first = generateTaskId();
      const second = generateTaskId();

      expect(first.slice(0, 3)).toBe(second.slice(0, 3));
    });

    it('uses a lexicographically greater day prefix on a later day', () => {
      const now = jest.spyOn(Date, 'now');

      now.mockReturnValue(Date.UTC(2026, 0, 1));
      const earlier = generateTaskId().slice(0, 3);
      now.mockReturnValue(Date.UTC(2027, 0, 1));
      const later = generateTaskId().slice(0, 3);

      expect(later > earlier).toBe(true);
    });

    it('generates unique ids for many tasks created the same day (issue #115)', () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 5, 22, 9));

      const ids = new Set<string>();
      for (let i = 0; i < 500; i++) ids.add(generateTaskId());

      expect(ids.size).toBe(500);
    });
  });

  describe('extractTaskId', () => {
    it('should extract ID from emoji format', () => {
      expect(extractTaskId('- [ ] Do something 🆔 20250105-a4f')).toBe('20250105-a4f');
    });

    it('should extract ID from dataview format', () => {
      expect(extractTaskId('- [ ] Do something [id::20250105-a4f]')).toBe('20250105-a4f');
    });

    it('should return null when no ID present', () => {
      expect(extractTaskId('- [ ] Do something')).toBeNull();
    });

    it('should prefer emoji format over dataview', () => {
      expect(extractTaskId('- [ ] Task 🆔 emoji-id [id::dv-id]')).toBe('emoji-id');
    });
  });

  describe('isValidTaskId', () => {
    it('validates the new 10-character base32 format', () => {
      expect(isValidTaskId('0s8k7p2qx9')).toBe(true);
      expect(isValidTaskId(generateTaskId())).toBe(true);
    });

    it('rejects a new-format id of the wrong length', () => {
      expect(isValidTaskId('0s8k7p2qx')).toBe(false);   // 9 chars
      expect(isValidTaskId('0s8k7p2qx9a')).toBe(false); // 11 chars
    });

    it('rejects a new-format id with ambiguous or uppercase chars', () => {
      expect(isValidTaskId('0s8k7p2qxi')).toBe(false); // 'i' not in base32 alphabet
      expect(isValidTaskId('0S8K7P2QX9')).toBe(false); // uppercase
    });

    it('validates the legacy YYYYMMDD-xxx format', () => {
      expect(isValidTaskId('20250105-abc')).toBe(true);
      expect(isValidTaskId('20250105-000')).toBe(true);
      expect(isValidTaskId('20250105-fff')).toBe(true);
      expect(isValidTaskId('19991231-123')).toBe(true);
    });

    it('should reject invalid date format', () => {
      expect(isValidTaskId('2025010-abc')).toBe(false);  // 7 digits
      expect(isValidTaskId('202501051-abc')).toBe(false);  // 9 digits
      expect(isValidTaskId('abcd1234-abc')).toBe(false);  // non-numeric date
    });

    it('should reject invalid hex suffix', () => {
      expect(isValidTaskId('20250105-ab')).toBe(false);   // 2 chars
      expect(isValidTaskId('20250105-abcd')).toBe(false); // 4 chars
      expect(isValidTaskId('20250105-xyz')).toBe(false);  // non-hex chars
      expect(isValidTaskId('20250105-ABC')).toBe(false);  // uppercase
    });

    it('should reject missing separator', () => {
      expect(isValidTaskId('20250105abc')).toBe(false);
    });

    it('should reject wrong separator', () => {
      expect(isValidTaskId('20250105_abc')).toBe(false);
      expect(isValidTaskId('20250105.abc')).toBe(false);
    });

    it('should reject empty or malformed strings', () => {
      expect(isValidTaskId('')).toBe(false);
      expect(isValidTaskId('not-a-valid-id')).toBe(false);
      expect(isValidTaskId('20250105-')).toBe(false);
      expect(isValidTaskId('-abc')).toBe(false);
    });
  });
});
