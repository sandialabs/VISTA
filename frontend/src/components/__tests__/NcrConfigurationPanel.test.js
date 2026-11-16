import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProjectConfigurationPanel from '../ProjectConfigurationPanel';

jest.setTimeout(10000);

function baseConfig(overrides = {}) {
  return {
    image_modalities: [{ id: 'visual', label: 'Visual', calibration_required: false, example_image_uploaded: false }],
    part_views: [{ id: 'front', label: 'Front', required_modalities: ['visual'], source: 'manual' }],
    defect_types: [{ name: 'Crack', color: '#ef4444', definition: '' }],
    process_settings: {
      require_disposition_on_submit: true,
      require_measurement_for_critical: false,
      require_second_reviewer_for_reject: false,
      configurable_hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    },
    display_settings: { default_colormap: 'grayscale', anomaly_colormap: 'viridis', grayscale_base_image: true },
    ...overrides,
  };
}

function mockFetch(config, { cloneConfig } = {}) {
  global.fetch = jest.fn((url, options = {}) => {
    if (url === '/api/projects/') {
      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: 'proj-1', name: 'Current Project', project_type: 'PT2' },
          { id: 'proj-src', name: 'Source Project', project_type: 'PT2' },
        ],
      });
    }
    if (url.includes('/configuration/clone') && options.method === 'POST') {
      return Promise.resolve({ ok: true, json: async () => ({ config: cloneConfig || config }) });
    }
    if (url.includes('/configuration') && options.method === 'PUT') {
      const body = JSON.parse(options.body);
      return Promise.resolve({ ok: true, json: async () => ({ config: body.config }) });
    }
    if (url.includes('/configuration')) {
      return Promise.resolve({ ok: true, json: async () => ({ config, project_type: 'PT2' }) });
    }
    if (url.includes('/users/me')) {
      return Promise.resolve({ ok: true, json: async () => ({ email: 'tester@example.com' }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

function lastSavedConfig() {
  const puts = global.fetch.mock.calls.filter(
    ([url, options = {}]) => url === '/api/projects/proj-1/configuration' && options.method === 'PUT',
  );
  expect(puts.length).toBeGreaterThan(0);
  return JSON.parse(puts[puts.length - 1][1].body).config;
}

async function openNcrTab() {
  const tab = await screen.findByRole('tab', { name: 'NCR Configuration' });
  fireEvent.click(tab);
  return screen.getByRole('tabpanel', { name: 'NCR configuration' });
}

describe('NCR Configuration subtab', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('is listed alongside General, Hotkeys, and UI Configuration', async () => {
    mockFetch(baseConfig());
    render(<ProjectConfigurationPanel projectId="proj-1" projectType="PT2" />);
    const tablist = await screen.findByRole('tablist', { name: 'Configuration sections' });
    const labels = within(tablist).getAllByRole('tab').map((tab) => tab.textContent);
    expect(labels).toEqual(expect.arrayContaining(['General', 'Hotkeys', 'UI Configuration', 'NCR Configuration']));
    expect(labels.indexOf('NCR Configuration')).toBe(labels.length - 1);
  });

  test('shows empty failure and disposition code sections by default', async () => {
    mockFetch(baseConfig());
    render(<ProjectConfigurationPanel projectId="proj-1" projectType="PT2" />);
    const panel = await openNcrTab();
    expect(within(panel).getByRole('region', { name: 'Failure Codes' })).toBeInTheDocument();
    expect(within(panel).getByRole('region', { name: 'Disposition Codes' })).toBeInTheDocument();
    expect(within(panel).getByText('No failure codes configured yet.')).toBeInTheDocument();
    expect(within(panel).getByText('No disposition codes configured yet.')).toBeInTheDocument();
  });

  test('adds failure and disposition codes and saves them in the project config', async () => {
    mockFetch(baseConfig());
    render(<ProjectConfigurationPanel projectId="proj-1" projectType="PT2" />);
    await openNcrTab();

    fireEvent.click(screen.getByRole('button', { name: 'Add Failure code' }));
    fireEvent.change(screen.getByLabelText('Failure Codes code 1'), { target: { value: 'FC-01' } });
    fireEvent.change(screen.getByLabelText('Failure Codes description 1'), { target: { value: 'Porosity' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Disposition code' }));
    fireEvent.change(screen.getByLabelText('Disposition Codes code 1'), { target: { value: 'RWK' } });
    fireEvent.change(screen.getByLabelText('Disposition Codes description 1'), { target: { value: 'Rework' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));
    await waitFor(() => expect(lastSavedConfig().ncr_configuration).toEqual({
      failure_codes: [{ code: 'FC-01', description: 'Porosity' }],
      disposition_codes: [{ code: 'RWK', description: 'Rework' }],
    }));
  });

  test('loads existing codes and removes one', async () => {
    mockFetch(baseConfig({
      ncr_configuration: {
        failure_codes: [
          { code: 'FC-01', description: 'Porosity' },
          { code: 'FC-02', description: 'Crack' },
        ],
        disposition_codes: [{ code: 'SCR', description: 'Scrap' }],
      },
    }));
    render(<ProjectConfigurationPanel projectId="proj-1" projectType="PT2" />);
    await openNcrTab();
    expect(screen.getByLabelText('Failure Codes code 2')).toHaveValue('FC-02');

    fireEvent.click(screen.getByRole('button', { name: 'Remove failure code 1' }));
    expect(screen.getByLabelText('Failure Codes code 1')).toHaveValue('FC-02');
    fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));
    await waitFor(() => expect(lastSavedConfig().ncr_configuration.failure_codes).toEqual([
      { code: 'FC-02', description: 'Crack' },
    ]));
  });

  test('autosaves code edits', async () => {
    mockFetch(baseConfig({
      ncr_configuration: { failure_codes: [{ code: 'FC-01', description: '' }], disposition_codes: [] },
    }));
    render(<ProjectConfigurationPanel projectId="proj-1" projectType="PT2" />);
    await openNcrTab();
    fireEvent.change(screen.getByLabelText('Failure Codes description 1'), { target: { value: 'Porosity' } });
    await waitFor(
      () => expect(lastSavedConfig().ncr_configuration.failure_codes).toEqual([
        { code: 'FC-01', description: 'Porosity' },
      ]),
      { timeout: 3000 },
    );
  });

  test('blank and duplicate rows are flagged inline and never hide the editor', async () => {
    mockFetch(baseConfig({
      ncr_configuration: { failure_codes: [{ code: 'FC-01', description: '' }], disposition_codes: [] },
    }));
    render(<ProjectConfigurationPanel projectId="proj-1" projectType="PT2" />);
    await openNcrTab();
    const putCount = () => global.fetch.mock.calls.filter(([, o = {}]) => o.method === 'PUT').length;
    const putsBefore = putCount();

    fireEvent.click(screen.getByRole('button', { name: 'Add Failure code' }));
    const newCode = screen.getByLabelText('Failure Codes code 2');
    expect(newCode).toHaveFocus();
    expect(newCode).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a code.')).toBeInTheDocument();

    // Regression: background autosave used to replace the whole editor with
    // "Each entry in Failure Codes requires a code." about 500 ms after Add.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 800)); });
    expect(screen.getByRole('tabpanel', { name: 'NCR configuration' })).toBeInTheDocument();
    expect(screen.queryByTestId('configuration-validation-error')).not.toBeInTheDocument();
    expect(screen.getByText('Unsaved changes will save once the highlighted fields are complete.')).toBeInTheDocument();
    expect(putCount()).toBe(putsBefore);

    fireEvent.change(newCode, { target: { value: 'fc-01' } });
    expect(screen.getAllByText('This code is already in the list.')).toHaveLength(2);

    // An explicit save reports the problem above the editor, which stays usable.
    fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));
    await waitFor(() => expect(screen.getByTestId('configuration-validation-error'))
      .toHaveTextContent('Failure Codes must be unique (case-insensitive).'));
    expect(screen.getByRole('tabpanel', { name: 'NCR configuration' })).toBeInTheDocument();
    expect(putCount()).toBe(putsBefore);

    fireEvent.change(newCode, { target: { value: 'FC-02' } });
    expect(screen.queryByTestId('configuration-validation-error')).not.toBeInTheDocument();
    await waitFor(() => expect(putCount()).toBe(putsBefore + 1), { timeout: 3000 });
    expect(lastSavedConfig().ncr_configuration.failure_codes.map((entry) => entry.code)).toEqual(['FC-01', 'FC-02']);
  });

  test('limits code and description length in the inputs', async () => {
    mockFetch(baseConfig({
      ncr_configuration: { failure_codes: [{ code: 'FC-01', description: '' }], disposition_codes: [] },
    }));
    render(<ProjectConfigurationPanel projectId="proj-1" projectType="PT2" />);
    await openNcrTab();
    expect(screen.getByLabelText('Failure Codes code 1')).toHaveAttribute('maxLength', '64');
    expect(screen.getByLabelText('Failure Codes description 1')).toHaveAttribute('maxLength', '255');
  });

  test('is read-only for archived projects', async () => {
    mockFetch(baseConfig({
      ncr_configuration: { failure_codes: [{ code: 'FC-01', description: '' }], disposition_codes: [] },
    }));
    render(
      <ProjectConfigurationPanel
        projectId="proj-1"
        projectType="PT2"
        project={{ id: 'proj-1', is_archived: true, project_type: 'PT2' }}
      />,
    );
    await openNcrTab();
    expect(screen.getByRole('button', { name: 'Add Failure code' })).toBeDisabled();
    expect(screen.getByLabelText('Failure Codes code 1')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove failure code 1' })).toBeDisabled();
  });

  test('can be hidden through ui_sections', async () => {
    mockFetch(baseConfig({ ui_sections: { 'project_configuration.ncr_configuration': false } }));
    render(<ProjectConfigurationPanel projectId="proj-1" projectType="PT2" />);
    await screen.findByRole('tab', { name: 'General' });
    expect(screen.queryByRole('tab', { name: 'NCR Configuration' })).not.toBeInTheDocument();
  });

  test('copying configuration from another project brings its NCR codes', async () => {
    const sourceNcr = {
      failure_codes: [{ code: 'SRC-FC', description: 'From source' }],
      disposition_codes: [{ code: 'SRC-DC', description: 'Source disposition' }],
    };
    mockFetch(baseConfig(), { cloneConfig: baseConfig({ ncr_configuration: sourceNcr }) });
    render(<ProjectConfigurationPanel projectId="proj-1" projectType="PT2" />);
    await screen.findByRole('tab', { name: 'General' });

    fireEvent.change(await screen.findByLabelText("Source project"), { target: { value: 'proj-src' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy from Project' }));
    await screen.findByText('Configuration copied from Source Project.');

    await openNcrTab();
    expect(screen.getByLabelText('Failure Codes code 1')).toHaveValue('SRC-FC');
    expect(screen.getByLabelText('Disposition Codes code 1')).toHaveValue('SRC-DC');
  });

  test('rejects a copied configuration with malformed NCR codes', async () => {
    mockFetch(baseConfig(), {
      cloneConfig: baseConfig({
        ncr_configuration: { failure_codes: [{ code: '' }], disposition_codes: [] },
      }),
    });
    render(<ProjectConfigurationPanel projectId="proj-1" projectType="PT2" />);
    await screen.findByRole('tab', { name: 'General' });
    fireEvent.change(await screen.findByLabelText("Source project"), { target: { value: 'proj-src' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy from Project' }));
    await screen.findByText(/invalid config settings fields/);
  });

  test('adding a blank defect type no longer hides the editor after autosave', async () => {
    mockFetch(baseConfig());
    render(<ProjectConfigurationPanel projectId="proj-1" projectType="PT2" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Defect Type' }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 800)); });
    expect(screen.getByLabelText('Defect type name 2')).toBeInTheDocument();
    expect(screen.queryByText('Each defect type requires a name.')).not.toBeInTheDocument();
  });
});
