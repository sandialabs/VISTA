import React from 'react';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import NotFound from '../NotFound';

test('renders 404 page', () => {
  render(
    <BrowserRouter>
      <NotFound />
    </BrowserRouter>
  );
  
  expect(screen.getByText('404')).toBeInTheDocument();
  expect(screen.getByText('Page Not Found')).toBeInTheDocument();
  expect(screen.getByText(/The page you are looking for does not exist/)).toBeInTheDocument();
});

test('has a link back to home', () => {
  render(
    <BrowserRouter>
      <NotFound />
    </BrowserRouter>
  );
  
  const homeLink = screen.getByText('Return to Home');
  expect(homeLink).toBeInTheDocument();
  expect(homeLink.closest('a')).toHaveAttribute('href', '/');
});
