import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Project from '../Project';
import { PROJECT_TYPE_OPTIONS } from '../projectTypes';

let mockPendingAutosave = false;
let mockSearch = '';
let mockProjectId = 'proj-1';
let mockFlushResolve = null;
let mockUploadCompletionResult = null;
let mockLatestUploadComplete = null;
let mockLatestBundleImportComplete = null;
let mockLatestUploaderSetError = null;
let mockPartsUnloadRefreshResult = null;
let mockLatestMetadataLoaded = null;
let mockLatestPartsUnloaded = null;
const mockFlushPendingAutosave = jest.fn();
const mockNavigate = jest.fn();
const mockNavigateToLocation = (to) => {
  const search = to?.search ? `?${String(to.search).replace(/^\?/, '')}` : '';
  mockSearch = search;
  window.history.pushState({}, '', `${to?.pathname || `/project/${mockProjectId}`}${search}`);
};

jest.mock('react-router-dom', () => ({
  useParams: () => ({ id: mockProjectId }),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: `/project/${mockProjectId}`, search: mockSearch }),
}));

jest.mock('../components/ProjectConfigurationPanel', () => {
  const React = require('react');
  return React.forwardRef(function MockProjectConfigurationPanel(props, ref) {
    React.useImperativeHandle(ref, () => ({
      hasPendingAutosave: () => mockPendingAutosave,
      flushPendingAutosave: mockFlushPendingAutosave,
    }));
    return (
      <div>
        <div>Project configuration editor</div>
        <div data-testid="configuration-project-prop">
          {JSON.stringify(props.project || null)}
        </div>
        <button
          type="button"
          onClick={() => props.onProjectUpdated?.({
            ...props.project,
            name: 'Updated Project',
            meta_group_id: 'destination-group',
          })}
        >
          Apply mocked project update
        </button>
        <button
          type="button"
          onClick={() => props.onProjectUpdated?.({
            ...props.project,
            id: 'stale-project',
            meta_group_id: 'stale-group',
          })}
        >
          Apply stale project update
        </button>
        <button type="button" onClick={() => props.onActiveSubtabChange?.('general')}>Show general config</button>
        <button type="button" onClick={() => props.onActiveSubtabChange?.('filenameConvention')}>Show filename config</button>
        <button type="button" onClick={() => props.onActiveSubtabChange?.('hotkeys')}>Show hotkeys config</button>
      </div>
    );
  });
});

jest.mock('../components/ImageUploader', () => function MockImageUploader({ onUploadComplete, onProjectMetadataLoaded, setError }) {
  mockLatestUploadComplete = onUploadComplete;
  mockLatestMetadataLoaded = onProjectMetadataLoaded;
  mockLatestUploaderSetError = setError;
  return (
    <div>
      <div>Image uploader</div>
      <button
        type="button"
        onClick={() => onUploadComplete?.(
          [{ id: 'uploaded-image', filename: 'uploaded.png' }],
          { source: 'local_upload', confirmedSucceeded: 1, completionUnknown: 0 },
        )}
      >
        Complete mocked upload
      </button>
      <button
        type="button"
        onClick={async () => {
          mockUploadCompletionResult = await onUploadComplete?.([], {
            source: 's3_import',
            confirmedSucceeded: 0,
            completionUnknown: 1,
            partsMayHaveChanged: true,
            requiresAuthoritativeReconciliation: true,
          });
        }}
      >
        Complete uncertain mocked upload
      </button>
    </div>
  );
});
jest.mock('../components/InspectionWorkbenchPanel', () => {
  const React = require('react');
  const MockInspectionWorkbenchPanel = ({
    launchFilters,
    mprSession,
    readOnly,
    onMprSessionChange,
    onInspectionShareStateChange,
  }) => (
    <div>
      <div>Inspection workbench</div>
      <output data-testid="inspection-launch-filters">{JSON.stringify(launchFilters || null)}</output>
      <output data-testid="inspection-mpr-session">{JSON.stringify(mprSession || null)}</output>
      <output data-testid="inspection-read-only">{String(readOnly)}</output>
      <button
        type="button"
        onClick={() => onMprSessionChange?.({
          slicePosition: { axial: 17, coronal: 23, sagittal: 31 },
          activePane: 'coronal',
          lastActiveAxis: 'coronal',
          viewportTransform: { zoom: 1.5, panX: 12, panY: -8 },
          rotation: { x: -12, y: 42 },
        })}
      >
        Update MPR session
      </button>
      <button
        type="button"
        onClick={() => onInspectionShareStateChange?.({
          selectedBatchId: 'batch-10',
          selectedPartId: 'part-43',
          selectedImageRef: 'image-8',
          reviewFilter: 'pass',
          activeMetadataTab: 'other',
          activeMprPane: 'coronal',
          activeOverlayIds: ['overlay-a'],
        }, { replace: true })}
      >
        Share inspection state
      </button>
    </div>
  );
  return {
    __esModule: true,
    default: MockInspectionWorkbenchPanel,
    buildInspectionShareParams: (state = {}) => {
      const params = new URLSearchParams();
      if (state.selectedBatchId) params.set('batch', state.selectedBatchId);
      if (state.selectedPartId) params.set('part', state.selectedPartId);
      if (state.selectedImageRef) params.set('image', state.selectedImageRef);
      if (state.reviewFilter && state.reviewFilter !== 'all') params.set('review', state.reviewFilter);
      if (state.activeMetadataTab && state.activeMetadataTab !== 'nsipro') params.set('metadataTab', state.activeMetadataTab);
      if (state.activeMprPane && state.activeMprPane !== 'axial') params.set('mprPane', state.activeMprPane);
      if (Array.isArray(state.activeOverlayIds) && state.activeOverlayIds.length > 0) params.set('overlays', state.activeOverlayIds.join(','));
      return params;
    },
  };
});
jest.mock('../components/AnalyzeWorkbenchTab', () => ({ setError }) => (
  <div>
    <div>Analyze workbench</div>
    <button type="button" onClick={() => setError?.('Mock analyze failure')}>Trigger analyze error</button>
  </div>
));
jest.mock('../components/ProjectDataSummaryTab', () => ({ counts, loading }) => (
  <div>
    <div>Project data summary</div>
    {!loading && <div data-testid="project-data-counts">{JSON.stringify(counts)}</div>}
  </div>
));
jest.mock('../components/ProjectDataExportPanel', () => function MockProjectDataExportPanel({ onImportComplete }) {
  mockLatestBundleImportComplete = onImportComplete;
  return (
    <div>
      <div>Project data export</div>
      <button type="button" onClick={() => onImportComplete?.({ project: {} })}>
        Complete mocked bundle import
      </button>
    </div>
  );
});
jest.mock('../components/ProjectReportTab', () => () => <div>Project report</div>);
jest.mock('../components/ProjectPhaseFlow', () => () => <div>Project phase flow</div>);
jest.mock('../components/ImagesToPartsTab', () => ({ images = [], parts = [] }) => (
  <div>Images to parts ({images.length} images, {parts.length} parts)</div>
));
jest.mock('../components/OverlaysTab', () => {
  const React = require('react');
  return function MockOverlaysTab({ images = [], parts = [], onAssignmentsChanged }) {
    const [feedback, setFeedback] = React.useState('');
    return (
      <div>
        <div>Overlays tab ({images.length} images, {parts.length} parts)</div>
        <button
          type="button"
          onClick={async () => {
            await onAssignmentsChanged?.();
            setFeedback('Mock overlay refresh complete');
          }}
        >
          Complete mocked overlay assignment
        </button>
        {feedback && <div>{feedback}</div>}
      </div>
    );
  };
});
jest.mock('../components/BatchesTab', () => () => <div>Batches</div>);
jest.mock('../components/UnloadPartsTab', () => {
  const React = require('react');
  return function MockUnloadPartsTab({ parts = [], onPartsUnloaded }) {
    mockLatestPartsUnloaded = onPartsUnloaded;
    const [feedback, setFeedback] = React.useState('');
    return (
      <div>
        <div>Unload parts ({parts.length} parts)</div>
        <button
          type="button"
          onClick={async () => {
            mockPartsUnloadRefreshResult = await onPartsUnloaded?.();
            setFeedback(`Mock parts unload refresh ${mockPartsUnloadRefreshResult}`);
          }}
        >
          Complete mocked parts unload
        </button>
        {feedback && <div>{feedback}</div>}
      </div>
    );
  };
});
jest.mock('../components/RemoveImagesTab', () => () => <div>Remove images</div>);
jest.mock('../components/ProjectDataMetadataTab', () => () => <div>Project data metadata</div>);

