import React, { useEffect } from 'react';

/**
 * Toast notification component
 * @param {Object} props - Component props
 * @param {string} props.message - Message to display
 * @param {string} props.type - Type of toast (success, error, warning, info)
 * @param {Function} props.onClose - Function to call when toast is closed
 * @param {number} props.duration - Duration in ms before auto-closing (default: 5000)
 */
const Toast = ({ message, type = 'info', onClose, duration = 5000 }) => {
  // Auto-dismiss after duration
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);
    
    // Clear timeout on unmount
    return () => clearTimeout(timer);
  }, [duration, onClose]);
  
  // Define styles based on type
  const getTypeStyles = () => {
    switch (type) {
      case 'success':
        return { backgroundColor: '#4caf50', color: 'white' };
      case 'error':
        return { backgroundColor: '#f44336', color: 'white' };
      case 'warning':
        return { backgroundColor: '#ff9800', color: 'black' };
      case 'info':
      default:
        return { backgroundColor: '#2196f3', color: 'white' };
    }
  };
  
  const baseStyles = {
    position: 'fixed',
    top: '20px',
    right: '20px',
    padding: '12px 20px',
    borderRadius: '4px',
    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.2)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    maxWidth: '400px',
    animation: 'slideIn 0.3s ease-out forwards'
  };
  
  return (
    <div style={{ ...baseStyles, ...getTypeStyles() }}>
      <div>{message}</div>
      <button 
        onClick={onClose}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          fontSize: '16px',
          cursor: 'pointer',
          marginLeft: '10px'
        }}
      >
        &times;
      </button>
    </div>
  );
};

export default Toast;
