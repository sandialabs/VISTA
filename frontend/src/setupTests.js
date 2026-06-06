// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Polyfill for crypto.randomUUID in Jest environment
if (typeof global.crypto === 'undefined') {
  global.crypto = {};
}
if (typeof global.crypto.randomUUID === 'undefined') {
  global.crypto.randomUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };
}

// Reduce noisy console output from React Router future-flag warnings
// and expected app logs during tests, while preserving other warnings/errors.

const originalWarn = console.warn;
const originalLog = console.log;
const originalError = console.error;

beforeAll(() => {
	console.warn = (...args) => {
		const first = args[0];
		const message = typeof first === 'string' ? first : '';

		if (message.includes('React Router Future Flag Warning') ||
			message.startsWith('Non-OK response when loading review statuses')) {
			return;
		}

		return originalWarn(...args);
	};

	console.log = (...args) => {
		const first = args[0];
		const message = typeof first === 'string' ? first : '';

		if (
			message.startsWith('Fetching images for project:') ||
			message.startsWith('Authentication is disabled or user is not logged in') ||
			message.startsWith('Starting download for image') ||
			message.startsWith('Trying endpoint:') ||
			message.startsWith('Direct image fetch failed') ||
			message.startsWith('Download completed successfully:') ||
			message.startsWith('App render count:')
		) {
			return;
		}

		return originalLog(...args);
	};

	console.error = (...args) => {
		const first = args[0];
		const message = typeof first === 'string' ? first : '';

		if (message.startsWith('Failed to load image with ID:') ||
			message.startsWith('Failed to load review statuses:') ||
			message.includes('inside a test was not wrapped in act(...)') ||
			message.includes('Not implemented: window.scrollTo') ||
			message.startsWith('Error loading project calibration')) {
			return;
		}

		return originalError(...args);
	};
});

afterAll(() => {
	console.warn = originalWarn;
	console.log = originalLog;
	console.error = originalError;
});
