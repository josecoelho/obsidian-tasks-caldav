module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test/e2e'],
  testMatch: ['**/*.e2e.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  testTimeout: 30000,
  moduleNameMapper: {
    '^obsidian$': '<rootDir>/test/e2e/__mocks__/obsidian.ts'
  }
};
