import {
  collectTransferables,
  handleSplatAssetMessage,
  parsePly,
  parseSplatAssetText,
} from '../pt3SplatAssetParser';

const PLY = [
  'ply',
  'format ascii 1.0',
  'element vertex 2',
  'property float x',
  'property float y',
  'property float z',
  'property float scale',
  'property float opacity',
  'property uchar red',
  'property uchar green',
  'property uchar blue',
  'property int segment_id',
  'end_header',
  '1 2 3 0.5 1.5 255 0 51 7',
  'not a vertex row',
  '4 5 6 0.25 0.5 0 255 0 9',
  '7 8 9 1 1 0 0 0 1',
].join('\r\n');

const canonicalPayload = (overrides = {}) => ({
  contract_version: 'pt3_real_3dgs/v1',
  representation: 'real_3dgs',
  sh_degree: 0,
  means: [[1, 2, 3]],
  scales: [[0.1, 0.4, 0.2]],
  rotations: [[1, 0, 0, 0]],
  opacities: [0.75],
  sh_coefficients: [[0, 10, -10]],
  segment_ids: [3],
  extra: 'kept',
  ...overrides,
});

describe('parsePly', () => {
  it('parses ascii vertices up to the declared count', () => {
    const parsed = parsePly(PLY);
    expect(Array.from(parsed.positions)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(parsed.scales)).toEqual([0.5, 0.25]);
    expect(parsed.colors[0]).toBeCloseTo(1);
    expect(parsed.colors[2]).toBeCloseTo(0.2);
    expect(parsed.colors[3]).toBe(1);
    expect(parsed.colors[7]).toBe(0.5);
    expect(parsed.segmentIds).toEqual([7, 9]);
    expect(parsed.layers).toEqual([{ id: 'baked', label: 'Baked splats', count: 2, visible: true, opacity: 1 }]);
  });
});

describe('parseSplatAssetText', () => {
  it('parses canonical real 3DGS JSON and strips bulk metadata keys', () => {
    const parsed = parseSplatAssetText(JSON.stringify(canonicalPayload()), { requireCanonical: true });
    expect(Array.from(parsed.positions)).toEqual([1, 2, 3]);
    expect(parsed.scales[0]).toBeCloseTo(0.4);
    expect(parsed.shValuesPerSplat).toBe(3);
    expect(parsed.colors[0]).toBeCloseTo(0.5);
    expect(parsed.colors[1]).toBe(1);
    expect(parsed.colors[2]).toBe(0);
    expect(parsed.colors[3]).toBeCloseTo(0.75);
    expect(parsed.segmentIds).toEqual([3]);
    expect(parsed.metadata).toEqual({
      contract_version: 'pt3_real_3dgs/v1',
      representation: 'real_3dgs',
      sh_degree: 0,
      extra: 'kept',
      splat_count: 1,
    });
  });

  it('clamps the SH degree and fills missing segment ids', () => {
    const coefficients = new Array(75).fill(0);
    const parsed = parseSplatAssetText(JSON.stringify(canonicalPayload({
      sh_degree: 9,
      sh_coefficients: [coefficients],
      segment_ids: undefined,
    })));
    expect(parsed.shDegree).toBe(4);
    expect(parsed.shValuesPerSplat).toBe(75);
    expect(parsed.segmentIds).toEqual([null]);
  });

  it('parses legacy splat JSON with intensity layers', () => {
    const parsed = parseSplatAssetText(JSON.stringify({
      splats: [
        { x: 1, y: 'bad', z: 3, scale: 'x', red: 255, intensity: 200 },
        { x: 0, y: 0, z: 0, scale: 2, opacity: 0.9, intensity: 10, segment_id: 4 },
        { layer: 'custom' },
      ],
      metadata: { source: 'legacy' },
    }));
    expect(Array.from(parsed.positions.slice(0, 3))).toEqual([1, 0, 3]);
    expect(Array.from(parsed.scales)).toEqual([1, 2, 1]);
    expect(parsed.colors[3]).toBe(0.5);
    expect(parsed.segmentIds).toEqual([null, 4, null]);
    expect(parsed.layers.map((layer) => [layer.id, layer.count])).toEqual([['surface', 1], ['void', 1], ['custom', 1]]);
    expect(parsed.metadata).toEqual({ source: 'legacy' });
  });

  it('rejects non-canonical assets when canonical is required', () => {
    expect(() => parseSplatAssetText(PLY, { requireCanonical: true }))
      .toThrow('Real 3DGS requires canonical JSON');
    expect(() => parseSplatAssetText(JSON.stringify({ splats: [] }), { requireCanonical: true }))
      .toThrow('Real 3DGS asset is not canonical v1 JSON');
  });
});

describe('handleSplatAssetMessage', () => {
  it('posts parsed data with transferable buffers', async () => {
    const postMessage = jest.fn();
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(JSON.stringify(canonicalPayload())) });
    await handleSplatAssetMessage({ id: 3, url: '/asset', requireCanonical: true }, { fetchImpl, postMessage });
    expect(fetchImpl).toHaveBeenCalledWith('/asset');
    const [message, transfer] = postMessage.mock.calls[0];
    expect(message).toMatchObject({ id: 3, ok: true, shDegree: 0 });
    expect(transfer).toEqual(collectTransferables(message));
    expect(transfer).toHaveLength(6);
  });

  it('posts an error message on HTTP failure', async () => {
    const postMessage = jest.fn();
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    await handleSplatAssetMessage({ id: 1, url: '/missing' }, { fetchImpl, postMessage });
    expect(postMessage).toHaveBeenCalledWith({ id: 1, ok: false, error: 'HTTP 404' });
  });

  it('uses a default error message when none is provided', async () => {
    const postMessage = jest.fn();
    const fetchImpl = jest.fn().mockRejectedValue({});
    await handleSplatAssetMessage(undefined, { fetchImpl, postMessage });
    expect(postMessage).toHaveBeenCalledWith({ id: undefined, ok: false, error: 'Failed to parse splat asset' });
  });
});
