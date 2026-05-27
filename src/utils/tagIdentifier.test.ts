import {
  normalizeTagIdentifier,
  stripTagIdentifier,
  injectTagIdentifier,
} from './tagIdentifier';

describe('normalizeTagIdentifier', () => {
  it('returns empty string for nullish or whitespace input', () => {
    expect(normalizeTagIdentifier(undefined)).toBe('');
    expect(normalizeTagIdentifier('')).toBe('');
    expect(normalizeTagIdentifier('   ')).toBe('');
  });

  it('lowercases and strips leading `#`', () => {
    expect(normalizeTagIdentifier('#Sync')).toBe('sync');
    expect(normalizeTagIdentifier('  Work  ')).toBe('work');
    expect(normalizeTagIdentifier('professional')).toBe('professional');
  });
});

describe('stripTagIdentifier', () => {
  it('is a no-op when the identifier is empty', () => {
    expect(stripTagIdentifier(['sync', 'urgent'], '')).toEqual(['sync', 'urgent']);
    expect(stripTagIdentifier(['sync', 'urgent'], '   ')).toEqual(['sync', 'urgent']);
  });

  it('drops the identifier regardless of case or `#` prefix', () => {
    expect(stripTagIdentifier(['sync', 'urgent'], 'sync')).toEqual(['urgent']);
    expect(stripTagIdentifier(['Sync', 'urgent'], '#sync')).toEqual(['urgent']);
    expect(stripTagIdentifier(['#sync', 'urgent'], 'SYNC')).toEqual(['urgent']);
  });

  it('drops every occurrence', () => {
    expect(stripTagIdentifier(['sync', 'urgent', 'Sync'], 'sync')).toEqual(['urgent']);
  });

  it('leaves the array untouched when identifier is absent', () => {
    expect(stripTagIdentifier(['work', 'urgent'], 'sync')).toEqual(['work', 'urgent']);
  });
});

describe('injectTagIdentifier', () => {
  it('is a no-op when identifier is empty', () => {
    expect(injectTagIdentifier(['urgent'], '')).toEqual(['urgent']);
    expect(injectTagIdentifier(['urgent'], '  ')).toEqual(['urgent']);
  });

  it('appends the bare identifier when missing', () => {
    expect(injectTagIdentifier(['urgent'], 'sync')).toEqual(['urgent', 'sync']);
    expect(injectTagIdentifier([], '#work')).toEqual(['work']);
  });

  it('does not duplicate when a case-variant is already present', () => {
    expect(injectTagIdentifier(['Sync', 'urgent'], 'sync')).toEqual(['Sync', 'urgent']);
    expect(injectTagIdentifier(['#sync', 'urgent'], 'SYNC')).toEqual(['#sync', 'urgent']);
  });
});
