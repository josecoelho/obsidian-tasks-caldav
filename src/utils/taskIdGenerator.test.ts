import {
  generateTaskId,
  extractTaskId,
  isValidTaskId
} from './taskIdGenerator';

function todayDatePart(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

describe('taskIdGenerator', () => {
  describe('generateTaskId', () => {
    afterEach(() => jest.restoreAllMocks());

    it('generates YYYYMMDD-xxxx with a 4-char hex suffix', () => {
      expect(generateTaskId()).toMatch(/^\d{8}-[0-9a-f]{4}$/);
    });

    it('uses the local calendar date, matching the legacy format', () => {
      expect(generateTaskId().slice(0, 8)).toBe(todayDatePart());
    });

    it('re-rolls when the candidate id is already in use', () => {
      const draws = [new Uint8Array([0x12, 0x34]), new Uint8Array([0xab, 0xcd])];
      jest.spyOn(crypto, 'getRandomValues').mockImplementation(<T,>(arr: T): T => {
        (arr as Uint8Array).set(draws.shift()!);
        return arr;
      });

      const used = new Set([`${todayDatePart()}-1234`]);

      expect(generateTaskId(used)).toBe(`${todayDatePart()}-abcd`);
    });

    it('records the returned id in the used set', () => {
      const used = new Set<string>();
      const id = generateTaskId(used);
      expect(used.has(id)).toBe(true);
    });

    it('generates unique ids for many tasks created the same day (issue #115)', () => {
      const used = new Set<string>();
      const ids = new Set<string>();
      for (let i = 0; i < 500; i++) ids.add(generateTaskId(used));

      expect(ids.size).toBe(500);
    });

    it('grows the suffix instead of looping forever when the day space is exhausted', () => {
      const used = new Set<string>();
      for (let i = 0; i < 65536; i++) {
        used.add(`${todayDatePart()}-${i.toString(16).padStart(4, '0')}`);
      }

      expect(generateTaskId(used)).toMatch(/^\d{8}-[0-9a-f]{5,}$/);
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
    it('validates the current 4-char hex suffix format', () => {
      expect(isValidTaskId('20260703-a4f3')).toBe(true);
      expect(isValidTaskId(generateTaskId())).toBe(true);
    });

    it('validates the legacy 3-char hex suffix format', () => {
      expect(isValidTaskId('20250105-abc')).toBe(true);
      expect(isValidTaskId('20250105-000')).toBe(true);
      expect(isValidTaskId('19991231-123')).toBe(true);
    });

    it('validates longer suffixes from day-space overflow', () => {
      expect(isValidTaskId('20260703-a4f3c')).toBe(true);
    });

    it('should reject invalid date format', () => {
      expect(isValidTaskId('2025010-abc')).toBe(false);  // 7 digits
      expect(isValidTaskId('202501051-abc')).toBe(false);  // 9 digits
      expect(isValidTaskId('abcd1234-abc')).toBe(false);  // non-numeric date
    });

    it('should reject invalid hex suffix', () => {
      expect(isValidTaskId('20250105-ab')).toBe(false);   // 2 chars
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
