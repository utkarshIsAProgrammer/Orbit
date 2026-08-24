/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: [
    "**/__tests__/**/*.ts",
    "**/*.test.ts",
    "**/*.spec.ts",
  ],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "__tests__/setup\.ts",
    "__tests__/teardown\.ts",
    "__tests__/setupAfterEnv\.ts",
    "__tests__/helpers/",
  ],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.json",
        useESM: false,
      },
    ],
    // sanitize-html ships htmlparser2 v12 — an ESM-only package — so transform
    // its module graph down to CommonJS (see transformIgnorePatterns below).
    "^.+\\.js$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.json",
        useESM: false,
        allowJs: true,
        diagnostics: false,
      },
    ],
  },
  // Only ESM-only deps (sanitize-html + its parser family) are transformed;
  // everything else in node_modules is left untouched for speed.
  transformIgnorePatterns: [
    "node_modules/(?!sanitize-html|htmlparser2|domhandler|domutils|dom-serializer|entities|domelementtype|css-select|nth-check)",
  ],
  moduleFileExtensions: ["ts", "js", "json"],
  // Global setup/teardown for MongoDB memory server
  globalSetup: "<rootDir>/src/__tests__/setup.ts",
  globalTeardown: "<rootDir>/src/__tests__/teardown.ts",
  setupFiles: ["<rootDir>/src/__tests__/setupAfterEnv.ts"],
  // Timeout for API tests (30 seconds)
  testTimeout: 30000,
  // Verbose output
  verbose: true,
  // Collect coverage
  collectCoverage: false,
  // Detect open handles
  detectOpenHandles: true,
  // Force exit after test suite completes
  forceExit: true,
};
