/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/__tests__'],
    testMatch: ['**/*.test.ts'],
    moduleFileExtensions: ['ts', 'js', 'json'],

    // Coverage settings - targeting 100%
    collectCoverage: true,
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'json-summary'],
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/index.ts',        // Entry point
        '!src/pairing.ts',      // CLI tool
        '!src/listGroups.ts',   // CLI tool
        '!src/**/*.d.ts',
    ],
    coverageThreshold: {
        global: {
            branches: 80,
            functions: 80,
            lines: 80,
            statements: 80,
        },
    },

    // Long timeout for real API calls
    testTimeout: 120000, // 2 minutes per test

    // Setup files
    setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],

    // Reporter - use default only (custom JSON logging in testLogger.ts)
    reporters: ['default'],

    // Globals for ts-jest
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: 'tsconfig.json',
        }],
    },

    // Module name mapper for path aliases if needed
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
};
