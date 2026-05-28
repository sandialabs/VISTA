import React, { useState, useCallback, useRef } from 'react';
import FilenameMetadataExtractor from './FilenameMetadataExtractor';

const CONCURRENT_UPLOADS = 6;
const HIERARCHY_KEYS = [
  'design_number',
  'lot_number',
  'serial_number',
  'side',
  'modality',
  'overlay',
];

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return ['true', '1', 'yes', 'y'].includes(value.trim().toLowerCase());
}

function firstNonEmptyValue(candidate, keys) {
  for (const key of keys) {
    const value = candidate?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return '';
}

function normalizeHierarchyMetadata(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const normalized = {
    ...candidate,
    design_number: String(firstNonEmptyValue(candidate, ['design_number', 'drawing_number', 'drawing', 'design'])).trim(),
    lot_number: String(firstNonEmptyValue(candidate, ['lot_number', 'lot'])).trim(),
    set_number: String(firstNonEmptyValue(candidate, ['set_number', 'part_number', 'part', 'part_group'])).trim(),
    batch_number: String(firstNonEmptyValue(candidate, ['batch_number', 'batch'])).trim(),
    serial_number: String(firstNonEmptyValue(candidate, ['serial_number', 'serial', 'sn'])).trim(),
    side: String(firstNonEmptyValue(candidate, ['side', 'side_identifier', 'view', 'view_name'])).trim().toLowerCase(),
    modality: String(firstNonEmptyValue(candidate, ['modality', 'image_modality'])).trim().toLowerCase(),
    overlay: normalizeBoolean(candidate.overlay),
  };
  const hasRequiredHierarchy = HIERARCHY_KEYS
    .filter((key) => key !== 'overlay')
    .every((key) => normalized[key]);
  if (!hasRequiredHierarchy || (!normalized.set_number && !normalized.batch_number)) return null;
  if (!normalized.set_number) delete normalized.set_number;
  if (!normalized.batch_number) delete normalized.batch_number;
  return normalized;
}

export function buildInspectionPartIngestPayload(uploadedRecords) {
  const partsByKey = new Map();
  const volumePartsByKey = new Map();

  uploadedRecords.forEach((record) => {
    const metadata = normalizeHierarchyMetadata(record.metadata);
    if (!metadata) {
      const recordMetadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {};
      const volumeStackId = String(recordMetadata.volume_stack_id || '').trim();
      const filename = record.image?.filename || record.filename;
      if (!volumeStackId || !filename) return;
      if (!volumePartsByKey.has(volumeStackId)) {
        volumePartsByKey.set(volumeStackId, {
          batchName: `PT3_${volumeStackId}`,
          batchDescription: `PT3 stack ${volumeStackId}`,
          serialNumber: String(recordMetadata.serial_number || volumeStackId),
          displayName: String(recordMetadata.display_name || `PT3 stack ${volumeStackId}`),
          metadata: {
            source: recordMetadata.source || 'manual-build-it',
            project_type: 'PT3',
            volume_stack_id: volumeStackId,
            source_images: [],
          },
        });
      }
      const volumePart = volumePartsByKey.get(volumeStackId);
      volumePart.metadata.source_images.push({
        filename,
        image_id: record.image?.id || null,
        slice_axis: recordMetadata.slice_axis || null,
        slice_index: typeof recordMetadata.slice_index === 'number' ? recordMetadata.slice_index : null,
        modality: recordMetadata.modality || null,
        overlay: normalizeBoolean(recordMetadata.overlay),
      });
      return;
    }

    const partGroupNumber = metadata.set_number || metadata.batch_number;
    const batchName = metadata.batch_number
      ? [
        metadata.design_number,
        metadata.lot_number,
        metadata.batch_number,
      ].join('_')
      : null;
    const partKey = [
      metadata.design_number,
      metadata.lot_number,
      partGroupNumber,
      metadata.serial_number,
    ].join('_');
    const filename = record.image?.filename || record.filename;
    if (!filename) return;

    if (!partsByKey.has(partKey)) {
      partsByKey.set(partKey, {
        batchName,
        batchDescription: metadata.batch_number
          ? `Design ${metadata.design_number}, lot ${metadata.lot_number}, batch ${metadata.batch_number}`
          : null,
        serialNumber: metadata.serial_number,
        displayName: `${metadata.design_number} ${metadata.lot_number} ${partGroupNumber} ${metadata.serial_number}`,
        metadata: {
          design_number: metadata.design_number,
          lot_number: metadata.lot_number,
          serial_number: metadata.serial_number,
          configured_views: [],
          modalities: [],
          view_images: {},
          overlay_images: {},
          source_images: [],
        },
      });
      if (metadata.set_number) {
        partsByKey.get(partKey).metadata.set_number = metadata.set_number;
      }
      if (metadata.batch_number) {
        partsByKey.get(partKey).metadata.batch_number = metadata.batch_number;
      }
    }

    const part = partsByKey.get(partKey);
    const side = metadata.side;
    const modality = metadata.modality;
    if (!part.metadata.configured_views.includes(side)) {
      part.metadata.configured_views.push(side);
    }
    if (!part.metadata.modalities.includes(modality)) {
      part.metadata.modalities.push(modality);
    }
    part.metadata.source_images.push({
      filename,
      side,
      modality,
      overlay: metadata.overlay,
      image_id: record.image?.id || null,
    });
    if (metadata.overlay) {
      part.metadata.overlay_images[side] = {
        ...(part.metadata.overlay_images[side] || {}),
        [modality]: filename,
      };
    } else if (!part.metadata.view_images[side]) {
      part.metadata.view_images[side] = filename;
    }
  });

  const batchesByName = new Map();
  const unassignedParts = [];
  [...Array.from(partsByKey.values()), ...Array.from(volumePartsByKey.values())].forEach((part) => {
    if (part.batchName && !batchesByName.has(part.batchName)) {
      batchesByName.set(part.batchName, {
        name: part.batchName,
        description: part.batchDescription,
        parts: [],
      });
    }
    if (Array.isArray(part.metadata.configured_views)) {
      part.metadata.configured_views.sort();
    }
    if (Array.isArray(part.metadata.modalities)) {
      part.metadata.modalities.sort();
    }
    const ingestPart = {
      serial_number: part.serialNumber,
      display_name: part.displayName,
      metadata: part.metadata,
    };
    if (part.batchName) {
      batchesByName.get(part.batchName).parts.push(ingestPart);
    } else {
      unassignedParts.push(ingestPart);
    }
  });

  const batches = Array.from(batchesByName.values()).map((batch) => ({
    ...batch,
    parts: batch.parts.sort((left, right) => left.serial_number.localeCompare(right.serial_number)),
  }));

  return {
    batches,
    unassigned_parts: unassignedParts.sort((left, right) => (
      left.serial_number.localeCompare(right.serial_number)
    )),
  };
}

function ImageUploader({ projectId, projectType = 'PT1', projectConfiguration = null, onUploadComplete, setError }) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadMetadata, setUploadMetadata] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [extractorConfig, setExtractorConfig] = useState({
    isValid: true,
    hasPattern: false,
    extractMetadata: () => null,
    keys: [],
  });
  const [groupKey, setGroupKey] = useState('');
  const [uploading, setUploading] = useState(false);
  const [loadingTestData, setLoadingTestData] = useState(false);
  const [testDataResult, setTestDataResult] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const cancelledRef = useRef(false);

  const handleExtractorChange = useCallback((config) => {
    setExtractorConfig(config);
    // If selected group key is no longer in the keys list, clear it
    if (groupKey && config.keys && !config.keys.includes(groupKey)) {
      setGroupKey('');
    }
  }, [groupKey]);

  // Handle file input change
  const handleFileChange = (e) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  // Handle drag and drop events
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) {
      setSelectedFiles(Array.from(e.dataTransfer.files));
    }
  };

  // Handle file upload
  const handleUpload = async (e) => {
    e.preventDefault();
    
    if (selectedFiles.length === 0) {
      setError('Please select at least one file to upload.');
      return;
    }

    // Block upload when the extractor configuration is invalid.
    if (!extractorConfig.isValid) {
      setError('Filename metadata extractor has errors. Please fix them before uploading.');
      return;
    }
    
    // Validate manual metadata JSON if provided
    let manualMetadata = null;
    if (uploadMetadata.trim()) {
      try {
        manualMetadata = JSON.parse(uploadMetadata);
      } catch (err) {
        setError('Invalid JSON format for metadata.');
        return;
      }
    }
    
    setUploading(true);
    cancelledRef.current = false;
    const total = selectedFiles.length;
    setUploadProgress({ completed: 0, failed: 0, total });

    const results = [];
    const uploadedRecords = [];
    let completed = 0;
    let failed = 0;

    // Upload files with bounded concurrency
    const queue = [...selectedFiles];
    const uploadOne = async () => {
      while (queue.length > 0) {
        if (cancelledRef.current) return;
        const file = queue.shift();
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        const extractedMetadata = extractorConfig.extractMetadata(file.name);
        const mergedMetadata = (extractedMetadata || manualMetadata)
          ? { ...(extractedMetadata || {}), ...(manualMetadata || {}) }
          : null;
        const hierarchyMetadata = normalizeHierarchyMetadata(mergedMetadata);
        const metadataForUpload = hierarchyMetadata
          ? { ...mergedMetadata, ...hierarchyMetadata }
          : mergedMetadata;

        if (metadataForUpload) {
          formData.append('metadata', JSON.stringify(metadataForUpload));
        }

        if (groupKey && extractedMetadata && extractedMetadata[groupKey]) {
          formData.append('group_identifier', extractedMetadata[groupKey]);
        }

        try {
          const response = await fetch(`/api/projects/${projectId}/images`, {
            method: 'POST',
            body: formData,
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const uploadedImage = await response.json();
          results.push(uploadedImage);
          uploadedRecords.push({
            image: uploadedImage,
            filename: file.name,
            metadata: metadataForUpload || {},
          });
        } catch (err) {
          console.error(`Error uploading ${file.name}:`, err);
          failed += 1;
        }
        completed += 1;
        setUploadProgress({ completed, failed, total });
      }
    };

    const workers = Array.from(
      { length: Math.min(CONCURRENT_UPLOADS, total) },
      () => uploadOne()
    );
    await Promise.all(workers);

    let ingestError = null;
    const ingestPayload = buildInspectionPartIngestPayload(uploadedRecords);
    const partCount = ingestPayload.batches.reduce((acc, batch) => acc + batch.parts.length, 0)
      + ingestPayload.unassigned_parts.length;
    if (partCount > 0) {
      try {
        const ingestResponse = await fetch(`/api/projects/${projectId}/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ingestPayload),
        });
        if (!ingestResponse.ok) {
          throw new Error(`HTTP ${ingestResponse.status}`);
        }
      } catch (err) {
        ingestError = err;
        console.error('Error ingesting uploaded images as inspection parts:', err);
      }
    }

    if (results.length > 0) {
      onUploadComplete(results);
    }
    if (failed > 0) {
      setError(`Upload complete: ${results.length} succeeded, ${failed} failed out of ${total}.`);
    } else if (ingestError) {
      setError('Images uploaded, but parts could not be created from filename metadata.');
    } else {
      setError(null);
    }
    setSelectedFiles([]);
    setUploadMetadata('');
    setUploadProgress(null);
    setUploading(false);
  };

  const handleLoadTestData = async () => {
    setLoadingTestData(true);
    setTestDataResult(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/load-test-data`, {
        method: 'POST',
      });
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const payload = await response.json();
          detail = payload?.detail || detail;
        } catch (parseError) {
          detail = response.statusText || detail;
        }
        throw new Error(detail);
      }
      const payload = await response.json();
      setTestDataResult(payload);
      setError(null);
      if (onUploadComplete) {
        onUploadComplete(payload);
      }
    } catch (err) {
      const detail = err?.message ? ` ${err.message}` : '';
      setError(`Failed to load ${projectType || 'project'} test data.${detail}`);
    } finally {
      setLoadingTestData(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Upload Images</h2>
      </div>
      <div className="card-content">
        <form onSubmit={handleUpload}>
          <div 
            className={`upload-area ${isDragOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => document.getElementById('file-input').click()}
          >
            <div className="upload-area-content">
              <div className="upload-area-icon">
                +
              </div>
              <div className="upload-area-text">
                Drag and drop images/voxel data here, or click to select files
              </div>
              <div className="upload-area-subtext">
                Supports image files and 3D voxel arrays (.npy, .npz, .inspiro)
              </div>
              <div className={`upload-area-status ${selectedFiles.length > 0 ? 'has-files' : 'no-files'}`}>
                {selectedFiles.length > 0 
                  ? `${selectedFiles.length} ${selectedFiles.length === 1 ? 'file' : 'files'} selected` 
                  : 'No files selected'}
              </div>
            </div>
            <input 
              type="file" 
              id="file-input" 
              accept="image/*,image/tiff,.tiff,.tif,.npy,.npz,.inspiro" 
              multiple 
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>

          <FilenameMetadataExtractor
            files={selectedFiles}
            onConfigChange={handleExtractorChange}
            fileNamingScheme={projectConfiguration?.file_naming_scheme}
          />

          {extractorConfig.keys && extractorConfig.keys.length > 0 && (
            <div className="form-group">
              <label htmlFor="group-key-select">Use as Group Identifier (Optional)</label>
              <select
                id="group-key-select"
                value={groupKey}
                onChange={(e) => setGroupKey(e.target.value)}
                className="form-control"
              >
                <option value="">-- None --</option>
                {extractorConfig.keys.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              <small className="form-text">
                Select which extracted key to use as the group identifier for each uploaded image.
              </small>
            </div>
          )}
          
          <div className="form-group">
            <label htmlFor="metadata-input">Metadata (Optional JSON)</label>
            <textarea 
              id="metadata-input" 
              rows="3" 
              placeholder='{"key": "value"}'
              value={uploadMetadata}
              onChange={(e) => setUploadMetadata(e.target.value)}
            ></textarea>
          </div>
          
          <div className="form-group">
            <button
              type="submit"
              className="btn btn-success"
              disabled={uploading || loadingTestData || !extractorConfig.isValid}
            >
              {uploading ? 'Uploading...' : 'Upload Images'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginLeft: '8px' }}
              disabled={uploading || loadingTestData}
              onClick={handleLoadTestData}
            >
              {loadingTestData ? 'Loading Test Data...' : 'Load Test Data'}
            </button>
            {uploading && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginLeft: '8px' }}
                onClick={() => { cancelledRef.current = true; }}
              >
                Cancel
              </button>
            )}
          </div>
          {uploadProgress && (
            <div style={{ marginTop: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
                <span>{uploadProgress.completed} / {uploadProgress.total} uploaded</span>
                {uploadProgress.failed > 0 && (
                  <span style={{ color: '#dc3545' }}>{uploadProgress.failed} failed</span>
                )}
              </div>
              <div style={{ width: '100%', height: '8px', backgroundColor: '#e9ecef', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.round((uploadProgress.completed / uploadProgress.total) * 100)}%`,
                    height: '100%',
                    backgroundColor: uploadProgress.failed > 0 ? '#ffc107' : '#28a745',
                    transition: 'width 0.2s',
                  }}
                />
              </div>
            </div>
          )}
          {testDataResult && (
            <div className="alert alert-success" data-testid="load-test-data-result">
              Loaded {testDataResult.images_created || 0} new {projectType || 'project'} test images;
              {' '}
              created {testDataResult.ingest?.counters?.parts_created || 0} parts.
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

export default ImageUploader;
