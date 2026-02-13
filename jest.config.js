module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
    '!src/caldav/requestDumper.ts',
    '!src/types/obsidianTasksApi.ts',
    '!src/ui/**'
  ],
  coverageThreshold: {
    './src/sync/': {
      lines: 80,
      branches: 80,
    },
    './src/caldav/': {
      lines: 80,
      branches: 70,
    },
    './src/tasks/': {
      lines: 80,
      branches: 80,
    },
  },
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  moduleNameMapper: {
    '^obsidian$': '<rootDir>/__mocks__/obsidian.ts'
  }
};
