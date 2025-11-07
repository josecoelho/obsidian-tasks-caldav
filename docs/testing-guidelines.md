# Testing Guidelines

## Core Principles

### 1. Test Behavior, Not Implementation

**DON'T test:**
- Private field assignments in constructors
- Simple getters that just return a field
- Function existence checks (`typeof foo === 'function'`)
- Implementation details (how it works)

**DO test:**
- Observable behavior (what it does)
- State changes
- Error conditions
- Edge cases that can break

**Example - BAD:**
```typescript
it('should store settings in private field', () => {
  const client = new CalDAVClient(settings);
  expect((client as any).settings).toEqual(settings); // ❌ Testing private field assignment
});

it('should have mapper instance', () => {
  const client = new CalDAVClient(settings);
  expect((client as any).mapper).toBeDefined(); // ❌ Testing constructor setup
});
```

**Example - GOOD:**
```typescript
it('should encode credentials correctly for Basic Auth', () => {
  const client = new CalDAVClient(settings);
  const authHeader = (client as any).authHeader;
  const decoded = atob(authHeader.replace('Basic ', ''));
  expect(decoded).toBe('testuser:testpass'); // ✅ Testing behavior that can break
});
```

### 2. Focus on What Can Actually Break

**Test things that:**
- Involve external dependencies (`btoa`, XML parsing, regex)
- Have complex logic (parsing, formatting, mapping)
- Handle edge cases (null, empty, malformed input)
- Change state (connection status, file updates)
- Have side effects (API calls, file writes)

**Don't test:**
- Simple assignments: `this.x = x`
- Trivial return statements: `return this.x`
- Constructor field initialization (tested implicitly)

### 3. Pure Functions = Thorough Testing

Pure functions (same input → same output, no side effects) should have comprehensive test coverage:

**Examples of pure functions in our codebase:**
- `parseCalendarsFromXML()` - XML parsing
- `parseVTODOsFromXML()` - VTODO extraction
- `taskToVTODO()` - Task to VTODO conversion
- `vtodoToTask()` - VTODO to Task conversion
- `generateTaskId()` - ID generation
- `isValidTaskId()` - ID validation

**Test coverage for pure functions:**
- Happy path with typical input
- Edge cases (empty, null, missing fields)
- Boundary conditions
- Format variations (CDATA, quotes, whitespace)
- Error conditions

**Example:**
```typescript
describe('parseCalendarsFromXML - pure function', () => {
  it('should extract calendar metadata and convert relative URLs', () => { ... });
  it('should handle CDATA in displayname', () => { ... });
  it('should use URL as fallback when displayname missing', () => { ... });
  it('should filter out non-calendar resources', () => { ... });
  it('should detect VTODO support correctly', () => { ... });
});
```

### 4. No Trivial Setter/Getter Tests

If a setter just assigns and a getter just returns, don't test them separately. They're tested implicitly when used in real scenarios.

**Example - BAD:**
```typescript
it('should set calendar URL', () => {
  client.setCalendarUrl('https://example.com/cal/');
  expect(client.getCalendarUrl()).toBe('https://example.com/cal/'); // ❌ Trivial
});
```

**Example - GOOD:**
```typescript
it('should report connected after calendar URL is set', () => {
  (client as any).calendarUrl = 'https://example.com/cal/';
  expect(client.isConnected()).toBe(true); // ✅ Tests business logic
});
```

## Test Organization

### Describe Blocks Should Indicate Function Type

```typescript
describe('parseCalendarsFromXML - pure function XML parsing', () => {
  // Tests for pure function
});

describe('Connection state', () => {
  // Tests for stateful behavior
});

describe('Authentication', () => {
  // Tests for behavior with external dependencies
});
```

### Test Names Should Describe Behavior

**BAD:**
```typescript
it('should work correctly', () => { ... }); // ❌ Vague
it('should parse XML', () => { ... }); // ❌ What about XML parsing?
```

**GOOD:**
```typescript
it('should extract calendar metadata and convert relative URLs to absolute', () => { ... }); // ✅ Clear
it('should strip quotes from etag values', () => { ... }); // ✅ Specific
it('should throw when fetching VTODOs without connection', () => { ... }); // ✅ Clear error case
```

## What to Test for Each Component Type

### Pure Functions (Parsers, Mappers, Validators)
- ✅ All input variations
- ✅ Edge cases (empty, null, malformed)
- ✅ Format variations
- ✅ Error conditions
- ❌ Implementation details

### Stateful Components (Clients, Managers)
- ✅ State transitions
- ✅ Connection/initialization behavior
- ✅ Error handling
- ✅ Side effects
- ❌ Private field assignments
- ❌ Constructor initialization

### Integration Points
- ✅ API contracts (inputs/outputs)
- ✅ Error propagation
- ✅ State synchronization
- ❌ Internal implementation

## Examples from Our Codebase

### CalDAVClientDirect Tests

**What We Test:**
- ✅ Auth encoding (can break with btoa)
- ✅ Connection state logic
- ✅ XML parsing edge cases
- ✅ Error conditions

**What We Don't Test:**
- ❌ Settings field assignment
- ❌ Mapper instance creation
- ❌ Function existence

### VTODOMapper Tests

**What We Test:**
- ✅ Status mappings (TODO ↔ NEEDS-ACTION)
- ✅ Priority mappings (highest ↔ 1)
- ✅ Date formatting (YYYY-MM-DD ↔ YYYYMMDD)
- ✅ Special character escaping
- ✅ CDATA handling
- ✅ Missing fields (defaults)

**What We Don't Test:**
- ❌ Simple field assignments

### SyncEngine Tests

**What We Test:**
- ✅ Tag filtering logic
- ✅ Priority mapping
- ✅ Markdown generation
- ✅ Tag case-insensitivity

**What We Don't Test:**
- ❌ Constructor parameter storage

## Red Flags in Test Code

If you see these patterns, the test might be wrong:

```typescript
// ❌ Accessing private fields just to check assignment
expect((obj as any).privateField).toBe(value);

// ❌ Testing function existence
expect(typeof obj.method).toBe('function');

// ❌ Testing trivial getters
expect(obj.getSomething()).toBe(obj.something);

// ❌ Duplicating implementation in test
const result = input.match(/regex/); // Test does same thing as code
expect(result).toBeTruthy();

// ✅ Calling actual production code
const result = MyClass.parseXML(input);
expect(result).toEqual(expected);

// ✅ Testing behavior
expect(client.isConnected()).toBe(false);

// ✅ Testing state changes
obj.connect();
expect(obj.isConnected()).toBe(true);
```

## When Adding New Tests

Ask yourself:

1. **Can this actually break?** If it's just `this.x = x`, skip it.
2. **Am I testing behavior or implementation?** Test what it does, not how.
3. **Is this a pure function?** If yes, test thoroughly with edge cases.
4. **Does this change state?** Test the state transition, not the field assignment.
5. **Am I duplicating code?** Call the actual method, don't reimplement it.

## Summary

**Test:**
- Behavior and outcomes
- Pure functions thoroughly
- State changes
- Error conditions
- Edge cases

**Don't Test:**
- Private field assignments
- Trivial getters/setters
- Function existence
- Implementation details
- Things that will break other tests if broken

**Remember:** Good tests verify the contract (what the code promises to do), not the implementation (how it does it).
