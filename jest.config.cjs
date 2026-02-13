const shared = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: { '^.+\\.ts$': 'ts-jest' },
  moduleNameMapper: { '^obsidian$': '<rootDir>/__mocks__/obsidian.ts' },
};

module.exports = {
  projects: [
    {
      ...shared,
      displayName: 'unit',
      roots: ['<rootDir>/src'],
      testMatch: ['**/?(*.)+(spec|test).ts'],
    },
    {
      ...shared,
      displayName: 'e2e',
      roots: ['<rootDir>/test/e2e'],
      testMatch: ['**/*.e2e.test.ts'],
      testTimeout: 30000,
    },
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
    '!src/caldav/requestDumper.ts',
    '!src/types/obsidianTasksApi.ts',
    '!src/ui/**',
  ],
  coverageThreshold: {
    './src/sync/': { lines: 80, branches: 80 },
    './src/caldav/': { lines: 80, branches: 70 },
    './src/tasks/': { lines: 80, branches: 80 },
  },
};
