'use strict';

// Jest configuration for the UI. It reproduces the defaults react-scripts applied
// (roots, test patterns, jsdom, resetMocks, CSS and asset transforms) so the suites
// behave the same after the move from Create React App to Vite.
module.exports = {
  roots: ['<rootDir>/src'],
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/config/jest/polyfills.js'],
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.js'],
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.{js,jsx,mjs,cjs}',
    '<rootDir>/src/**/*.{spec,test}.{js,jsx,mjs,cjs}',
  ],
  transform: {
    '^.+\\.(js|jsx|mjs|cjs)$': [
      'babel-jest',
      {
        babelrc: false,
        configFile: false,
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          ['@babel/preset-react', { runtime: 'automatic' }],
        ],
      },
    ],
    '^.+\\.css$': '<rootDir>/config/jest/cssTransform.js',
    '^(?!.*\\.(js|jsx|mjs|cjs|css|json)$)': '<rootDir>/config/jest/fileTransform.js',
  },
  transformIgnorePatterns: ['[/\\\\]node_modules[/\\\\].+\\.(js|jsx|mjs|cjs)$'],
  moduleFileExtensions: ['js', 'jsx', 'mjs', 'cjs', 'json', 'node'],
  moduleNameMapper: {
    // react-router 7 ships its DOM entry as ESM through package exports; point Jest at
    // the CommonJS build.
    '^react-router/dom$': '<rootDir>/node_modules/react-router/dist/development/dom-export.js',
    // flexlayout-react exports only an ESM "import" condition. setupTests.js replaces it
    // with a factory mock, so Jest only needs a path to resolve.
    '^flexlayout-react$': '<rootDir>/node_modules/flexlayout-react/dist/index.js',
  },
  resetMocks: true,
  // Keep the snapshot format of the Jest 27 runner the stored snapshots were written with.
  snapshotFormat: { escapeString: true, printBasicPrototype: true },
};
