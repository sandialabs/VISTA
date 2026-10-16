import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectDataExportPanel from '../ProjectDataExportPanel';

describe('ProjectDataExportPanel', () => {
  jest.setTimeout(10000);
  beforeEach(() => {
    global.fetch = jest.fn((url) => {
      if (String(url).includes('/export-bundle/estimate')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ estimated_bytes: 1572864 }),
        });
      }
      return Promise.resolve({
        ok: true,
        headers: { get: () => 'attachment; filename="project_export_bundle.zip"' },
        blob: async () => new Blob(['zip-bytes'], { type: 'application/zip' }),
      });
    });
    window.URL.createObjectURL = jest.fn(() => 'blob:project-export');
    window.URL.revokeObjectURL = jest.fn();
    HTMLAnchorElement.prototype.click = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('asks whether to overwrite or append when importing into a non-blank project', async () => {
    const setError = jest.fn();
    const onImportComplete = jest.fn();
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({ project: { images_created: 3 } }),
    }));

    render(
      <ProjectDataExportPanel
        projectId="project-123"
        projectName="Inspection Project"
        counts={{ rawImages: 5, overlayImages: 2, annotations: 7 }}
        setError={setError}
        onImportComplete={onImportComplete}
      />
    );

    fireEvent.change(screen.getByLabelText(/Choose project bundle to import/i), {
      target: {
        files: [new File(['zip-bytes'], 'bundle.zip', { type: 'application/zip' })],
      },
    });

    expect(screen.getByRole('dialog', { name: /Import into non-blank project/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Append to Current Project/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project-123/import',
      expect.objectContaining({ method: 'POST' })
    ));
    const [, options] = global.fetch.mock.calls.find(([url]) => url === '/api/projects/project-123/import');
    expect(options.method).toBe('POST');
    expect(options.body.get('mode')).toBe('append_active');
    expect(options.body.get('confirmation')).toBe('IMPORT');
    expect(await screen.findByTestId('project-data-import-result')).toHaveTextContent('Appended project bundle: 3 images imported');
    expect(onImportComplete).toHaveBeenCalled();
  }, 10000);

  test('imports blank projects without prompting and uses append mode', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({ project: { images_created: 1 } }),
    }));

    render(
      <ProjectDataExportPanel
        projectId="project-blank"
        projectName="Blank"
        counts={{ rawImages: 0, overlayImages: 0, annotations: 0 }}
      />
    );

    fireEvent.change(screen.getByLabelText(/Choose project bundle to import/i), {
      target: {
        files: [new File(['zip-bytes'], 'bundle.zip', { type: 'application/zip' })],
      },
    });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project-blank/import',
      expect.objectContaining({ method: 'POST' })
    ));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const [, options] = global.fetch.mock.calls.find(([url]) => url === '/api/projects/project-blank/import');
    expect(options.body.get('mode')).toBe('append_active');
  }, 10000);

  test('exports selected project artifacts with TOML bundle options', async () => {
    const setError = jest.fn();
    render(
      <ProjectDataExportPanel
        projectId="project-123"
        projectName="Inspection Project"
        counts={{ rawImages: 5, overlayImages: 2, annotations: 7 }}
        setError={setError}
      />
    );

    expect(screen.getByText('Export Data')).toBeInTheDocument();
    expect(screen.getByText('Loaded images')).toBeInTheDocument();
    expect(screen.getByText('Project configuration')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(await screen.findByText('1.50 MB')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Loaded overlays/i));
    fireEvent.click(screen.getByRole('button', { name: /Export Project Bundle/i }));

    await waitFor(() => expect(window.URL.createObjectURL).toHaveBeenCalled());
    const requestedUrl = global.fetch.mock.calls
      .map(([url]) => url)
      .find((url) => String(url).includes('/export-bundle?'));
    expect(requestedUrl).toContain('/api/projects/project-123/export-bundle?');
    expect(requestedUrl).toContain('include_images=true');
    expect(requestedUrl).toContain('include_overlays=false');
    expect(requestedUrl).toContain('include_metadata=true');
    expect(requestedUrl).toContain('include_created_overlays=true');
    expect(requestedUrl).toContain('include_project_configuration=true');
    expect(window.URL.createObjectURL).toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith(null);
    expect(await screen.findByTestId('project-data-export-result')).toHaveTextContent('4 export sections');
  }, 10000);

  test('exports and imports project bundles through S3 endpoints', async () => {
    const setError = jest.fn();
    global.fetch = jest.fn((url) => {
      if (String(url).includes('/export-bundle/estimate')) {
        return Promise.resolve({ ok: true, json: async () => ({ estimated_bytes: 2048 }) });
      }
      if (url.endsWith('/export-bundle/s3')) {
        return Promise.resolve({ ok: true, json: async () => ({ s3_url: 's3://bucket/project.vistabundle' }) });
      }
      if (url.endsWith('/import/s3')) {
        return Promise.resolve({ ok: true, json: async () => ({ project: { images_created: 2 } }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(
      <ProjectDataExportPanel
        projectId="project-123"
        projectName="Inspection Project"
        counts={{ rawImages: 0, overlayImages: 0, annotations: 0 }}
        setError={setError}
      />
    );

    fireEvent.change(screen.getByLabelText('Export bundle to S3'), {
      target: { value: 's3://bucket/project.vistabundle' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export to S3' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project-123/export-bundle/s3',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('s3://bucket/project.vistabundle') })
    ));
    expect(await screen.findByTestId('project-data-export-result')).toHaveTextContent('Project bundle exported to s3://bucket/project.vistabundle');

    fireEvent.change(screen.getByLabelText('Import project bundle from S3'), {
      target: { value: 's3://bucket/project.vistabundle' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import from S3' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project-123/import/s3',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('append_active') })
    ));
    expect(await screen.findByTestId('project-data-import-result')).toHaveTextContent('Appended S3 project bundle: 2 images imported');
    expect(setError).toHaveBeenLastCalledWith(null);
  }, 10000);

});
