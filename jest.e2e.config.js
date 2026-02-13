module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test/e2e'],
  testMatch: ['**/*.e2e.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
    '!src/caldav/requestDumper.ts',
    '!src/types/obsidianTasksApi.ts',
    '!src/ui/**'
  ],
  coverageDirectory: 'coverage-e2e',
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  testTimeout: 30000,
  maxWorkers: 1, // E2E tests share a single CalDAV calendar
  moduleNameMapper: {
    '^obsidian$': '<rootDir>/__mocks__/obsidian.ts'
  }
};