beforeEach(() => {
  mockProjectId = 'proj-1';
  mockLatestUploadComplete = null;
  mockLatestBundleImportComplete = null;
  mockLatestUploaderSetError = null;
  mockPartsUnloadRefreshResult = null;
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    statusText: '',
    url: '',
    headers: { get: () => null },
    clone() { return this; },
    json: async () => payload,
    text: async () => '',
  };
}


describe('Project image summary loading', () => {
  beforeEach(() => {
    mockPendingAutosave = false;
    mockSearch = '?tab=project_data';
    mockNavigate.mockClear();
    mockUploadCompletionResult = null;
    mockNavigate.mockImplementation(mockNavigateToLocation);
    window.history.pushState({}, '', `/project/proj-1${mockSearch}`);
    global.fetch = jest.fn((url) => {
      if (url === '/api/projects/proj-1') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'proj-1', name: 'Large Image Project', project_type: 'PT1' }) });
      }
      if (url === '/api/projects/proj-1/metadata-dict') {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      if (url === '/api/projects/proj-1/classes') {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (url === '/api/projects/proj-1/data-summary') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            active_image_count: 2345,
            deleted_image_count: 9,
            total_image_bytes: 123456,
            part_count: 2,
            image_metadata_fields: 3,
            annotation_count: 7,
            overlay_layer_count: 4,
          }),
        });
      }
      if (url === '/api/projects/proj-1/parts') {
        return Promise.resolve({ ok: true, json: async () => [{ id: 'part-1' }, { id: 'part-2' }] });
      }
      if (String(url).startsWith('/api/projects/proj-1/images-page?')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [], total: 0, next_cursor: null, has_more: false }),
        });
      }
      if (url === '/api/projects/proj-1/configuration') {
        return Promise.resolve({ ok: true, json: async () => ({ config: {} }) });
      }
      if (String(url).startsWith('/interface-hierarchy.toml')) {
        return Promise.resolve({ ok: false, text: async () => '' });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('hands the full project and a route-guarded update callback to Project Configuration', async () => {
    mockSearch = '?tab=project_configuration';
    window.history.pushState({}, '', `/project/proj-1${mockSearch}`);
    const defaultFetch = global.fetch.getMockImplementation();
    const projectPayload = {
      id: 'proj-1',
      name: 'Large Image Project',
      project_type: 'PT1',
      meta_group_id: 'source-group',
      is_archived: false,
    };
    global.fetch.mockImplementation((url, options) => {
      if (url === '/api/projects/proj-1') {
        return Promise.resolve({ ok: true, json: async () => projectPayload });
      }
      return defaultFetch(url, options);
    });

    render(<Project />);

    const projectProp = await screen.findByTestId('configuration-project-prop');
    expect(projectProp).toHaveTextContent(JSON.stringify(projectPayload));

    fireEvent.click(screen.getByRole('button', { name: 'Apply stale project update' }));
    expect(projectProp).toHaveTextContent(JSON.stringify(projectPayload));

    fireEvent.click(screen.getByRole('button', { name: 'Apply mocked project update' }));
    await waitFor(() => {
      expect(projectProp).toHaveTextContent('"meta_group_id":"destination-group"');
      expect(screen.getByRole('heading', { name: 'Updated Project' })).toBeInTheDocument();
    });
  });

  test('loads lightweight project counts without fetching parts, exports, or image collections', async () => {
    render(<Project />);

    expect(await screen.findByTestId('project-data-counts')).toHaveTextContent(JSON.stringify({
      partsLoaded: 2,
      rawImages: 2345,
      imageMetadata: 3,
      overlayImages: 4,
      annotations: 7,
    }));
    expect(screen.getByRole('tab', { name: 'Load Images' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Images to Parts' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Unload Parts' })).toBeInTheDocument();

    const urls = global.fetch.mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => url === '/api/projects/proj-1/data-summary')).toHaveLength(1);
    expect(urls).not.toContain('/api/projects/proj-1/parts');
    expect(urls).not.toContain('/api/projects/proj-1/export-bundle-json');
    expect(urls.some((url) => url.includes('/images-page?') || url.includes('/images?'))).toBe(false);
  });

  test('loads only parts when the Unload Parts tab is opened', async () => {
    render(<Project />);
    await screen.findByTestId('project-data-counts');

    fireEvent.click(screen.getByRole('tab', { name: 'Unload Parts' }));

    expect(await screen.findByText('Unload parts (2 parts)')).toBeInTheDocument();
    expect(global.fetch.mock.calls.filter(([url]) => url === '/api/projects/proj-1/parts')).toHaveLength(1);
    expect(
      global.fetch.mock.calls.some(([url]) => String(url).includes('/images-page?')),
    ).toBe(false);
  });

  test('refreshes only parts and summary after all parts are unloaded', async () => {
    render(<Project />);
    await screen.findByTestId('project-data-counts');
    fireEvent.click(screen.getByRole('tab', { name: 'Unload Parts' }));
    await screen.findByText('Unload parts (2 parts)');

    fireEvent.click(screen.getByRole('button', { name: 'Complete mocked parts unload' }));

    expect(await screen.findByText('Mock parts unload refresh fresh')).toBeInTheDocument();
    expect(mockPartsUnloadRefreshResult).toBe('fresh');
    expect(global.fetch.mock.calls.filter(([url]) => url === '/api/projects/proj-1/parts')).toHaveLength(2);
    expect(global.fetch.mock.calls.filter(([url]) => url === '/api/projects/proj-1/data-summary')).toHaveLength(2);
    expect(
      global.fetch.mock.calls.some(([url]) => String(url).includes('/images-page?')),
    ).toBe(false);
  });

  test('reports an unload refresh error when the authoritative parts reload fails', async () => {
    const defaultFetch = global.fetch.getMockImplementation();
    let partRequests = 0;
    global.fetch.mockImplementation((url, options) => {
      if (url === '/api/projects/proj-1/parts') {
        partRequests += 1;
        if (partRequests === 2) {
          return Promise.resolve({ ok: false, status: 503 });
        }
      }
      return defaultFetch(url, options);
    });

    render(<Project />);
    await screen.findByTestId('project-data-counts');
    fireEvent.click(screen.getByRole('tab', { name: 'Unload Parts' }));
    await screen.findByText('Unload parts (2 parts)');

    fireEvent.click(screen.getByRole('button', { name: 'Complete mocked parts unload' }));

    await waitFor(() => expect(mockPartsUnloadRefreshResult).toBe('error'));
    expect(screen.getByText('Unload parts (2 parts)')).toBeInTheDocument();
    expect(screen.getByText('Mock parts unload refresh error')).toBeInTheDocument();
  });

  test('refreshes the authoritative image summary once after upload completion', async () => {
    render(<Project />);

    await screen.findByTestId('project-data-counts');
    expect(global.fetch.mock.calls.filter(([url]) => url === '/api/projects/proj-1/data-summary')).toHaveLength(1);
    expect(global.fetch.mock.calls.filter(([url]) => url === '/api/projects/proj-1/metadata-dict')).toHaveLength(1);
    expect(global.fetch.mock.calls.filter(([url]) => url === '/api/projects/proj-1/configuration')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Complete mocked upload' }));

    await waitFor(() => {
      expect(global.fetch.mock.calls.filter(([url]) => url === '/api/projects/proj-1/data-summary')).toHaveLength(2);
    });
    const postUploadUrls = global.fetch.mock.calls.map(([url]) => String(url));
    expect(postUploadUrls).not.toContain('/api/projects/proj-1/parts');
    expect(postUploadUrls).not.toContain('/api/projects/proj-1/export-bundle-json');
    expect(postUploadUrls.some((url) => url.includes('/images-page?') || url.includes('/images?'))).toBe(false);
    expect(global.fetch.mock.calls.filter(([url]) => url === '/api/projects/proj-1/metadata-dict')).toHaveLength(1);
    expect(global.fetch.mock.calls.filter(([url]) => url === '/api/projects/proj-1/configuration')).toHaveLength(1);
  });

  test('awaits complete image and part reconciliation for an uncertain upload', async () => {
    render(<Project />);
    await screen.findByTestId('project-data-counts');

    fireEvent.click(screen.getByRole('button', { name: 'Complete uncertain mocked upload' }));

    await waitFor(() => expect(mockUploadCompletionResult).toEqual({
      reconciled: true,
      authoritative: true,
    }));
    expect(global.fetch.mock.calls.filter(([url]) => url === '/api/projects/proj-1/data-summary')).toHaveLength(2);
    expect(global.fetch.mock.calls.filter(([url]) => url === '/api/projects/proj-1/parts')).toHaveLength(1);
    expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('/images-page?'))).toHaveLength(1);
  });

  test('reports an uncertain upload as unreconciled when an authoritative collection reload fails', async () => {
    const defaultFetch = global.fetch.getMockImplementation();
    global.fetch.mockImplementation((url, options) => {
      if (String(url).startsWith('/api/projects/proj-1/images-page?')) {
        return Promise.resolve({ ok: false, status: 503 });
      }
      return defaultFetch(url, options);
    });

    render(<Project />);
    await screen.findByTestId('project-data-counts');
    fireEvent.click(screen.getByRole('button', { name: 'Complete uncertain mocked upload' }));

    await waitFor(() => expect(mockUploadCompletionResult).toEqual({
      reconciled: false,
      authoritative: true,
    }));
    expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('/images-page?'))).toHaveLength(1);
    expect(global.fetch.mock.calls.filter(([url]) => url === '/api/projects/proj-1/parts')).toHaveLength(1);
  });

  test('refreshes summary, metadata, and configuration after a bundle import without eager collection loads', async () => {
    render(<Project />);
    await screen.findByTestId('project-data-counts');

    fireEvent.click(screen.getByRole('button', { name: 'Complete mocked bundle import' }));

    await waitFor(() => {
      expect(global.fetch.mock.calls.filter(([url]) => url === '/api/projects/proj-1/data-summary')).toHaveLength(2);
      expect(global.fetch.mock.calls.filter(([url]) => url === '/api/projects/proj-1/metadata-dict')).toHaveLength(2);
      expect(global.fetch.mock.calls.filter(([url]) => url === '/api/projects/proj-1/configuration')).toHaveLength(2);
    });
    const urls = global.fetch.mock.calls.map(([url]) => String(url));
    expect(urls).not.toContain('/api/projects/proj-1/parts');
    expect(urls.some((url) => url.includes('/images-page?') || url.includes('/images?'))).toBe(false);
  });

  test('loads complete parts and all 2501 images only when a consuming tab is opened', async () => {
    const defaultFetch = global.fetch.getMockImplementation();
    const images = Array.from({ length: 2501 }, (_, index) => ({
      id: `image-${index}`,
      filename: `image-${index}.png`,
    }));
    global.fetch.mockImplementation((url, options) => {
      if (String(url).startsWith('/api/projects/proj-1/images-page?')) {
        const parsed = new URL(String(url), 'http://vista.test');
        const offset = Number(parsed.searchParams.get('cursor') || 0);
        const limit = Number(parsed.searchParams.get('limit'));
        const pageItems = images.slice(offset, offset + limit);
        const nextOffset = offset + pageItems.length;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: pageItems,
            total: images.length,
            next_cursor: nextOffset < images.length ? String(nextOffset) : null,
            has_more: nextOffset < images.length,
          }),
        });
      }
      return defaultFetch(url, options);
    });

    render(<Project />);
    await screen.findByTestId('project-data-counts');
    expect(global.fetch.mock.calls.some(([url]) => String(url).includes('/images-page?'))).toBe(false);

    fireEvent.click(screen.getByRole('tab', { name: 'Images to Parts' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Loading complete project data');
    expect(await screen.findByText('Images to parts (2501 images, 2 parts)')).toBeInTheDocument();

    expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('/images-page?'))).toHaveLength(6);
    expect(global.fetch.mock.calls.filter(([url]) => url === '/api/projects/proj-1/parts')).toHaveLength(1);
  });

  test('keeps an already-loaded Overlays tab mounted while assigned collections refresh', async () => {
    render(<Project />);
    await screen.findByTestId('project-data-counts');

    fireEvent.click(screen.getByRole('tab', { name: 'Overlays' }));
    expect(await screen.findByText('Overlays tab (0 images, 2 parts)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Complete mocked overlay assignment' }));

    expect(await screen.findByText('Mock overlay refresh complete')).toBeInTheDocument();
    await waitFor(() => {
      expect(global.fetch.mock.calls.filter(([url]) => url === '/api/projects/proj-1/parts')).toHaveLength(2);
      expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('/images-page?'))).toHaveLength(2);
    });
    expect(screen.queryByText('Loading complete project data...')).not.toBeInTheDocument();
  });

  test('does not let an in-flight pre-upload image snapshot clear the stale marker', async () => {
    const defaultFetch = global.fetch.getMockImplementation();
    let resolveFirstImagePage;
    let imagePageRequests = 0;
    global.fetch.mockImplementation((url, options) => {
      if (String(url).startsWith('/api/projects/proj-1/images-page?')) {
        imagePageRequests += 1;
        if (imagePageRequests === 1) {
          return new Promise((resolve) => {
            resolveFirstImagePage = resolve;
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: [{ id: 'fresh-image', filename: 'fresh.png' }],
            total: 1,
            next_cursor: null,
            has_more: false,
          }),
        });
      }
      return defaultFetch(url, options);
    });

    render(<Project />);
    await screen.findByTestId('project-data-counts');
    fireEvent.click(screen.getByRole('tab', { name: 'Images to Parts' }));
    await waitFor(() => expect(imagePageRequests).toBe(1));

    fireEvent.click(screen.getByRole('tab', { name: 'Load Images' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete mocked upload' }));
    await waitFor(() => {
      expect(global.fetch.mock.calls.filter(([url]) => url === '/api/projects/proj-1/data-summary')).toHaveLength(2);
    });

    await act(async () => {
      resolveFirstImagePage({
        ok: true,
        json: async () => ({
          items: [{ id: 'stale-image', filename: 'stale.png' }],
          total: 1,
          next_cursor: null,
          has_more: false,
        }),
      });
      await Promise.resolve();
    });
    expect(imagePageRequests).toBe(1);

    fireEvent.click(screen.getByRole('tab', { name: 'Images to Parts' }));
    expect(await screen.findByText('Images to parts (1 images, 2 parts)')).toBeInTheDocument();
    expect(imagePageRequests).toBe(2);
  });

  test('continues authoritative reconciliation after an in-flight image snapshot becomes stale', async () => {
    const defaultFetch = global.fetch.getMockImplementation();
    let resolveFirstImagePage;
    let imagePageRequests = 0;
    global.fetch.mockImplementation((url, options) => {
      if (String(url).startsWith('/api/projects/proj-1/images-page?')) {
        imagePageRequests += 1;
        if (imagePageRequests === 1) {
          return new Promise((resolve) => {
            resolveFirstImagePage = resolve;
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: [{ id: 'fresh-image', filename: 'fresh.png' }],
            total: 1,
            next_cursor: null,
            has_more: false,
          }),
        });
      }
      return defaultFetch(url, options);
    });

    render(<Project />);
    await screen.findByTestId('project-data-counts');
    fireEvent.click(screen.getByRole('tab', { name: 'Images to Parts' }));
    await waitFor(() => expect(imagePageRequests).toBe(1));

    fireEvent.click(screen.getByRole('tab', { name: 'Load Images' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete uncertain mocked upload' }));

    await act(async () => {
      resolveFirstImagePage({
        ok: true,
        json: async () => ({
          items: [{ id: 'stale-image', filename: 'stale.png' }],
          total: 1,
          next_cursor: null,
          has_more: false,
        }),
      });
      await Promise.resolve();
    });

    await waitFor(() => expect(mockUploadCompletionResult).toEqual({
      reconciled: true,
      authoritative: true,
    }));
    expect(imagePageRequests).toBe(2);

    fireEvent.click(screen.getByRole('tab', { name: 'Images to Parts' }));
    expect(await screen.findByText('Images to parts (1 images, 2 parts)')).toBeInTheDocument();
  });

  test('waits for an explicit retry after a lazy image page fails', async () => {
    const defaultFetch = global.fetch.getMockImplementation();
    let failImages = true;
    global.fetch.mockImplementation((url, options) => {
      if (String(url).startsWith('/api/projects/proj-1/images-page?')) {
        if (failImages) return Promise.resolve({ ok: false, status: 503 });
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [], total: 0, next_cursor: null, has_more: false }),
        });
      }
      return defaultFetch(url, options);
    });

    render(<Project />);
    await screen.findByTestId('project-data-counts');
    fireEvent.click(screen.getByRole('tab', { name: 'Images to Parts' }));

    expect(await screen.findByText('Failed to load project images (503)')).toBeInTheDocument();
    expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('/images-page?'))).toHaveLength(1);

    failImages = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Images to parts (0 images, 2 parts)')).toBeInTheDocument();
    expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('/images-page?'))).toHaveLength(2);
  });
});


