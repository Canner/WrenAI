/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@server/(.*)$': '<rootDir>/src/server/$1',
  },
  testMatch: ['**/*.test.[tj]s?(x)'],
  setupFilesAfterEnv: ['<rootDir>/src/tests/jest.cleanup.ts'],
  modulePathIgnorePatterns: [
    '<rootDir>/e2e/',
    '<rootDir>/\\.next($|-.+)',
  ],
  testPathIgnorePatterns: [
    '<rootDir>/e2e/',
    '<rootDir>/\\.next($|-.+)',
  ],
};
