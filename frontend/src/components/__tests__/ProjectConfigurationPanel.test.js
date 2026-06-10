import React from 'react';
import fs from 'fs';
import path from 'path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectConfigurationPanel from '../ProjectConfigurationPanel';

const projectTypes = ['PT1', 'PT2', 'PT3'];
const syntheticUsers = ['basic', 'intermediate', 'advanced'];

function makeConfig(projectType, syntheticUser) {
  const complexity = syntheticUsers.indexOf(syntheticUser) + 1;
  return {
    image_modalities: Array.from({ length: complexity }, (_, index) => ({
      id: `${projectType.toLowerCase()}-${syntheticUser}-modality-${index + 1}`,
      label: `Modality ${index + 1}`,
      calibration_required: index > 0,
      example_image_uploaded: true,
    })),
    part_views: Array.from({ length: complexity + 1 }, (_, index) => ({
      id: `${projectType.toLowerCase()}-${syntheticUser}-view-${index + 1}`,
      label: `View ${index + 1}`,
      required_modalities: [`${projectType.toLowerCase()}-${syntheticUser}-modality-1`],
      source: index % 2 === 0 ? 'manual' : 'auto',
    })),
    defect_types: Array.from({ length: complexity }, (_, index) => ({
      name: `Defect ${index + 1}`,
      color: '#ef4444',
      definition: `Definition ${index + 1}`,
    })),
    process_settings: {
      require_disposition_on_submit: true,
      require_measurement_for_critical: complexity > 1,
      require_second_reviewer_for_reject: complexity > 2,
      configurable_hotkeys: {
        accept_classification: complexity === 1 ? 'a' : complexity === 2 ? 's' : 'z',
        reject_classification: complexity === 1 ? 'r' : complexity === 2 ? 'd' : 'x',
        toggle_shortcut_help: complexity === 1 ? 'h' : complexity === 2 ? 'f' : 'c',
      },
    },
    display_settings: {
      default_colormap: complexity > 1 ? 'magma' : 'grayscale',
      anomaly_colormap: 'viridis',
      grayscale_base_image: true,
    },
    serial_number_scheme: {
      batch_sn_enabled: true,
      sub_batching_enabled: complexity > 1,
      sub_batch_sn_enabled: complexity > 2,
      part_sn_enabled: true,
    },
  };
}

function mockFetch(config, projectType, mockOptions = {}) {
  const alternateProjectType = projectType === 'PT1' ? 'PT2' : 'PT1';
  global.fetch = jest.fn((url, requestOptions = {}) => {
    if (url === '/api/projects/') {
      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: 'proj-1', name: 'Current Project', project_type: projectType },
          { id: 'proj-copy', name: 'Template Project', project_type: projectType },
          { id: 'proj-copy-2', name: 'Template Project 2', project_type: projectType },
          { id: 'proj-cross-type', name: 'Cross-Type Project', project_type: alternateProjectType },
        ],
      });
    }

    if (url.includes('/configuration/clone') && requestOptions.method === 'POST') {
      if (mockOptions.cloneFailureDetail) {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({ detail: mockOptions.cloneFailureDetail }),
        });
      }
      if (mockOptions.cloneInvalidJson) {
        return Promise.resolve({
          ok: false,
          status: 502,
          json: async () => {
            throw new Error('invalid json');
          },
        });
      }
      if (mockOptions.delayedClone) {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true, json: async () => ({ config: { ...config, defect_types: [] } }) }), 25);
        });
      }
      if (mockOptions.cloneMissingConfig) {
        return Promise.resolve({ ok: true, json: async () => ({ copied: true }) });
      }
      if (mockOptions.cloneInvalidConfigShape) {
        return Promise.resolve({ ok: true, json: async () => ({ config: {} }) });
      }
      if (mockOptions.cloneInvalidConfigEntries) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            config: {
              ...config,
              image_modalities: [null],
              part_views: [{ id: 'pv-1', label: 'View 1', required_modalities: 'not-an-array' }],
              defect_types: ['not-an-object'],
            },
          }),
        });
      }
      if (mockOptions.cloneInvalidConfigScalarFields) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            config: {
              ...config,
              image_modalities: [{ id: 123, label: 'Modality 1' }],
              part_views: [{ id: 'pv-1', label: 42, required_modalities: [9] }],
              defect_types: [{ name: null, color: '#ef4444' }],
            },
          }),
        });
      }
      if (mockOptions.cloneInvalidConfigSettingsFields) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            config: {
              ...config,
              process_settings: {
                require_disposition_on_submit: 'yes',
                require_measurement_for_critical: true,
                require_second_reviewer_for_reject: false,
                configurable_hotkeys: {
                  accept_classification: 'a',
                  reject_classification: 9,
                  toggle_shortcut_help: 'h',
                },
              },
              display_settings: {
                default_colormap: 'grayscale',
                anomaly_colormap: 'viridis',
                grayscale_base_image: 'true',
              },
            },
          }),
        });
      }
      if (mockOptions.cloneInvalidConfigDomainFields) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            config: {
              ...config,
              part_views: [{ id: 'pv-1', label: 'View 1', required_modalities: [config.image_modalities[0]?.id || 'm1'], source: 'api' }],
              display_settings: {
                ...config.display_settings,
                default_colormap: 'plasma',
              },
            },
          }),
        });
      }
      if (mockOptions.cloneInvalidConfigHotkeyDomainFields) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            config: {
              ...config,
              process_settings: {
                ...config.process_settings,
                configurable_hotkeys: {
                  accept_classification: 'aa',
                  reject_classification: 'aa',
                  toggle_shortcut_help: 'h',
                },
              },
            },
          }),
        });
      }
      if (mockOptions.cloneInvalidConfigRelationalFields) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            config: {
              ...config,
              image_modalities: [
                { id: 'duplicate-id', label: 'Modality 1' },
                { id: 'duplicate-id', label: 'Modality 2' },
              ],
              part_views: [
                { id: 'view-1', label: 'View 1', required_modalities: ['duplicate-id'] },
                { id: 'view-1', label: 'View 2', required_modalities: ['missing-modality'] },
              ],
            },
          }),
        });
      }
      if (mockOptions.cloneInvalidConfigSemanticFields) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            config: {
              ...config,
              image_modalities: [{ id: '   ', label: '   ' }],
              part_views: [{ id: 'view-1', label: ' ', required_modalities: ['   '] }],
              defect_types: [{ name: '   ', color: 'red' }],
            },
          }),
        });
      }
      if (mockOptions.cloneInvalidConfigDefectRelationalFields) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            config: {
              ...config,
              defect_types: [
                { name: 'Duplicate Defect', color: '#ef4444' },
                { name: 'duplicate defect', color: '#22c55e' },
              ],
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ config: { ...config, defect_types: [] } }) });
    }

    if (url.includes('/configuration/interface-layout/default') && requestOptions.method === 'POST') {
      return Promise.resolve({ ok: true, json: async () => ({ config }) });
    }

    if (url.includes('/configuration/interface-layout/project-type-default') && requestOptions.method === 'POST') {
      return Promise.resolve({ ok: true, json: async () => ({ config }) });
    }

    if (url.includes('/configuration') && requestOptions.method === 'PUT') {
      return Promise.resolve({ ok: true, json: async () => ({ config }) });
    }

    if (url.includes('/configuration')) {
      return Promise.resolve({ ok: true, json: async () => ({ config }) });
    }

    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