describe('Project route transition quarantine', () => {
  beforeEach(() => {
    mockProjectId = 'project-a';
    mockSearch = '?tab=project_data';
    mockNavigate.mockClear();
    mockNavigate.mockImplementation(mockNavigateToLocation);
    window.history.pushState({}, '', `/project/${mockProjectId}${mockSearch}`);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('aborts and ignores a deferred project A bootstrap response after navigating to project B', async () => {
    const projectAResponse = deferred();
    let projectASignal;
    global.fetch = jest.fn((url, options = {}) => {
      if (url === '/api/projects/project-a') {
        projectASignal = options.signal;
        return projectAResponse.promise;
      }
      if (url === '/api/projects/project-b') {
        return Promise.resolve(jsonResponse({ id: 'project-b', name: 'Project B', project_type: 'PT1' }));
      }
      if (url === '/api/projects/project-b/metadata-dict') {
        return Promise.resolve(jsonResponse({ owner: 'B' }));
      }
      if (url === '/api/projects/project-b/classes') {
        return Promise.resolve(jsonResponse([{ id: 'class-b' }]));
      }
      if (url === '/api/projects/project-b/data-summary') {
        return Promise.resolve(jsonResponse({
          active_image_count: 22,
          part_count: 2,
          image_metadata_fields: 4,
          annotation_count: 6,
          overlay_layer_count: 8,
        }));
      }
      if (url === '/api/projects/project-b/configuration') {
        return Promise.resolve(jsonResponse({ config: {} }));
      }
      if (String(url).startsWith('/interface-hierarchy.toml')) {
        return Promise.resolve({ ok: false, text: async () => '' });
      }
      return Promise.resolve(jsonResponse({}));
    });

    const view = render(<Project />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project-a',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    expect(projectASignal.aborted).toBe(false);

    await act(async () => {
      mockProjectId = 'project-b';
      window.history.pushState({}, '', `/project/${mockProjectId}${mockSearch}`);
      view.rerender(<Project />);
    });

    expect(await screen.findByText('Project B')).toBeInTheDocument();
    expect(await screen.findByTestId('project-data-counts')).toHaveTextContent('"rawImages":22');
    expect(projectASignal.aborted).toBe(true);

    await act(async () => {
      projectAResponse.resolve(jsonResponse({ id: 'project-a', name: 'Late Project A', project_type: 'PT3' }));
      await Promise.resolve();
    });

    expect(screen.getByText('Project B')).toBeInTheDocument();
    expect(screen.queryByText('Late Project A')).not.toBeInTheDocument();
    expect(screen.queryByText(/HTTP error/)).not.toBeInTheDocument();
    expect(screen.queryByText('Loading project data...')).not.toBeInTheDocument();
  });

  test('aborts project A lazy image pagination and parts loading when navigating to project B', async () => {
    const projectASecondImagePage = deferred();
    const projectAParts = deferred();
    let projectAImagePageRequests = 0;
    let projectAImageSignal;
    let projectAPartsSignal;

    const rejectOnAbort = (signal, request) => {
      signal.addEventListener('abort', () => {
        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        request.reject(abortError);
      }, { once: true });
    };

    global.fetch = jest.fn((url, options = {}) => {
      if (String(url).startsWith('/interface-hierarchy.toml')) {
        return Promise.resolve({ ok: false, text: async () => '' });
      }
      if (String(url).startsWith('/api/projects/project-a/images-page?')) {
        projectAImagePageRequests += 1;
        projectAImageSignal = options.signal;
        if (projectAImagePageRequests === 1) {
          return Promise.resolve(jsonResponse({
            items: [{ id: 'project-a-image-1', filename: 'a-1.png' }],
            total: 3,
            next_cursor: 'project-a-cursor-2',
            has_more: true,
          }));
        }
        rejectOnAbort(options.signal, projectASecondImagePage);
        return projectASecondImagePage.promise;
      }
      if (url === '/api/projects/project-a/parts') {
        projectAPartsSignal = options.signal;
        rejectOnAbort(options.signal, projectAParts);
        return projectAParts.promise;
      }
      if (String(url).startsWith('/api/projects/project-b/images-page?')) {
        return Promise.resolve(jsonResponse({
          items: [],
          total: 0,
          next_cursor: null,
          has_more: false,
        }));
      }

      const match = String(url).match(/^\/api\/projects\/(project-[ab])(?:\/(.*))?$/);
      if (!match) return Promise.resolve(jsonResponse({}));
      const [, projectId, suffix = ''] = match;
      if (!suffix) {
        return Promise.resolve(jsonResponse({
          id: projectId,
          name: projectId === 'project-a' ? 'Project A' : 'Project B',
          project_type: 'PT1',
        }));
      }
      if (suffix === 'metadata-dict') return Promise.resolve(jsonResponse({}));
      if (suffix === 'classes') return Promise.resolve(jsonResponse([]));
      if (suffix === 'configuration') return Promise.resolve(jsonResponse({ config: {} }));
      if (suffix === 'data-summary') {
        return Promise.resolve(jsonResponse({
          active_image_count: 0,
          part_count: 0,
          image_metadata_fields: 0,
          annotation_count: 0,
          overlay_layer_count: 0,
        }));
      }
      if (suffix === 'parts') return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({}));
    });

    const view = render(<Project />);
    expect(await screen.findByText('Project A')).toBeInTheDocument();
    await screen.findByTestId('project-data-counts');
    fireEvent.click(screen.getByRole('tab', { name: 'Images to Parts' }));
    await waitFor(() => {
      expect(projectAImagePageRequests).toBe(2);
      expect(projectAImageSignal).toEqual(expect.any(AbortSignal));
      expect(projectAPartsSignal).toEqual(expect.any(AbortSignal));
    });
    expect(projectAImageSignal.aborted).toBe(false);
    expect(projectAPartsSignal.aborted).toBe(false);

    await act(async () => {
      mockProjectId = 'project-b';
      window.history.pushState({}, '', `/project/${mockProjectId}${mockSearch}`);
      view.rerender(<Project />);
    });

    expect(await screen.findByText('Project B')).toBeInTheDocument();
    expect(projectAImageSignal.aborted).toBe(true);
    expect(projectAPartsSignal.aborted).toBe(true);
    expect(projectAImagePageRequests).toBe(2);
    expect(await screen.findByText('Images to parts (0 images, 0 parts)')).toBeInTheDocument();
    expect(screen.queryByText(/operation was aborted/i)).not.toBeInTheDocument();
  });

  test('ignores deferred project A metadata, summary, configuration, and errors after project B loads', async () => {
    mockSearch = '?tab=project_configuration';
    window.history.pushState({}, '', `/project/${mockProjectId}${mockSearch}`);
    const deferredA = {
      metadata: deferred(),
      summary: deferred(),
      configuration: deferred(),
    };
    const projectASecondarySignals = [];

    global.fetch = jest.fn((url, options = {}) => {
      if (url === '/api/projects/project-a') {
        return Promise.resolve(jsonResponse({ id: 'project-a', name: 'Project A', project_type: 'PT1' }));
      }
      const aKey = {
        '/api/projects/project-a/metadata-dict': 'metadata',
        '/api/projects/project-a/data-summary': 'summary',
        '/api/projects/project-a/configuration': 'configuration',
      }[url];
      if (aKey) {
        projectASecondarySignals.push(options.signal);
        return deferredA[aKey].promise;
      }
      if (url === '/api/projects/project-b') {
        return Promise.resolve(jsonResponse({ id: 'project-b', name: 'Project B', project_type: 'PT1' }));
      }
      if (url === '/api/projects/project-b/metadata-dict') {
        return Promise.resolve(jsonResponse({ owner: 'B' }));
      }
      if (url === '/api/projects/project-b/data-summary') {
        return Promise.resolve(jsonResponse({
          active_image_count: 22,
          part_count: 2,
          image_metadata_fields: 4,
          annotation_count: 6,
          overlay_layer_count: 8,
        }));
      }
      if (url === '/api/projects/project-b/configuration') {
        return Promise.resolve(jsonResponse({ config: { ui_sections: { 'main.report': true } } }));
      }
      if (String(url).startsWith('/interface-hierarchy.toml')) {
        return Promise.resolve({ ok: false, text: async () => '' });
      }
      return Promise.resolve(jsonResponse({}));
    });

    const view = render(<Project />);
    await waitFor(() => expect(projectASecondarySignals).toHaveLength(3));

    await act(async () => {
      mockProjectId = 'project-b';
      window.history.pushState({}, '', `/project/${mockProjectId}${mockSearch}`);
      view.rerender(<Project />);
    });

    expect(await screen.findByText('Project B')).toBeInTheDocument();
    expect(await screen.findByText('Project configuration editor')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Project Data' })).toBeInTheDocument();
    projectASecondarySignals.forEach((signal) => expect(signal.aborted).toBe(true));

    await act(async () => {
      deferredA.metadata.resolve(jsonResponse({ owner: 'A' }));
      deferredA.summary.resolve(jsonResponse({
        active_image_count: 999,
        part_count: 999,
        image_metadata_fields: 999,
        annotation_count: 999,
        overlay_layer_count: 999,
      }));
      deferredA.configuration.resolve(jsonResponse({
        config: { ui_sections: { 'main.project_data': false, 'main.report': false } },
      }));
      await Promise.resolve();
    });

    expect(screen.getByText('Project B')).toBeInTheDocument();
    expect(screen.getByText('Project configuration editor')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Project Data' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Project Data' }));
    expect(await screen.findByTestId('project-data-counts')).toHaveTextContent(JSON.stringify({
      partsLoaded: 2,
      rawImages: 22,
      imageMetadata: 4,
      overlayImages: 8,
      annotations: 6,
    }));
  });

  test('quarantines project A upload, bundle, and child error completions invoked after project B navigation', async () => {
    global.fetch = jest.fn((url) => {
      if (String(url).startsWith('/interface-hierarchy.toml')) {
        return Promise.resolve({ ok: false, text: async () => '' });
      }
      if (String(url).startsWith('/api/projects/project-b/images-page?')) {
        return Promise.resolve(jsonResponse({
          items: [{ id: 'project-b-image', filename: 'b.png' }],
          total: 1,
          next_cursor: null,
          has_more: false,
        }));
      }
      const match = String(url).match(/^\/api\/projects\/(project-[ab])(?:\/(.*))?$/);
      if (!match) return Promise.resolve(jsonResponse({}));
      const [, projectId, suffix = ''] = match;
      const isB = projectId === 'project-b';
      if (!suffix) return Promise.resolve(jsonResponse({ id: projectId, name: isB ? 'Project B' : 'Project A', project_type: 'PT1' }));
      if (suffix === 'metadata-dict') return Promise.resolve(jsonResponse({ owner: isB ? 'B' : 'A' }));
      if (suffix === 'classes') return Promise.resolve(jsonResponse([]));
      if (suffix === 'configuration') return Promise.resolve(jsonResponse({ config: {} }));
      if (suffix === 'data-summary') return Promise.resolve(jsonResponse({
        active_image_count: isB ? 1 : 10,
        part_count: isB ? 1 : 10,
        image_metadata_fields: isB ? 1 : 10,
        annotation_count: isB ? 1 : 10,
        overlay_layer_count: isB ? 1 : 10,
      }));
      if (suffix === 'parts') return Promise.resolve(jsonResponse([{ id: `${projectId}-part` }]));
      return Promise.resolve(jsonResponse({}));
    });

    const view = render(<Project />);
    expect(await screen.findByText('Project A')).toBeInTheDocument();
    await screen.findByTestId('project-data-counts');
    const projectAUploadComplete = mockLatestUploadComplete;
    const projectABundleComplete = mockLatestBundleImportComplete;
    const projectASetError = mockLatestUploaderSetError;
    expect(projectAUploadComplete).toEqual(expect.any(Function));
    expect(projectABundleComplete).toEqual(expect.any(Function));

    await act(async () => {
      mockProjectId = 'project-b';
      window.history.pushState({}, '', `/project/${mockProjectId}${mockSearch}`);
      view.rerender(<Project />);
    });
    expect(await screen.findByText('Project B')).toBeInTheDocument();
    expect(await screen.findByTestId('project-data-counts')).toHaveTextContent('"rawImages":1');

    fireEvent.click(screen.getByRole('tab', { name: 'Images to Parts' }));
    expect(await screen.findByText('Images to parts (1 images, 1 parts)')).toBeInTheDocument();
    const projectARefreshesBeforeLateCallbacks = global.fetch.mock.calls.filter(
      ([url]) => url === '/api/projects/project-a/data-summary',
    ).length;

    let uploadResult;
    let bundleResult;
    await act(async () => {
      uploadResult = await projectAUploadComplete(
        [{ id: 'late-project-a-image', filename: 'late-a.png' }],
        { source: 'local_upload', requiresAuthoritativeReconciliation: false },
      );
      bundleResult = await projectABundleComplete({ project: { id: 'project-a' } });
      projectASetError('late project A child error');
    });

    expect(uploadResult).toEqual({ reconciled: false, authoritative: false, stale: true });
    expect(bundleResult).toBe('stale');
    expect(screen.getByText('Images to parts (1 images, 1 parts)')).toBeInTheDocument();
    expect(screen.getByTestId('project-data-counts')).toHaveTextContent('"rawImages":1');
    expect(screen.queryByText(/late project A child error/)).not.toBeInTheDocument();
    expect(global.fetch.mock.calls.filter(
      ([url]) => url === '/api/projects/project-a/data-summary',
    )).toHaveLength(projectARefreshesBeforeLateCallbacks);
  });
});


describe('Project route ownership for project data actions', () => {
  const overlayA = {
    part_id: 'part-a',
    image_id: 'overlay-a',
    label: 'Late Project A overlay',
    filename: 'a.png',
  };

  const routeFetch = (overrides = {}) => jest.fn((url, options = {}) => {
    const key = String(url);
    if (overrides[key]) return overrides[key](options);
    if (key.startsWith('/interface-hierarchy.toml')) {
      return Promise.resolve({ ok: false, text: async () => '' });
    }
    if (key.includes('/images-page?')) {
      return Promise.resolve(jsonResponse({ items: [], total: 0, next_cursor: null, has_more: false }));
    }
    const match = key.match(/^\/api\/projects\/(project-[ab])(?:\/(.*))?$/);
    if (!match) return Promise.resolve(jsonResponse({}));
    const [, projectId, suffix = ''] = match;
    const isB = projectId === 'project-b';
    if (!suffix) {
      return Promise.resolve(jsonResponse({ id: projectId, name: isB ? 'Project B' : 'Project A', project_type: 'PT1' }));
    }
    if (suffix === 'configuration') return Promise.resolve(jsonResponse({ config: {} }));
    if (suffix === 'data-summary') {
      const count = isB ? 1 : 10;
      return Promise.resolve(jsonResponse({
        active_image_count: count,
        part_count: count,
        image_metadata_fields: count,
        annotation_count: count,
        overlay_layer_count: count,
      }));
    }
    if (suffix === 'analyze/overlays/recently-deleted') return Promise.resolve(jsonResponse([]));
    if (suffix === 'parts' || suffix === 'batches') return Promise.resolve(jsonResponse([]));
    return Promise.resolve(jsonResponse({}));
  });

  const callsTo = (url) => global.fetch.mock.calls.filter(([calledUrl]) => calledUrl === url).length;

  const navigateToProjectB = async (view) => {
    await act(async () => {
      mockProjectId = 'project-b';
      window.history.pushState({}, '', `/project/${mockProjectId}${mockSearch}`);
      view.rerender(<Project />);
    });
    expect(await screen.findByText('Project B')).toBeInTheDocument();
  };

  beforeEach(() => {
    mockProjectId = 'project-a';
    mockPendingAutosave = false;
    mockNavigate.mockClear();
    mockNavigate.mockImplementation(mockNavigateToLocation);
  });

  afterEach(() => {
    mockPendingAutosave = false;
    jest.clearAllMocks();
  });

  test('ignores a deferred project A recently deleted overlay list after navigating to project B', async () => {
    mockSearch = '?tab=project_data&dataTab=recently_deleted';
    window.history.pushState({}, '', `/project/${mockProjectId}${mockSearch}`);
    const recentlyDeletedA = deferred();
    let recentlyDeletedASignal;
    global.fetch = routeFetch({
      '/api/projects/project-a/analyze/overlays/recently-deleted': (options) => {
        recentlyDeletedASignal = options.signal;
        return recentlyDeletedA.promise;
      },
    });

    const view = render(<Project />);
    await waitFor(() => expect(recentlyDeletedASignal).toEqual(expect.any(AbortSignal)));
    expect(await screen.findByText('Loading recently deleted overlays...')).toBeInTheDocument();

    await navigateToProjectB(view);
    expect(await screen.findByText('No Analyze overlays are waiting for deletion.')).toBeInTheDocument();
    expect(recentlyDeletedASignal.aborted).toBe(true);

    await act(async () => {
      recentlyDeletedA.resolve(jsonResponse([overlayA]));
      await Promise.resolve();
    });

    expect(screen.queryByText('Late Project A overlay')).not.toBeInTheDocument();
    expect(screen.getByText('No Analyze overlays are waiting for deletion.')).toBeInTheDocument();
  });

  test('does not refresh or report a project A overlay restore that settles after navigating to project B', async () => {
    mockSearch = '?tab=project_data&dataTab=recently_deleted';
    window.history.pushState({}, '', `/project/${mockProjectId}${mockSearch}`);
    const restoreA = deferred();
    global.fetch = routeFetch({
      '/api/projects/project-a/analyze/overlays/recently-deleted': () => Promise.resolve(jsonResponse([overlayA])),
      '/api/projects/project-a/analyze/overlays/overlay-a/restore': () => restoreA.promise,
    });

    const view = render(<Project />);
    expect(await screen.findByText('Late Project A overlay')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(callsTo('/api/projects/project-a/analyze/overlays/overlay-a/restore')).toBe(1));

    await navigateToProjectB(view);
    expect(await screen.findByText('No Analyze overlays are waiting for deletion.')).toBeInTheDocument();
    const recentlyDeletedACalls = callsTo('/api/projects/project-a/analyze/overlays/recently-deleted');
    const summaryACalls = callsTo('/api/projects/project-a/data-summary');

    await act(async () => {
      restoreA.resolve(jsonResponse({ restored: true }));
      await Promise.resolve();
    });

    expect(callsTo('/api/projects/project-a/analyze/overlays/recently-deleted')).toBe(recentlyDeletedACalls);
    expect(callsTo('/api/projects/project-a/data-summary')).toBe(summaryACalls);
    expect(screen.queryByText('Late Project A overlay')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('does not submit or show a project A ingest validation that resumes after navigating to project B', async () => {
    mockSearch = '?tab=project_data';
    window.history.pushState({}, '', `/project/${mockProjectId}${mockSearch}`);
    const batchesA = deferred();
    global.fetch = routeFetch({
      '/api/projects/project-a/batches': () => batchesA.promise,
    });

    const view = render(<Project />);
    expect(await screen.findByText('Project A')).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('request-ingest-validation'));
    expect(await screen.findByText('Running Ingest Validation...')).toBeInTheDocument();

    await navigateToProjectB(view);
    expect(await screen.findByText('Run Ingest Validation')).toBeInTheDocument();

    await act(async () => {
      batchesA.resolve(jsonResponse([{ id: 'batch-a', name: 'Batch A' }]));
      await Promise.resolve();
    });

    expect(callsTo('/api/projects/project-a/ingest')).toBe(0);
    expect(screen.getByText('Run Ingest Validation')).toBeInTheDocument();
    expect(screen.queryByTestId('ingest-validation-result')).not.toBeInTheDocument();
  });

  test('reports project A metadata-loaded and parts-unloaded callbacks as stale after navigating to project B', async () => {
    mockSearch = '?tab=project_data';
    window.history.pushState({}, '', `/project/${mockProjectId}${mockSearch}`);
    global.fetch = routeFetch();

    const view = render(<Project />);
    expect(await screen.findByText('Project A')).toBeInTheDocument();
    await screen.findByTestId('project-data-counts');
    const projectAMetadataLoaded = mockLatestMetadataLoaded;
    expect(projectAMetadataLoaded).toEqual(expect.any(Function));
    fireEvent.click(screen.getByRole('tab', { name: 'Unload Parts' }));
    expect(await screen.findByText('Unload parts (0 parts)')).toBeInTheDocument();
    const projectAPartsUnloaded = mockLatestPartsUnloaded;
    expect(projectAPartsUnloaded).toEqual(expect.any(Function));

    await navigateToProjectB(view);
    expect(await screen.findByTestId('project-data-counts')).toHaveTextContent('"rawImages":1');
    const metadataACalls = callsTo('/api/projects/project-a/metadata-dict');
    const partsACalls = callsTo('/api/projects/project-a/parts');
    const summaryACalls = callsTo('/api/projects/project-a/data-summary');

    let metadataResult;
    let unloadResult;
    await act(async () => {
      metadataResult = await projectAMetadataLoaded();
      unloadResult = await projectAPartsUnloaded();
    });

    expect(metadataResult).toBe('stale');
    expect(unloadResult).toBe('stale');
    expect(callsTo('/api/projects/project-a/metadata-dict')).toBe(metadataACalls);
    expect(callsTo('/api/projects/project-a/parts')).toBe(partsACalls);
    expect(callsTo('/api/projects/project-a/data-summary')).toBe(summaryACalls);
    expect(screen.getByTestId('project-data-counts')).toHaveTextContent('"rawImages":1');
  });

  test('does not switch tabs when a project A autosave flush finishes after navigating to project B', async () => {
    mockSearch = '?tab=project_configuration';
    window.history.pushState({}, '', `/project/${mockProjectId}${mockSearch}`);
    mockPendingAutosave = true;
    const flushA = deferred();
    mockFlushPendingAutosave.mockImplementation(() => flushA.promise);
    global.fetch = routeFetch();

    const view = render(<Project />);
    expect(await screen.findByText('Project configuration editor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Project Data' }));
    expect(await screen.findByText(/Autosaving project configuration before changing tabs/)).toBeInTheDocument();

    await navigateToProjectB(view);
    expect(screen.queryByText(/Autosaving project configuration before changing tabs/)).not.toBeInTheDocument();
    mockNavigate.mockClear();

    await act(async () => {
      flushA.resolve(true);
      await Promise.resolve();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByText('Project configuration editor')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Project Configuration' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Project title bar type label', () => {
  const originalPt2ShortLabel = PROJECT_TYPE_OPTIONS.find((option) => option.value === 'PT2')?.shortLabel;

  beforeEach(() => {
    mockPendingAutosave = false;
    mockSearch = '';
    mockNavigate.mockClear();
    mockNavigate.mockImplementation(mockNavigateToLocation);
    window.history.pushState({}, '', '/project/proj-1');
    const pt2Option = PROJECT_TYPE_OPTIONS.find((option) => option.value === 'PT2');
    if (pt2Option) pt2Option.shortLabel = 'Config Short Type';
    global.fetch = jest.fn((url) => {
      if (url === '/api/projects/proj-1') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'proj-1', name: 'Configurable Type Project', project_type: 'PT2' }) });
      }
      if (url === '/api/projects/proj-1/metadata-dict') {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      if (url === '/api/projects/proj-1/classes') {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (String(url).startsWith('/api/projects/proj-1/images-page?')) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [], total: 0, next_cursor: null, has_more: false }) });
      }
      if (url === '/api/projects/proj-1/parts') {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (url === '/api/projects/proj-1/export-bundle-json') {
        return Promise.resolve({ ok: true, json: async () => ({ bundle_summary: {} }) });
      }
      if (url === '/api/projects/proj-1/configuration') {
        return Promise.resolve({ ok: true, json: async () => ({ config: {} }) });
      }
      if (String(url).startsWith('/interface-hierarchy.toml')) {
        return Promise.resolve({ ok: false, text: async () => '' });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  afterEach(() => {
    const pt2Option = PROJECT_TYPE_OPTIONS.find((option) => option.value === 'PT2');
    if (pt2Option) pt2Option.shortLabel = originalPt2ShortLabel;
    jest.clearAllMocks();
  });

  test('renders the configured short project type string instead of the raw project type code', async () => {
    render(<Project />);

    expect(await screen.findByText('Type: Config Short Type')).toBeInTheDocument();
    expect(screen.queryByText('Type: PT2')).not.toBeInTheDocument();
  });
});

describe('Project tab autosave coordination', () => {
  beforeEach(() => {
    mockPendingAutosave = false;
    mockSearch = '';
    mockFlushResolve = null;
    mockFlushPendingAutosave.mockReset();
    mockFlushPendingAutosave.mockImplementation(() => new Promise((resolve) => {
      mockFlushResolve = () => {
        mockPendingAutosave = false;
        resolve(true);
      };
    }));
    mockNavigate.mockClear();
    mockNavigate.mockImplementation(mockNavigateToLocation);
    window.history.pushState({}, '', `/project/proj-1${mockSearch}`);
    global.fetch = jest.fn((url) => {
      if (url === '/api/projects/proj-1') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'proj-1', name: 'Autosave Project', project_type: 'PT1' }) });
      }
      if (url === '/api/projects/proj-1/metadata-dict') {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      if (url === '/api/projects/proj-1/classes') {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (String(url).startsWith('/api/projects/proj-1/images-page?')) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [], total: 0, next_cursor: null, has_more: false }) });
      }
      if (url === '/api/projects/proj-1/parts') {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (url === '/api/projects/proj-1/export-bundle-json') {
        return Promise.resolve({ ok: true, json: async () => ({ bundle_summary: {} }) });
      }
      if (url === '/api/projects/proj-1/configuration') {
        return Promise.resolve({ ok: true, json: async () => ({ config: {} }) });
      }
      if (String(url).startsWith('/interface-hierarchy.toml')) {
        return Promise.resolve({ ok: false, text: async () => '' });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('delays tab changes and shows an autosaving message until configuration autosave finishes', async () => {
    mockPendingAutosave = true;
    render(<Project />);

    await waitFor(() => expect(screen.getByText('Project configuration editor')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('tab', { name: 'Project Data' }));

    expect(mockFlushPendingAutosave).toHaveBeenCalledWith('Configuration autosaved.');
    expect(screen.getByRole('status')).toHaveTextContent('Autosaving project configuration before changing tabs…');
    expect(screen.getByText('Project configuration editor')).toBeInTheDocument();

    await act(async () => {
      mockFlushResolve();
    });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByText('Project data summary')).toBeInTheDocument();
  });

  test('keeps Configuration open when a pending invalid draft cannot be flushed', async () => {
    mockPendingAutosave = true;
    mockFlushPendingAutosave.mockResolvedValue(false);
    render(<Project />);

    await waitFor(() => expect(screen.getByText('Project configuration editor')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'Project Data' }));

    await waitFor(() => {
      expect(mockFlushPendingAutosave).toHaveBeenCalledWith('Configuration autosaved.');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Project configuration editor')).toBeInTheDocument();
    expect(screen.queryByText('Project data summary')).not.toBeInTheDocument();
  });
});


describe('Project query parameter tab selection', () => {
  beforeEach(() => {
    mockPendingAutosave = false;
    mockSearch = '?tab=inspection&part=part-42&batch=batch-9&review=manual&image=image-7&metadataTab=details';
    mockNavigate.mockClear();
    mockNavigate.mockImplementation(mockNavigateToLocation);
    window.history.pushState({}, '', `/project/proj-1${mockSearch}`);
    global.fetch = jest.fn((url) => {
      if (url === '/api/projects/proj-1') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'proj-1', name: 'Inspection Project', project_type: 'PT1' }) });
      }
      if (url === '/api/projects/proj-1/metadata-dict') {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      if (url === '/api/projects/proj-1/classes') {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (String(url).startsWith('/api/projects/proj-1/images-page?')) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [], total: 0, next_cursor: null, has_more: false }) });
      }
      if (url === '/api/projects/proj-1/parts') {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (url === '/api/projects/proj-1/export-bundle-json') {
        return Promise.resolve({ ok: true, json: async () => ({ bundle_summary: {} }) });
      }
      if (url === '/api/projects/proj-1/configuration') {
        return Promise.resolve({ ok: true, json: async () => ({ config: {} }) });
      }
      if (String(url).startsWith('/interface-hierarchy.toml')) {
        return Promise.resolve({ ok: false, text: async () => '' });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('updates the URL query when clicking a main tab while preserving unrelated params and clearing stale dataTab', async () => {
    mockSearch = '?tab=project_data&dataTab=metadata&batch=batch-9&review=manual';
    window.history.pushState({}, '', `/project/proj-1${mockSearch}`);

    render(<Project />);

    await waitFor(() => expect(screen.getByText('Project data metadata')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('tab', { name: 'Analyze' }));

    await waitFor(() => expect(screen.getByText('Analyze workbench')).toBeInTheDocument());
    expect(mockNavigate).toHaveBeenCalledWith(
      { pathname: '/project/proj-1', search: 'tab=analyze&batch=batch-9&review=manual' },
      { replace: false },
    );
    expect(window.location.search).toBe('?tab=analyze&batch=batch-9&review=manual');
  });

  test('clears project error banners from the Analyze tab', async () => {
    mockSearch = '?tab=analyze';
    window.history.pushState({}, '', `/project/proj-1${mockSearch}`);

    render(<Project />);

    await waitFor(() => expect(screen.getByText('Analyze workbench')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Trigger analyze error' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Mock analyze failure');
    fireEvent.click(screen.getByRole('button', { name: 'Clear error message' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('updates tab and dataTab query params when clicking project data subtabs', async () => {
    mockSearch = '?tab=project_data&batch=batch-9';
    window.history.pushState({}, '', `/project/proj-1${mockSearch}`);

    render(<Project />);

    await waitFor(() => expect(screen.getByText('Image uploader')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('tab', { name: 'Overlays' }));

    await waitFor(() => expect(screen.getByText(/Overlays tab/)).toBeInTheDocument());
    expect(mockNavigate).toHaveBeenCalledWith(
      { pathname: '/project/proj-1', search: 'tab=project_data&batch=batch-9&dataTab=overlays' },
      { replace: false },
    );
    expect(window.location.search).toBe('?tab=project_data&batch=batch-9&dataTab=overlays');
  });

  test('selects the Inspection tab from the project URL query string and passes launch filters', async () => {
    render(<Project />);

    await waitFor(() => expect(screen.getByText('Inspection workbench')).toBeInTheDocument());

    expect(screen.getByRole('tab', { name: 'Inspection' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('inspection-launch-filters')).toHaveTextContent(JSON.stringify({
      selected_batch_id: 'batch-9',
      selected_part_id: 'part-42',
      review_filter: 'manual',
      selected_image_ref: 'image-7',
      active_metadata_tab: 'details',
    }));
    expect(screen.getByTestId('inspection-read-only')).toHaveTextContent('true');
  });

  test('retains the full MPR session when Inspection unmounts during tab navigation', async () => {
    render(<Project />);

    await waitFor(() => expect(screen.getByText('Inspection workbench')).toBeInTheDocument());
    expect(screen.getByTestId('inspection-mpr-session')).toHaveTextContent('null');

    fireEvent.click(screen.getByRole('button', { name: 'Update MPR session' }));
    const expectedSession = {
      slicePosition: { axial: 17, coronal: 23, sagittal: 31 },
      activePane: 'coronal',
      lastActiveAxis: 'coronal',
      viewportTransform: { zoom: 1.5, panX: 12, panY: -8 },
      rotation: { x: -12, y: 42 },
    };
    expect(screen.getByTestId('inspection-mpr-session')).toHaveTextContent(
      JSON.stringify(expectedSession),
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Analyze' }));
    await waitFor(() => expect(screen.getByText('Analyze workbench')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'Inspection' }));

    await waitFor(() => expect(screen.getByText('Inspection workbench')).toBeInTheDocument());
    expect(screen.getByTestId('inspection-mpr-session')).toHaveTextContent(
      JSON.stringify(expectedSession),
    );
  });

  test('does not show project classes or metadata management on the configuration tab', async () => {
    mockSearch = '?tab=project_configuration';
    render(<Project />);

    await waitFor(() => expect(screen.getByText('Project configuration editor')).toBeInTheDocument());
    expect(screen.queryByText('Class manager')).not.toBeInTheDocument();
    expect(screen.queryByText('Metadata manager')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show filename config' }));
    expect(screen.queryByText('Class manager')).not.toBeInTheDocument();
    expect(screen.queryByText('Metadata manager')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show hotkeys config' }));
    expect(screen.queryByText('Class manager')).not.toBeInTheDocument();
    expect(screen.queryByText('Metadata manager')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show general config' }));
    expect(screen.queryByText('Class manager')).not.toBeInTheDocument();
    expect(screen.queryByText('Metadata manager')).not.toBeInTheDocument();
  });

  test('replaces the parent route query with allowlisted inspection share state', async () => {
    render(<Project />);

    await waitFor(() => expect(screen.getByText('Inspection workbench')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Share inspection state' }));

    expect(mockNavigate).toHaveBeenLastCalledWith(
      {
        pathname: '/project/proj-1',
        search: 'tab=inspection&batch=batch-10&part=part-43&image=image-8&review=pass&metadataTab=other&mprPane=coronal&overlays=overlay-a',
      },
      { replace: true },
    );
  });

});

describe('Project session link sharing', () => {
  beforeEach(() => {
    mockPendingAutosave = false;
    mockSearch = '?tab=inspection&image=image-7';
    mockNavigate.mockClear();
    mockNavigate.mockImplementation(mockNavigateToLocation);
    window.history.pushState({}, '', `/project/proj-1${mockSearch}`);
    global.fetch = jest.fn((url) => {
      if (url === '/api/projects/proj-1') return Promise.resolve({ ok: true, json: async () => ({ id: 'proj-1', name: 'Share Project', project_type: 'PT1' }) });
      if (url === '/api/projects/proj-1/metadata-dict') return Promise.resolve({ ok: true, json: async () => ({}) });
      if (url === '/api/projects/proj-1/classes') return Promise.resolve({ ok: true, json: async () => [] });
      if (String(url).startsWith('/api/projects/proj-1/images-page?')) return Promise.resolve({ ok: true, json: async () => ({ items: [], total: 0, next_cursor: null, has_more: false }) });
      if (url === '/api/projects/proj-1/parts') return Promise.resolve({ ok: true, json: async () => [] });
      if (url === '/api/projects/proj-1/export-bundle-json') return Promise.resolve({ ok: true, json: async () => ({ bundle_summary: {} }) });
      if (url === '/api/projects/proj-1/configuration') return Promise.resolve({ ok: true, json: async () => ({ config: {} }) });
      if (String(url).startsWith('/interface-hierarchy.toml')) return Promise.resolve({ ok: false, text: async () => '' });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  test('copies the exact current browser URL from the project header', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    render(<Project />);
    await waitFor(() => expect(screen.getByText('Share Project')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Copy session link' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
    await waitFor(() => expect(screen.getByText('Session link copied to clipboard.')).toBeInTheDocument());
  });
});

describe('Project configurable UI sections', () => {
  beforeEach(() => {
    mockPendingAutosave = false;
    mockSearch = '';
    mockNavigate.mockClear();
    mockNavigate.mockImplementation(mockNavigateToLocation);
    window.history.pushState({}, '', '/project/proj-1');
    global.fetch = jest.fn((url) => {
      if (url === '/api/projects/proj-1') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'proj-1', name: 'Configurable UI Project', project_type: 'PT1' }) });
      }
      if (url === '/api/projects/proj-1/metadata-dict') {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      if (url === '/api/projects/proj-1/classes') {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (String(url).startsWith('/api/projects/proj-1/images-page?')) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [], total: 0, next_cursor: null, has_more: false }) });
      }
      if (url === '/api/projects/proj-1/parts') {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (url === '/api/projects/proj-1/export-bundle-json') {
        return Promise.resolve({ ok: true, json: async () => ({ bundle_summary: {} }) });
      }
      if (url === '/api/projects/proj-1/configuration') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            config: {
              ui_sections: {
                'main.analyze': false,
                'main.report': false,
                'project_data.batches': false,
                'project_data.data_validation': false,
              },
            },
          }),
        });
      }
      if (String(url).startsWith('/interface-hierarchy.toml')) {
        return Promise.resolve({ ok: false, text: async () => '' });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('hides project tabs and Project Data sections disabled by configuration', async () => {
    render(<Project />);

    await waitFor(() => expect(screen.getByText('Project configuration editor')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Analyze' })).not.toBeInTheDocument());
    expect(screen.queryByRole('tab', { name: 'Report' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Project Data' }));

    expect(screen.queryByRole('tab', { name: 'Batches' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Data Validation' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Images to Parts' })).toBeInTheDocument();
    expect(await screen.findByTestId('project-data-counts')).toBeInTheDocument();
  });
});
