import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { downloadExcel } from '../utils/downloadExcel';
import { generateCSVReport, generateJSONReport } from '../utils/reportExport';
import ReportImageCard from './ReportImageCard';

function ProjectReport() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [images, setImages] = useState([]);
  const [classes, setClasses] = useState([]);
  const [annotations, setAnnotations] = useState([]);
  const [bboxClasses, setBboxClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [fullWidthImages, setFullWidthImages] = useState(false);
  const [exporting, setExporting] = useState(false);

  const getClassLabels = (classifications, classes) => {
    if (!classifications || classifications.length === 0) return 'None';
    return classifications.map(c => classes.find(cls => cls.id === c.class_id)?.name || 'Unknown').join(', ');
  };

  // Build lookup maps for annotations
  const bboxClassMap = {};
  bboxClasses.forEach(c => { bboxClassMap[c.id] = c; });

  const annotationsByImage = {};
  annotations.forEach(ann => {
    const imgId = ann.image_id;
    if (!annotationsByImage[imgId]) annotationsByImage[imgId] = [];
    annotationsByImage[imgId].push(ann);
  });

  const getAnnotationSummary = (imageId) => {
    const anns = annotationsByImage[imageId] || [];
    if (anns.length === 0) return '';
    return anns.map(a => {
      const cls = bboxClassMap[a.bbox_class_id];
      const name = cls?.name || 'Unknown';
      return `${name} [${Math.round(a.bbox_x_min)},${Math.round(a.bbox_y_min)},${Math.round(a.bbox_x_max)},${Math.round(a.bbox_y_max)}]`;
    }).join('; ');
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

        // Load bbox classes and user annotations
        const bboxResponse = await fetch(`/api/projects/${id}/bbox-classes`);
        if (bboxResponse.ok) {
          setBboxClasses(await bboxResponse.json());
        }
        const annResponse = await fetch(`/api/projects/${id}/user-annotations`);
        if (annResponse.ok) {
          setAnnotations(await annResponse.json());
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

  const generateCSV = () => {
    setGenerating(true);
    try {
      generateCSVReport({ images, classes, project, annotationsByImage, getAnnotationSummary });
    } catch (error) {
      console.error('Error generating CSV:', error);
      setError('Failed to generate CSV report');
    } finally {
      setGenerating(false);
    }
  };

  const generateJSON = () => {
    setGenerating(true);
    try {
      generateJSONReport({
        images, classes, bboxClasses, bboxClassMap,
        project, currentUser, annotationsByImage,
      });
    } catch (error) {
      console.error('Error generating JSON:', error);
      setError('Failed to generate JSON report');
    } finally {
      setGenerating(false);
    }
  };

  // Generate Excel export via backend
  const generateExcel = async () => {
    setExporting(true);
    try {
      await downloadExcel(id, project?.name);
    } catch (err) {
      console.error('Excel export failed:', err);
      setError(`Excel export failed: ${err.message}`);
    } finally {
      setExporting(false);
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
                className="btn btn-primary btn-small"
                onClick={generateExcel}
                disabled={exporting}
                title="Download data as Microsoft Excel (.xlsx) file"
              >
                {exporting ? 'Generating...' : 'Export to Excel'}
              </button>
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
                <div className="stat-item">
                  <div className="stat-number">{annotations.length}</div>
                  <div className="stat-label">Annotations</div>
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
                  <ReportImageCard
                    key={image.id}
                    image={image}
                    fullWidthImages={fullWidthImages}
                    annotations={annotationsByImage[image.id] || []}
                    bboxClassMap={bboxClassMap}
                    classes={classes}
                    formatFileSize={formatFileSize}
                    getClassLabels={getClassLabels}
                  />
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