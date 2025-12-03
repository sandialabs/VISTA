import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

test('renders image management platform header', () => {
  render(
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
  const headerElement = screen.getByText('Image Management Platform');
  expect(headerElement).toBeInTheDocument();
});
