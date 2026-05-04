/**
 * Shared gallery filter, sort, and state persistence utilities.
 *
 * Used by ImageGallery (to persist/restore controls) and ImageView (to apply
 * the same filter/sort when building the prev/next navigation list).
 */

const STORAGE_PREFIX = 'gallery_state_';
const MAX_ENTRIES = 100;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const GALLERY_STATE_DEFAULTS = {
  viewMode: 'grid',
  thumbnailSize: 220,
  sortBy: 'date',
  searchField: 'filename',
  searchValue: '',
  reviewFilter: 'all',
};

/**
 * Load saved gallery state from localStorage for a given key.
 * Returns an empty object on missing or corrupt data.
 * Updates the lastAccessed timestamp so active entries are not evicted.
 */
function loadGalleryState(key) {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Touch the entry to keep it alive
    parsed.lastAccessed = Date.now();
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(parsed));
    // Strip internal bookkeeping from the returned state
    const { lastAccessed, ...state } = parsed;
    return state;
  } catch (e) {
    return {};
  }
}

/**
 * Load saved gallery state merged with defaults.
 * Every field is guaranteed to have a value.
 * Migrates legacy viewMode values ('small', 'medium', 'large') to 'grid' + thumbnailSize.
 */
function loadGalleryStateWithDefaults(key) {
  const saved = loadGalleryState(key);
  const merged = { ...GALLERY_STATE_DEFAULTS, ...saved };

  // Migrate old named viewMode values to 'grid' + thumbnailSize
  const legacySizeMap = { small: 150, medium: 220, large: 300 };
  if (legacySizeMap[merged.viewMode] !== undefined) {
    if (saved.thumbnailSize === undefined) {
      merged.thumbnailSize = legacySizeMap[merged.viewMode];
    }
    merged.viewMode = 'grid';
  }

  // Clamp thumbnailSize to the supported slider range
  const size = Number(merged.thumbnailSize);
  if (!Number.isFinite(size) || size < 100 || size > 500) {
    merged.thumbnailSize = GALLERY_STATE_DEFAULTS.thumbnailSize;
  } else {
    merged.thumbnailSize = size;
  }

  return merged;
}

/**
 * Persist gallery state to localStorage under the given key.
 * Stamps the entry with a lastAccessed timestamp and runs periodic cleanup.
 */
function saveGalleryState(key, state) {
  try {
    const entry = { ...state, lastAccessed: Date.now() };
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(entry));
    cleanupStaleGalleryStates();
  } catch (e) {
    // Fail closed: if persistence is unavailable, ignore the error.
  }
}

/**
 * Remove gallery state entries that are older than MAX_AGE_MS (30 days).
 * If the total count still exceeds MAX_ENTRIES after age-based eviction,
 * drop the oldest entries until under the cap.
 */
function cleanupStaleGalleryStates() {
  try {
    const now = Date.now();
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(STORAGE_PREFIX)) continue;
      let lastAccessed = 0;
      try {
        const parsed = JSON.parse(localStorage.getItem(k));
        lastAccessed = parsed && parsed.lastAccessed ? parsed.lastAccessed : 0;
      } catch (_) {
        // Corrupt entry -- treat as oldest so it gets evicted.
      }
      entries.push({ key: k, lastAccessed });
    }

    // Phase 1: evict entries older than MAX_AGE_MS
    const staleKeys = entries
      .filter(e => now - e.lastAccessed > MAX_AGE_MS)
      .map(e => e.key);
    staleKeys.forEach(k => localStorage.removeItem(k));

    // Phase 2: if still over the cap, evict oldest entries
    const remaining = entries
      .filter(e => !staleKeys.includes(e.key))
      .sort((a, b) => a.lastAccessed - b.lastAccessed);
    while (remaining.length > MAX_ENTRIES) {
      const evict = remaining.shift();
      localStorage.removeItem(evict.key);
    }
  } catch (e) {
    // Non-critical -- don't block save on cleanup failure.
  }
}

/**
 * Return true if a search term matches the image according to the field.
 */
function imageMatchesSearch(image, searchField, searchLower) {
  switch (searchField) {
    case 'filename':
      return (image.filename || '').toLowerCase().includes(searchLower);
    case 'content_type':
      return (image.content_type || '').toLowerCase().includes(searchLower);
    case 'uploaded_by':
      return (image.uploaded_by_user_id || '').toLowerCase().includes(searchLower);
    case 'metadata': {
      const meta = image.metadata || image.metadata_;
      if (!meta) return false;
      return Object.values(meta).some(v =>
        String(v).toLowerCase().includes(searchLower)
      );
    }
    default: {
      const meta = image.metadata || image.metadata_;
      if (!meta) return false;
      const value = meta[searchField];
      if (value === null || typeof value === 'undefined') return false;
      return String(value).toLowerCase().includes(searchLower);
    }
  }
}

/**
 * Filter an array of images by search field/value.
 * Returns the original array when there is nothing to filter.
 */
function filterBySearch(images, searchField, searchValue) {
  if (!searchValue || !searchField) return images;
  const searchLower = searchValue.toLowerCase();
  return images.filter(img => imageMatchesSearch(img, searchField, searchLower));
}

/**
 * Filter images by review status using a pre-fetched status map.
 * `reviewStatuses` is an object mapping image id -> status string.
 */
function filterByReviewStatus(images, reviewFilter, reviewStatuses) {
  // If no specific review filter is requested, or filter is "all", do nothing.
  if (!reviewFilter || reviewFilter === 'all') return images;
  // If a filter is active but no statuses are available (e.g., fetch failed),
  // skip review-based filtering rather than treating all as "unreviewed".
  if (!reviewStatuses) return images;
  return images.filter(img => {
    const status = reviewStatuses[img.id] || 'unreviewed';
    return status === reviewFilter;
  });
}

/**
 * Sort a copy of the images array by the given sort key.
 */
function sortImages(images, sortBy) {
  return [...images].sort((a, b) => {
    switch (sortBy) {
      case 'name':
        return (a.filename || '').localeCompare(b.filename || '', undefined, { numeric: true, sensitivity: 'base' });
      case 'size':
        return (b.size_bytes || 0) - (a.size_bytes || 0);
      case 'date':
      default:
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    }
  });
}

/**
 * Apply the full filter-then-sort pipeline in one call.
 * `reviewStatuses` may be null/undefined when no review filter is active.
 */
function applyGalleryFilters(images, { searchField, searchValue, reviewFilter, sortBy, reviewStatuses }) {
  let result = filterBySearch(images, searchField, searchValue);
  result = filterByReviewStatus(result, reviewFilter, reviewStatuses);
  result = sortImages(result, sortBy || 'date');
  return result;
}

export {
  GALLERY_STATE_DEFAULTS,
  STORAGE_PREFIX,
  MAX_ENTRIES,
  MAX_AGE_MS,
  loadGalleryState,
  loadGalleryStateWithDefaults,
  saveGalleryState,
  cleanupStaleGalleryStates,
  filterBySearch,
  filterByReviewStatus,
  sortImages,
  applyGalleryFilters,
};
