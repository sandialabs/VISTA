import React from 'react';
import { Link } from 'react-router-dom';

const NotFound = () => {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#f5f5f5',
      padding: '2rem'
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        padding: '3rem',
        maxWidth: '500px',
        textAlign: 'center',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
      }}>
        <h1 style={{
          fontSize: '6rem',
          fontWeight: 700,
          color: '#1976d2',
          margin: '0 0 1rem 0'
        }}>
          404
        </h1>
        <h2 style={{
          fontSize: '1.5rem',
          fontWeight: 600,
          color: '#333',
          margin: '0 0 1rem 0'
        }}>
          Page Not Found
        </h2>
        <p style={{
          color: '#666',
          lineHeight: '1.6',
          marginBottom: '2rem'
        }}>
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          to="/"
          style={{
            display: 'inline-block',
            backgroundColor: '#1976d2',
            color: 'white',
            padding: '0.75rem 2rem',
            borderRadius: '4px',
            textDecoration: 'none',
            fontWeight: 500,
            transition: 'background-color 0.2s'
          }}
          onMouseEnter={(e) => e.target.style.backgroundColor = '#1565c0'}
          onMouseLeave={(e) => e.target.style.backgroundColor = '#1976d2'}
        >
          Return to Home
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
