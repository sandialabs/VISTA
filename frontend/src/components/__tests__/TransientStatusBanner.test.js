import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import TransientStatusBanner, { TRANSIENT_STATUS_DURATION_MS } from '../TransientStatusBanner';

function Harness({ initial = 'Configuration saved.', duration }) {
  const [message, setMessage] = useState(initial);
  return (
    <>
      <button type="button" onClick={() => setMessage('Configuration autosaved.')}>next</button>
      <TransientStatusBanner message={message} onDismiss={() => setMessage('')} duration={duration} />
    </>
  );
}

describe('TransientStatusBanner', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('renders a polite status overlay at the document root', () => {
    const { container } = render(<Harness />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Configuration saved.');
    expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(container.contains(banner)).toBe(false);
    expect(banner.parentElement).toHaveClass('transient-status-layer');
  });

  test('dismisses itself after 2 seconds', () => {
    render(<Harness />);
    expect(TRANSIENT_STATUS_DURATION_MS).toBe(2000);
    act(() => { jest.advanceTimersByTime(1900); });
    expect(screen.getByRole('status')).toHaveClass('is-leaving');
    act(() => { jest.advanceTimersByTime(100); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('a new message restarts the timer', () => {
    render(<Harness />);
    act(() => { jest.advanceTimersByTime(1500); });
    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    act(() => { jest.advanceTimersByTime(1500); });
    expect(screen.getByRole('status')).toHaveTextContent('Configuration autosaved.');
    expect(screen.getByRole('status')).not.toHaveClass('is-leaving');
    act(() => { jest.advanceTimersByTime(500); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('clicking dismisses early; empty message renders nothing', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('status'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    render(<TransientStatusBanner message="" onDismiss={() => {}} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
