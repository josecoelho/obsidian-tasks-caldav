import {
  generateTaskId,
  extractTaskId,
  ensureTaskId,
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
    it('should extract ID from task text with [id::...] format', () => {
      const taskText = '- [ ] Do something [id::20250105-a4f]';
      const id = extractTaskId(taskText);
      expect(id).toBe('20250105-a4f');
    });

    it('should return null when no ID present', () => {
      const taskText = '- [ ] Do something';
      const id = extractTaskId(taskText);
      expect(id).toBeNull();
    });

    it('should extract ID from middle of text', () => {
      const taskText = '- [ ] Task [id::20250105-abc] with more text';
      const id = extractTaskId(taskText);
      expect(id).toBe('20250105-abc');
    });

    it('should extract first ID when multiple present', () => {
      const taskText = '- [ ] Task [id::20250105-abc] [id::20250105-def]';
      const id = extractTaskId(taskText);
      expect(id).toBe('20250105-abc');
    });

    it('should handle IDs with various hex characters', () => {
      const taskText = '- [ ] Task [id::20250105-f9e]';
      const id = extractTaskId(taskText);
      expect(id).toBe('20250105-f9e');
    });
  });

  describe('ensureTaskId', () => {
    it('should return existing ID when present', () => {
      const taskText = '- [ ] Task [id::20250105-abc]';
      const result = ensureTaskId(taskText);

      expect(result.id).toBe('20250105-abc');
      expect(result.text).toBe(taskText);
      expect(result.modified).toBe(false);
    });

    it('should inject new ID when not present', () => {
      const taskText = '- [ ] Task without ID';
      const result = ensureTaskId(taskText);

      expect(result.id).toMatch(/^\d{8}-[0-9a-f]{3}$/);
      expect(result.text).toBe(`${taskText} [id::${result.id}]`);
      expect(result.modified).toBe(true);
    });

    it('should append ID at end of text', () => {
      const taskText = '- [ ] Some task';
      const result = ensureTaskId(taskText);

      expect(result.text).toMatch(/^- \[ \] Some task \[id::\d{8}-[0-9a-f]{3}\]$/);
    });

    it('should not modify text that already has ID', () => {
      const taskText = '- [ ] Task [id::20250105-abc] with extra text';
      const result = ensureTaskId(taskText);

      expect(result.text).toBe(taskText);
      expect(result.modified).toBe(false);
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
