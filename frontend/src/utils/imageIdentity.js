const TRUE_METADATA_VALUES = new Set(['1', 'true', 'yes', 'y', 'on']);
const FALSE_METADATA_VALUES = new Set(['', '0', 'false', 'no', 'n', 'off']);

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

/**
 * Return the persisted image identity used by the API.
 *
 * Assignment records use `image_id`, while catalog records use `id`. Prefer
 * the assignment field when both are present so an explicit relationship is
 * never silently redirected through another object's id.
 */
export function getCanonicalImageId(image) {
  if (!image || typeof image !== 'object') return '';
  const value = hasValue(image.image_id) ? image.image_id : image.id;
  return hasValue(value) ? String(value).trim() : '';
}

/**
 * Parse boolean-shaped metadata without JavaScript's "false" => true trap.
 * Unknown values use the caller-provided fallback (false by default).
 */
export function parseMetadataBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value !== 0 : Boolean(fallback);
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (TRUE_METADATA_VALUES.has(normalized)) return true;
    if (FALSE_METADATA_VALUES.has(normalized)) return false;
  }
  return Boolean(fallback);
}

/**
 * Add a display-only ordinal immediately before the final file extension.
 */
export function appendFilenameOrdinal(filename, ordinal) {
  const safeFilename = String(filename ?? '');
  const safeOrdinal = Math.max(1, Math.trunc(Number(ordinal) || 1));
  const slashIndex = Math.max(safeFilename.lastIndexOf('/'), safeFilename.lastIndexOf('\\'));
  const dotIndex = safeFilename.lastIndexOf('.');
  if (dotIndex > slashIndex + 1) {
    return `${safeFilename.slice(0, dotIndex)} (${safeOrdinal})${safeFilename.slice(dotIndex)}`;
  }
  return `${safeFilename} (${safeOrdinal})`;
}

function compareForPresentation(left, right) {
  const leftTime = Date.parse(left.image?.created_at || '');
  const rightTime = Date.parse(right.image?.created_at || '');
  const leftHasTime = Number.isFinite(leftTime);
  const rightHasTime = Number.isFinite(rightTime);

  if (leftHasTime && rightHasTime && leftTime !== rightTime) return leftTime - rightTime;
  if (leftHasTime !== rightHasTime) return leftHasTime ? -1 : 1;

  const leftId = getCanonicalImageId(left.image);
  const rightId = getCanonicalImageId(right.image);
  if (leftId !== rightId) {
    if (!leftId) return 1;
    if (!rightId) return -1;
    return leftId.localeCompare(rightId);
  }
  return left.index - right.index;
}

/**
 * Decorate images with collision-safe, display-only duplicate aliases.
 *
 * Exact raw filenames form duplicate groups. Metadata and recognized filename
 * keywords are deliberately ignored. Ranking by created_at and UUID keeps an
 * image's alias stable when paginated results arrive in a different order.
 */
export function assignDuplicateFilenameAliases(images) {
  const source = Array.isArray(images) ? images : [];
  const entries = source.map((image, index) => ({ image, index }));
  const groups = new Map();
  const reservedNames = new Set();

  entries.forEach((entry) => {
    if (!entry.image || typeof entry.image !== 'object') return;
    const filename = String(entry.image.filename ?? '');
    reservedNames.add(filename);
    if (!groups.has(filename)) groups.set(filename, []);
    groups.get(filename).push(entry);
  });

  const aliases = new Map();
  const claimedNames = new Set();
  groups.forEach((group, filename) => {
    const ranked = [...group].sort(compareForPresentation);
    ranked.forEach((entry, occurrence) => {
      let displayName = filename;
      let displayOrdinal = 0;
      if (occurrence > 0) {
        displayOrdinal = occurrence;
        displayName = appendFilenameOrdinal(filename, displayOrdinal);
        while (reservedNames.has(displayName) || claimedNames.has(displayName)) {
          displayOrdinal += 1;
          displayName = appendFilenameOrdinal(filename, displayOrdinal);
        }
      }
      aliases.set(entry.index, {
        displayName,
        duplicateOccurrence: occurrence,
        displayOrdinal,
      });
      claimedNames.add(displayName);
    });
  });

  return source.map((image, index) => {
    if (!image || typeof image !== 'object') return image;
    return {
      ...image,
      ...(aliases.get(index) || {
        displayName: String(image.filename ?? ''),
        duplicateOccurrence: 0,
        displayOrdinal: 0,
      }),
    };
  });
}

function isActiveCatalogImage(image) {
  if (!image || typeof image !== 'object') return false;
  if (image.deleted_at) return false;
  return image.filename !== undefined
    && image.filename !== null
    && String(image.filename) !== '';
}

/**
 * Build the active image catalog without collapsing equal filenames.
 *
 * Repeated rows with the same persisted UUID represent one image and are
 * canonicalized to their first occurrence. Id-less legacy rows remain
 * separate because filename alone is not a safe identity.
 */
export function buildActiveImageCatalog(images) {
  const canonicalImages = [];
  const canonicalInputIndexes = [];
  const seenIds = new Set();

  (Array.isArray(images) ? images : []).forEach((image, inputIndex) => {
    if (!isActiveCatalogImage(image)) return;
    const id = getCanonicalImageId(image);
    if (id && seenIds.has(id)) return;
    if (id) seenIds.add(id);
    canonicalImages.push(image);
    canonicalInputIndexes.push(inputIndex);
  });

  const refs = assignDuplicateFilenameAliases(canonicalImages).map((image, canonicalIndex) => {
    const id = getCanonicalImageId(image);
    const filename = String(image.filename);
    const inputIndex = canonicalInputIndexes[canonicalIndex];
    return {
      ...image,
      key: id || `filename:${filename}:${inputIndex}`,
      id,
      filename,
    };
  });

  const byId = new Map();
  const byFilename = new Map();
  refs.forEach((ref) => {
    if (ref.id) byId.set(ref.id, ref);
    if (!byFilename.has(ref.filename)) byFilename.set(ref.filename, []);
    byFilename.get(ref.filename).push(ref);
  });

  return { refs, byId, byFilename };
}

function resolution(status, match, candidates = []) {
  const ref = status === 'resolved' ? candidates[0] : null;
  return {
    status,
    match,
    ref,
    image: ref,
    candidates,
  };
}

/**
 * Resolve an assignment against an active catalog.
 *
 * A non-empty image_id/id is authoritative. Filename fallback is allowed only
 * for legacy references with no id and only when the exact filename is unique.
 */
export function resolveImageReference(reference, catalog) {
  const safeCatalog = catalog || {};
  const byId = safeCatalog.byId instanceof Map ? safeCatalog.byId : new Map();
  const byFilename = safeCatalog.byFilename instanceof Map ? safeCatalog.byFilename : new Map();
  const explicitId = getCanonicalImageId(reference);

  if (explicitId) {
    const matched = byId.get(explicitId);
    return matched
      ? resolution('resolved', 'id', [matched])
      : resolution('missing', 'id');
  }

  const filename = typeof reference === 'string'
    ? reference
    : String(reference?.filename ?? '');
  if (!filename) return resolution('missing', 'filename');

  const candidates = byFilename.get(filename) || [];
  if (candidates.length === 1) return resolution('resolved', 'filename', candidates);
  if (candidates.length > 1) return resolution('ambiguous', 'filename', candidates);
  return resolution('missing', 'filename');
}
