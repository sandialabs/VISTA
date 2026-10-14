import React, { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectConfigurationPanel from '../ProjectConfigurationPanel';

jest.setTimeout(10000);

const projectTypes = ['PT1', 'PT2', 'PT3'];
const syntheticUsers = ['basic', 'intermediate', 'advanced'];
const configurationScenarioMatrix = [
  ['PT2', 'intermediate'],
  ['PT3', 'advanced'],
];
const cloneWorkflowScenarioMatrix = [['PT1', 'basic']];

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
      inspection_tile_max_columns: 8,
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

    if (url === '/api/projects/proj-1' && requestOptions.method === 'PUT') {
      if (mockOptions.accessGroupResponsePromise) {
        return mockOptions.accessGroupResponsePromise;
      }
      if (mockOptions.accessGroupFailureDetail) {
        return Promise.resolve({
          ok: false,
          status: 403,
          json: async () => ({ detail: mockOptions.accessGroupFailureDetail }),
        });
      }
      const requestPayload = JSON.parse(requestOptions.body);
      const updatedProject = Object.prototype.hasOwnProperty.call(mockOptions, 'accessGroupResponse')
        ? mockOptions.accessGroupResponse
        : {
            id: 'proj-1',
            name: 'Current Project',
            project_type: projectType,
            meta_group_id: requestPayload.meta_group_id,
            is_archived: false,
          };
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => {
          if (mockOptions.accessGroupInvalidJson) {
            throw new SyntaxError('invalid json');
          }
          return updatedProject;
        },
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
      if (mockOptions.cloneInvalidPt3GuideSettings) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            config: {
              ...config,
              display_settings: {
                ...config.display_settings,
                pt3_3d_guides: {
                  crosshair_transparency_percent: 101,
                  crosshair_line_width_px: 1.25,
                  plane_outline_transparency_percent: 0,
                  plane_outline_line_width_px: 1.25,
                },
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
      return Promise.resolve({ ok: true, json: async () => ({ config, project_type: projectType }) });
    }

    if (url.includes('/configuration/interface-layout/project-type-default') && requestOptions.method === 'POST') {
      return Promise.resolve({ ok: true, json: async () => ({ config, project_type: projectType }) });
    }

    if (url.includes('/configuration') && requestOptions.method === 'PUT') {
      return Promise.resolve({ ok: true, json: async () => ({ config, project_type: projectType }) });
    }

    if (url.includes('/configuration')) {
      return Promise.resolve({ ok: true, json: async () => ({ config, project_type: projectType }) });
    }

    if (url.includes('/metadata-dict')) {
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }

    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

describe('ProjectConfigurationPanel', () => {

  test('updates the Access Group with the exact project payload and returns the full project', async () => {
    const config = makeConfig('PT1', 'basic');
    const project = {
      id: 'proj-1',
      name: 'Current Project',
      project_type: 'PT1',
      meta_group_id: 'source-group',
      is_archived: false,
    };
    const updatedProject = {
      ...project,
      meta_group_id: 'destination-group',
      updated_at: '2026-07-27T01:02:03Z',
    };
    const onProjectUpdated = jest.fn();
    mockFetch(config, 'PT1', { accessGroupResponse: updatedProject });

    render(
      <ProjectConfigurationPanel
        projectId="proj-1"
        project={project}
        onProjectUpdated={onProjectUpdated}
      />,
    );

    const accessGroupInput = await screen.findByRole('textbox', { name: 'Access Group' });
    expect(accessGroupInput).toHaveValue('source-group');
    expect(accessGroupInput).toHaveAttribute('maxlength', '255');
    expect(screen.getByRole('button', { name: 'Update Access Group' })).toBeDisabled();

    fireEvent.change(accessGroupInput, { target: { value: '  destination-group  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Access Group' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/projects/proj-1',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ meta_group_id: 'destination-group' }),
        },
      );
      expect(onProjectUpdated).toHaveBeenCalledWith(updatedProject);
    });
    expect(accessGroupInput).toHaveValue('destination-group');
    expect(screen.getByText('Access Group updated.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update Access Group' })).toBeDisabled();
  });

  test('shows a destination authorization failure locally and preserves the Access Group draft', async () => {
    const config = makeConfig('PT1', 'basic');
    const project = {
      id: 'proj-1',
      name: 'Current Project',
      project_type: 'PT1',
      meta_group_id: 'source-group',
      is_archived: false,
    };
    const onProjectUpdated = jest.fn();
    const detail = "User 'test@example.com' cannot move project 'proj-1' to group 'restricted-group'.";
    mockFetch(config, 'PT1', { accessGroupFailureDetail: detail });

    render(
      <ProjectConfigurationPanel
        projectId="proj-1"
        project={project}
        onProjectUpdated={onProjectUpdated}
      />,
    );

    const accessGroupInput = await screen.findByRole('textbox', { name: 'Access Group' });
    fireEvent.change(accessGroupInput, { target: { value: 'restricted-group' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Access Group' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(detail);
    expect(accessGroupInput).toHaveValue('restricted-group');
    expect(screen.getByTestId('project-configuration-summary')).toBeInTheDocument();
    expect(onProjectUpdated).not.toHaveBeenCalled();
  });

  test.each([
    ['non-JSON', { accessGroupInvalidJson: true }],
    ['missing required fields', { accessGroupResponse: {} }],
    ['a mismatched project id', {
      accessGroupResponse: {
        id: 'another-project',
        name: 'Current Project',
        project_type: 'PT1',
        meta_group_id: 'destination-group',
        is_archived: false,
      },
    }],
    ['a mismatched Access Group', {
      accessGroupResponse: {
        id: 'proj-1',
        name: 'Current Project',
        project_type: 'PT1',
        meta_group_id: 'different-group',
        is_archived: false,
      },
    }],
  ])('rejects a successful Access Group response containing %s', async (_label, mockOptions) => {
    const config = makeConfig('PT1', 'basic');
    const project = {
      id: 'proj-1',
      name: 'Current Project',
      project_type: 'PT1',
      meta_group_id: 'source-group',
      is_archived: false,
    };
    const onProjectUpdated = jest.fn();
    mockFetch(config, 'PT1', mockOptions);

    render(
      <ProjectConfigurationPanel
        projectId="proj-1"
        project={project}
        onProjectUpdated={onProjectUpdated}
      />,
    );

    const accessGroupInput = await screen.findByRole('textbox', { name: 'Access Group' });
    fireEvent.change(accessGroupInput, { target: { value: '  destination-group  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Access Group' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to update Access Group (invalid project response).',
    );
    expect(accessGroupInput).toHaveValue('  destination-group  ');
    expect(screen.queryByText('Access Group updated.')).not.toBeInTheDocument();
    expect(onProjectUpdated).not.toHaveBeenCalled();
  });

  test('validates blank and oversized Access Groups before sending a request', async () => {
    const config = makeConfig('PT1', 'basic');
    const project = {
      id: 'proj-1',
      name: 'Current Project',
      project_type: 'PT1',
      meta_group_id: 'source-group',
      is_archived: false,
    };
    mockFetch(config, 'PT1');

    render(<ProjectConfigurationPanel projectId="proj-1" project={project} />);

    const accessGroupInput = await screen.findByRole('textbox', { name: 'Access Group' });
    fireEvent.change(accessGroupInput, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Access Group' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Access Group is required.');

    fireEvent.change(accessGroupInput, { target: { value: 'g'.repeat(256) } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Access Group' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Access Group must be 255 characters or fewer.');

    const projectUpdateCalls = global.fetch.mock.calls.filter(
      ([url, options = {}]) => url === '/api/projects/proj-1' && options.method === 'PUT',
    );
    expect(projectUpdateCalls).toHaveLength(0);
  });

  test('keeps Access Group typing outside configuration autosave state', async () => {
    const config = makeConfig('PT1', 'basic');
    const project = {
      id: 'proj-1',
      name: 'Current Project',
      project_type: 'PT1',
      meta_group_id: 'source-group',
      is_archived: false,
    };
    mockFetch(config, 'PT1');
    render(<ProjectConfigurationPanel projectId="proj-1" project={project} />);

    const accessGroupInput = await screen.findByRole('textbox', { name: 'Access Group' });
    jest.useFakeTimers();
    fireEvent.change(accessGroupInput, { target: { value: 'draft-group' } });
    act(() => {
      jest.advanceTimersByTime(600);
    });

    const configurationPutCalls = global.fetch.mock.calls.filter(
      ([url, options = {}]) => (
        url === '/api/projects/proj-1/configuration' && options.method === 'PUT'
      ),
    );
    expect(configurationPutCalls).toHaveLength(0);
    expect(screen.queryByText('Unsaved changes will autosave shortly.')).not.toBeInTheDocument();
  });

  test('disables Access Group changes for archived projects', async () => {
    const config = makeConfig('PT1', 'basic');
    mockFetch(config, 'PT1');
    render(
      <ProjectConfigurationPanel
        projectId="proj-1"
        project={{
          id: 'proj-1',
          meta_group_id: 'archived-group',
          is_archived: true,
        }}
      />,
    );

    expect(await screen.findByRole('textbox', { name: 'Access Group' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Update Access Group' })).toBeDisabled();
    expect(screen.getByText('Archived projects are read-only.')).toBeInTheDocument();
  });

  test('keeps project calibration and configuration saving read-only when archived', async () => {
    jest.useFakeTimers();
    const config = {
      ...makeConfig('PT1', 'basic'),
      calibration: {
        pixels_per_mm: 10,
        pixels_per_inch: 254,
        unit: 'mm',
        updated_at: null,
      },
    };
    mockFetch(config, 'PT1');
    render(
      <ProjectConfigurationPanel
        projectId="proj-1"
        project={{
          id: 'proj-1',
          meta_group_id: 'archived-group',
          is_archived: true,
        }}
      />,
    );

    expect(await screen.findByLabelText('Project calibration unit')).toBeDisabled();
    expect(screen.getByLabelText('Pixels per millimeter')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear Calibration' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save Configuration' })).toBeDisabled();

    act(() => {
      jest.advanceTimersByTime(600);
    });
    const configurationPutCalls = global.fetch.mock.calls.filter(
      ([url, options = {}]) => (
        url === '/api/projects/proj-1/configuration' && options.method === 'PUT'
      ),
    );
    expect(configurationPutCalls).toHaveLength(0);
  });

  test('disables and guards Copy Configuration when the target becomes archived', async () => {
    const config = makeConfig('PT1', 'basic');
    mockFetch(config, 'PT1');
    const activeProject = {
      id: 'proj-1',
      meta_group_id: 'source-group',
      is_archived: false,
    };
    const { rerender } = render(
      <ProjectConfigurationPanel
        projectId="proj-1"
        project={activeProject}
      />,
    );

    const sourceSelect = await screen.findByLabelText('Source project');
    fireEvent.change(sourceSelect, { target: { value: 'proj-copy' } });
    expect(screen.getByRole('button', { name: 'Copy from Project' })).toBeEnabled();

    rerender(
      <ProjectConfigurationPanel
        projectId="proj-1"
        project={{ ...activeProject, is_archived: true }}
      />,
    );
    expect(sourceSelect).toBeDisabled();
    const copyButton = screen.getByRole('button', { name: 'Copy from Project' });
    expect(copyButton).toBeDisabled();
    fireEvent.click(copyButton);

    const cloneCalls = global.fetch.mock.calls.filter(
      ([url, options = {}]) => (
        url === '/api/projects/proj-1/configuration/clone' && options.method === 'POST'
      ),
    );
    expect(cloneCalls).toHaveLength(0);
  });

  test('invalidates an in-flight Access Group update when the project becomes archived', async () => {
    const config = makeConfig('PT1', 'basic');
    const project = {
      id: 'proj-1',
      name: 'Current Project',
      project_type: 'PT1',
      meta_group_id: 'source-group',
      is_archived: false,
    };
    let resolveAccessGroupResponse;
    const accessGroupResponsePromise = new Promise((resolve) => {
      resolveAccessGroupResponse = resolve;
    });
    const onProjectUpdated = jest.fn();
    mockFetch(config, 'PT1', { accessGroupResponsePromise });

    const { rerender } = render(
      <ProjectConfigurationPanel
        projectId="proj-1"
        project={project}
        onProjectUpdated={onProjectUpdated}
      />,
    );

    const accessGroupInput = await screen.findByRole('textbox', { name: 'Access Group' });
    fireEvent.change(accessGroupInput, { target: { value: 'destination-group' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Access Group' }));
    await waitFor(() => expect(accessGroupInput).toBeDisabled());

    rerender(
      <ProjectConfigurationPanel
        projectId="proj-1"
        project={{ ...project, is_archived: true }}
        onProjectUpdated={onProjectUpdated}
      />,
    );
    expect(accessGroupInput).toBeDisabled();
    expect(accessGroupInput).toHaveValue('source-group');

    await act(async () => {
      resolveAccessGroupResponse({
        ok: true,
        status: 200,
        json: async () => ({
          ...project,
          meta_group_id: 'destination-group',
        }),
      });
      await accessGroupResponsePromise;
    });

    expect(accessGroupInput).toBeDisabled();
    expect(accessGroupInput).toHaveValue('source-group');
    expect(screen.queryByText('Access Group updated.')).not.toBeInTheDocument();
    expect(onProjectUpdated).not.toHaveBeenCalled();
  });

  test('uses instance-unique Access Group ids and heading references', async () => {
    const config = makeConfig('PT1', 'basic');
    mockFetch(config, 'PT1');
    const project = {
      id: 'proj-1',
      name: 'Current Project',
      project_type: 'PT1',
      meta_group_id: 'source-group',
      is_archived: false,
    };

    render(
      <>
        <ProjectConfigurationPanel projectId="proj-1" project={project} />
        <ProjectConfigurationPanel projectId="proj-2" project={{ ...project, id: 'proj-2' }} />
      </>,
    );

    const accessGroupHeadings = await screen.findAllByRole('heading', { name: 'Access Group' });
    const accessGroupInputs = screen.getAllByRole('textbox', { name: 'Access Group' });
    expect(accessGroupHeadings).toHaveLength(2);
    expect(accessGroupInputs).toHaveLength(2);
    expect(accessGroupHeadings[0].id).not.toBe(accessGroupHeadings[1].id);
    expect(accessGroupInputs[0].id).not.toBe(accessGroupInputs[1].id);
    accessGroupHeadings.forEach((heading) => {
      expect(heading.closest('section')).toHaveAttribute('aria-labelledby', heading.id);
    });
  });

  test('saves project calibration, converts display units, and clears the project default', async () => {
    const config = {
      ...makeConfig('PT1', 'basic'),
      calibration: {
        pixels_per_mm: 10,
        pixels_per_inch: 254,
        unit: 'mm',
        updated_at: '2026-07-26T18:30:00Z',
      },
    };
    mockFetch(config, 'PT1');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    expect(await screen.findByRole('heading', { name: 'Project Calibration' })).toBeInTheDocument();
    expect(screen.getByLabelText('Pixels per millimeter')).toHaveValue(10);
    expect(screen.getByText('CALIBRATED')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Project calibration unit'), {
      target: { value: 'inches' },
    });
    expect(screen.getByLabelText('Pixels per inch')).toHaveValue(254);
    fireEvent.change(screen.getByLabelText('Pixels per inch'), {
      target: { value: '508' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

    await waitFor(() => {
      const putCalls = global.fetch.mock.calls.filter(
        ([url, options = {}]) => url === '/api/projects/proj-1/configuration' && options.method === 'PUT',
      );
      expect(putCalls.length).toBeGreaterThan(0);
      const savedConfig = JSON.parse(putCalls.at(-1)[1].body).config;
      expect(savedConfig.calibration).toEqual(expect.objectContaining({
        pixels_per_mm: 20,
        pixels_per_inch: 508,
        unit: 'inches',
        updated_at: expect.any(String),
      }));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Clear Calibration' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear Calibration' }));
    expect(screen.getByLabelText('Pixels per millimeter')).toHaveValue(null);
    expect(screen.getByText('NOT SET')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

    await waitFor(() => {
      const putCalls = global.fetch.mock.calls.filter(
        ([url, options = {}]) => url === '/api/projects/proj-1/configuration' && options.method === 'PUT',
      );
      expect(putCalls.length).toBeGreaterThan(1);
      const savedConfig = JSON.parse(putCalls.at(-1)[1].body).config;
      expect(savedConfig.calibration).toBeNull();
    });
  });

  test('shows project calibration when it is the only enabled General section', async () => {
    const config = {
      ...makeConfig('PT1', 'basic'),
      ui_sections: {
        'project_configuration.owner_section': false,
        'project_configuration.user_section': false,
        'project_configuration.calibration': true,
        'project_configuration.process_settings': false,
        'project_configuration.serial_scheme': false,
        'project_configuration.project_phase_settings': false,
        'project_configuration.defect_types': false,
        'project_configuration.view_options': false,
        'project_configuration.display_options': false,
        'project_configuration.copy_configuration': false,
      },
    };
    mockFetch(config, 'PT1');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    expect(await screen.findByRole('heading', { name: 'Project Calibration' })).toBeInTheDocument();
    expect(screen.queryByText('No General configuration sections are enabled.')).not.toBeInTheDocument();
  });

  test('hides project calibration and reports no configurable General sections when disabled', async () => {
    const config = {
      ...makeConfig('PT1', 'basic'),
      ui_sections: {
        'project_configuration.owner_section': false,
        'project_configuration.user_section': false,
        'project_configuration.calibration': false,
        'project_configuration.process_settings': false,
        'project_configuration.serial_scheme': false,
        'project_configuration.project_phase_settings': false,
        'project_configuration.defect_types': false,
        'project_configuration.view_options': false,
        'project_configuration.display_options': false,
        'project_configuration.copy_configuration': false,
      },
    };
    mockFetch(config, 'PT1');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    expect(await screen.findByText('No General configuration sections are enabled.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Project Calibration' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'UI Configuration' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Project Configuration' }));
    expect(screen.getByLabelText('Project Calibration section')).not.toBeChecked();
  });

  test('keeps legacy projects uncalibrated until a positive project scale is entered', async () => {
    const config = makeConfig('PT1', 'basic');
    mockFetch(config, 'PT1');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    expect(await screen.findByLabelText('Pixels per millimeter')).toHaveValue(null);
    expect(screen.getByRole('button', { name: 'Clear Calibration' })).toBeDisabled();
    expect(screen.getByText(/fall back to legacy project metadata/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Pixels per millimeter'), {
      target: { value: '-2' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('positive finite number');
    expect(screen.getByRole('button', { name: 'Save Configuration' })).toBeDisabled();
  });

  test('accepts a null calibration timestamp and rejects contradictory persisted scales', async () => {
    const config = {
      ...makeConfig('PT1', 'basic'),
      calibration: {
        pixels_per_mm: 10,
        pixels_per_inch: 254,
        unit: 'mm',
        updated_at: null,
      },
    };
    mockFetch(config, 'PT1');
    const { unmount } = render(<ProjectConfigurationPanel projectId="proj-1" />);

    expect(await screen.findByLabelText('Pixels per millimeter')).toHaveValue(10);
    expect(screen.getByText('CALIBRATED')).toBeInTheDocument();

    const contradictoryConfig = {
      ...config,
      calibration: {
        ...config.calibration,
        pixels_per_inch: 255,
      },
    };
    unmount();
    mockFetch(contradictoryConfig, 'PT1');
    render(<ProjectConfigurationPanel projectId="proj-1" />);
    expect(await screen.findByText('NOT SET')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));
    expect(await screen.findByText(/positive finite pixel scales and a valid unit/i))
      .toBeInTheDocument();
    const configurationPutCalls = global.fetch.mock.calls.filter(
      ([url, options = {}]) => (
        url === '/api/projects/proj-1/configuration' && options.method === 'PUT'
      ),
    );
    expect(configurationPutCalls).toHaveLength(0);
  });

  test.each([
    ['millimeter overflow', 'Pixels per millimeter', '1e308'],
    ['inch underflow', 'Pixels per inch', '1e-323'],
  ])('keeps %s drafts invalid without publishing derived scales', async (_label, inputLabel, value) => {
    const config = makeConfig('PT1', 'basic');
    mockFetch(config, 'PT1');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    if (inputLabel === 'Pixels per inch') {
      fireEvent.change(await screen.findByLabelText('Project calibration unit'), {
        target: { value: 'inches' },
      });
    }
    const input = await screen.findByLabelText(inputLabel);
    fireEvent.change(input, { target: { value } });

    expect(input).toHaveValue(Number(value));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('positive finite number');
    expect(screen.getByRole('button', { name: 'Save Configuration' })).toBeDisabled();

    const configurationPutCalls = global.fetch.mock.calls.filter(
      ([url, options = {}]) => (
        url === '/api/projects/proj-1/configuration' && options.method === 'PUT'
      ),
    );
    expect(configurationPutCalls).toHaveLength(0);
  });

  test('marks an emptied touched scale pending and blocks flush/navigation until corrected', async () => {
    const config = {
      ...makeConfig('PT1', 'basic'),
      calibration: {
        pixels_per_mm: 10,
        pixels_per_inch: 254,
        unit: 'mm',
        updated_at: null,
      },
    };
    const panelRef = createRef();
    mockFetch(config, 'PT1');
    render(<ProjectConfigurationPanel ref={panelRef} projectId="proj-1" />);

    const input = await screen.findByLabelText('Pixels per millimeter');
    fireEvent.change(input, { target: { value: '' } });

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('positive finite number');
    expect(panelRef.current.hasPendingAutosave()).toBe(true);

    let flushResult;
    await act(async () => {
      flushResult = await panelRef.current.flushPendingAutosave();
    });
    expect(flushResult).toBe(false);
    expect(await screen.findByText(/before saving or leaving Configuration/i)).toBeInTheDocument();
    expect(input).toHaveValue(null);
  });

  test('uses a non-sticky desktop action bar on the calibration subtab', async () => {
    const config = makeConfig('PT2', 'basic');
    mockFetch(config, 'PT2');
    const { container } = render(<ProjectConfigurationPanel projectId="proj-1" projectType="PT2" />);

    await screen.findByRole('heading', { name: 'Project Calibration' });
    expect(container.querySelector('.configuration-action-bar'))
      .toHaveClass('configuration-action-bar--calibration-safe');
  });

  test('shows expected filename preview as the primary file naming guide', async () => {
    const config = {
      ...makeConfig('PT2', 'basic'),
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
    mockFetch(config, 'PT2');

    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await openFilenameConventionSubtab();
    const preview = await screen.findByTestId('expected-filename-preview');
    expect(preview).toHaveTextContent('D001_L001_PN001_side_modality.type');
    expect(screen.getByLabelText('Expected filename preview')).toHaveTextContent('ID value: 001');

    expect(screen.queryByLabelText('Level 1')).not.toBeInTheDocument();
  });

  test('saves disabled filename convention switch', async () => {
    const config = makeConfig('PT2', 'basic');
    mockFetch(config, 'PT2');

    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await openFilenameConventionSubtab();
    fireEvent.click(await screen.findByLabelText('Use filename convention'));
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
    expect(savedConfig.file_naming_scheme.use_filename_convention).toBe(false);
    expect(screen.getByText(/Filename convention assumptions are disabled/)).toBeInTheDocument();
  });

  test('keeps view descriptors user-facing as side in the expected filename preview', async () => {
    const config = makeConfig('PT2', 'basic');
    mockFetch(config, 'PT2');

    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await openFilenameConventionSubtab();
    expect(await screen.findByTestId('expected-filename-preview')).toHaveTextContent(
      'D001_P001_L001_S001_R001_side_modality.type',
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  async function openFilenameConventionSubtab() {
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Filename Convention' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Filename Convention' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Filename Convention' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Filename Convention' })).toBeInTheDocument());
  }

  test('loads copy source projects from the canonical trailing-slash endpoint', async () => {
    const config = makeConfig('PT2', 'basic');
    mockFetch(config, 'PT2');

    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByTestId('project-configuration-summary')).toBeInTheDocument());
    expect(global.fetch.mock.calls.map(([url]) => url)).toContain('/api/projects/');
    expect(global.fetch.mock.calls.map(([url]) => url)).not.toContain('/api/projects');
  });

  test('hides filename convention controls until users open the filename convention subtab', async () => {
    const config = makeConfig('PT2', 'basic');
    mockFetch(config, 'PT2');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.queryByRole('heading', { name: 'Filename Convention' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Level 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Add Hierarchy Level')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Filename Convention' }));
    await waitFor(() => expect(screen.getByRole('tabpanel', { name: 'Filename Convention configuration' })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Filename Convention' })).toBeInTheDocument();
  });

  test('filename convention directs hierarchy assignment to Images to Parts', async () => {
    const config = makeConfig('PT2', 'basic');
    mockFetch(config, 'PT2');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await openFilenameConventionSubtab();
    expect(screen.queryByLabelText('Level 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Add Hierarchy Level')).not.toBeInTheDocument();
    expect(screen.getByText('Part hierarchy assignment is configured in Project Data → Images to Parts → Automatically Assign Images to Parts.')).toBeInTheDocument();
  });


  test('filename configuration exposes arbitrary image identifiers, versions, and overlay matching controls', async () => {
    const config = makeConfig('PT2', 'basic');
    mockFetch(config, 'PT2');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await openFilenameConventionSubtab();
    fireEvent.click(screen.getByText('Add Image Descriptor'));
    fireEvent.change(screen.getByLabelText('Descriptor 3'), { target: { value: 'version' } });
    expect(screen.getByDisplayValue('v')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Add Image Descriptor'));
    fireEvent.change(screen.getByLabelText('Descriptor 4'), { target: { value: 'other' } });
    fireEvent.change(screen.getAllByLabelText('Custom Label').pop(), { target: { value: 'Camera Pose' } });
    expect(screen.getByText('Metadata key: camera_pose')).toBeInTheDocument();

    expect(screen.getByLabelText('Enable overlay filename matching')).toBeChecked();
    expect(screen.getByLabelText('Overlay values')).toHaveValue('true, overlay, ov, mask, heatmap');
    expect(screen.getByLabelText('Remove overlay specifier when matching base image')).toBeChecked();
  });

  test('adds and removes image descriptor rows', async () => {
    const config = makeConfig('PT2', 'basic');
    mockFetch(config, 'PT2');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await openFilenameConventionSubtab();
    expect(screen.queryByText('Add Hierarchy Level')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Add Image Descriptor'));
    expect(screen.getByLabelText('Descriptor 3')).toBeInTheDocument();

    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    fireEvent.click(removeButtons[removeButtons.length - 1]);
    expect(screen.queryByLabelText('Descriptor 3')).not.toBeInTheDocument();
  });


  test('UI Configuration subtab controls hide optional project sections and persist choices', async () => {
    const config = makeConfig('PT1', 'basic');
    mockFetch(config, 'PT1');
    render(<ProjectConfigurationPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'UI Configuration' })).toBeInTheDocument());
    expect(screen.queryByText('Available UI Sections')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'UI Configuration' }));
    expect(screen.getByText('Available UI Sections')).toBeInTheDocument();
    expect(screen.getByLabelText('Analyze')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Project Data/ }));
    expect(screen.getByLabelText('Batches subtab')).toBeChecked();

    fireEvent.click(screen.getByLabelText('Analyze'));
    expect(screen.queryByLabelText('Analyze tab')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Filename Convention subtab')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Batches subtab'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/proj-1/configuration',
      expect.objectContaining({ method: 'PUT' }),
    ));
    const putCall = global.fetch.mock.calls.find(
      ([url, options = {}]) => url === '/api/projects/proj-1/configuration' && options.method === 'PUT',
    );
    const savedConfig = JSON.parse(putCall[1].body).config;
    expect(savedConfig.ui_sections['main.analyze']).toBe(false);
    expect(savedConfig.ui_sections['analyze.toolbox']).toBe(false);
    expect(savedConfig.ui_sections['project_data.batches']).toBe(false);
    expect(savedConfig.ui_sections['project_data.images_to_parts']).toBe(true);
  });

  test('deep-normalizes legacy PT3 guide settings and renders their live preview', async () => {
    const config = {
      ...makeConfig('PT3', 'advanced'),
      display_settings: {
        ...makeConfig('PT3', 'advanced').display_settings,
        deployment_display_hint: 'preserve-me',
      },
    };
    mockFetch(config, 'PT3');
    render(<ProjectConfigurationPanel projectId="proj-1" projectType="PT3" />);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'UI Configuration' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'UI Configuration' }));

    expect(screen.getByTestId('pt3-guide-configuration-card')).toBeInTheDocument();
    expect(screen.getByLabelText('Crosshair transparency')).toHaveValue('50');
    expect(screen.getByLabelText('Crosshair line width')).toHaveValue('1.25');
    expect(screen.getByLabelText('Plane outline transparency')).toHaveValue('0');
    expect(screen.getByLabelText('Plane outline line width')).toHaveValue('1.25');
    expect(screen.getByLabelText('Plane outline line width')).toHaveAccessibleDescription(
      'The selected plane uses this width; the other planes use half for visual hierarchy.',
    );
    expect(screen.getByTestId('pt3-guide-preview')).toHaveAccessibleName('Live 3D guide appearance preview');
    expect(screen.getByTestId('pt3-guide-preview').closest('figure')).toHaveTextContent('Crosshair 50% transparent');
    expect(screen.getByRole('button', { name: 'Reset 3D view guides to defaults' })).toBeDisabled();
  });

  test('autosaves custom PT3 guide settings, preserves display siblings, and supports reset', async () => {
    jest.useFakeTimers();
    const config = {
      ...makeConfig('PT3', 'advanced'),
      display_settings: {
        ...makeConfig('PT3', 'advanced').display_settings,
        deployment_display_hint: 'preserve-me',
      },
    };
    mockFetch(config, 'PT3');
    render(<ProjectConfigurationPanel projectId="proj-1" projectType="PT3" />);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'UI Configuration' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'UI Configuration' }));

    fireEvent.change(screen.getByLabelText('Crosshair transparency'), { target: { value: '72' } });
    fireEvent.change(screen.getByLabelText('Crosshair line width'), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText('Plane outline transparency'), { target: { value: '35' } });
    fireEvent.change(screen.getByLabelText('Plane outline line width'), { target: { value: '3' } });
    expect(screen.getByTestId('pt3-guide-preview').closest('figure')).toHaveTextContent('Crosshair 72% transparent');
    expect(screen.getByTestId('pt3-guide-preview').closest('figure')).toHaveTextContent('Plane outlines 35% transparent');

    act(() => {
      jest.advanceTimersByTime(500);
    });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/proj-1/configuration',
      expect.objectContaining({ method: 'PUT' }),
    ));
    expect(await screen.findByText('Configuration autosaved.')).toBeInTheDocument();

    const autosaveCall = global.fetch.mock.calls.find(
      ([url, options = {}]) => url === '/api/projects/proj-1/configuration' && options.method === 'PUT',
    );
    const autosavedConfig = JSON.parse(autosaveCall[1].body).config;
    expect(autosavedConfig.display_settings).toEqual(expect.objectContaining({
      deployment_display_hint: 'preserve-me',
      pt3_3d_guides: {
        crosshair_transparency_percent: 72,
        crosshair_line_width_px: 2.5,
        plane_outline_transparency_percent: 35,
        plane_outline_line_width_px: 3,
      },
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Reset 3D view guides to defaults' }));
    expect(screen.getByLabelText('Crosshair transparency')).toHaveValue('50');
    expect(screen.getByLabelText('Crosshair line width')).toHaveValue('1.25');
    expect(screen.getByLabelText('Plane outline transparency')).toHaveValue('0');
    expect(screen.getByLabelText('Plane outline line width')).toHaveValue('1.25');

    fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));
    await waitFor(() => {
      const putCalls = global.fetch.mock.calls.filter(
        ([url, options = {}]) => url === '/api/projects/proj-1/configuration' && options.method === 'PUT',
      );
      expect(putCalls.length).toBeGreaterThanOrEqual(2);
      const savedConfig = JSON.parse(putCalls.at(-1)[1].body).config;
      expect(savedConfig.display_settings.pt3_3d_guides).toEqual({
        crosshair_transparency_percent: 50,
        crosshair_line_width_px: 1.25,
        plane_outline_transparency_percent: 0,
        plane_outline_line_width_px: 1.25,
      });
    });
    expect(await screen.findByRole('button', { name: 'Save Configuration' })).toBeEnabled();
  });

  test.each(['PT1', 'PT2'])('hides 3D View Guides for %s projects', async (projectType) => {
    const config = makeConfig(projectType, 'basic');
    mockFetch(config, projectType);
    render(<ProjectConfigurationPanel projectId="proj-1" projectType={projectType} />);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'UI Configuration' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'UI Configuration' }));
    expect(screen.queryByTestId('pt3-guide-configuration-card')).not.toBeInTheDocument();
  });

  test('keeps PT3 guide controls available when the Available UI Sections tree is disabled', async () => {
    const config = {
      ...makeConfig('PT3', 'advanced'),
      ui_sections: {
        'project_configuration.available_ui_sections': false,
      },
    };
    mockFetch(config, 'PT3');
    render(<ProjectConfigurationPanel projectId="proj-1" projectType="PT3" />);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'UI Configuration' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'UI Configuration' }));
    expect(screen.queryByRole('heading', { name: 'Available UI Sections' })).not.toBeInTheDocument();
    expect(screen.getByTestId('pt3-guide-configuration-card')).toBeInTheDocument();
    expect(screen.queryByText('No UI Configuration sections are enabled.')).not.toBeInTheDocument();
  });


  test('hides Filename Convention configuration for PT1 projects', async () => {
    const config = { ...makeConfig('PT1', 'basic'), ui_sections: {} };
    mockFetch(config, 'PT1');
    render(<ProjectConfigurationPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument());
    expect(screen.queryByRole('tab', { name: 'Filename Convention' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'UI Configuration' }));
    fireEvent.click(screen.getByRole('button', { name: /Project Configuration/ }));
    expect(screen.queryByLabelText('Filename Convention subtab')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sides section')).not.toBeInTheDocument();
    expect(screen.queryByText(/filename hierarchy/i)).not.toBeInTheDocument();
  });

  test('defaults missing Project Configuration visibility keys to visible subtabs', async () => {
    const config = { ...makeConfig('PT2', 'basic'), ui_sections: {} };
    mockFetch(config, 'PT2');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Filename Convention' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Hotkeys' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'UI Configuration' })).toBeInTheDocument();
  });

  test('hides Filename Convention subtab and panel when disabled in ui_sections', async () => {
    const config = {
      ...makeConfig('PT2', 'basic'),
      ui_sections: { 'project_configuration.filename_convention': false },
    };
    mockFetch(config, 'PT2');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument());
    expect(screen.queryByRole('tab', { name: 'Filename Convention' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tabpanel', { name: 'Filename Convention configuration' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Filename Convention' })).not.toBeInTheDocument();
  });

  test('falls back to the first visible subtab when General is disabled', async () => {
    const config = {
      ...makeConfig('PT2', 'basic'),
      ui_sections: { 'project_configuration.general': false },
    };
    mockFetch(config, 'PT2');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.queryByRole('tab', { name: 'General' })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Filename Convention' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('tabpanel', { name: 'Filename Convention configuration' })).toBeInTheDocument();
  });

  test('keeps Filename Convention hidden after saving UI Configuration and reloading', async () => {
    const config = makeConfig('PT2', 'basic');
    mockFetch(config, 'PT2');
    const { unmount } = render(<ProjectConfigurationPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'UI Configuration' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'UI Configuration' }));
    fireEvent.click(screen.getByRole('button', { name: /Project Configuration/ }));
    fireEvent.click(screen.getByLabelText('Filename Convention subtab'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/proj-1/configuration',
      expect.objectContaining({ method: 'PUT' }),
    ));
    const putCall = global.fetch.mock.calls.find(
      ([url, options = {}]) => url === '/api/projects/proj-1/configuration' && options.method === 'PUT',
    );
    const savedConfig = JSON.parse(putCall[1].body).config;
    expect(savedConfig.ui_sections['project_configuration.filename_convention']).toBe(false);

    unmount();
    jest.clearAllMocks();
    mockFetch(savedConfig, 'PT2');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument());
    expect(screen.queryByRole('tab', { name: 'Filename Convention' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Filename Convention' })).not.toBeInTheDocument();
  });

  test('hides disabled General child sections and Available UI Sections without blank panels', async () => {
    const config = {
      ...makeConfig('PT2', 'basic'),
      ui_sections: {
        'project_configuration.owner_section': false,
        'project_configuration.available_ui_sections': false,
      },
    };
    mockFetch(config, 'PT2');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.queryByRole('heading', { name: 'Project Owner' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Current User' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'UI Configuration' }));
    expect(screen.queryByRole('heading', { name: 'Available UI Sections' })).not.toBeInTheDocument();
    expect(screen.getByText('No UI Configuration sections are enabled.')).toBeInTheDocument();
  });

  test('shows an empty state when all Project Configuration subtabs are disabled', async () => {
    const config = {
      ...makeConfig('PT2', 'basic'),
      ui_sections: {
        'project_configuration.general': false,
        'project_configuration.filename_convention': false,
        'project_configuration.hotkeys': false,
        'project_configuration.ui_configuration': false,
      },
    };
    mockFetch(config, 'PT2');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText(/No Project Configuration sections are enabled/)).toBeInTheDocument());
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
  });

  test('top-level workspace rows toggle their matching main tabs without duplicate checkbox-only rows', async () => {
    const config = makeConfig('PT2', 'basic');
    mockFetch(config, 'PT2');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'UI Configuration' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'UI Configuration' }));

    expect(screen.getByLabelText('Report')).toBeChecked();
    expect(screen.queryByLabelText('Report tab')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Report'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/proj-1/configuration',
      expect.objectContaining({ method: 'PUT' }),
    ));
    const putCall = global.fetch.mock.calls.find(
      ([url, options = {}]) => url === '/api/projects/proj-1/configuration' && options.method === 'PUT',
    );
    const savedConfig = JSON.parse(putCall[1].body).config;
    expect(savedConfig.ui_sections['main.report']).toBe(false);
    expect(savedConfig.ui_sections['report.project_report']).toBe(false);
  });

  test('renders UI configuration rows with expansion and checkbox controls on the same line', async () => {
    const config = makeConfig('PT2', 'basic');
    mockFetch(config, 'PT2');
    const { container } = render(<ProjectConfigurationPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'UI Configuration' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'UI Configuration' }));

    const workspaceRow = screen.getByRole('button', { name: 'Collapse Vista workspace' })
      .closest('.configurable-ui-section-summary');
    expect(workspaceRow).toContainElement(screen.getByLabelText('Vista workspace'));

    const projectConfigurationRow = screen.getByRole('button', { name: 'Expand Project Configuration' })
      .closest('.configurable-ui-section-summary');
    expect(projectConfigurationRow).toContainElement(projectConfigurationRow.querySelector('input[type="checkbox"]'));
    expect(projectConfigurationRow).toHaveTextContent('Project Configuration');

    expect(screen.queryByLabelText('Project Configuration tab')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand Project Data' }));
    const batchesRow = screen.getByLabelText('Batches subtab').closest('.configurable-ui-section-leaf');
    expect(batchesRow.querySelector('.configurable-ui-section-expander-spacer')).toBeInTheDocument();
    expect(batchesRow).toContainElement(screen.getByLabelText('Batches subtab'));

    expect(container.querySelectorAll('.configurable-ui-section-leaf .configurable-ui-section-expander-spacer').length).toBeGreaterThan(0);
  });


  test('autosaves configuration changes after users edit fields', async () => {
    jest.useFakeTimers();
    const config = makeConfig('PT2', 'basic');
    mockFetch(config, 'PT2');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await openFilenameConventionSubtab();

    fireEvent.change(screen.getByLabelText('Modality label 1'), { target: { value: 'Autosaved thermal' } });
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

  test('keeps filename label lists focused and rejects blank or partial additions', async () => {
    const config = makeConfig('PT2', 'basic');
    mockFetch(config, 'PT2');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await openFilenameConventionSubtab();

    expect(screen.queryByLabelText('Part view required modalities 1')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Part view source 1')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Image modality calibration required 1')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Image modality example uploaded 1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Side' }));
    fireEvent.change(screen.getByLabelText(`Side label ${config.part_views.length + 1}`), {
      target: { value: 'Rear side' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Modality' }));
    fireEvent.change(screen.getByLabelText(`Modality filename value ${config.image_modalities.length + 1}`), {
      target: { value: 'uv' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

    expect(await screen.findByText(/Each side requires both a filename value and label/)).toBeInTheDocument();
    expect(screen.getByText(/Each modality requires both a filename value and label/)).toBeInTheDocument();
  });

  test('removing a modality clears hidden side requirements before saving', async () => {
    const config = makeConfig('PT2', 'basic');
    mockFetch(config, 'PT2');
    render(<ProjectConfigurationPanel projectId="proj-1" />);

    await openFilenameConventionSubtab();
    fireEvent.click(screen.getByLabelText('Remove image modality 1'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

    await waitFor(() => {
      const putCalls = global.fetch.mock.calls.filter(
        ([url, options = {}]) => url === '/api/projects/proj-1/configuration' && options.method === 'PUT',
      );
      expect(putCalls.length).toBeGreaterThan(0);
      const savedConfig = JSON.parse(putCalls.at(-1)[1].body).config;
      expect(savedConfig.image_modalities).toEqual([]);
      expect(savedConfig.part_views[0].required_modalities).toEqual([]);
    });
  });

  test('flushes pending autosave immediately for callers that must wait before leaving the tab', async () => {
    jest.useFakeTimers();
    const config = makeConfig('PT2', 'basic');
    mockFetch(config, 'PT2');
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
    const config = makeConfig('PT2', 'basic');
    mockFetch(config, 'PT2');
    const { container } = render(<ProjectConfigurationPanel projectId="proj-1" />);

    await waitFor(() => expect(screen.getByTestId('configuration-sections-grid')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Owner Name'), { target: { value: 'Ada Inspector' } });
    fireEvent.change(screen.getByLabelText('Owner Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Active Username'), { target: { value: 'manual-reviewer' } });

    fireEvent.click(screen.getByRole('tab', { name: 'Filename Convention' }));
    await waitFor(() => expect(screen.getByLabelText('Descriptor 1')).toBeInTheDocument());
    expect(screen.queryByLabelText('Level 1')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Descriptor 1'), { target: { value: 'operator' } });
    fireEvent.change(container.querySelector('#image-descriptor-abbreviation-0'), { target: { value: 'OP' } });
    fireEvent.change(screen.getByLabelText('Modality label 1'), { target: { value: 'Thermal image' } });
    fireEvent.change(screen.getByLabelText('Modality filename value 1'), { target: { value: 'thermal' } });
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    await waitFor(() => expect(screen.getByLabelText('Require disposition on submit')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Require disposition on submit'));
    fireEvent.click(screen.getByLabelText('Require measurement for critical defects'));
    fireEvent.click(screen.getByLabelText('Require second reviewer for rejects'));

    fireEvent.click(screen.getByRole('tab', { name: 'Hotkeys' }));
    fireEvent.change(screen.getByLabelText('Accept hotkey'), { target: { value: 'q' } });
    fireEvent.change(screen.getByLabelText('Reject hotkey'), { target: { value: 'w' } });
    fireEvent.change(screen.getByLabelText('Help hotkey'), { target: { value: 'e' } });
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));

    fireEvent.click(screen.getByLabelText('Track serial number at batch level'));
    fireEvent.click(screen.getByLabelText('Organize each batch into sub-batches'));
    fireEvent.click(screen.getByLabelText('Track serial number at sub-batch level'));
    fireEvent.click(screen.getByLabelText('Track serial number at part level'));

    fireEvent.click(screen.getByLabelText('Manually choose current project phase'));
    fireEvent.change(screen.getByLabelText('Manual project phase'), { target: { value: 'reporting' } });

    fireEvent.change(screen.getByLabelText('Defect type name 1'), { target: { value: 'Crack' } });
    fireEvent.change(screen.getByLabelText('Defect type color 1'), { target: { value: '#123abc' } });
    fireEvent.change(screen.getByLabelText('Defect type definition 1'), { target: { value: 'Linear fracture' } });

    fireEvent.click(screen.getByRole('tab', { name: 'Filename Convention' }));
    fireEvent.change(screen.getByLabelText('Side label 1'), { target: { value: 'Top view' } });
    fireEvent.change(screen.getByLabelText('Side filename value 1'), { target: { value: 'top' } });
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    fireEvent.change(screen.getByLabelText('Default colormap'), { target: { value: 'magma' } });
    fireEvent.change(screen.getByLabelText('Anomaly colormap'), { target: { value: 'grayscale' } });
    fireEvent.click(screen.getByLabelText('Use grayscale base image'));
    fireEvent.change(screen.getByLabelText('Maximum inspection images per row'), { target: { value: '12' } });

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
        inspection_tile_max_columns: 12,
        pt3_3d_guides: {
          crosshair_transparency_percent: 50,
          crosshair_line_width_px: 1.25,
          plane_outline_transparency_percent: 0,
          plane_outline_line_width_px: 1.25,
        },
      },
    }));
    expect(savedConfig.file_naming_scheme.image_descriptors[0]).toEqual({ id: 'operator', label: 'Operator', abbreviation: 'OP' });
    expect(savedConfig.image_modalities[0]).toEqual({
      id: 'thermal',
      label: 'Thermal image',
      calibration_required: false,
      example_image_uploaded: true,
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
      source: 'manual',
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

  configurationScenarioMatrix.forEach(([projectType, syntheticUser]) => {
    test(`loads and saves configuration for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType);

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByTestId('project-configuration-summary')).toBeInTheDocument());

        expect(screen.getAllByRole('heading', { name: 'Modalities' }).length).toBeGreaterThan(0);
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

        await openFilenameConventionSubtab();

        fireEvent.click(screen.getByRole('button', { name: 'Add Modality' }));
        fireEvent.change(screen.getByLabelText(`Modality label ${config.image_modalities.length + 1}`), {
          target: { value: `Synthetic ${projectType} ${syntheticUser}` },
        });
        fireEvent.change(screen.getByLabelText(`Modality filename value ${config.image_modalities.length + 1}`), {
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

        await waitFor(() => expect(screen.getByRole('tab', { name: 'Hotkeys' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('tab', { name: 'Hotkeys' }));
        expect(screen.getByRole('tabpanel', { name: 'Hotkeys configuration' })).toBeInTheDocument();

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
        config.part_views[0].required_modalities = ['nonexistent_modality'];
        mockFetch(config, projectType);

        render(<ProjectConfigurationPanel projectId="proj-1" />);

        await waitFor(() => expect(screen.getByRole('tab', { name: 'Hotkeys' })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('tab', { name: 'Hotkeys' }));
        expect(screen.getByRole('tabpanel', { name: 'Hotkeys configuration' })).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Accept hotkey'), { target: { value: 'q' } });
        fireEvent.change(screen.getByLabelText('Reject hotkey'), { target: { value: 'q' } });
        fireEvent.click(screen.getByRole('tab', { name: 'General' }));
        fireEvent.change(screen.getByLabelText('Defect type color 1'), { target: { value: 'red' } });
        const putCallsBefore = global.fetch.mock.calls.filter(
          ([url, options = {}]) => url === '/api/projects/proj-1/configuration' && options.method === 'PUT',
        ).length;

        fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

        await waitFor(() => {
          expect(screen.getByText(/Hotkeys must be unique/)).toBeInTheDocument();
          expect(screen.getByText(/Defect type colors must be valid/)).toBeInTheDocument();
          expect(screen.getByText(/Stored side modality requirements must reference configured modalities/)).toBeInTheDocument();
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

        await openFilenameConventionSubtab();
        await waitFor(() => expect(screen.getByLabelText('Side label 1')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: 'Add Side' }));
        fireEvent.change(screen.getByLabelText(`Side label ${config.part_views.length + 1}`), {
          target: { value: `Expanded ${projectType} ${syntheticUser}` },
        });
        fireEvent.change(screen.getByLabelText(`Side filename value ${config.part_views.length + 1}`), {
          target: { value: `${projectType.toLowerCase()}-${syntheticUser}-expanded-view` },
        });
        fireEvent.click(screen.getByLabelText('Remove side 1'));
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

  cloneWorkflowScenarioMatrix.forEach(([projectType, syntheticUser]) => {
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

      test(`rejects clone success payloads with invalid PT3 guide settings for ${projectType} ${syntheticUser} synthetic user`, async () => {
        const config = makeConfig(projectType, syntheticUser);
        mockFetch(config, projectType, { cloneInvalidPt3GuideSettings: true });

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
