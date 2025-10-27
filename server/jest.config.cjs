/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@lib/(.*)$': '<rootDir>/src/lib/$1',
    '^@providers/(.*)$': '<rootDir>/src/providers/$1',
    '^@routes/(.*)$': '<rootDir>/src/routes/$1',
    '^@workers/(.*)$': '<rootDir>/src/workers/$1',
    '^@storage/(.*)$': '<rootDir>/src/storage/$1',
    '^@util/(.*)$': '<rootDir>/src/util/$1'
  },
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts']
};
