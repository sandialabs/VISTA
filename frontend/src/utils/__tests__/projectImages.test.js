import { fetchProjectImagePages } from '../projectImages';

describe('fetchProjectImagePages', () => {
  test('loads all 2501 images without a hard result cap', async () => {
    const allImages = Array.from({ length: 2501 }, (_, index) => ({ id: `image-${index}` }));
    const fetchImpl = jest.fn(async (url) => {
      const parsed = new URL(url, 'http://vista.test');
      const offset = Number(parsed.searchParams.get('cursor') || 0);
      const limit = Number(parsed.searchParams.get('limit'));
      const items = allImages.slice(offset, offset + limit);
      const nextOffset = offset + items.length;
      return {
        ok: true,
        json: async () => ({
          items,
          total: allImages.length,
          next_cursor: nextOffset < allImages.length ? String(nextOffset) : null,
          has_more: nextOffset < allImages.length,
        }),
      };
    });

    const result = await fetchProjectImagePages('project/one', { fetchImpl });

    expect(result.items).toHaveLength(2501);
    expect(result.items.at(-1)).toEqual({ id: 'image-2500' });
    expect(result.total).toBe(2501);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(fetchImpl.mock.calls[0][0]).toContain('/api/projects/project%2Fone/images-page?');
    expect(fetchImpl.mock.calls.every(([url]) => new URL(url, 'http://vista.test').searchParams.get('limit') === '500')).toBe(true);
  });

  test('rejects a repeated cursor instead of returning incomplete data', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({ items: [], total: 2, next_cursor: 'same', has_more: true }),
    }));

    await expect(fetchProjectImagePages('project', { fetchImpl })).rejects.toThrow('repeated cursor');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('passes an abort signal to every request', async () => {
    const controller = new AbortController();
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({ items: [], total: 0, next_cursor: null, has_more: false }),
    }));

    await fetchProjectImagePages('project', { fetchImpl, signal: controller.signal });

    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), { signal: controller.signal });
  });

  test('rejects a final page that contradicts the reported total', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [{ id: 'only-image' }],
        total: 2,
        next_cursor: null,
        has_more: false,
      }),
    }));

    await expect(fetchProjectImagePages('project', { fetchImpl })).rejects.toThrow(
      'ended early after 1 of 2 images',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
