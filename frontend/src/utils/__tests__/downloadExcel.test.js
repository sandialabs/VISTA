import { downloadExcel } from '../downloadExcel';

describe('downloadExcel', () => {
  const originalFetch = global.fetch;
  const originalCreateObjectURL = window.URL.createObjectURL;
  const originalRevokeObjectURL = window.URL.revokeObjectURL;
  const originalCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    global.fetch = jest.fn();
    window.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    window.URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.URL.createObjectURL = originalCreateObjectURL;
    window.URL.revokeObjectURL = originalRevokeObjectURL;
    document.createElement = originalCreateElement;
    jest.restoreAllMocks();
  });

  test('uses content-disposition filename when provided', async () => {
    const blob = new Blob(['sheet']);
    const anchor = document.createElement('a');
    anchor.click = jest.fn();
    jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'a') return anchor;
      return originalCreateElement(tag);
    });

    global.fetch.mockResolvedValue({
      ok: true,
      blob: jest.fn().mockResolvedValue(blob),
      headers: {
        get: jest.fn(() => 'attachment; filename="report.xlsx"'),
      },
    });

    await downloadExcel('proj-1', 'fallback');

    expect(anchor.download).toBe('report.xlsx');
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(window.URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  test('uses fallback filename when content-disposition is missing', async () => {
    const anchor = document.createElement('a');
    anchor.click = jest.fn();
    jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'a') return anchor;
      return originalCreateElement(tag);
    });

    global.fetch.mockResolvedValue({
      ok: true,
      blob: jest.fn().mockResolvedValue(new Blob(['sheet'])),
      headers: {
        get: jest.fn(() => null),
      },
    });

    await downloadExcel('proj-2', 'my-project');
    expect(anchor.download).toBe('my-project_export.xlsx');
  });

  test('throws API error detail for unsuccessful response', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: jest.fn().mockResolvedValue({ detail: 'boom' }),
    });

    await expect(downloadExcel('proj-3', 'ignored')).rejects.toThrow('boom');
  });
});