describe('ProjectConfigurationPanel', () => {

  test('shows expected filename preview as the primary file naming guide and updates from hierarchy abbreviations', async () => {
    const config = {
      ...makeConfig('PT1', 'basic'),
      file_naming_scheme: {
        hierarchy_levels: [
          { id: 'drawing_number', label: 'Drawing Number', abbreviation: 'D' },
          { id: 'lot_number', label: 'Lot Number', abbreviation: 'L' },
          { id: 'part_number', label: 'Part Number', abbreviation: 'PN' },
        ],
        image_descriptors: [
          { id: 'side', label: 'Side', abbreviation: 'S' },
          { id: 'modality', label: 'Modality', abbreviation: 'M' },
        ],
      },
    };
    mockFetch(config, 'PT1');

    render(<ProjectConfigurationPanel projectId="proj-1" />);

    const preview = await screen.findByTestId('expected-filename-preview');
    expect(preview).toHaveTextContent('D001_L001_PN001_side_modality.type');
    expect(screen.getByLabelText('Expected filename preview')).toHaveTextContent('ID value: 001');

    fireEvent.change(screen.getByLabelText('Abbreviation', { selector: '#hierarchy-level-abbreviation-2' }), {
      target: { value: 'PART' },
    });

    expect(screen.getByTestId('expected-filename-preview')).toHaveTextContent('D001_L001_PART001_side_modality.type');
  });

  test('keeps view descriptors user-facing as side in the expected filename preview', async () => {
    const config = makeConfig('PT1', 'basic');
    mockFetch(config, 'PT1');

    render(<ProjectConfigurationPanel projectId="proj-1" />);

    expect(await screen.findByTestId('expected-filename-preview')).toHaveTextContent(
      'D001_P001_L001_S001_R001_side_modality.type',
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  test('loads copy source projects from the canonical trailing-slash endpoint', async () => {
    const config = makeConfig('PT1', 'basic');
    mockFetch(config, 'PT1');

    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByTestId('project-configuration-summary')).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith('/api/projects/');
    expect(global.fetch).not.toHaveBeenCalledWith('/api/projects');
  });

  test('renders file naming configuration defaults and supports hierarchy customization', async () => {
    const config = makeConfig('PT1', 'basic');
    mockFetch(config, 'PT1');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Filename Convention' })).toBeInTheDocument());
    expect(screen.getByLabelText('Level 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('D')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Level 1'), { target: { value: 'other' } });
    expect(screen.getByLabelText('Custom Label')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Custom Label'), { target: { value: 'Workcell' } });
    fireEvent.change(screen.getByLabelText('Abbreviation', { selector: '#hierarchy-level-abbreviation-0' }), {
      target: { value: 'W' },
    });
    expect(screen.getByDisplayValue('W')).toBeInTheDocument();
  });

  test('adds and removes hierarchy and image descriptor rows', async () => {
    const config = makeConfig('PT1', 'basic');
    mockFetch(config, 'PT1');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText('Add Hierarchy Level')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Add Hierarchy Level'));
    expect(screen.getByLabelText('Level 6')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Add Image Descriptor'));
    expect(screen.getByLabelText('Descriptor 3')).toBeInTheDocument();

    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    fireEvent.click(removeButtons[removeButtons.length - 1]);
    expect(screen.queryByLabelText('Descriptor 3')).not.toBeInTheDocument();
  });


  test('autosaves configuration changes after users edit fields', async () => {
    jest.useFakeTimers();
    const config = makeConfig('PT1', 'basic');
    mockFetch(config, 'PT1');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByLabelText('Image modality label 1')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Image modality label 1'), { target: { value: 'Autosaved thermal' } });
    expect(screen.getByText('Unsaved changes will autosave shortly.')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/projects/proj-1/configuration',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('Autosaved thermal'),
        }),
      );
    });
    expect(await screen.findByText('Configuration autosaved.')).toBeInTheDocument();
  });

  test('flushes pending autosave immediately for callers that must wait before leaving the tab', async () => {
    jest.useFakeTimers();
    const config = makeConfig('PT1', 'basic');
    mockFetch(config, 'PT1');
    const autosaveRef = React.createRef();
    render(<ProjectConfigurationPanel projectId="proj-1" ref={autosaveRef} />);

    await waitFor(() => expect(screen.getByLabelText('Defect type definition 1')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Defect type definition 1'), {
      target: { value: 'Flush before tab navigation' },
    });
    expect(autosaveRef.current.hasPendingAutosave()).toBe(true);

    let saved = false;
    await act(async () => {
      saved = await autosaveRef.current.flushPendingAutosave('Configuration autosaved.');
    });

    expect(saved).toBe(true);
    expect(autosaveRef.current.hasPendingAutosave()).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/proj-1/configuration',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('Flush before tab navigation'),
      }),
    );
  });

  test('persists edits for every configuration field exposed by the configuration tab', async () => {
    const config = makeConfig('PT1', 'basic');
    mockFetch(config, 'PT1');
    const { container } = render(<ProjectConfigurationPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByTestId('configuration-sections-grid')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Owner Name'), { target: { value: 'Ada Inspector' } });
    fireEvent.change(screen.getByLabelText('Owner Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Active Username'), { target: { value: 'manual-reviewer' } });

    fireEvent.change(screen.getByLabelText('Level 1'), { target: { value: 'batch' } });
    fireEvent.change(container.querySelector('#hierarchy-level-abbreviation-0'), { target: { value: 'BT' } });
    fireEvent.change(screen.getByLabelText('Descriptor 1'), { target: { value: 'operator' } });
    fireEvent.change(container.querySelector('#image-descriptor-abbreviation-0'), { target: { value: 'OP' } });

    fireEvent.click(screen.getByLabelText('Require disposition on submit'));
    fireEvent.click(screen.getByLabelText('Require measurement for critical defects'));
    fireEvent.click(screen.getByLabelText('Require second reviewer for rejects'));
    fireEvent.change(screen.getByLabelText('Accept hotkey'), { target: { value: 'q' } });
    fireEvent.change(screen.getByLabelText('Reject hotkey'), { target: { value: 'w' } });
    fireEvent.change(screen.getByLabelText('Help hotkey'), { target: { value: 'e' } });

    fireEvent.click(screen.getByLabelText('Track serial number at batch level'));
    fireEvent.click(screen.getByLabelText('Organize each batch into sub-batches'));
    fireEvent.click(screen.getByLabelText('Track serial number at sub-batch level'));
    fireEvent.click(screen.getByLabelText('Track serial number at part level'));

    fireEvent.click(screen.getByLabelText('Manually choose current project phase'));
    fireEvent.change(screen.getByLabelText('Manual project phase'), { target: { value: 'reporting' } });

    fireEvent.change(screen.getByLabelText('Image modality label 1'), { target: { value: 'Thermal image' } });
    fireEvent.change(screen.getByLabelText('Image modality id 1'), { target: { value: 'thermal' } });
    fireEvent.click(screen.getByLabelText('Image modality calibration required 1'));
    fireEvent.click(screen.getByLabelText('Image modality example uploaded 1'));

    fireEvent.change(screen.getByLabelText('Defect type name 1'), { target: { value: 'Crack' } });
    fireEvent.change(screen.getByLabelText('Defect type color 1'), { target: { value: '#123abc' } });
    fireEvent.change(screen.getByLabelText('Defect type definition 1'), { target: { value: 'Linear fracture' } });

    fireEvent.change(screen.getByLabelText('Part view label 1'), { target: { value: 'Top view' } });
    fireEvent.change(screen.getByLabelText('Part view id 1'), { target: { value: 'top' } });
    fireEvent.change(screen.getByLabelText('Part view required modalities 1'), { target: { value: 'thermal' } });
    fireEvent.change(screen.getByLabelText('Part view required modalities 2'), { target: { value: 'thermal' } });
    fireEvent.change(screen.getByLabelText('Part view source 1'), { target: { value: 'auto' } });

    fireEvent.change(screen.getByLabelText('Default colormap'), { target: { value: 'magma' } });
    fireEvent.change(screen.getByLabelText('Anomaly colormap'), { target: { value: 'grayscale' } });
    fireEvent.click(screen.getByLabelText('Use grayscale base image'));

    fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/projects/proj-1/configuration',
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    const putCall = global.fetch.mock.calls.find(
      ([url, options = {}]) => url === '/api/projects/proj-1/configuration' && options.method === 'PUT',
    );
    const savedConfig = JSON.parse(putCall[1].body).config;

    expect(savedConfig).toEqual(expect.objectContaining({
      project_owner: { name: 'Ada Inspector', email: 'ada@example.com' },
      current_user: { username: 'manual-reviewer', sso_authenticated: false },
      process_settings: {
        require_disposition_on_submit: false,
        require_measurement_for_critical: true,
        require_second_reviewer_for_reject: true,
        configurable_hotkeys: {
          accept_classification: 'q',
          reject_classification: 'w',
          toggle_shortcut_help: 'e',
        },
      },
      serial_number_scheme: {
        batch_sn_enabled: false,
        sub_batching_enabled: true,
        sub_batch_sn_enabled: true,
        part_sn_enabled: false,
      },
      phase_settings: {
        manual_phase_selection_enabled: true,
        manual_phase: 'reporting',
      },
      display_settings: {
        default_colormap: 'magma',
        anomaly_colormap: 'grayscale',
        grayscale_base_image: false,
      },
    }));
    expect(savedConfig.file_naming_scheme.hierarchy_levels[0]).toEqual({ id: 'batch', label: 'Batch', abbreviation: 'BT' });
    expect(savedConfig.file_naming_scheme.image_descriptors[0]).toEqual({ id: 'operator', label: 'Operator', abbreviation: 'OP' });
    expect(savedConfig.image_modalities[0]).toEqual({
      id: 'thermal',
      label: 'Thermal image',
      calibration_required: true,
      example_image_uploaded: false,
    });
    expect(savedConfig.defect_types[0]).toEqual({
      name: 'Crack',
      color: '#123abc',
      definition: 'Linear fracture',
    });
    expect(savedConfig.part_views[0]).toEqual({
      id: 'top',
      label: 'Top view',
      required_modalities: ['thermal'],
      source: 'auto',
    });
  });

  test('adds backend service diagnostics when project configuration fetch fails', async () => {
    let configRequestCount = 0;
    global.fetch = jest.fn((url) => {
      if (url === '/api/projects/proj-1/configuration') {
        configRequestCount += 1;
        if (configRequestCount === 1) {
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          json: async () => ({ detail: 'database unavailable' }),
        });
      }
      if (url === '/api/projects/') {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => [],
        });
      }
      if (url === '/api/health') {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ status: 'healthy' }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) });
    });

    render(<ProjectConfigurationPanel projectId="proj-1" />);

    expect(await screen.findByText(/Failed to fetch/)).toBeInTheDocument();
    expect(screen.getByText(/Backend service diagnostics/)).toBeInTheDocument();
    expect(screen.getByText(/API health: responded at \/api\/health \(200 OK/)).toBeInTheDocument();
    expect(screen.getByText(/Projects list \(Postgres\): responded at \/api\/projects\/ \(200 OK/)).toBeInTheDocument();
    expect(screen.getByText(/Project configuration \(Postgres\): error at \/api\/projects\/proj-1\/configuration \(503 Service Unavailable/)).toBeInTheDocument();
  });


  test('documents downstream implementation status for every saved configuration field', () => {
    const srcRoot = path.join(process.cwd(), 'src');
    const collectSource = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') return [];
        return collectSource(fullPath);
      }
      if (!entry.name.endsWith('.js')) return [];
      if (fullPath.endsWith(path.join('components', 'ProjectConfigurationPanel.js'))) return [];
      return [fs.readFileSync(fullPath, 'utf8')];
    }).join('\n');

    const downstreamSource = collectSource(srcRoot);
    const fieldsWithDownstreamEffects = [
      'phase_settings',
      'manual_phase_selection_enabled',
      'manual_phase',
      'file_naming_scheme',
      'configurable_hotkeys',
      'defect_types',
    ];
    fieldsWithDownstreamEffects.forEach((fieldName) => {
      expect(downstreamSource).toContain(fieldName);
    });

    const persistedOnlyFields = [
      'project_owner',
      'current_user',
      'serial_number_scheme',
      'batch_sn_enabled',
      'sub_batching_enabled',
      'sub_batch_sn_enabled',
      'part_sn_enabled',
      'display_settings',
      'default_colormap',
      'anomaly_colormap',
      'grayscale_base_image',
      'require_disposition_on_submit',
      'require_measurement_for_critical',
      'require_second_reviewer_for_reject',
      'image_modalities',
      'calibration_required',
      'example_image_uploaded',
      'part_views',
    ];
    persistedOnlyFields.forEach((fieldName) => {
      expect(downstreamSource).not.toContain(fieldName);
    });
  });

  projectTypes.forEach((projectType) => {
    test(`prepopulates default defect types for ${projectType} when configuration has no defect type list`, async () => {
      const config = makeConfig(projectType, 'basic');
      delete config.defect_types;
      mockFetch(config, projectType);

      render(<ProjectConfigurationPanel projectId="proj-1" />);

      await waitFor(() => {
        expect(screen.getByDisplayValue(`DefectType1_${projectType}`)).toBeInTheDocument();
      });
      expect(screen.getByDisplayValue(`DefectType2_${projectType}`)).toBeInTheDocument();
      expect(screen.getByDisplayValue(`DefectType3_${projectType}`)).toBeInTheDocument();
    });

    test(`preserves an explicitly empty defect type list for ${projectType}`, async () => {
      const config = { ...makeConfig(projectType, 'basic'), defect_types: [] };
      mockFetch(config, projectType);

      render(<ProjectConfigurationPanel projectId="proj-1" />);

      await waitFor(() => {
        expect(screen.getByText('No defect types configured yet.')).toBeInTheDocument();
      });
      expect(screen.queryByDisplayValue(`DefectType1_${projectType}`)).not.toBeInTheDocument();
    });
  });

  projectTypes.forEach((projectType) => {
    syntheticUsers.forEach((syntheticUser) => {
      test(`loads and saves configuration for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType);

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByTestId('project-configuration-summary')).toBeInTheDocument());

        expect(screen.getAllByRole('heading', { name: 'Image Modalities' }).length).toBeGreaterThan(0);
        expect(screen.getByRole('heading', { name: 'Serial Number Scheme' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

        await waitFor(() => {
          expect(global.fetch).toHaveBeenCalledWith(
            '/api/projects/proj-1/configuration',
            expect.objectContaining({ method: 'PUT' }),
          );
        });
      });

      test(`supports defect type add/edit/remove for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType);

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Defect type name 1')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: 'Add Defect Type' }));
        fireEvent.change(screen.getByLabelText(`Defect type name ${config.defect_types.length + 1}`), {
          target: { value: `Escalated ${projectType} ${syntheticUser}` },
        });
        fireEvent.change(screen.getByLabelText(`Defect type color ${config.defect_types.length + 1}`), {
          target: { value: '#22c55e' },
        });
        fireEvent.change(screen.getByLabelText(`Defect type definition ${config.defect_types.length + 1}`), {
          target: { value: 'Added during synthetic edit workflow' },
        });

        fireEvent.click(screen.getByLabelText('Remove defect type 1'));
        fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

        await waitFor(() => {
          expect(global.fetch).toHaveBeenCalledWith(
            '/api/projects/proj-1/configuration',
            expect.objectContaining({
              method: 'PUT',
              body: expect.stringContaining(`Escalated ${projectType} ${syntheticUser}`),
            }),
          );
        });
      });

      test(`supports image modality add/edit/remove for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType);

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Image modality label 1')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: 'Add Modality' }));
        fireEvent.change(screen.getByLabelText(`Image modality label ${config.image_modalities.length + 1}`), {
          target: { value: `Synthetic ${projectType} ${syntheticUser}` },
        });
        fireEvent.change(screen.getByLabelText(`Image modality id ${config.image_modalities.length + 1}`), {
          target: { value: `${projectType.toLowerCase()}-${syntheticUser}-custom` },
        });
        fireEvent.click(screen.getByLabelText(`Image modality calibration required ${config.image_modalities.length + 1}`));
        fireEvent.click(screen.getByLabelText(`Image modality example uploaded ${config.image_modalities.length + 1}`));
        fireEvent.change(screen.getByLabelText('Part view required modalities 1'), {
          target: { value: `${projectType.toLowerCase()}-${syntheticUser}-custom` },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

        await waitFor(() => {
          expect(global.fetch).toHaveBeenCalledWith(
            '/api/projects/proj-1/configuration',
            expect.objectContaining({
              method: 'PUT',
              body: expect.stringContaining(`Synthetic ${projectType} ${syntheticUser}`),
            }),
          );
        });
      });

      test(`supports configurable hotkeys edits for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType);

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Accept hotkey')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Accept hotkey'), { target: { value: 'q' } });
        fireEvent.change(screen.getByLabelText('Reject hotkey'), { target: { value: 'w' } });
        fireEvent.change(screen.getByLabelText('Help hotkey'), { target: { value: 'e' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

        await waitFor(() => {
          expect(global.fetch).toHaveBeenCalledWith(
            '/api/projects/proj-1/configuration',
            expect.objectContaining({
              method: 'PUT',
              body: expect.stringContaining('"accept_classification":"q"'),
            }),
          );
          expect(global.fetch).toHaveBeenCalledWith(
            '/api/projects/proj-1/configuration',
            expect.objectContaining({
              method: 'PUT',
              body: expect.stringContaining('"reject_classification":"w"'),
            }),
          );
          expect(global.fetch).toHaveBeenCalledWith(
            '/api/projects/proj-1/configuration',
            expect.objectContaining({
              method: 'PUT',
              body: expect.stringContaining('"toggle_shortcut_help":"e"'),
            }),
          );
        });
      });

      
      test(`blocks save and shows validation errors for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType);

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Accept hotkey')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Accept hotkey'), { target: { value: 'q' } });
        fireEvent.change(screen.getByLabelText('Reject hotkey'), { target: { value: 'q' } });
        fireEvent.change(screen.getByLabelText('Defect type color 1'), { target: { value: 'red' } });
        fireEvent.change(screen.getByLabelText('Part view required modalities 1'), {
          target: { value: 'nonexistent_modality' },
        });

        const putCallsBefore = global.fetch.mock.calls.filter(
          ([url, options = {}]) => url === '/api/projects/proj-1/configuration' && options.method === 'PUT',
        ).length;

        fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

        await waitFor(() => {
          expect(screen.getByText(/Hotkeys must be unique/)).toBeInTheDocument();
          expect(screen.getByText(/Defect type colors must be valid/)).toBeInTheDocument();
          expect(screen.getByText(/Part views can only require modalities/)).toBeInTheDocument();
        });

        const putCallsAfter = global.fetch.mock.calls.filter(
          ([url, options = {}]) => url === '/api/projects/proj-1/configuration' && options.method === 'PUT',
        ).length;
        expect(putCallsAfter).toBe(putCallsBefore);
      });


      test(`blocks save on duplicate defect names for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType);

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Defect type name 1')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: 'Add Defect Type' }));
        fireEvent.change(screen.getByLabelText(`Defect type name ${config.defect_types.length + 1}`), {
          target: { value: 'Defect 1' },
        });
        fireEvent.change(screen.getByLabelText(`Defect type color ${config.defect_types.length + 1}`), {
          target: { value: '#22c55e' },
        });

        const putCallsBefore = global.fetch.mock.calls.filter(
          ([url, options = {}]) => url === '/api/projects/proj-1/configuration' && options.method === 'PUT',
        ).length;

        fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

        await waitFor(() => {
          expect(screen.getByText(/Defect type names must be unique/)).toBeInTheDocument();
        });

        const putCallsAfter = global.fetch.mock.calls.filter(
          ([url, options = {}]) => url === '/api/projects/proj-1/configuration' && options.method === 'PUT',
        ).length;
        expect(putCallsAfter).toBe(putCallsBefore);
      });

      test(`supports part view add/edit/remove for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType);

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Part view label 1')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: 'Add Part View' }));
        fireEvent.change(screen.getByLabelText(`Part view label ${config.part_views.length + 1}`), {
          target: { value: `Expanded ${projectType} ${syntheticUser}` },
        });
        fireEvent.change(screen.getByLabelText(`Part view id ${config.part_views.length + 1}`), {
          target: { value: `${projectType.toLowerCase()}-${syntheticUser}-expanded-view` },
        });
        fireEvent.change(screen.getByLabelText(`Part view required modalities ${config.part_views.length + 1}`), {
          target: { value: `${projectType.toLowerCase()}-${syntheticUser}-modality-1` },
        });
        fireEvent.change(screen.getByLabelText(`Part view source ${config.part_views.length + 1}`), {
          target: { value: 'auto' },
        });

        fireEvent.click(screen.getByLabelText('Remove part view 1'));
        fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

        await waitFor(() => {
          expect(global.fetch).toHaveBeenCalledWith(
            '/api/projects/proj-1/configuration',
            expect.objectContaining({
              method: 'PUT',
              body: expect.stringContaining(`Expanded ${projectType} ${syntheticUser}`),
            }),
          );
          expect(global.fetch).toHaveBeenCalledWith(
            '/api/projects/proj-1/configuration',
            expect.objectContaining({
              method: 'PUT',
              body: expect.stringContaining(`"required_modalities":["${projectType.toLowerCase()}-${syntheticUser}-modality-1"]`),
            }),
          );
        });
      });
    });
  });

  projectTypes.forEach((projectType) => {
    syntheticUsers.forEach((syntheticUser) => {
      test(`copies configuration via clone endpoint for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType);

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Source project')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Source project'), { target: { value: 'proj-copy' } });
        fireEvent.click(screen.getByRole('button', { name: 'Copy from Project' }));

        await waitFor(() => {
          expect(global.fetch).toHaveBeenCalledWith(
            '/api/projects/proj-1/configuration/clone',
            expect.objectContaining({
              method: 'POST',
              body: JSON.stringify({ source_project_id: 'proj-copy' }),
            }),
          );
          expect(screen.getByText('Configuration copied from Template Project.')).toBeInTheDocument();
        });
      });

      test(`resets clone source selection after successful copy for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType);

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Source project')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Source project'), { target: { value: 'proj-copy' } });
        fireEvent.click(screen.getByRole('button', { name: 'Copy from Project' }));

        await waitFor(() => {
          expect(screen.getByText('Configuration copied from Template Project.')).toBeInTheDocument();
        });

        expect(screen.getByLabelText('Source project')).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Copy from Project' })).toBeDisabled();
      });


      test(`surfaces clone API detail errors for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        const cloneFailureDetail = `Source project is not compatible with ${projectType}`;
        mockFetch(config, projectType, { cloneFailureDetail });

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Source project')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Source project'), { target: { value: 'proj-copy' } });
        fireEvent.click(screen.getByRole('button', { name: 'Copy from Project' }));

        await waitFor(() => {
          expect(screen.getByText(cloneFailureDetail)).toBeInTheDocument();
        });
        expect(screen.queryByText('Configuration copied from Template Project.')).not.toBeInTheDocument();
      });

      test(`falls back to status error when clone API response is non-JSON for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType, { cloneInvalidJson: true });

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Source project')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Source project'), { target: { value: 'proj-copy' } });
        fireEvent.click(screen.getByRole('button', { name: 'Copy from Project' }));

        await waitFor(() => {
          expect(screen.getByText('Failed to copy project configuration (502)')).toBeInTheDocument();
        });
      });

      test(`rejects clone success payloads that omit config for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType, { cloneMissingConfig: true });

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Source project')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Source project'), { target: { value: 'proj-copy' } });
        fireEvent.click(screen.getByRole('button', { name: 'Copy from Project' }));

        await waitFor(() => {
          expect(screen.getByText('Failed to copy project configuration (missing config payload)')).toBeInTheDocument();
        });
        expect(screen.queryByText('Configuration copied from Template Project.')).not.toBeInTheDocument();
      });

      test(`rejects clone success payloads with invalid config shape for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType, { cloneInvalidConfigShape: true });

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Source project')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Source project'), { target: { value: 'proj-copy' } });
        fireEvent.click(screen.getByRole('button', { name: 'Copy from Project' }));

        await waitFor(() => {
          expect(screen.getByText('Failed to copy project configuration (invalid config payload shape)')).toBeInTheDocument();
        });
        expect(screen.queryByText('Configuration copied from Template Project.')).not.toBeInTheDocument();
      });

      test(`rejects clone success payloads with invalid config entries for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType, { cloneInvalidConfigEntries: true });

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Source project')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Source project'), { target: { value: 'proj-copy' } });
        fireEvent.click(screen.getByRole('button', { name: 'Copy from Project' }));

        await waitFor(() => {
          expect(screen.getByText('Failed to copy project configuration (invalid config payload entries)')).toBeInTheDocument();
        });
        expect(screen.queryByText('Configuration copied from Template Project.')).not.toBeInTheDocument();
      });

      test(`rejects clone success payloads with invalid config scalar fields for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType, { cloneInvalidConfigScalarFields: true });

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Source project')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Source project'), { target: { value: 'proj-copy' } });
        fireEvent.click(screen.getByRole('button', { name: 'Copy from Project' }));

        await waitFor(() => {
          expect(screen.getByText('Failed to copy project configuration (invalid config scalar fields)')).toBeInTheDocument();
        });
        expect(screen.queryByText('Configuration copied from Template Project.')).not.toBeInTheDocument();
      });

      test(`rejects clone success payloads with invalid config settings fields for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType, { cloneInvalidConfigSettingsFields: true });

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Source project')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Source project'), { target: { value: 'proj-copy' } });
        fireEvent.click(screen.getByRole('button', { name: 'Copy from Project' }));

        await waitFor(() => {
          expect(screen.getByText('Failed to copy project configuration (invalid config settings fields)')).toBeInTheDocument();
        });
        expect(screen.queryByText('Configuration copied from Template Project.')).not.toBeInTheDocument();
      });

      test(`rejects clone success payloads with invalid config domain fields for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType, { cloneInvalidConfigDomainFields: true });

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Source project')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Source project'), { target: { value: 'proj-copy' } });
        fireEvent.click(screen.getByRole('button', { name: 'Copy from Project' }));

        await waitFor(() => {
          expect(screen.getByText('Failed to copy project configuration (invalid config domain fields)')).toBeInTheDocument();
        });
        expect(screen.queryByText('Configuration copied from Template Project.')).not.toBeInTheDocument();
      });

      test(`rejects clone success payloads with invalid config hotkey domain fields for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType, { cloneInvalidConfigHotkeyDomainFields: true });

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Source project')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Source project'), { target: { value: 'proj-copy' } });
        fireEvent.click(screen.getByRole('button', { name: 'Copy from Project' }));

        await waitFor(() => {
          expect(screen.getByText('Failed to copy project configuration (invalid config hotkey domain fields)')).toBeInTheDocument();
        });
        expect(screen.queryByText('Configuration copied from Template Project.')).not.toBeInTheDocument();
      });

      test(`rejects clone success payloads with invalid config relational fields for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType, { cloneInvalidConfigRelationalFields: true });

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Source project')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Source project'), { target: { value: 'proj-copy' } });
        fireEvent.click(screen.getByRole('button', { name: 'Copy from Project' }));

        await waitFor(() => {
          expect(screen.getByText('Failed to copy project configuration (invalid config relational fields)')).toBeInTheDocument();
        });
        expect(screen.queryByText('Configuration copied from Template Project.')).not.toBeInTheDocument();
      });

      test(`rejects clone success payloads with invalid config semantic fields for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType, { cloneInvalidConfigSemanticFields: true });

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Source project')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Source project'), { target: { value: 'proj-copy' } });
        fireEvent.click(screen.getByRole('button', { name: 'Copy from Project' }));

        await waitFor(() => {
          expect(screen.getByText('Failed to copy project configuration (invalid config semantic fields)')).toBeInTheDocument();
        });
        expect(screen.queryByText('Configuration copied from Template Project.')).not.toBeInTheDocument();
      });

      test(`rejects clone success payloads with duplicate defect names for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType, { cloneInvalidConfigDefectRelationalFields: true });

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Source project')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Source project'), { target: { value: 'proj-copy' } });
        fireEvent.click(screen.getByRole('button', { name: 'Copy from Project' }));

        await waitFor(() => {
          expect(screen.getByText('Failed to copy project configuration (invalid config relational fields)')).toBeInTheDocument();
        });
        expect(screen.queryByText('Configuration copied from Template Project.')).not.toBeInTheDocument();
      });

      test(`clears clone status alerts when source project selection changes for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType);

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Source project')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Source project'), { target: { value: 'proj-copy' } });
        fireEvent.click(screen.getByRole('button', { name: 'Copy from Project' }));

        await waitFor(() => {
          expect(screen.getByText('Configuration copied from Template Project.')).toBeInTheDocument();
        });

        fireEvent.change(screen.getByLabelText('Source project'), { target: { value: 'proj-copy-2' } });

        expect(screen.queryByText('Configuration copied from Template Project.')).not.toBeInTheDocument();
      });

      test(`filters copy source projects by matching project type for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType);

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Source project')).toBeInTheDocument());

        expect(screen.getByText(new RegExp(`Only ${projectType} source projects are listed`))).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Template Project' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Cross-Type Project' })).not.toBeInTheDocument();
      });

      test(`shows empty-state guidance when no same-type copy sources exist for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType);
        const originalFetch = global.fetch;
        const incompatibleType = projectType === 'PT1' ? 'PT2' : 'PT1';
        global.fetch = jest.fn((url, requestOptions = {}) => {
          if (url === '/api/projects/') {
            return Promise.resolve({
              ok: true,
              json: async () => [
                { id: 'proj-1', name: 'Current Project', project_type: projectType },
                { id: 'proj-cross-type', name: 'Cross-Type Project', project_type: incompatibleType },
              ],
            });
          }
          return originalFetch(url, requestOptions);
        });

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Source project')).toBeInTheDocument());
        expect(screen.getByTestId('no-compatible-copy-sources')).toBeInTheDocument();
        expect(screen.getByLabelText('Source project')).toBeDisabled();
      });

      test(`prevents duplicate clone submissions while copy is in progress for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType, { delayedClone: true });

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByLabelText('Source project')).toBeInTheDocument());

        fireEvent.change(screen.getByLabelText('Source project'), { target: { value: 'proj-copy' } });
        const copyButton = screen.getByRole('button', { name: 'Copy from Project' });

        fireEvent.click(copyButton);
        expect(screen.getByRole('button', { name: 'Copying...' })).toBeDisabled();
        expect(screen.getByLabelText('Source project')).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Copying...' }));

        await waitFor(() => {
          const cloneCalls = global.fetch.mock.calls.filter(
            ([url, options = {}]) => url === '/api/projects/proj-1/configuration/clone' && options.method === 'POST',
          );
          expect(cloneCalls).toHaveLength(1);
          expect(screen.getByText('Configuration copied from Template Project.')).toBeInTheDocument();
        });
      });
    });
  });

  test('shows interface default buttons and calls save endpoints', async () => {
    const config = makeConfig('PT1', 'advanced');
    mockFetch(config, 'PT1');
    const layoutModel = {
      layout: { type: 'row', children: [] },
    };

    render(
      <ProjectConfigurationPanel
        projectId="proj-1"
        projectType="PT1"
        currentInterfaceLayout={layoutModel}
        isAdminUser
      />,
    );

    await waitFor(() => expect(screen.getByTestId('project-configuration-summary')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Save Current Interface as Project Default' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Current Interface as PT1 Default' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/projects/proj-1/configuration/interface-layout/default',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/projects/proj-1/configuration/interface-layout/project-type-default',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
