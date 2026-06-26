import { isChunkLoadError, retryChunkImport } from '../lazyWithRetry';

describe('lazyWithRetry utilities', () => {
  test('recognizes webpack chunk load failures', () => {
    expect(isChunkLoadError({ name: 'ChunkLoadError' })).toBe(true);
    expect(isChunkLoadError({ message: 'Loading chunk vendors-node_modules_flexlayout-react_dist_index_js failed.' })).toBe(true);
    expect(isChunkLoadError(new Error('regular failure'))).toBe(false);
  });

  test('retries chunk load failures before resolving', async () => {
    const chunkError = Object.assign(new Error('Loading chunk vendors-node_modules_flexlayout-react_dist_index_js failed.'), {
      name: 'ChunkLoadError',
    });
    const module = { default: () => null };
    const importer = jest
      .fn()
      .mockRejectedValueOnce(chunkError)
      .mockResolvedValueOnce(module);

    await expect(retryChunkImport(importer, [1])).resolves.toBe(module);
    expect(importer).toHaveBeenCalledTimes(2);
  });

  test('does not retry non-chunk failures', async () => {
    const error = new Error('syntax error');
    const importer = jest.fn().mockRejectedValue(error);

    await expect(retryChunkImport(importer, [25])).rejects.toBe(error);
    expect(importer).toHaveBeenCalledTimes(1);
  });
});
