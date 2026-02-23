import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import CollectionPhaseControls from './CollectionPhaseControls';
import CertificationPanel from './CertificationPanel';
import ReviewProgressBar from './ReviewProgressBar';
import ImageGallery from './ImageGallery';
import ClassManager from './ClassManager';
import ImageUploader from './ImageUploader';
import BboxClassSelector from './BboxClassSelector';

const PHASE_LABELS = {
  draft: 'Draft',
  annotating: 'Annotating',
  review: 'Review',
  certified: 'Certified',
};

function CollectionDetail() {
  const { id: projectId, collectionId } = useParams();
  const navigate = useNavigate();
  const [collection, setCollection] = useState(null);
  const [images, setImages] = useState([]);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [projectImages, setProjectImages] = useState([]);
  const [showImagePicker, setShowImagePicker] = useState(false);

  const fetchCollection = useCallback(async () => {
    try {
      const resp = await fetch(`/api/collections/${collectionId}`);
      if (resp.ok) {
        const data = await resp.json();
        setCollection(data);
      } else {
        setError('Failed to load collection');
      }
    } catch (err) {
      setError('Failed to load collection');
    }
  }, [collectionId]);

  const fetchImages = useCallback(async () => {
    try {
      const resp = await fetch(`/api/collections/${collectionId}/images/full`);
      if (resp.ok) {
        const data = await resp.json();
        setImages(data);
      }
    } catch (err) {
      console.error('Failed to fetch collection images:', err);
    }
  }, [collectionId]);

  const fetchProgress = useCallback(async () => {
    try {
      const resp = await fetch(`/api/collections/${collectionId}/review-progress`);
      if (resp.ok) {
        const data = await resp.json();
        setProgress(data);
      }
    } catch (err) {
      console.error('Failed to fetch review progress:', err);
    }
  }, [collectionId]);

  const fetchProjectImages = useCallback(async () => {
    try {
      const resp = await fetch(`/api/projects/${projectId}/images`);
      if (resp.ok) {
        const data = await resp.json();
        setProjectImages(data);
      }
    } catch (err) {
      console.error('Failed to fetch project images:', err);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchCollection(), fetchImages(), fetchProgress()])
      .finally(() => setLoading(false));
  }, [fetchCollection, fetchImages, fetchProgress]);

  const handlePhaseChanged = (updated) => {
    setCollection(updated);
    fetchProgress();
  };

  const handleCertified = (updated) => {
    setCollection(updated);
    fetchProgress();
  };

  const handleAddImages = async (imageIds) => {
    try {
      const resp = await fetch(`/api/collections/${collectionId}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_ids: imageIds }),
      });
      if (resp.ok) {
        fetchImages();
        fetchCollection();
        setShowImagePicker(false);
      }
    } catch (err) {
      console.error('Failed to add images:', err);
    }
  };

  const handleRemoveImage = async (imageId) => {
    try {
      const resp = await fetch(`/api/collections/${collectionId}/images`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_ids: [imageId] }),
      });
      if (resp.ok) {
        fetchImages();
        fetchCollection();
      }
    } catch (err) {
      console.error('Failed to remove image:', err);
    }
  };

  const navigateToImage = (imageId) => {
    navigate(`/view/${imageId}?project=${projectId}&collection=${collectionId}`);
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <div className="loading-text">Loading collection...</div>
      </div>
    );
  }

  if (error || !collection) {
    return (
      <div className="alert alert-error">
        {error || 'Collection not found'}
      </div>
    );
  }

  const isDraft = collection.phase === 'draft';
  const isReview = collection.phase === 'review';
  const isCertified = collection.phase === 'certified';

  return (
    <div className="collection-detail">
      <div className="collection-detail-header">
        <button
          className="btn btn-secondary btn-small"
          onClick={() => navigate(`/project/${projectId}`)}
        >
          &larr; Back to Project
        </button>
        <div className="collection-detail-title-row">
          <h1>{collection.name}</h1>
          <span className={`phase-badge phase-${collection.phase}`}>
            {PHASE_LABELS[collection.phase]}
          </span>
          <span className={`purpose-badge purpose-${collection.purpose}`}>
            {collection.purpose}
          </span>
        </div>
        {collection.description && (
          <p className="collection-detail-desc">{collection.description}</p>
        )}
      </div>

      <CollectionPhaseControls
        collection={collection}
        onPhaseChanged={handlePhaseChanged}
        onCertify={() => {}}
      />

      {(isReview || isCertified) && (
        <ReviewProgressBar progress={progress} />
      )}

      {isReview && (
        <CertificationPanel
          collection={collection}
          onCertified={handleCertified}
        />
      )}

      {isCertified && collection.certified_at && (
        <CertificationPanel collection={collection} />
      )}

      {isDraft && (
        <div className="collection-draft-controls">
          <h3>Manage Images</h3>
          <div className="collection-image-actions">
            <button
              className="btn btn-primary btn-small"
              onClick={() => {
                fetchProjectImages();
                setShowImagePicker(!showImagePicker);
              }}
            >
              {showImagePicker ? 'Close Picker' : 'Add Images from Project'}
            </button>
          </div>
          {showImagePicker && (
            <div className="image-picker">
              <p>Select images to add:</p>
              <div className="image-picker-grid">
                {projectImages.map(img => {
                  const inCollection = images.some(ci => ci.id === img.id);
                  return (
                    <div
                      key={img.id}
                      className={`image-picker-item ${inCollection ? 'in-collection' : ''}`}
                      onClick={() => !inCollection && handleAddImages([img.id])}
                      title={inCollection ? 'Already in collection' : 'Click to add'}
                    >
                      <span className="image-picker-name">{img.filename}</span>
                      {inCollection && <span className="image-picker-check">Added</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="collection-images">
        <h3>Images ({images.length})</h3>
        {images.length === 0 ? (
          <p>No images in this collection yet.</p>
        ) : (
          <div className="collection-image-grid">
            {images.map(img => (
              <div
                key={img.id}
                className="collection-image-card"
                onClick={() => navigateToImage(img.id)}
              >
                <span className="collection-image-name">{img.filename}</span>
                {isDraft && (
                  <button
                    className="btn btn-small btn-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveImage(img.id);
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default CollectionDetail;
