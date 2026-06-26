import { render, screen } from '@testing-library/react';
import ReviewStatusBadge from '../ReviewStatusBadge';

describe('ReviewStatusBadge', () => {
  test('does not render for unreviewed status', () => {
    const { container } = render(<ReviewStatusBadge status="unreviewed" />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders reject pending label and title', () => {
    render(<ReviewStatusBadge status="reject_pending" size="large" />);
    const badge = screen.getByText('Reject Pending');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('title', 'Review status: Reject Pending');
    expect(badge).toHaveStyle({ fontSize: '0.75rem' });
  });

  test('falls back to unreviewed config for unknown status while still rendering', () => {
    render(<ReviewStatusBadge status="something-new" />);
    const badge = screen.getByText('--');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('title', 'Review status: --');
  });
});
