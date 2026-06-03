import React, { useState, useCallback, useRef } from 'react';
import FilenameMetadataExtractor from './FilenameMetadataExtractor';

const CONCURRENT_UPLOADS = 6;
const S3_IMPORT_LIMIT = 100;

const ASSOCIATED_METADATA_EXTENSIONS = ['.json', '.nsipro'];

function getFileExtension(filename = '') {
  const normalized = String(filename).toLowerCase();
  const dotIndex = normalized.lastIndexOf('.');
  return dotIndex >= 0 ? normalized.slice(dotIndex) : '';
}

function safeMetadataReferenceName(filename = '') {
  return String(filename || 'metadata')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'metadata';
}

function stableStringHash(value = '') {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) + value.charCodeAt(index);
    hash >>>= 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function parseScalarMetadataValue(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^null$/i.test(value)) return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  try {
    return JSON.parse(value);
  } catch (err) {
    return value.replace(/^['"]|['"]$/g, '');
  }
}

function parseNsiproKeyValueText(text) {
  const root = {};
  let currentSection = root;
  String(text || '').split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';') || line.startsWith('//')) return;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const sectionName = sectionMatch[1].trim();
      if (!sectionName) return;
      if (!root[sectionName] || typeof root[sectionName] !== 'object') root[sectionName] = {};
      currentSection = root[sectionName];
      return;
    }
    const delimiterIndex = ['=', ':']
      .map((delimiter) => line.indexOf(delimiter))
      .filter((index) => index > 0)
      .sort((left, right) => left - right)[0];
    if (!delimiterIndex) return;
    const key = line.slice(0, delimiterIndex).trim();
    if (!key) return;
    currentSection[key] = parseScalarMetadataValue(line.slice(delimiterIndex + 1));
  });
  if (Object.keys(root).length === 0) {
    throw new Error('No metadata entries were found in the .nsipro file.');
  }
  return root;
}

export function parseAssociatedMetadataText(text, filename = '') {
  const extension = getFileExtension(filename);
  if (!ASSOCIATED_METADATA_EXTENSIONS.includes(extension)) {
    throw new Error('Unsupported metadata file type. Choose a .json or .nsipro file.');
  }

  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('Metadata file is empty.');
  }

  if (extension === '.json') {
    try {
      return { parser: 'json', metadata: JSON.parse(trimmed) };
    } catch (err) {
      throw new Error('Invalid JSON metadata file.');
    }
  }

  try {
    return { parser: 'nsipro-json', metadata: JSON.parse(trimmed) };
  } catch (jsonError) {
    return { parser: 'nsipro-key-value', metadata: parseNsiproKeyValueText(trimmed) };
  }
}


function readAssociatedMetadataFileText(file) {
  if (file && typeof file.text === 'function') {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Unable to read metadata file.'));
    reader.readAsText(file);
  });
}

function buildAssociatedMetadataBundle(file, text, parsedResult) {
  const extension = getFileExtension(file?.name);
  const contentHash = stableStringHash(`${file?.name || ''}\n${text}`);
  const key = `associated_upload_metadata:${safeMetadataReferenceName(file?.name)}:${contentHash}`;
  return {
    key,
    value: {
      kind: 'associated_image_upload_metadata',
      filename: file?.name || 'metadata',
      file_type: extension.replace(/^\./, ''),
      parser: parsedResult.parser,
      content_hash: contentHash,
      size_bytes: typeof file?.size === 'number' ? file.size : text.length,
      metadata: parsedResult.metadata,
    },
  };
}

