const DEFAULT_IMAGE_PAGE_SIZE = 500;

function normalizePageSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_IMAGE_PAGE_SIZE;
  return Math.max(1, Math.min(DEFAULT_IMAGE_PAGE_SIZE, Math.trunc(parsed)));
}

/**
 * Fetch every image in a project using the cursor-paginated image endpoint.
 *
 * The cursor is intentionally treated as opaque. A repeated cursor or a page
 * that claims to have more data without providing a cursor is rejected rather
 * than silently returning a truncated image collection.
 */
export async function fetchProjectImagePages(projectId, options = {}) {
  const {
    includeDeleted = true,
    pageSize = DEFAULT_IMAGE_PAGE_SIZE,
    fetchImpl = fetch,
    signal,
    onPage,
  } = options;
  const safeProjectId = encodeURIComponent(String(projectId || ''));
  if (!safeProjectId) throw new Error('A project id is required to load images.');

  const limit = normalizePageSize(pageSize);
  const items = [];
  const seenCursors = new Set();
  let cursor = null;
  let total = null;

  while (true) {
    const params = new URLSearchParams({
      include_deleted: includeDeleted ? 'true' : 'false',
      limit: String(limit),
    });
    if (cursor) params.set('cursor', cursor);

    const response = await fetchImpl(
      `/api/projects/${safeProjectId}/images-page?${params.toString()}`,
      signal ? { signal } : undefined,
    );
    if (!response.ok) {
      throw new Error(`Failed to load project images (${response.status})`);
    }

    const payload = await response.json();
    if (!payload || !Array.isArray(payload.items)) {
      throw new Error('Project image page returned an invalid response.');
    }

    items.push(...payload.items);
    if (Number.isFinite(Number(payload.total))) total = Number(payload.total);
    if (onPage) {
      await onPage({
        items: payload.items,
        loaded: items.length,
        total,
      });
    }

    const hasMore = payload.has_more === true || (
      payload.has_more === undefined && Boolean(payload.next_cursor)
    );
    if (!hasMore) {
      if (total !== null && items.length < total) {
        throw new Error(
          `Project image pagination ended early after ${items.length} of ${total} images.`,
        );
      }
      break;
    }

    const nextCursor = String(payload.next_cursor || '');
    if (!nextCursor) {
      throw new Error('Project image page was truncated because the next cursor was missing.');
    }
    if (seenCursors.has(nextCursor)) {
      throw new Error('Project image pagination returned a repeated cursor.');
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return {
    items,
    total: total === null ? items.length : total,
  };
}

export { DEFAULT_IMAGE_PAGE_SIZE };
