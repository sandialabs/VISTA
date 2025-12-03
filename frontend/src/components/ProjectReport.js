import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

function ProjectReport() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [images, setImages] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [fullWidthImages, setFullWidthImages] = useState(false);

  const getClassLabels = (classifications, classes) => {
    if (!classifications || classifications.length === 0) return 'None';
    return classifications.map(c => classes.find(cls => cls.id === c.class_id)?.name || 'Unknown').join(', ');
  };

  // Load project data
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);

        // Load current user
        const userResponse = await fetch('/api/users/me');
        if (userResponse.ok) {
          const userData = await userResponse.json();
          setCurrentUser(userData);
        }

        // Load project
        const projectResponse = await fetch(`/api/projects/${id}`);
        if (!projectResponse.ok) {
          throw new Error('Failed to fetch project');
        }
        const projectData = await projectResponse.json();
        setProject(projectData);

        // Load all images with full metadata and comments
        const imagesResponse = await fetch(`/api/projects/${id}/images?include_deleted=true`);
        if (!imagesResponse.ok) {
          throw new Error('Failed to fetch images');
        }
        const imagesData = await imagesResponse.json();

        // Load detailed data for each image (comments, full metadata)
        const detailedImages = await Promise.all(
          imagesData.map(async (image) => {
            try {
              // Get comments
              const commentsResponse = await fetch(`/api/images/${image.id}/comments`);
              const comments = commentsResponse.ok ? await commentsResponse.json() : [];

              // Get classifications
              const classificationsResponse = await fetch(`/api/images/${image.id}/classifications`);
              const classifications = classificationsResponse.ok ? await classificationsResponse.json() : [];

              return {
                ...image,
                comments,
                classifications
              };
            } catch (error) {
              console.error(`Failed to load details for image ${image.id}:`, error);
              return {
                ...image,
                comments: [],
                classifications: []
              };
            }
          })
        );

        setImages(detailedImages);

        // Load classes
        const classesResponse = await fetch(`/api/projects/${id}/classes`);
        if (classesResponse.ok) {
          const classesData = await classesResponse.json();
          setClasses(classesData);
        }

      } catch (error) {
        console.error('Error loading data:', error);
        setError(error.message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [id]);

  // Helper function to escape CSV values properly with CSV injection protection
  const escapeCsvValue = (value) => {
    if (value === null || value === undefined) {
      return '';
    }

    let stringValue = value.toString().trim();

    // CSV injection protection: prevent formula execution in spreadsheet applications
    // Characters that start formulas: = @ + - and also tab characters
    if (stringValue.match(/^[=@+\t-]/) || stringValue.toLowerCase().startsWith('cmd|') || stringValue.toLowerCase().startsWith('dde|')) {
      stringValue = `'${stringValue}`;
    }

    // If the value contains quotes, commas, newlines, or other special characters, escape it
    if (stringValue.includes('"') || stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('\r') || stringValue.includes('\t')) {
      // Escape quotes by doubling them and wrap the entire value in quotes
      return `"${stringValue.replace(/"/g, '""')}"`;
    }

    // Additional protection: wrap values that start with dangerous characters
    if (stringValue.match(/^[=@+-]/)) {
      return `"${stringValue}"`;
    }

    return stringValue;
  };

  // Generate CSV export
  const generateCSV = () => {
    setGenerating(true);

    try {
      const headers = [
        'Image ID',
        'Filename',
        'Size (bytes)',
        'Content Type',
        'Upload Date',
        'Deleted',
        'Comments Count',
        'Comments',
        'Classifications',
        'Custom Metadata'
      ];

      const rows = images.map(image => {
        const comments = image.comments?.map(c => `${c.text} (by ${c.author?.email || 'Unknown'} on ${new Date(c.created_at).toLocaleString()})`).join('; ') || '';
        const classifications = image.classifications?.map(c => classes.find(cls => cls.id === c.class_id)?.name || 'Unknown').join(', ') || '';
        const customMetadata = image.metadata ? JSON.stringify(image.metadata) : '';

        return [
          escapeCsvValue(image.id),
          escapeCsvValue(image.filename || ''),
          escapeCsvValue(image.size_bytes || 0),
          escapeCsvValue(image.content_type || ''),
          escapeCsvValue(new Date(image.created_at).toLocaleString()),
          escapeCsvValue(image.deleted_at ? 'Yes' : 'No'),
          escapeCsvValue(image.comments?.length || 0),
          escapeCsvValue(comments),
          escapeCsvValue(classifications),
          escapeCsvValue(customMetadata)
        ];
      });

      const csvContent = [headers.map(escapeCsvValue), ...rows].map(row => row.join(',')).join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${project.name}_report.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating CSV:', error);
      setError('Failed to generate CSV report');
    } finally {
      setGenerating(false);
    }
  };

  // Generate JSON export
  const generateJSON = () => {
    setGenerating(true);

    try {
      const reportData = {
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          meta_group_id: project.meta_group_id,
          created_at: project.created_at
        },
        classes: classes,
        images: images.map(image => ({
          id: image.id,
          filename: image.filename,
          size_bytes: image.size_bytes,
          content_type: image.content_type,
          created_at: image.created_at,
          deleted_at: image.deleted_at,
          metadata: image.metadata || {},
          comments: image.comments || [],
          classifications: image.classifications || []
        })),
        generated_at: new Date().toISOString(),
        generated_by: currentUser?.email || 'Unknown'
      };

      const jsonContent = JSON.stringify(reportData, null, 2);

      const blob = new Blob([jsonContent], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${project.name}_report.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating JSON:', error);
      setError('Failed to generate JSON report');
    } finally {
      setGenerating(false);
    }
  };

  // Print report
  const printReport = () => {
    window.print();
  };

  // Helper function to format file sizes
  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  if (loading) {
    return (
      <div className="App">
        <div className="loading-container">
          <div className="spinner"></div>
          <div className="loading-text">Loading project data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      <header className="project-header">
        <div className="project-header-content">
          <div className="project-nav">
            <button
              className="back-btn"
              onClick={() => navigate(`/project/${id}`)}
            >
              <span className="back-icon">←</span>
              <span>Back to Project</span>
            </button>
            <div className="breadcrumb-mini">
              <span>Projects</span>
              <span className="breadcrumb-separator">›</span>
              <span className="current-project">{project?.name || 'Loading...'}</span>
              <span className="breadcrumb-separator">›</span>
              <span>Report</span>
            </div>
          </div>
          <div className="project-info">
            <h1 className="project-title">Generate Report: {project?.name}</h1>
            {currentUser && (
              <div className="project-meta">
                <span className="project-user">Logged in as {currentUser.email}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="container">
        {error && (
          <div className="alert alert-error">
            <strong>Error:</strong> {error}
            <button
              className="close-alert"
              onClick={() => setError(null)}
            >
              &times;
            </button>
          </div>
        )}

        <div className="report-container">
          <div className="report-actions no-print">
            <div className="image-toggle">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={fullWidthImages}
                  onChange={(e) => setFullWidthImages(e.target.checked)}
                />
                <span className="toggle-text">Full width images</span>
              </label>
            </div>
            <div className="export-buttons-small">
              <button
                className="btn btn-secondary btn-small"
                onClick={generateCSV}
                disabled={generating}
                title="Download data as CSV for spreadsheet analysis"
              >
                {generating ? 'Generating...' : 'Download CSV'}
              </button>
              <button
                className="btn btn-secondary btn-small"
                onClick={generateJSON}
                disabled={generating}
                title="Download complete data as JSON"
              >
                {generating ? 'Generating...' : 'Download JSON'}
              </button>
              <button
                className="btn btn-primary btn-small"
                onClick={printReport}
                title="Print or save as PDF"
              >
                Print / Save as PDF
              </button>
            </div>
          </div>

          <div className="report-content">
            <div className="report-header">
              <h1 className="project-title">{project?.name}</h1>
              <div className="project-meta">
                <p><strong>Description:</strong> {project?.description || 'No description provided'}</p>
                <p><strong>Project ID:</strong> {project?.id}</p>
                <p><strong>Group:</strong> {project?.meta_group_id}</p>
                <p><strong>Report Generated:</strong> {new Date().toLocaleString()}</p>
                <p><strong>Generated By:</strong> {currentUser?.email || 'Unknown'}</p>
              </div>
            </div>

            <div className="report-section">
              <h2 className="section-title">Project Statistics</h2>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-number">{images.length}</div>
                  <div className="stat-label">Total Images</div>
                </div>
                <div className="stat-item">
                  <div className="stat-number">{images.filter(img => !img.deleted_at).length}</div>
                  <div className="stat-label">Active Images</div>
                </div>
                <div className="stat-item">
                  <div className="stat-number">{images.filter(img => img.deleted_at).length}</div>
                  <div className="stat-label">Deleted Images</div>
                </div>
                <div className="stat-item">
                  <div className="stat-number">{images.reduce((sum, img) => sum + (img.comments?.length || 0), 0)}</div>
                  <div className="stat-label">Total Comments</div>
                </div>
                <div className="stat-item">
                  <div className="stat-number">{classes.length}</div>
                  <div className="stat-label">Classifications</div>
                </div>
              </div>
            </div>

            {classes.length > 0 && (
              <div className="report-section">
                <h2 className="section-title">Available Classifications</h2>
                <ul className="classifications-list">
                  {classes.map(cls => (
                    <li key={cls.id}>
                      <strong>{cls.name}</strong> - {cls.description || 'No description'}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="report-section">
              <h2 className="section-title">Image Details</h2>
              <div className="images-list">
                {images.map(image => (
                  <div key={image.id} className="image-item">
                    <div className={`image-display-section ${fullWidthImages ? 'full-width' : ''}`}>
                      <div className={`image-thumbnail ${fullWidthImages ? 'full-width-thumbnail' : ''}`}>
                        {image.deleted_at ? (
                          <div className="deleted-image-placeholder">
                            <div className="deleted-image-text">
                              <div>IMAGE DELETED</div>
                              <div className="deleted-date">
                                {new Date(image.deleted_at).toLocaleDateString()}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <img
                            src={fullWidthImages
                              ? (image.content_type === 'image/tiff' 
                                  ? `/api/images/${image.id}/thumbnail?width=800&height=800`
                                  : `/api/images/${image.id}/content`)
                              : `/api/images/${image.id}/thumbnail?width=300&height=300`
                            }
                            alt={image.filename || 'Image'}
                            className="report-image"
                            onError={(e) => {
                              // Fallback to content endpoint if thumbnail fails
                              if (!e.target.src.includes('/content')) {
                                e.target.src = `/api/images/${image.id}/content`;
                              }
                            }}
                          />
                        )}
                      </div>
                      <div className="image-details">
                        <div className="image-title">{image.filename || 'Untitled'}</div>
                        <div className="image-meta">
                          <span><strong>ID:</strong> {image.id}</span>
                          <span><strong>Size:</strong> {formatFileSize(image.size_bytes)}</span>
                          <span><strong>Type:</strong> {image.content_type || 'Unknown'}</span>
                          <span><strong>Uploaded:</strong> {new Date(image.created_at).toLocaleString()}</span>

                          <span><strong>Class Labels:</strong> {getClassLabels(image.classifications, classes)}</span>

                          {image.deleted_at && (
                            <span className="deleted-indicator">
                              <strong>DELETED:</strong> {new Date(image.deleted_at).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {image.comments && image.comments.length > 0 && (
                      <div className="image-comments">
                        <strong>Comments ({image.comments.length}):</strong>
                        {image.comments.map((comment, idx) => (
                          <div key={idx} className="comment">
                            <strong>{comment.author?.email || 'Unknown'}:</strong> {comment.text}
                            <small className="comment-date"> - {new Date(comment.created_at).toLocaleString()}</small>
                          </div>
                        ))}
                      </div>
                    )}

                    {image.metadata && Object.keys(image.metadata).length > 0 && (
                      <div className="image-metadata">
                        <strong>Custom Metadata:</strong>
                        <pre className="metadata-json">{JSON.stringify(image.metadata, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProjectReport;