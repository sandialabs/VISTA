import React from 'react';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';

// Component that always throws an error
const ThrowError = () => {
  throw new Error('Test error');
};

// Component that works fine
const WorkingComponent = () => <div>Working</div>;

test('renders children when there is no error', () => {
  render(
    <ErrorBoundary>
      <WorkingComponent />
    </ErrorBoundary>
  );
  expect(screen.getByText('Working')).toBeInTheDocument();
});

test('renders error UI when child component throws', () => {
  // Suppress console.error for this test
  const consoleError = console.error;
  console.error = jest.fn();

  render(
    <ErrorBoundary>
      <ThrowError />
    </ErrorBoundary>
  );

  expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  expect(screen.getByText(/The application encountered an unexpected error/)).toBeInTheDocument();
  expect(screen.getByText('Reload Page')).toBeInTheDocument();

  // Restore console.error
  console.error = consoleError;
});

test('shows error details in collapsed section', () => {
  // Suppress console.error for this test
  const consoleError = console.error;
  console.error = jest.fn();

  render(
    <ErrorBoundary>
      <ThrowError />
    </ErrorBoundary>
  );

  expect(screen.getByText('Error details')).toBeInTheDocument();

  // Restore console.error
  console.error = consoleError;
});
