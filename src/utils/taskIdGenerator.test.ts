import {
  generateTaskId,
  extractTaskId,
  isValidTaskId
} from './taskIdGenerator';

describe('taskIdGenerator', () => {
  describe('generateTaskId', () => {
    it('should generate ID in YYYYMMDD-xxx format', () => {
      const id = generateTaskId();
      expect(id).toMatch(/^\d{8}-[0-9a-f]{3}$/);
    });

    it('should generate IDs with current date', () => {
      const id = generateTaskId();
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const expectedPrefix = `${year}${month}${day}`;

      expect(id.startsWith(expectedPrefix)).toBe(true);
    });

    it('should generate unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateTaskId());
      }
      // Should have high uniqueness (allow for small chance of collision)
      expect(ids.size).toBeGreaterThan(95);
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
    it('should validate correct format', () => {
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
