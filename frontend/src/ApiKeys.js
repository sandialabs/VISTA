import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import './App.css';
import Toast from './components/Toast';

function ApiKeys() {
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const nameInputRef = useRef(null);

  // Function to show a toast notification
  const showToast = useCallback((message, type = 'error') => {
    setToast({ message, type });
  }, []);

  // Function to hide the toast
  const hideToast = () => {
    setToast(null);
  };

  // Copy to clipboard function
  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('API key copied to clipboard!', 'success');
    } catch (err) {
      console.error('Failed to copy: ', err);
      showToast('Failed to copy to clipboard', 'error');
    }
  };

  // Fetch current user
  useEffect(() => {
    fetch('/api/users/me')
      .then(response => {
        if (!response.ok) {
          if (response.status === 401) {
            console.log("Authentication is disabled or user is not logged in");
            return null;
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(userData => {
        if (userData) {
          setCurrentUser(userData);
        }
      })
      .catch(err => {
        console.error("Failed to fetch current user:", err);
      });
  }, []);

  // Fetch API keys
  const fetchApiKeys = useCallback(() => {
    setLoading(true);
    fetch('/api/api-keys')
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        setApiKeys(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch API keys:", err);
        showToast(`Failed to fetch API keys: ${err.message}`, 'error');
        setLoading(false);
      });
  }, [showToast]);

  useEffect(() => {
    fetchApiKeys();
  }, [fetchApiKeys]);

  // Handle API key creation
  const handleCreateApiKey = (e) => {
    e.preventDefault();
    const name = nameInputRef.current.value.trim();
    
    if (!name) {
      showToast('Please enter a name for the API key', 'error');
      return;
    }

    setLoading(true);
    fetch('/api/api-keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    })
      .then(response => {
        if (!response.ok) {
          return response.json().then(errorData => {
            throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
          });
        }
        return response.json();
      })
      .then(data => {
        console.log("API key created successfully:", data);
        setNewlyCreatedKey(data.key); // Store the raw key for one-time display
        setApiKeys(prev => [...prev, data.api_key]);
        setShowCreateModal(false);
        setLoading(false);
        showToast(`API key "${data.api_key.name}" created successfully!`, 'success');
        // Clear the form
        nameInputRef.current.value = '';
      })
      .catch(err => {
        console.error("Failed to create API key:", err);
        showToast(err.message, 'error');
        setLoading(false);
      });
  };

  // Handle API key deletion
  const handleDeleteApiKey = (keyId, keyName) => {
    if (!window.confirm(`Are you sure you want to deactivate the API key "${keyName}"? This action cannot be undone.`)) {
      return;
    }

    fetch(`/api/api-keys/${keyId}`, {
      method: 'DELETE',
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        // Remove the key from the list
        setApiKeys(prev => prev.filter(key => key.id !== keyId));
        showToast(`API key "${keyName}" has been deactivated`, 'success');
      })
      .catch(err => {
        console.error("Failed to delete API key:", err);
        showToast(`Failed to deactivate API key: ${err.message}`, 'error');
      });
  };

  // Format date
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const CreateApiKeyModal = () => (
    <div className="modal">
      <div className="modal-content">
        <div className="modal-header">
          <h3>Create New API Key</h3>
          <span className="close" onClick={() => setShowCreateModal(false)}>&times;</span>
        </div>
        <div className="modal-body">
          <form onSubmit={handleCreateApiKey}>
            <div className="form-group">
              <label htmlFor="api-key-name">API Key Name *</label>
              <input 
                type="text" 
                id="api-key-name" 
                ref={nameInputRef}
                required
                placeholder="Enter a descriptive name for this API key"
                className="form-control"
                autoFocus
              />
              <small className="form-text">
                Choose a descriptive name to help you identify this API key
              </small>
            </div>
            <div className="modal-footer">
              <button 
                type="button" 
                className="btn btn-secondary"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="btn btn-success btn-large"
              >
                Create API Key
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );

  const NewKeyDisplayModal = () => (
    <div className="modal">
      <div className="modal-content">
        <div className="modal-header">
          <h3>API Key Created Successfully</h3>
        </div>
        <div className="modal-body">
          <div className="alert alert-warning">
            <strong>Important:</strong> This is the only time you will see this API key. 
            Please copy it now and store it in a secure location.
          </div>
          <div className="form-group">
            <label>Your new API Key:</label>
            <div className="api-key-display">
              <code className="api-key-value">{newlyCreatedKey}</code>
              <button 
                className="btn btn-primary btn-small"
                onClick={() => copyToClipboard(newlyCreatedKey)}
                style={{ marginLeft: '10px' }}
              >
                Copy
              </button>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button 
            className="btn btn-primary btn-large"
            onClick={() => setNewlyCreatedKey(null)}
          >
            I've Copied the Key
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="App">
      <header className="App-header">
        <div className="header-content">
          <div className="header-title">
            <h1>API Key Management</h1>
            {currentUser && (
              <div className="user-info">
                <span>Welcome back, {currentUser.email}</span>
              </div>
            )}
          </div>
          <button 
            className="btn btn-primary btn-large" 
            onClick={() => setShowCreateModal(true)}
          >
            Create New API Key
          </button>
        </div>
      </header>

      <div className="container">
        {/* Toast notification */}
        {toast && (
          <Toast 
            message={toast.message}
            type={toast.type}
            onClose={hideToast}
            duration={5000}
          />
        )}
        
        {/* Breadcrumb Navigation */}
        <div className="nav-breadcrumb">
          <div className="breadcrumb">
            <div className="breadcrumb-item">
              <Link to="/">Dashboard</Link>
            </div>
            <span className="breadcrumb-separator">/</span>
            <div className="breadcrumb-item">
              <span>API Keys</span>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="loading-container">
            <div className="spinner"></div>
            <div className="loading-text">Loading your API keys...</div>
          </div>
        )}
        
        {/* Empty State */}
        {!loading && apiKeys.length === 0 && (
          <div className="card text-center">
            <div className="card-content">
              <div style={{ fontSize: '4rem', marginBottom: 'var(--space-4)' }}>🔑</div>
              <h3 style={{ marginBottom: 'var(--space-4)', color: 'var(--gray-600)' }}>
                No API keys yet
              </h3>
              <p style={{ color: 'var(--gray-500)', marginBottom: 'var(--space-6)' }}>
                Create your first API key to start using our API programmatically
              </p>
              <button 
                className="btn btn-primary btn-large"
                onClick={() => setShowCreateModal(true)}
              >
                Create Your First API Key
              </button>
            </div>
          </div>
        )}
        
        {/* API Keys List */}
        {!loading && apiKeys.length > 0 && (
          <>
            <div className="flex justify-between items-center mb-6">
              <h2 style={{ margin: 0, color: 'var(--gray-900)', fontSize: '1.5rem', fontWeight: '600' }}>
                Your API Keys ({apiKeys.length})
              </h2>
            </div>
            
            <div className="api-keys-table">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Key ID</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Last Used</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.map(apiKey => (
                    <tr key={apiKey.id}>
                      <td>
                        <strong>{apiKey.name}</strong>
                      </td>
                      <td>
                        <code className="key-id">{apiKey.id}</code>
                      </td>
                      <td>
                        <span className={`status-badge ${apiKey.is_active ? 'active' : 'inactive'}`}>
                          {apiKey.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>{formatDate(apiKey.created_at)}</td>
                      <td>
                        {apiKey.last_used_at ? formatDate(apiKey.last_used_at) : 'Never'}
                      </td>
                      <td>
                        {apiKey.is_active && (
                          <button 
                            className="btn btn-danger btn-small"
                            onClick={() => handleDeleteApiKey(apiKey.id, apiKey.name)}
                          >
                            Deactivate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      {showCreateModal && <CreateApiKeyModal />}
      {newlyCreatedKey && <NewKeyDisplayModal />}
    </div>
  );
}

export default ApiKeys;