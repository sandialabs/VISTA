// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Reduce noisy console output from React Router future-flag warnings
// and expected app logs during tests, while preserving other warnings/errors.

const originalWarn = console.warn;
const originalLog = console.log;
const originalError = console.error;

beforeAll(() => {
	console.warn = (...args) => {
		const first = args[0];
		const message = typeof first === 'string' ? first : '';

		if (message.includes('React Router Future Flag Warning')) {
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

		if (message.startsWith('Failed to load image with ID:')) {
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
