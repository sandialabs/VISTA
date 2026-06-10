import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectDataExportPanel from '../ProjectDataExportPanel';

describe('ProjectDataExportPanel', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      headers: { get: () => 'attachment; filename="project_export_bundle.zip"' },
      blob: async () => new Blob(['zip-bytes'], { type: 'application/zip' }),
    }));
    window.URL.createObjectURL = jest.fn(() => 'blob:project-export');
    window.URL.revokeObjectURL = jest.fn();
    HTMLAnchorElement.prototype.click = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });



  test('asks whether to overwrite or append when importing into a non-blank project', async () => {
    const user = userEvent.setup();
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

    await user.upload(
      screen.getByLabelText(/Choose project bundle to import/i),
      new File(['zip-bytes'], 'bundle.zip', { type: 'application/zip' })
    );

    expect(screen.getByRole('dialog', { name: /Import into non-blank project/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Append to Current Project/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/projects/project-123/import');
    expect(options.method).toBe('POST');
    expect(options.body.get('mode')).toBe('append_active');
    expect(options.body.get('confirmation')).toBe('IMPORT');
    expect(await screen.findByTestId('project-data-import-result')).toHaveTextContent('Appended project bundle: 3 images imported');
    expect(onImportComplete).toHaveBeenCalled();
  });

  test('imports blank projects without prompting and uses append mode', async () => {
    const user = userEvent.setup();
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

    await user.upload(
      screen.getByLabelText(/Choose project bundle to import/i),
      new File(['zip-bytes'], 'bundle.zip', { type: 'application/zip' })
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(global.fetch.mock.calls[0][1].body.get('mode')).toBe('append_active');
  });

  test('exports selected project artifacts with TOML bundle options', async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByLabelText(/Loaded overlays/i));
    await user.click(screen.getByRole('button', { name: /Export Project Bundle/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const requestedUrl = global.fetch.mock.calls[0][0];
    expect(requestedUrl).toContain('/api/projects/project-123/export-bundle?');
    expect(requestedUrl).toContain('include_images=true');
    expect(requestedUrl).toContain('include_overlays=false');
    expect(requestedUrl).toContain('include_metadata=true');
    expect(requestedUrl).toContain('include_created_overlays=true');
    expect(requestedUrl).toContain('include_project_configuration=true');
    expect(window.URL.createObjectURL).toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith(null);
    expect(await screen.findByTestId('project-data-export-result')).toHaveTextContent('4 export sections');
  });
});
