// Associated metadata-file (.json / .nsipro) parsing helpers used by image uploads.
import { parseNsiproText } from '../metadata/nsiproParsers';

export const ASSOCIATED_METADATA_EXTENSIONS = ['.json', '.nsipro'];

export function getFileExtension(filename = '') {
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

// Associated .nsipro files are decoded in the frontend before upload ingest so
// users get immediate validation feedback and the ingest payload can include the
// parser id/version/hash contract. The backend remains authoritative: ingest
// dereferences associated_metadata_ref from project metadata, validates parser
// contract fields in strict mode, and normalizes the persisted .nsipro payload.
export function parseAssociatedMetadataText(text, filename = '', options = {}) {
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

  return parseNsiproText(trimmed, filename, options);
}

export function isAssociatedMetadataFile(file) {
  return ASSOCIATED_METADATA_EXTENSIONS.includes(getFileExtension(file?.name));
}

export function readAssociatedMetadataFileText(file) {
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

export function buildAssociatedMetadataBundle(file, text, parsedResult) {
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
      parser_id: parsedResult.parser_id,
      requested_parser_id: parsedResult.requested_parser_id,
      parser_version: parsedResult.parser_version,
      parser_hash: parsedResult.parser_hash,
      warnings: Array.isArray(parsedResult.warnings) ? parsedResult.warnings : [],
      source_filename: parsedResult.source_filename || file?.name || 'metadata',
      content_hash: contentHash,
      size_bytes: typeof file?.size === 'number' ? file.size : text.length,
      metadata: parsedResult.metadata,
    },
  };
}

function getRecordNsiproMetadata(recordMetadata) {
  const candidates = [
    recordMetadata?.nsipro_metadata,
    recordMetadata?.nsipro_payload,
    recordMetadata?.associated_metadata?.nsipro_metadata,
    recordMetadata?.associated_metadata?.nsipro_payload,
  ];
  return candidates.find((candidate) => candidate && typeof candidate === 'object') || null;
}

export function getAssociatedMetadataFields(recordMetadata) {
  const fields = {};
  if (recordMetadata?.associated_metadata_ref) {
    fields.associated_metadata_ref = recordMetadata.associated_metadata_ref;
  }
  if (recordMetadata?.associated_metadata && typeof recordMetadata.associated_metadata === 'object') {
    fields.associated_metadata = recordMetadata.associated_metadata;
  }
  return fields;
}

export function getNsiproIngestMetadata(recordMetadata) {
  const nsiproMetadata = getRecordNsiproMetadata(recordMetadata);
  return nsiproMetadata ? { nsipro_metadata: nsiproMetadata } : {};
}

export function buildMetadataWithAssociatedReference(baseMetadata, associatedMetadataReference = null) {
  if (!associatedMetadataReference) return baseMetadata;
  return {
    ...(baseMetadata || {}),
    associated_metadata_ref: associatedMetadataReference.project_metadata_key,
    associated_metadata: associatedMetadataReference,
  };
}

export function buildAssociatedMetadataImageReference(bundle) {
  if (!bundle?.key || !bundle?.value) return null;
  return {
    reference_type: 'project_metadata',
    project_metadata_key: bundle.key,
    filename: bundle.value.filename,
    file_type: bundle.value.file_type,
    parser: bundle.value.parser,
    parser_id: bundle.value.parser_id,
    requested_parser_id: bundle.value.requested_parser_id,
    parser_version: bundle.value.parser_version,
    parser_hash: bundle.value.parser_hash,
    source_filename: bundle.value.source_filename || bundle.value.filename,
    content_hash: bundle.value.content_hash,
  };
}
