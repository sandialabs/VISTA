import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './App.css';

// Import components
import ImageUploader from './components/ImageUploader';
import MetadataManager from './components/MetadataManager';
import ClassManager from './components/ClassManager';
import ImageGallery from './components/ImageGallery';

function Project() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [images, setImages] = useState([]);
  const [metadata, setMetadata] = useState({});
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [deletedOnly, setDeletedOnly] = useState(false);

  const fetchImages = useCallback(async (projId, opts = {}) => {
    const inc = opts.includeDeleted ?? includeDeleted;
    const delOnly = opts.deletedOnly ?? deletedOnly;
    const searchField = opts.searchField;
    const searchValue = opts.searchValue;
    let url = `/api/projects/${projId}/images`;
    const params = [];
    if (delOnly) {
      params.push('deleted_only=true');
    } else if (inc) {
      params.push('include_deleted=true');
    }
    if (searchField && searchValue) {
      params.push(`search_field=${encodeURIComponent(searchField)}`);
      params.push(`search_value=${encodeURIComponent(searchValue)}`);
    }
    if (params.length) url += `?${params.join('&')}`;
    const imagesResponse = await fetch(url);
    if (imagesResponse.ok) {
      const imagesData = await imagesResponse.json();
      setImages(imagesData);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Fetch the current user
    fetch('/api/users/me')
      .then(response => {
        if (!response.ok) {
          // If we get a 401, it's expected when authentication is disabled
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

    // Load project data, metadata, classes, and images
    const fetchProjectData = async () => {
      try {
        setLoading(true);
        
        // Fetch project details
        const projectResponse = await fetch(`/api/projects/${id}`);
        if (!projectResponse.ok) {
          throw new Error(`HTTP error! status: ${projectResponse.status}`);
        }
        const projectData = await projectResponse.json();
        setProject(projectData);
        
        // Fetch project metadata
        const metadataResponse = await fetch(`/api/projects/${id}/metadata-dict`);
        if (metadataResponse.ok) {
          const metadataData = await metadataResponse.json();
          setMetadata(metadataData);
        }
        
        // Fetch project classes
        const classesResponse = await fetch(`/api/projects/${id}/classes`);
        if (classesResponse.ok) {
          const classesData = await classesResponse.json();
          setClasses(classesData);
        }
        
  await fetchImages(id);
        
        setLoading(false);
      } catch (err) {
        console.error("Failed to fetch project data:", err);
        setError(err.message);
        setLoading(false);
      }
    };

    fetchProjectData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Refetch when deletion visibility changes
  useEffect(() => {
    if (project) {
      fetchImages(project.id, { includeDeleted, deletedOnly });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeDeleted, deletedOnly, project?.id]);

  // Handle image upload completion
  const handleUploadComplete = (newImages) => {
    // If not showing deleted, just append
    setImages(prevImages => [...prevImages, ...newImages]);
  };

  const handleImageStateUpdate = (updatedImage) => {
    setImages(prev => {
      const idx = prev.findIndex(i => i.id === updatedImage.id);
      if (idx === -1) return prev;
      const copy = [...prev];
      // If image became deleted and we are NOT including deleted, remove from list
      if (updatedImage.deleted_at && !includeDeleted && !deletedOnly) {
        copy.splice(idx, 1);
        return copy;
      }
      copy[idx] = updatedImage;
      return copy;
    });
  };

  return (
    <div className="App">
      <header className="project-header">
        <div className="project-header-content">
          <div className="project-nav">
            <button 
              className="back-btn" 
              onClick={() => navigate('/')}
            >
              <span className="back-icon">←</span>
              <span>Back to Dashboard</span>
            </button>
            <div className="breadcrumb-mini">
              <span>Projects</span>
              <span className="breadcrumb-separator">›</span>
              <span className="current-project">{project ? project.name : 'Loading...'}</span>
            </div>
          </div>
          <div className="project-info">
            <h1 className="project-title">{project ? project.name : 'Loading project...'}</h1>
            <p className="project-description">
              {project ? (project.description || 'No description provided') : ''}
            </p>
            <div className="project-meta">
              <span className="project-id">
                Project ID: {project?.id}
                <button
                  className="copy-id-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(project?.id);
                  }}
                  title="Copy project ID"
                >
                  Copy
                </button>
              </span>
              <span className="project-group">Group: {project?.meta_group_id}</span>
              {currentUser && <span className="project-user">{currentUser.email}</span>}
            </div>
          </div>
        </div>
      </header>

      <div className="project-container">

        {error && (
          <div className="alert alert-error">
            <strong>Error:</strong> {error}
          </div>
        )}
        
        {loading && (
          <div className="loading-container">
            <div className="spinner"></div>
            <div className="loading-text">Loading project data...</div>
          </div>
        )}
        
        {!loading && (
          <div className="project-content">
            {/* Main Gallery Section */}
            <div className="gallery-section">
              <ImageGallery 
                projectId={id} 
                images={images} 
                loading={loading} 
                onImageUpdated={handleImageStateUpdate}
                refreshProjectImages={(searchOpts) => fetchImages(id, searchOpts)}
              />
            </div>
            
            {/* Quick Upload Section */}
            <div className="upload-section">
              <ImageUploader 
                projectId={id} 
                onUploadComplete={handleUploadComplete} 
                loading={loading} 
                setLoading={setLoading} 
                setError={setError} 
              />
            </div>
            
            {/* Management Sections */}
            <div className="management-sections">
              <div className="metadata-section">
                <MetadataManager 
                  projectId={id} 
                  metadata={metadata} 
                  setMetadata={setMetadata} 
                  loading={loading} 
                  setLoading={setLoading} 
                  setError={setError} 
                />
              </div>
              
              <div className="classes-section">
                <ClassManager 
                  projectId={id} 
                  classes={classes} 
                  setClasses={setClasses} 
                  loading={loading} 
                  setLoading={setLoading} 
                  setError={setError} 
                />
              </div>
            </div>
            
            {/* Image Deletion Controls - moved to bottom */}
            <div className="deletion-controls-section" style={{ marginTop: '24px', padding: '16px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem', fontWeight: '600', color: '#333' }}>Image View Options</h3>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input 
                    type="checkbox" 
                    checked={includeDeleted} 
                    onChange={(e) => {
                      const val = e.target.checked;
                      setIncludeDeleted(val);
                      if (!val) setDeletedOnly(false);
                    }}
                  />
                  Show deleted
                </label>
                <label style={{ display: 'flex', gap: '6px', alignItems: 'center', opacity: includeDeleted ? 1 : 0.4 }}>
                  <input 
                    type="checkbox" 
                    disabled={!includeDeleted} 
                    checked={deletedOnly} 
                    onChange={(e) => setDeletedOnly(e.target.checked)}
                  />
                  Deleted only
                </label>
                <span style={{ fontSize: '0.85rem', color: '#666', fontStyle: 'italic' }}>
                  Deleted images are kept for retention; force delete removes storage object.
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Project;
