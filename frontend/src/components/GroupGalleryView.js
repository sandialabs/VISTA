import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import ImageGallery from './ImageGallery';
import '../App.css';
import { fetchGroup } from '../api/groups';
import { fetchProjectImages } from '../api/images';
import { fetchProject } from '../api/projects';
import useRouteRequestOwnership, { isAbortError } from '../utils/useRouteRequestOwnership';

function GroupGalleryView() {
  const { id: projectId, groupId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isUngrouped = !groupId;

  const [project, setProject] = useState(null);
  const [groupInfo, setGroupInfo] = useState(null);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const {
    beginRequest,
    isCurrent,
    releaseRequest,
  } = useRouteRequestOwnership(`${projectId}:${groupId || '__ungrouped__'}`);

  const groupIdentifier = groupInfo?.display_name || groupInfo?.identifier || location.state?.groupIdentifier || (isUngrouped ? 'Ungrouped' : groupId);

  const fetchImages = useCallback(async (opts = {}, existingRequest = null) => {
    const request = existingRequest || beginRequest();
    const ownsRequest = !existingRequest;
    if (!isCurrent(request)) return;
    setLoading(true);
    setError(null);
    try {
      const baseParams = new URLSearchParams();
      if (isUngrouped) {
        baseParams.set('ungrouped', 'true');
      } else {
        baseParams.set('group_id', groupId);
      }
      if (opts.searchField && opts.searchValue) {
        baseParams.set('search_field', opts.searchField);
        baseParams.set('search_value', opts.searchValue);
      }
      const PAGE_SIZE = 200;
      let skip = 0;
      let allImages = [];
      let hasMore = true;
      while (hasMore) {
        const params = new URLSearchParams(baseParams);
        params.set('skip', String(skip));
        params.set('limit', String(PAGE_SIZE));
        const batch = await fetchProjectImages(projectId, Object.fromEntries(params.entries()), {
          signal: request.controller.signal,
        });
        if (!isCurrent(request)) return;
        allImages = allImages.concat(batch);
        hasMore = batch.length === PAGE_SIZE;
        skip += PAGE_SIZE;
      }
      if (!isCurrent(request)) return;
      setImages(allImages.filter(img => !img.deleted_at));
    } catch (err) {
      if (isAbortError(err, request) || !isCurrent(request)) return;
      setError(err.message?.startsWith('Failed to load images')
        ? err.message
        : `Failed to load images: ${err.message}`);
    } finally {
      if (isCurrent(request)) {
        setLoading(false);
      }
      if (ownsRequest) {
        releaseRequest(request);
      }
    }
  }, [beginRequest, groupId, isCurrent, isUngrouped, projectId, releaseRequest]);

  useEffect(() => {
    const request = beginRequest();
    setGroupInfo(null);
    fetchProject(projectId, { signal: request.controller.signal })
      .then(data => {
        if (isCurrent(request)) setProject(data);
      })
      .catch((err) => {
        if (!isAbortError(err, request) && isCurrent(request)) {
          // Project metadata is non-critical for the gallery body.
        }
      });
    if (groupId && !isUngrouped) {
      fetchGroup(groupId, { signal: request.controller.signal })
        .then(data => {
          if (isCurrent(request)) setGroupInfo(data);
        })
        .catch((err) => {
          if (!isAbortError(err, request) && isCurrent(request)) {
            // The route-state identifier remains usable if group metadata fails.
          }
        });
    }
    fetchImages({}, request).finally(() => releaseRequest(request));
    return () => {
      request.controller.abort();
      releaseRequest(request);
    };
  }, [beginRequest, fetchImages, groupId, isCurrent, isUngrouped, projectId, releaseRequest]);

  const handleImageUpdated = (updatedImage) => {
    setImages(prev => {
      const idx = prev.findIndex(i => i.id === updatedImage.id);
      if (idx === -1) return prev;
      const copy = [...prev];
      if (updatedImage.deleted_at) {
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
              onClick={() => navigate(`/project/${projectId}`)}
            >
              <span className="back-icon">←</span>
              <span>Back to Groups</span>
            </button>
            <div className="breadcrumb-mini">
              <span>Projects</span>
              <span className="breadcrumb-separator">›</span>
              <span
                className="breadcrumb-link"
                style={{ cursor: 'pointer', textDecoration: 'underline' }}
                onClick={() => navigate(`/project/${projectId}`)}
              >
                {project ? project.name : 'Loading...'}
              </span>
              <span className="breadcrumb-separator">›</span>
              <span className="current-project">{groupIdentifier}</span>
            </div>
          </div>
          <div className="project-info">
            <h1 className="project-title">{groupIdentifier}</h1>
            <p className="project-description">
              {project ? project.name : ''}
              {' - '}
              {isUngrouped ? 'Images not assigned to any group' : `Group: ${groupIdentifier}`}
            </p>
          </div>
        </div>
      </header>

      <div className="project-container">
        {error && (
          <div className="alert alert-error">
            <strong>Error:</strong> {error}
          </div>
        )}
        <div className="project-content">
          <div className="gallery-section">
            <ImageGallery
              projectId={projectId}
              galleryKey={isUngrouped ? `${projectId}_ungrouped` : `${projectId}_group_${groupId}`}
              images={images}
              loading={loading}
              onImageUpdated={handleImageUpdated}
              refreshProjectImages={(opts) => fetchImages(opts)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default GroupGalleryView;
