import {
  loadGalleryState,
  loadGalleryStateWithDefaults,
  saveGalleryState,
  cleanupStaleGalleryStates,
  filterBySearch,
  filterByReviewStatus,
  sortImages,
  applyGalleryFilters,
  STORAGE_PREFIX,
  MAX_ENTRIES,
  MAX_AGE_MS,
} from '../galleryState';

const mockImages = [
  {
    id: 'img-1',
    filename: 'alpha.jpg',
    size_bytes: 500,
    created_at: '2023-01-01T00:00:00Z',
    content_type: 'image/jpeg',
    uploaded_by_user_id: 'alice@test.com',
    metadata: { color: 'red', location: 'lab-a' },
  },
  {
    id: 'img-2',
    filename: 'bravo.png',
    size_bytes: 2000,
    created_at: '2023-01-03T00:00:00Z',
    content_type: 'image/png',
    uploaded_by_user_id: 'bob@test.com',
    metadata: { color: 'blue', location: 'lab-b' },
  },
  {
    id: 'img-3',
    filename: 'charlie.jpg',
    size_bytes: 1000,
    created_at: '2023-01-02T00:00:00Z',
    content_type: 'image/jpeg',
    uploaded_by_user_id: 'alice@test.com',
  },
];

describe('galleryState utilities', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('loadGalleryState / saveGalleryState', () => {
    test('returns empty object when key does not exist', () => {
      expect(loadGalleryState('nonexistent')).toEqual({});
    });

    test('round-trips state through localStorage', () => {
      const state = { sortBy: 'name', viewMode: 'large' };
      saveGalleryState('my-key', state);
      expect(loadGalleryState('my-key')).toEqual(state);
    });

    test('returns empty object on corrupt JSON', () => {
      localStorage.setItem('gallery_state_bad', '{not json');
      expect(loadGalleryState('bad')).toEqual({});
    });
  });

  describe('loadGalleryStateWithDefaults', () => {
    test('returns defaults when no state is stored', () => {
      const state = loadGalleryStateWithDefaults('no-key');
      expect(state.viewMode).toBe('grid');
      expect(state.thumbnailSize).toBe(220);
      expect(state.sortBy).toBe('date');
    });

    test('merges stored state with defaults', () => {
      saveGalleryState('merge-key', { sortBy: 'name', viewMode: 'grid', thumbnailSize: 300 });
      const state = loadGalleryStateWithDefaults('merge-key');
      expect(state.sortBy).toBe('name');
      expect(state.thumbnailSize).toBe(300);
      expect(state.searchField).toBe('filename');
    });

    test('migrates legacy viewMode small to grid + thumbnailSize 150', () => {
      saveGalleryState('legacy-key', { viewMode: 'small', sortBy: 'name' });
      const state = loadGalleryStateWithDefaults('legacy-key');
      expect(state.viewMode).toBe('grid');
      expect(state.thumbnailSize).toBe(150);
    });

    test('migrates legacy viewMode medium to grid + thumbnailSize 220', () => {
      saveGalleryState('legacy-key', { viewMode: 'medium', sortBy: 'date' });
      const state = loadGalleryStateWithDefaults('legacy-key');
      expect(state.viewMode).toBe('grid');
      expect(state.thumbnailSize).toBe(220);
    });

    test('migrates legacy viewMode large to grid + thumbnailSize 300', () => {
      saveGalleryState('legacy-key', { viewMode: 'large', sortBy: 'size' });
      const state = loadGalleryStateWithDefaults('legacy-key');
      expect(state.viewMode).toBe('grid');
      expect(state.thumbnailSize).toBe(300);
    });

    test('preserves explicit thumbnailSize when migrating legacy viewMode', () => {
      saveGalleryState('legacy-key', { viewMode: 'small', thumbnailSize: 200 });
      const state = loadGalleryStateWithDefaults('legacy-key');
      expect(state.viewMode).toBe('grid');
      expect(state.thumbnailSize).toBe(200);
    });

    test('preserves list viewMode without migration', () => {
      saveGalleryState('list-key', { viewMode: 'list' });
      const state = loadGalleryStateWithDefaults('list-key');
      expect(state.viewMode).toBe('list');
    });

    test('clamps thumbnailSize below minimum to default', () => {
      saveGalleryState('clamp-key', { viewMode: 'grid', thumbnailSize: 0 });
      const state = loadGalleryStateWithDefaults('clamp-key');
      expect(state.thumbnailSize).toBe(220);
    });

    test('clamps thumbnailSize above maximum to default', () => {
      saveGalleryState('clamp-key', { viewMode: 'grid', thumbnailSize: 9999 });
      const state = loadGalleryStateWithDefaults('clamp-key');
      expect(state.thumbnailSize).toBe(220);
    });

    test('falls back to default for non-numeric thumbnailSize', () => {
      saveGalleryState('clamp-key', { viewMode: 'grid', thumbnailSize: 'big' });
      const state = loadGalleryStateWithDefaults('clamp-key');
      expect(state.thumbnailSize).toBe(220);
    });

    test('falls back to default for null thumbnailSize', () => {
      saveGalleryState('clamp-key', { viewMode: 'grid', thumbnailSize: null });
      const state = loadGalleryStateWithDefaults('clamp-key');
      expect(state.thumbnailSize).toBe(220);
    });
  });

  describe('filterBySearch', () => {
    test('returns all images when searchValue is empty', () => {
      expect(filterBySearch(mockImages, 'filename', '')).toBe(mockImages);
    });

    test('returns all images when searchField is empty', () => {
      expect(filterBySearch(mockImages, '', 'alpha')).toBe(mockImages);
    });

    test('filters by filename', () => {
      const result = filterBySearch(mockImages, 'filename', 'alpha');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('img-1');
    });

    test('filters by content_type', () => {
      const result = filterBySearch(mockImages, 'content_type', 'png');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('img-2');
    });

    test('filters by uploaded_by', () => {
      const result = filterBySearch(mockImages, 'uploaded_by', 'bob');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('img-2');
    });

    test('filters by all metadata values', () => {
      const result = filterBySearch(mockImages, 'metadata', 'blue');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('img-2');
    });

    test('filters by specific metadata key', () => {
      const result = filterBySearch(mockImages, 'location', 'lab-a');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('img-1');
    });

    test('returns empty when metadata key is missing from image', () => {
      const result = filterBySearch(mockImages, 'location', 'lab');
      // img-3 has no metadata, so only img-1 and img-2 match
      expect(result).toHaveLength(2);
    });

    test('is case-insensitive', () => {
      const result = filterBySearch(mockImages, 'filename', 'ALPHA');
      expect(result).toHaveLength(1);
    });

    test('handles images with metadata_ instead of metadata', () => {
      const images = [{ id: 'x', metadata_: { tag: 'special' } }];
      const result = filterBySearch(images, 'metadata', 'special');
      expect(result).toHaveLength(1);
    });
  });

  describe('filterByReviewStatus', () => {
    const statuses = { 'img-1': 'pass', 'img-2': 'reject_pending' };

    test('returns all images when filter is "all"', () => {
      expect(filterByReviewStatus(mockImages, 'all', statuses)).toBe(mockImages);
    });

    test('returns all images when filter is falsy', () => {
      expect(filterByReviewStatus(mockImages, null, statuses)).toBe(mockImages);
      expect(filterByReviewStatus(mockImages, '', statuses)).toBe(mockImages);
    });

    test('filters by matching status', () => {
      const result = filterByReviewStatus(mockImages, 'pass', statuses);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('img-1');
    });

    test('treats missing status as unreviewed', () => {
      const result = filterByReviewStatus(mockImages, 'unreviewed', statuses);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('img-3');
    });

    test('handles null reviewStatuses gracefully', () => {
      const result = filterByReviewStatus(mockImages, 'unreviewed', null);
      expect(result).toHaveLength(3);
    });
  });

  describe('sortImages', () => {
    test('sorts by date descending (default)', () => {
      const result = sortImages(mockImages, 'date');
      expect(result.map(i => i.id)).toEqual(['img-2', 'img-3', 'img-1']);
    });

    test('sorts by name ascending', () => {
      const result = sortImages(mockImages, 'name');
      expect(result.map(i => i.id)).toEqual(['img-1', 'img-2', 'img-3']);
    });

    test('sorts by name using natural order for numeric filenames', () => {
      const numericImages = [
        { id: 'a', filename: 'image10.jpg', size_bytes: 100, created_at: '2023-01-01T00:00:00Z' },
        { id: 'b', filename: 'image2.jpg', size_bytes: 100, created_at: '2023-01-01T00:00:00Z' },
        { id: 'c', filename: 'image1.jpg', size_bytes: 100, created_at: '2023-01-01T00:00:00Z' },
        { id: 'd', filename: 'image20.jpg', size_bytes: 100, created_at: '2023-01-01T00:00:00Z' },
      ];
      const result = sortImages(numericImages, 'name');
      expect(result.map(i => i.filename)).toEqual([
        'image1.jpg',
        'image2.jpg',
        'image10.jpg',
        'image20.jpg',
      ]);
    });

    test('sorts by size descending', () => {
      const result = sortImages(mockImages, 'size');
      expect(result.map(i => i.id)).toEqual(['img-2', 'img-3', 'img-1']);
    });

    test('defaults to date sort for unknown sort key', () => {
      const result = sortImages(mockImages, 'unknown');
      expect(result.map(i => i.id)).toEqual(['img-2', 'img-3', 'img-1']);
    });

    test('does not mutate the original array', () => {
      const original = [...mockImages];
      sortImages(mockImages, 'name');
      expect(mockImages).toEqual(original);
    });
  });

  describe('applyGalleryFilters', () => {
    test('applies search, review, and sort together', () => {
      const statuses = { 'img-1': 'pass', 'img-2': 'pass' };
      const result = applyGalleryFilters(mockImages, {
        searchField: 'content_type',
        searchValue: 'jpeg',
        reviewFilter: 'pass',
        sortBy: 'name',
        reviewStatuses: statuses,
      });
      // jpeg matches img-1 and img-3; pass filter keeps only img-1
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('img-1');
    });

    test('defaults to date sort when sortBy is not provided', () => {
      const result = applyGalleryFilters(mockImages, {
        searchField: 'filename',
        searchValue: '',
        reviewFilter: 'all',
        reviewStatuses: {},
      });
      expect(result.map(i => i.id)).toEqual(['img-2', 'img-3', 'img-1']);
    });

    test('works with empty options', () => {
      const result = applyGalleryFilters(mockImages, {});
      expect(result).toHaveLength(3);
    });
  });

  describe('cleanup and TTL', () => {
    test('saveGalleryState stamps lastAccessed on the entry', () => {
      const before = Date.now();
      saveGalleryState('ts-key', { sortBy: 'name' });
      const raw = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}ts-key`));
      expect(raw.lastAccessed).toBeGreaterThanOrEqual(before);
      expect(raw.lastAccessed).toBeLessThanOrEqual(Date.now());
      expect(raw.sortBy).toBe('name');
    });

    test('loadGalleryState touches lastAccessed and strips it from result', () => {
      // Seed an entry with an old timestamp
      const old = Date.now() - 1000;
      localStorage.setItem(
        `${STORAGE_PREFIX}touch-key`,
        JSON.stringify({ sortBy: 'size', lastAccessed: old })
      );
      const state = loadGalleryState('touch-key');
      expect(state.sortBy).toBe('size');
      expect(state.lastAccessed).toBeUndefined();
      // The stored entry should have a refreshed timestamp
      const raw = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}touch-key`));
      expect(raw.lastAccessed).toBeGreaterThan(old);
    });

    test('cleanupStaleGalleryStates removes entries older than MAX_AGE_MS', () => {
      const staleTime = Date.now() - MAX_AGE_MS - 1000;
      const freshTime = Date.now();
      localStorage.setItem(
        `${STORAGE_PREFIX}old`,
        JSON.stringify({ sortBy: 'date', lastAccessed: staleTime })
      );
      localStorage.setItem(
        `${STORAGE_PREFIX}new`,
        JSON.stringify({ sortBy: 'name', lastAccessed: freshTime })
      );
      cleanupStaleGalleryStates();
      expect(localStorage.getItem(`${STORAGE_PREFIX}old`)).toBeNull();
      expect(localStorage.getItem(`${STORAGE_PREFIX}new`)).not.toBeNull();
    });

    test('cleanupStaleGalleryStates does not remove non-gallery keys', () => {
      localStorage.setItem('unrelated_key', 'keep me');
      const staleTime = Date.now() - MAX_AGE_MS - 1000;
      localStorage.setItem(
        `${STORAGE_PREFIX}stale`,
        JSON.stringify({ lastAccessed: staleTime })
      );
      cleanupStaleGalleryStates();
      expect(localStorage.getItem('unrelated_key')).toBe('keep me');
    });

    test('cleanupStaleGalleryStates evicts oldest when over MAX_ENTRIES', () => {
      // Create MAX_ENTRIES + 5 fresh entries
      for (let i = 0; i < MAX_ENTRIES + 5; i++) {
        localStorage.setItem(
          `${STORAGE_PREFIX}cap-${i}`,
          JSON.stringify({ lastAccessed: Date.now() - (MAX_ENTRIES + 5 - i) * 1000 })
        );
      }
      cleanupStaleGalleryStates();
      // Count remaining gallery entries
      let count = 0;
      for (let i = 0; i < localStorage.length; i++) {
        if (localStorage.key(i).startsWith(STORAGE_PREFIX)) count++;
      }
      expect(count).toBeLessThanOrEqual(MAX_ENTRIES);
      // The oldest entries (cap-0 through cap-4) should be gone
      for (let i = 0; i < 5; i++) {
        expect(localStorage.getItem(`${STORAGE_PREFIX}cap-${i}`)).toBeNull();
      }
      // The newest should still exist
      expect(localStorage.getItem(`${STORAGE_PREFIX}cap-${MAX_ENTRIES + 4}`)).not.toBeNull();
    });

    test('cleanupStaleGalleryStates treats corrupt entries as oldest', () => {
      localStorage.setItem(`${STORAGE_PREFIX}corrupt`, '{not valid json');
      localStorage.setItem(
        `${STORAGE_PREFIX}good`,
        JSON.stringify({ lastAccessed: Date.now() })
      );
      // Corrupt entry has lastAccessed=0, so now - 0 > MAX_AGE_MS is true
      // (Date.now() is much larger than 30 days in ms), making it stale.
      cleanupStaleGalleryStates();
      expect(localStorage.getItem(`${STORAGE_PREFIX}corrupt`)).toBeNull();
      expect(localStorage.getItem(`${STORAGE_PREFIX}good`)).not.toBeNull();
    });
  });
});