function buildAssociatedMetadataImageReference(bundle) {
  if (!bundle?.key || !bundle?.value) return null;
  return {
    reference_type: 'project_metadata',
    project_metadata_key: bundle.key,
    filename: bundle.value.filename,
    file_type: bundle.value.file_type,
    parser: bundle.value.parser,
    content_hash: bundle.value.content_hash,
  };
}

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
  const [associatedMetadataFile, setAssociatedMetadataFile] = useState(null);
  const [associatedMetadataBundle, setAssociatedMetadataBundle] = useState(null);
  const [associatedMetadataParsing, setAssociatedMetadataParsing] = useState(false);
  const [associatedMetadataError, setAssociatedMetadataError] = useState(null);
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
  const [s3Url, setS3Url] = useState('');
  const [s3Objects, setS3Objects] = useState([]);
  const [selectedS3Keys, setSelectedS3Keys] = useState([]);
  const [loadingS3Files, setLoadingS3Files] = useState(false);
  const [importingS3Files, setImportingS3Files] = useState(false);
  const [s3PickerOpen, setS3PickerOpen] = useState(false);
  const cancelledRef = useRef(false);

  const extractorPreviewFiles = selectedFiles.length > 0
    ? selectedFiles
    : s3Objects.map((object) => ({ name: object.filename || object.key }));

  const handleExtractorChange = useCallback((config) => {
    setExtractorConfig(config);
    // If selected group key is no longer in the keys list, clear it
    if (groupKey && config.keys && !config.keys.includes(groupKey)) {
      setGroupKey('');
    }
  }, [groupKey]);

  const handleAssociatedMetadataFileChange = async (e) => {
    const file = e.target.files && e.target.files[0];
    setAssociatedMetadataFile(file || null);
    setAssociatedMetadataBundle(null);
    setAssociatedMetadataError(null);
    if (!file) return;

    if (!ASSOCIATED_METADATA_EXTENSIONS.includes(getFileExtension(file.name))) {
      setAssociatedMetadataError('Unsupported metadata file type. Choose a .json or .nsipro file.');
      return;
    }

    setAssociatedMetadataParsing(true);
    try {
      const text = await readAssociatedMetadataFileText(file);
      const parsedResult = parseAssociatedMetadataText(text, file.name);
      setAssociatedMetadataBundle(buildAssociatedMetadataBundle(file, text, parsedResult));
    } catch (err) {
      setAssociatedMetadataError(err?.message || 'Unable to parse associated metadata file.');
    } finally {
      setAssociatedMetadataParsing(false);
    }
  };

  const saveAssociatedMetadataBundle = useCallback(async () => {
    if (!associatedMetadataFile) return null;
    if (associatedMetadataParsing) {
      throw new Error('Associated metadata file is still being parsed.');
    }
    if (associatedMetadataError || !associatedMetadataBundle) {
      throw new Error(associatedMetadataError || 'Associated metadata file could not be parsed.');
    }

    const response = await fetch(`/api/projects/${projectId}/metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: associatedMetadataBundle.key,
        value: associatedMetadataBundle.value,
      }),
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
    return buildAssociatedMetadataImageReference(associatedMetadataBundle);
  }, [associatedMetadataBundle, associatedMetadataError, associatedMetadataFile, associatedMetadataParsing, projectId]);

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

    let associatedMetadataReference = null;
    if (associatedMetadataFile) {
      try {
        associatedMetadataReference = await saveAssociatedMetadataBundle();
      } catch (err) {
        const detail = err?.message ? ` ${err.message}` : '';
        setError(`Unable to associate metadata file.${detail}`);
        setUploadProgress(null);
        setUploading(false);
        return;
      }
    }
    

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
        const metadataWithAssociatedReference = associatedMetadataReference
          ? {
            ...(mergedMetadata || {}),
            associated_metadata_ref: associatedMetadataReference.project_metadata_key,
            associated_metadata: associatedMetadataReference,
          }
          : mergedMetadata;
        const hierarchyMetadata = normalizeHierarchyMetadata(metadataWithAssociatedReference);
        const metadataForUpload = hierarchyMetadata
          ? { ...metadataWithAssociatedReference, ...hierarchyMetadata }
          : metadataWithAssociatedReference;

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

  const getMergedMetadataForName = useCallback((filename, manualMetadata, associatedMetadataReference = null) => {
    const extractedMetadata = extractorConfig.extractMetadata(filename);
    const mergedMetadata = (extractedMetadata || manualMetadata)
      ? { ...(extractedMetadata || {}), ...(manualMetadata || {}) }
      : null;
    const metadataWithAssociatedReference = associatedMetadataReference
      ? {
        ...(mergedMetadata || {}),
        associated_metadata_ref: associatedMetadataReference.project_metadata_key,
        associated_metadata: associatedMetadataReference,
      }
      : mergedMetadata;
    const hierarchyMetadata = normalizeHierarchyMetadata(metadataWithAssociatedReference);
    return hierarchyMetadata
      ? { ...metadataWithAssociatedReference, ...hierarchyMetadata }
      : metadataWithAssociatedReference;
  }, [extractorConfig]);

  const parseManualMetadata = () => {
    if (!uploadMetadata.trim()) return null;
    try {
      return JSON.parse(uploadMetadata);
    } catch (err) {
      setError('Invalid JSON format for metadata.');
      return undefined;
    }
  };

  const handleLoadS3Files = async () => {
    if (!s3Url.trim()) {
      setError('Please specify an S3 URL.');
      return;
    }
    setLoadingS3Files(true);
    setS3Objects([]);
    setSelectedS3Keys([]);
    setS3PickerOpen(false);
    try {
      const response = await fetch(`/api/projects/${projectId}/s3/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s3_url: s3Url.trim() }),
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
      const objects = payload.objects || [];
      setS3Objects(objects);
      setSelectedS3Keys(objects.map((object) => object.key).slice(0, S3_IMPORT_LIMIT));
      setS3PickerOpen(true);
      setError(objects.length ? null : 'No supported files were found at that S3 URL.');
    } catch (err) {
      const detail = err?.message ? ` ${err.message}` : '';
      setError(`Failed to load files from S3.${detail}`);
    } finally {
      setLoadingS3Files(false);
    }
  };

  const handleToggleS3Key = (key) => {
    setSelectedS3Keys((current) => (
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key].slice(0, S3_IMPORT_LIMIT)
    ));
  };

  const handleToggleAllS3Keys = () => {
    setSelectedS3Keys((current) => (
      current.length === s3Objects.length
        ? []
        : s3Objects.map((object) => object.key).slice(0, S3_IMPORT_LIMIT)
    ));
  };

  const handleImportS3Files = async () => {
    if (selectedS3Keys.length === 0) {
      setError('Please choose at least one S3 file to load.');
      return;
    }
    if (!extractorConfig.isValid) {
      setError('Filename metadata extractor has errors. Please fix them before loading S3 files.');
      return;
    }
    const manualMetadata = parseManualMetadata();
    if (manualMetadata === undefined) return;

    let associatedMetadataReference = null;
    if (associatedMetadataFile) {
      try {
        associatedMetadataReference = await saveAssociatedMetadataBundle();
      } catch (err) {
        const detail = err?.message ? ` ${err.message}` : '';
        setError(`Unable to associate metadata file.${detail}`);
        return;
      }
    }

    setImportingS3Files(true);
    setUploadProgress({ completed: 0, failed: 0, total: selectedS3Keys.length });
    try {
      const selectedObjects = s3Objects.filter((object) => selectedS3Keys.includes(object.key));
      const perFileMetadata = {};
      const groupIdentifiers = {};
      selectedObjects.forEach((object) => {
        const metadataForUpload = getMergedMetadataForName(object.filename, manualMetadata, associatedMetadataReference);
        if (metadataForUpload) {
          perFileMetadata[object.key] = metadataForUpload;
        }
        const extractedMetadata = extractorConfig.extractMetadata(object.filename);
        if (groupKey && extractedMetadata && extractedMetadata[groupKey]) {
          groupIdentifiers[object.key] = extractedMetadata[groupKey];
        }
      });

      const response = await fetch(`/api/projects/${projectId}/s3/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          s3_url: s3Url.trim(),
          keys: selectedS3Keys,
          per_file_metadata: perFileMetadata,
          group_identifiers: groupIdentifiers,
        }),
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
      const imported = payload.imported || [];
      const failed = payload.failed || [];
      setUploadProgress({ completed: imported.length + failed.length, failed: failed.length, total: selectedS3Keys.length });

      let ingestError = null;
      const uploadedRecords = selectedObjects
        .map((object) => {
          const image = imported.find((item) => item.metadata?.source_s3_key === object.key)
            || imported.find((item) => item.filename === object.filename);
          if (!image) return null;
          return {
            image,
            filename: object.filename,
            metadata: perFileMetadata[object.key] || {},
          };
        })
        .filter(Boolean);
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
          console.error('Error ingesting S3-loaded images as inspection parts:', err);
        }
      }

      if (imported.length > 0 && onUploadComplete) {
        onUploadComplete(imported);
      }
      if (failed.length > 0) {
        setError(`S3 load complete: ${imported.length} succeeded, ${failed.length} failed out of ${selectedS3Keys.length}.`);
      } else if (ingestError) {
        setError('S3 files loaded, but parts could not be created from filename metadata.');
      } else {
        setError(null);
      }
      setS3PickerOpen(false);
      setSelectedS3Keys([]);
    } catch (err) {
      const detail = err?.message ? ` ${err.message}` : '';
      setError(`Failed to import selected S3 files.${detail}`);
    } finally {
      setImportingS3Files(false);
      setUploadProgress(null);
    }
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

          <div className="form-group" style={{ marginTop: '16px' }}>
            <label htmlFor="s3-url-input">S3 URL (Optional)</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                id="s3-url-input"
                type="text"
                className="form-control"
                placeholder="s3://bucket/path/to/files/"
                value={s3Url}
                onChange={(e) => setS3Url(e.target.value)}
                disabled={uploading || loadingTestData || loadingS3Files || importingS3Files}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleLoadS3Files}
                disabled={uploading || loadingTestData || loadingS3Files || importingS3Files}
              >
                {loadingS3Files ? 'Loading S3 Files...' : 'Load Files from S3'}
              </button>
            </div>
            <small className="form-text">
              Enter an s3:// bucket or prefix, then choose which files to load into this project.
            </small>
          </div>

          {s3PickerOpen && (
            <div className="card" style={{ margin: '12px 0', border: '1px solid #dee2e6' }} data-testid="s3-file-picker">
              <div className="card-header">
                <h3 style={{ margin: 0 }}>Choose S3 Files</h3>
              </div>
              <div className="card-content">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span>{selectedS3Keys.length} / {s3Objects.length} selected</span>
                  <button type="button" className="btn btn-secondary" onClick={handleToggleAllS3Keys}>
                    {selectedS3Keys.length === s3Objects.length ? 'Clear Selection' : 'Select All'}
                  </button>
                </div>
                <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid #e9ecef', borderRadius: '4px' }}>
                  {s3Objects.map((object) => (
                    <label
                      key={object.key}
                      style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '8px', borderBottom: '1px solid #f1f3f5' }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedS3Keys.includes(object.key)}
                        onChange={() => handleToggleS3Key(object.key)}
                      />
                      <span style={{ flex: 1 }}>
                        <strong>{object.filename}</strong>
                        <br />
                        <small>{object.key} · {object.size || 0} bytes</small>
                      </span>
                    </label>
                  ))}
                </div>
                <div style={{ marginTop: '12px' }}>
                  <button
                    type="button"
                    className="btn btn-success"
                    onClick={handleImportS3Files}
                    disabled={importingS3Files || selectedS3Keys.length === 0 || !extractorConfig.isValid}
                  >
                    {importingS3Files ? 'Loading Selected S3 Files...' : 'Load Selected S3 Files'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ marginLeft: '8px' }}
                    onClick={() => setS3PickerOpen(false)}
                    disabled={importingS3Files}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          <FilenameMetadataExtractor
            files={extractorPreviewFiles}
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
            <fieldset className="metadata-association-section" style={{ border: '1px solid #e9ecef', borderRadius: '4px', padding: '12px' }}>
              <legend style={{ fontSize: '1rem', fontWeight: 600, padding: '0 4px' }}>Associate Metadata</legend>
              <label htmlFor="associated-metadata-input">Metadata File (Optional)</label>
              <input
                id="associated-metadata-input"
                type="file"
                accept=".json,.nsipro,application/json"
                onChange={handleAssociatedMetadataFileChange}
              />
              <small className="form-text">
                Choose one .json or .nsipro file after selecting images. VISTA stores the parsed file once as project metadata and adds a reference to every uploaded image.
              </small>
              {associatedMetadataParsing && (
                <div className="form-text" role="status">Parsing associated metadata…</div>
              )}
              {associatedMetadataBundle && !associatedMetadataError && (
                <div className="form-text" role="status">
                  Associated {associatedMetadataBundle.value.filename} as {associatedMetadataBundle.key}.
                </div>
              )}
              {associatedMetadataError && (
                <div className="alert alert-danger" role="alert">{associatedMetadataError}</div>
              )}
            </fieldset>
          </div>

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
              disabled={uploading || loadingTestData || !extractorConfig.isValid || associatedMetadataParsing || Boolean(associatedMetadataError)}
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
