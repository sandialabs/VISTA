import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Project from '../Project';

let mockPendingAutosave = false;
let mockFlushResolve = null;
const mockFlushPendingAutosave = jest.fn();

jest.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'proj-1' }),
  useNavigate: () => jest.fn(),
}));

jest.mock('../components/ProjectConfigurationPanel', () => {
  const React = require('react');
  return React.forwardRef(function MockProjectConfigurationPanel(_props, ref) {
    React.useImperativeHandle(ref, () => ({
      hasPendingAutosave: () => mockPendingAutosave,
      flushPendingAutosave: mockFlushPendingAutosave,
    }));
    return <div>Project configuration editor</div>;
  });
});

jest.mock('../components/ImageUploader', () => () => <div>Image uploader</div>);
jest.mock('../components/MetadataManager', () => () => <div>Metadata manager</div>);
jest.mock('../components/ClassManager', () => () => <div>Class manager</div>);
jest.mock('../components/InspectionWorkbenchPanel', () => () => <div>Inspection workbench</div>);
jest.mock('../components/AnalyzeWorkbenchTab', () => () => <div>Analyze workbench</div>);
jest.mock('../components/ProjectDataSummaryTab', () => () => <div>Project data summary</div>);
jest.mock('../components/ProjectDataExportPanel', () => () => <div>Project data export</div>);
jest.mock('../components/ProjectReportTab', () => () => <div>Project report</div>);
jest.mock('../components/ProjectPhaseFlow', () => () => <div>Project phase flow</div>);
jest.mock('../components/ImagesToPartsTab', () => () => <div>Images to parts</div>);
jest.mock('../components/BatchesTab', () => () => <div>Batches</div>);
jest.mock('../components/RemoveImagesTab', () => () => <div>Remove images</div>);

describe('Project tab autosave coordination', () => {
  beforeEach(() => {
    mockPendingAutosave = false;
    mockFlushResolve = null;
    mockFlushPendingAutosave.mockReset();
    mockFlushPendingAutosave.mockImplementation(() => new Promise((resolve) => {
      mockFlushResolve = () => {
        mockPendingAutosave = false;
        resolve(true);
      };
    }));
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
      if (String(url).startsWith('/api/projects/proj-1/images')) {
        return Promise.resolve({ ok: true, json: async () => [] });
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
});
