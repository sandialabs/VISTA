'use strict';

// react-scripts loaded react-app-polyfill/jsdom, which gave the jsdom environment a
// global fetch. Jest's jsdom environment has none, and the suites spy on global.fetch.
// An unmocked call rejects, as the polyfill did with no server behind it.
if (typeof globalThis.fetch !== 'function') {
  globalThis.fetch = function fetch(input) {
    return Promise.reject(new TypeError(`fetch is not mocked in this test: ${String(input)}`));
  };
}
