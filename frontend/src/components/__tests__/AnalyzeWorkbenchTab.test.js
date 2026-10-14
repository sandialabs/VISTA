import React from 'react';
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AnalyzeWorkbenchTab from '../AnalyzeWorkbenchTab';

const toolboxPayload = {
  name: 'backend_analyze_toolbox',
  version: '0.1.0',
  contract_version: 'vista-analyze.v1',
  methods: [
    {
      id: 'source.project_part_images',
      name: 'Project Part Image Source',
      category: 'Input',
      description: 'Source',
      input_types: ['any'],
      output_types: ['image'],
      parameters: [{ name: 'example_image_id', label: 'Choose Example', type: 'string', default: '' }],
    },
    {
      id: 'output.versioned_image_artifact',
      name: 'Recipe / Artifact Output',
      category: 'Output',
      description: 'Output',
      input_types: ['image', 'mask', 'labels', 'detections', 'measurements', 'metadata'],
      output_types: ['metadata'],
      parameters: [
        {
          name: 'mode',
          label: 'Output Mode',
          type: 'select',
          default: 'processing_sequence',
          options: ['processing_sequence', 'metadata_only', 'overlay_artifact', 'materialized_image', 'review_only'],
        },
        {
          name: 'export_policy',
          label: 'Export Policy',
          type: 'select',
          default: 'materialize_on_export',
          options: ['materialize_on_export', 'recipe_plus_artifacts', 'metadata_only'],
        },
        { name: 'materialize_processed_images', label: 'Materialize Processed Images', type: 'boolean', default: false },
      ],
    },
    {
      id: 'preprocess.window_level_normalization',
      name: 'Window / Level Normalization',
      category: 'Preprocessing',
      description: 'Normalize',
      input_types: ['image'],
      output_types: ['image'],
      parameters: [
        { name: 'window', label: 'Window', type: 'float', default: 400, min_value: 1 },
        { name: 'level', label: 'Level', type: 'float', default: 40 },
        { name: 'clip', label: 'Clip Outliers', type: 'boolean', default: true },
      ],
    },
    {
      id: 'segmentation.yolo.placeholder',
      name: 'YOLO',
      category: 'Segmentation',
      description: 'YOLO segmentation adapter',
      input_types: ['image'],
      output_types: ['mask', 'detections', 'measurements'],
      parameters: [
        { name: 'integration_mode', label: 'Local/Remote', type: 'select', default: 'local', options: ['local', 'remote'] },
        { name: 'fastapi_url', label: 'FastAPI URL', type: 'string', default: '' },
        { name: 'mode', label: 'Segmentation Mode', type: 'string', default: 'predict' },
        { name: 'checkpoint_id', label: 'Checkpoint', type: 'string', default: '' },
        { name: 'prompts', label: 'Prompts JSON', type: 'json', default: {} },
        { name: 'options', label: 'Options JSON', type: 'json', default: { model: 'yolo11n-seg.pt', confidence: 0.25, iou: 0.7 } },
      ],
    },
    {
      id: 'segmentation.anomalib.placeholder',
      name: 'Anomalib',
      category: 'Segmentation',
      description: 'Anomalib segmentation adapter',
      input_types: ['image'],
      output_types: ['mask', 'measurements', 'metadata'],
      parameters: [
        { name: 'integration_mode', label: 'Local/Remote', type: 'select', default: 'local', options: ['local', 'remote'] },
        { name: 'fastapi_url', label: 'FastAPI URL', type: 'string', default: '' },
        { name: 'mode', label: 'Segmentation Mode', type: 'string', default: 'default' },
        { name: 'checkpoint_id', label: 'Checkpoint', type: 'string', default: '' },
        { name: 'prompts', label: 'Prompts JSON', type: 'json', default: {} },
        { name: 'options', label: 'Options JSON', type: 'json', default: { model_name: 'patchcore', threshold: 0.5, min_mask_area_px: 1 } },
      ],
    },
    {
      id: 'segmentation.opencv.placeholder',
      name: 'OpenCV',
      category: 'Segmentation',
      description: 'Placeholder segmenter',
      input_types: ['image'],
      output_types: ['mask'],
      parameters: [
        { name: 'integration_mode', label: 'Local/Remote', type: 'select', default: 'local', options: ['local', 'remote'] },
        { name: 'fastapi_url', label: 'FastAPI URL', type: 'string', default: '' },
        { name: 'options', label: 'Options JSON', type: 'json', default: { min_peak_distance_px: 1 } },
      ],
    },
    {
      id: 'segmentation.fastapi.remote',
      name: 'FastAPI Segmentation',
      category: 'Segmentation',
      description: 'Remote FastAPI segmentation service',
      input_types: ['image'],
      output_types: ['mask', 'detections', 'measurements', 'metadata'],
      parameters: [
        { name: 'fastapi_url', label: 'FastAPI URL', type: 'string', default: 'http://localhost:8001/run-inference-presigned', required: true },
        { name: 'timeout_seconds', label: 'Service Response Timeout Seconds', type: 'float', default: 60, min_value: 1 },
        { name: 'job_stall_timeout_seconds', label: 'No-Response Timeout Seconds', type: 'float', default: 600, min_value: 5 },
        { name: 'poll_interval_seconds', label: 'Status Poll Interval Seconds', type: 'float', default: 2, min_value: 0.5 },
      ],
    },
    {
      id: 'preprocess.minmax_normalization',
      name: 'Min-Max Normalization',
      category: 'Preprocessing',
      description: 'Rescale image intensities to a target numeric range.',
      input_types: ['image'],
      output_types: ['image'],
      parameters: [
        { name: 'output_min', label: 'Output Min', type: 'float', default: 0 },
        { name: 'output_max', label: 'Output Max', type: 'float', default: 1 },
      ],
    },
  ],
};

const inputPayload = {
  project_id: 'proj-1',
  source: {
    id: 'all-loaded-part-images',
    label: 'All images from loaded parts',
    kind: 'project_parts',
    project_id: 'proj-1',
    image_count: 2,
    part_count: 1,
  },
  parts: [{ part_id: 'part-1', serial_number: 'SN-1', display_name: 'Part 1', image_count: 2 }],
  images: [
    { image_id: 'img-1', filename: 'slice-001.png', part_id: 'part-1', part_serial_number: 'SN-1', slice_index: 1 },
    { image_id: 'img-2', filename: 'slice-002.png', part_id: 'part-1', part_serial_number: 'SN-1', slice_index: 2 },
  ],
};

function mockFetchFallback(url, options = {}) {
    if (url === '/api/analyze/toolbox') {
      return Promise.resolve({ ok: true, json: async () => toolboxPayload });
    }
    if (url === '/api/projects/proj-1/analyze/input-source') {
      return Promise.resolve({ ok: true, json: async () => inputPayload });
    }
    if (url === '/api/projects/proj-1/metadata/vista.analyze.workflow' && (!options.method || options.method === 'GET')) {
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: 'not found' }) });
    }
    if (url === '/api/projects/proj-1/metadata/vista.analyze.workflow' && options.method === 'PUT') {
      const body = JSON.parse(options.body);
      return Promise.resolve({ ok: true, json: async () => ({ key: body.key, value: body.value }) });
    }
    if (url === '/api/projects/proj-1/analyze/workflows/execute' && options.method === 'POST') {
      return Promise.resolve({
        ok: true,
        text: async () => JSON.stringify({
          run_id: 'run-1',
          workflow_name: 'Part image analysis workflow',
          status: 'completed',
          execution_mode: 'execution',
          image_count: 2,
          node_results: [{ node_id: 'input-source', method_id: 'source.project_part_images', status: 'completed' }],
          warnings: [],
        }),
        json: async () => ({
          run_id: 'run-1',
          workflow_name: 'Part image analysis workflow',
          status: 'completed',
          execution_mode: 'execution',
          image_count: 2,
          node_results: [{ node_id: 'input-source', method_id: 'source.project_part_images', status: 'completed' }],
          warnings: [],
        }),
      });
    }
    if (url === '/api/projects/proj-1/analyze/workflows/start' && options.method === 'POST') {
      return Promise.resolve({ ok: true, text: async () => JSON.stringify({ run_id: 'run-remote-1' }) });
    }
    if (url === '/api/projects/proj-1/analyze/runs/run-remote-1') {
      return Promise.resolve({
        ok: true,
        text: async () => JSON.stringify({
          run_id: 'run-remote-1',
          status: 'completed',
          result: {
            run_id: 'run-remote-1',
            workflow_name: 'Part image analysis workflow',
            status: 'completed',
            execution_mode: 'execution',
            image_count: 2,
            node_results: [{ node_id: 'remote', method_id: 'segmentation.fastapi.remote', status: 'completed' }],
            warnings: [],
          },
          remote_jobs: [{ job_id: 'job-remote-1', remote_status: 'completed', uploaded_outputs: [{ kind: 'prediction' }], log_tail: ['done'] }],
        }),
      });
    }
    if (url === '/api/projects/proj-1/analyze/workflows/validate' && options.method === 'POST') {
      return Promise.resolve({
        ok: true,
        text: async () => JSON.stringify({
          run_id: 'run-1',
          workflow_name: 'Part image analysis workflow',
          status: 'validated',
          image_count: 2,
          node_results: [],
          warnings: [],
        }),
        json: async () => ({
          run_id: 'run-1',
          workflow_name: 'Part image analysis workflow',
          status: 'validated',
          image_count: 2,
          node_results: [],
          warnings: [],
        }),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: 'not found' }) });
}

function mockFetch() {
  global.fetch = jest.fn(mockFetchFallback);
}

function dragMethodToGraph(methodRoleName, methodId, point = {}) {
  const toolboxMethod = screen.getByRole('button', { name: methodRoleName });
  const graph = screen.getByTestId('analyze-graph');
  const dataTransfer = { setData: jest.fn(), getData: jest.fn(() => methodId), effectAllowed: 'copy' };
  graph.getBoundingClientRect = jest.fn(() => ({
    left: 0,
    top: 0,
    right: 980,
    bottom: 540,
    width: 980,
    height: 540,
  }));
  fireEvent.dragStart(toolboxMethod, { dataTransfer });
  const dropEvent = createEvent.drop(graph, { dataTransfer });
  Object.defineProperty(dropEvent, 'clientX', { value: point.clientX ?? 0 });
  Object.defineProperty(dropEvent, 'clientY', { value: point.clientY ?? 0 });
  fireEvent(graph, dropEvent);
}

describe('AnalyzeWorkbenchTab', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  test('loads toolbox methods and renders the default graph', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Pipeline Studio' })).toBeInTheDocument();
    expect(await screen.findByTestId('analyze-source-summary')).toHaveTextContent('1 parts');
    expect(screen.getByLabelText('Analyze Workbench')).not.toBeEmptyDOMElement();
    expect(screen.getByLabelText('Analyze toolbox')).toHaveTextContent('Input');
    expect(screen.getByTestId('analyze-graph')).toHaveTextContent('Loaded Part Images');
    expect(screen.getByLabelText('Workflow block settings')).toHaveTextContent('Status');
    expect(screen.getByTestId('analyze-source-summary')).toHaveTextContent('2 images');
    expect(screen.getByRole('button', { name: /Workflow block Window \/ Level Normalization/i })).toBeInTheDocument();
  });

  test('shows output artifact options without exposing internal policy fields', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Recipe \/ Artifact Output/i });
    fireEvent.click(screen.getByRole('button', { name: /Workflow block Recipe \/ Artifact Output/i }));

    expect(screen.getByLabelText('Output Mode')).toBeInTheDocument();
    expect(screen.getByLabelText('Export Policy')).toBeInTheDocument();
    expect(screen.queryByLabelText('Version Strategy')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cache Policy')).not.toBeInTheDocument();
  });

  test('edits window level and runs workflow', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Window \/ Level Normalization/i });
    fireEvent.click(screen.getByRole('button', { name: /Workflow block Window \/ Level Normalization/i }));
    fireEvent.change(screen.getByLabelText('Window'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByTestId('analyze-run-summary')).toHaveTextContent('completed'));
    const executeCall = global.fetch.mock.calls.find(([url]) => url === '/api/projects/proj-1/analyze/workflows/execute');
    expect(executeCall).toEqual([
      '/api/projects/proj-1/analyze/workflows/execute',
      expect.objectContaining({
        method: 'POST',
      })
    ]);
    const workflow = JSON.parse(executeCall[1].body);
    expect(workflow.nodes.some((node) => node.method_id === 'output.versioned_image_artifact')).toBe(true);
    expect(workflow.output).toEqual(expect.objectContaining({
      mode: 'processing_sequence',
      version_strategy: 'recipe_metadata',
      artifact_policy: 'automatic_by_output_type',
      cache_policy: 'local_on_demand',
      invalidation_policy: 'source_workflow_toolbox_model',
      provenance_level: 'full',
      export_policy: 'materialize_on_export',
      volume_policy: 'recipe_volume_sparse_artifacts',
      preserve_original: true,
      write_detection_metadata: true,
      write_segmentation_overlays: true,
      materialize_processed_images: false,
    }));
    expect(workflow.source.kind).toBe('project_parts');
    expect(executeCall[1].body).toContain('"window":250');
  }, 10000);

  test('auto-selects the default YOLO checkpoint for the YOLO analysis block', async () => {
    mockFetch();
    global.fetch.mockImplementation((url, options = {}) => {
      if (url === '/api/projects/proj-1/analyze/checkpoints?scope=project') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            checkpoints: [{
              id: 'default-yolo-id',
              filename: 'yolo11n-seg.pt',
              model_family: 'yolo',
              model_type: 'YOLO',
              model_version: 'YOLOv11',
              size_bytes: 5900000,
            }],
          }),
        });
      }
      if (url === '/api/projects/proj-1/analyze/checkpoints?scope=authorized') {
        return Promise.resolve({ ok: true, json: async () => ({ checkpoints: [] }) });
      }
      return mockFetchFallback(url, options);
    });
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Loaded Part Images/i });
    fireEvent.click(screen.getByRole('button', { name: /Workflow block YOLO/i }));

    await waitFor(() => expect(screen.getByLabelText('Checkpoint')).toHaveValue('default-yolo-id'));
    fireEvent.click(screen.getByRole('button', { name: 'Run Example' }));

    await waitFor(() => expect(screen.getByTestId('analyze-run-summary')).toHaveTextContent('completed'));
    const executeCall = global.fetch.mock.calls.find(([url]) => url === '/api/projects/proj-1/analyze/workflows/execute');
    const workflow = JSON.parse(executeCall[1].body);
    const yoloNode = workflow.nodes.find((node) => node.method_id === 'segmentation.yolo.placeholder');
    expect(yoloNode.parameters.checkpoint_id).toBe('default-yolo-id');
  });

  test('auto-selects the default Anomalib checkpoint for an Anomalib analysis block', async () => {
    mockFetch();
    global.fetch.mockImplementation((url, options = {}) => {
      if (url === '/api/projects/proj-1/analyze/checkpoints?scope=project') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            checkpoints: [{
              id: 'default-anomalib-id',
              filename: 'patchcore_default.ckpt',
              model_family: 'anomalib',
              model_type: 'Anomalib',
              model_version: 'PatchCore',
              size_bytes: 12000000,
              uploaded_by_user_id: 'system',
              object_storage_key: 'proj-1/checkpoints/default/patchcore_default.ckpt',
              diagnostics: { builtin_checkpoint_path: '/app/checkpoints/patchcore_default.ckpt' },
            }],
          }),
        });
      }
      if (url === '/api/projects/proj-1/analyze/checkpoints?scope=authorized') {
        return Promise.resolve({ ok: true, json: async () => ({ checkpoints: [] }) });
      }
      return mockFetchFallback(url, options);
    });
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Loaded Part Images/i });
    dragMethodToGraph(/^Anomalib/i, 'segmentation.anomalib.placeholder', { clientX: 1040, clientY: 120 });

    await waitFor(() => expect(screen.getByLabelText('Checkpoint')).toHaveValue('default-anomalib-id'));
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByTestId('analyze-run-summary')).toHaveTextContent('completed'));
    const executeCall = global.fetch.mock.calls.find(([url]) => url === '/api/projects/proj-1/analyze/workflows/execute');
    const workflow = JSON.parse(executeCall[1].body);
    const anomalibNode = workflow.nodes.find((node) => node.method_id === 'segmentation.anomalib.placeholder');
    expect(anomalibNode.parameters.checkpoint_id).toBe('default-anomalib-id');
  });

  test('prefers bundled YOLO checkpoint over a same-name project upload', async () => {
    mockFetch();
    global.fetch.mockImplementation((url, options = {}) => {
      if (url === '/api/projects/proj-1/analyze/checkpoints?scope=project') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            checkpoints: [
              {
                id: 'uploaded-yolo-id',
                filename: 'yolo11n-seg.pt',
                model_family: 'yolo',
                model_type: 'YOLO',
                size_bytes: 5900000,
                parameter_count: 2893306,
                uploaded_by_user_id: 'user@example.com',
                object_storage_key: 'proj-1/checkpoints/uploaded/yolo11n-seg.pt',
                diagnostics: {},
              },
              {
                id: 'default-yolo-id',
                filename: 'yolo11n-seg.pt',
                model_family: 'yolo',
                model_type: 'YOLO',
                size_bytes: 5900000,
                parameter_count: 2893306,
                uploaded_by_user_id: 'system',
                object_storage_key: 'proj-1/checkpoints/default/yolo11n-seg.pt',
                diagnostics: { builtin_checkpoint_path: '/app/checkpoints/yolo11n-seg.pt' },
              },
            ],
            diagnostics: {
              endpoint: '/analyze/checkpoints',
              default_yolo_file_present: true,
              default_yolo_registered: true,
              default_yolo_checkpoint_id: 'default-yolo-id',
            },
          }),
        });
      }
      if (url === '/api/projects/proj-1/analyze/checkpoints?scope=authorized') {
        return Promise.resolve({ ok: true, json: async () => ({ checkpoints: [] }) });
      }
      return mockFetchFallback(url, options);
    });

    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Loaded Part Images/i });
    fireEvent.click(screen.getByRole('tab', { name: 'Checkpoints' }));

    await waitFor(() => expect(screen.getByTestId('checkpoint-status-readout')).toHaveTextContent('/analyze/checkpoints ok'));
    expect(screen.getByTestId('checkpoint-status-readout')).toHaveTextContent('default YOLO file present, registered');
    expect(screen.getByTestId('checkpoint-status-readout')).toHaveTextContent('project 2 total, yolo 2');
    expect(screen.getAllByText(/2\.89M/)[0]).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Pipeline Studio' }));
    fireEvent.click(screen.getByRole('button', { name: /Workflow block YOLO/i }));

    await waitFor(() => expect(screen.getByLabelText('Checkpoint')).toHaveValue('default-yolo-id'));
  });

  test('opens checkpoint model diagram from project checkpoint name', async () => {
    global.fetch = jest.fn((url, options) => {
      if (url === '/api/projects/proj-1/analyze/checkpoints?scope=project') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            checkpoints: [
              {
                id: 'default-yolo-id',
                filename: 'yolo11n-seg.pt',
                model_family: 'yolo',
                model_type: 'YOLO',
                model_version: 'YOLOv11',
                size_bytes: 5900000,
                parameter_count: 2893306,
              },
            ],
            diagnostics: { endpoint: '/analyze/checkpoints' },
          }),
        });
      }
      if (url === '/api/projects/proj-1/analyze/checkpoints?scope=authorized') {
        return Promise.resolve({ ok: true, json: async () => ({ checkpoints: [] }) });
      }
      if (url === '/api/projects/proj-1/analyze/checkpoints/default-yolo-id/graph') {
        return Promise.resolve({
          ok: true,
          text: async () => JSON.stringify({
            checkpoint_id: 'default-yolo-id',
            filename: 'yolo11n-seg.pt',
            parameter_count: 2893306,
            parameter_count_kind: 'module_parameters',
            warnings: [],
            graph: {
              source: 'torch_module_hierarchy',
              nodes: [
                { id: 'root', label: 'yolo11n-seg.pt', path: '<root>', type: 'SegmentationModel', kind: 'Module', depth: 0, parameter_count: 2893306 },
                { id: 'module:model.0', label: '0', path: 'model.0', type: 'Conv', kind: 'Module', depth: 2, parent: 'module:model', parameter_count: 464 },
              ],
              edges: [],
              truncated: false,
            },
          }),
        });
      }
      return mockFetchFallback(url, options);
    });

    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Loaded Part Images/i });
    fireEvent.click(screen.getByRole('tab', { name: 'Checkpoints' }));
    fireEvent.click(await screen.findByRole('button', { name: 'View model diagram for yolo11n-seg.pt' }));

    expect(await screen.findByRole('dialog', { name: 'yolo11n-seg.pt' })).toBeInTheDocument();
    expect(await screen.findByText('module_parameters')).toBeInTheDocument();
    expect(screen.getByText('SegmentationModel')).toBeInTheDocument();
    expect(screen.getByText('model.0')).toBeInTheDocument();
  });

  test('steps float parameters by arrows and adaptive wheel increments', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Window \/ Level Normalization/i });
    fireEvent.click(screen.getByRole('button', { name: /Workflow block Window \/ Level Normalization/i }));

    const windowInput = screen.getByLabelText('Window');
    expect(windowInput).toHaveAttribute('step', '0.05');

    fireEvent.change(windowInput, { target: { value: '250' } });
    expect(windowInput).toHaveValue(250);

    fireEvent.wheel(windowInput, { deltaY: -6 });
    await waitFor(() => expect(windowInput).toHaveValue(250.01));

    fireEvent.wheel(windowInput, { deltaY: 120 });
    await waitFor(() => expect(windowInput).toHaveValue(249.96));

    fireEvent.change(windowInput, { target: { value: '1.01' } });
    fireEvent.wheel(windowInput, { deltaY: 120 });
    await waitFor(() => expect(windowInput).toHaveValue(1));
    fireEvent.click(screen.getByRole('button', { name: /^OpenCV/i }));
    expect(screen.getByLabelText('Local/Remote')).toHaveValue('local');
    expect(screen.queryByLabelText('FastAPI URL')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Options JSON')).toHaveValue(JSON.stringify({ min_peak_distance_px: 1 }, null, 2));
  });

  test('shows FastAPI URL only for remote segmentation execution', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Loaded Part Images/i });
    fireEvent.click(screen.getByRole('button', { name: /Workflow block YOLO/i }));

    const localRemote = screen.getByLabelText('Local/Remote');
    expect(localRemote).toHaveValue('local');
    expect(screen.queryByLabelText('FastAPI URL')).not.toBeInTheDocument();

    fireEvent.change(localRemote, { target: { value: 'remote' } });

    expect(screen.getByLabelText('FastAPI URL')).toBeInTheDocument();
    expect(screen.queryByLabelText('Local Function Path')).not.toBeInTheDocument();
  });

  test('clicking a toolbox method previews its configuration without adding a workflow block', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    const toolboxMethod = await screen.findByRole('button', { name: /^Min-Max Normalization/i });
    fireEvent.click(toolboxMethod);

    const inspector = screen.getByLabelText('Workflow block settings');
    expect(within(inspector).getByRole('heading', { name: 'Min-Max Normalization' })).toBeInTheDocument();
    expect(within(inspector).getByText('preprocess.minmax_normalization')).toBeInTheDocument();
    expect(within(inspector).getByLabelText('Output Min')).toHaveValue(0);
    expect(within(inspector).getByLabelText('Output Max')).toHaveValue(1);
    expect(screen.queryByRole('button', { name: /Workflow block Min-Max Normalization/i })).not.toBeInTheDocument();
  });

  test('adds demo FastAPI segmentation block to workflow', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Loaded Part Images/i });
    dragMethodToGraph(/^FastAPI Segmentation/i, 'segmentation.fastapi.remote', { clientX: 1040, clientY: 120 });

    const remoteNode = screen.getByRole('button', { name: /Workflow block FastAPI Segmentation/i });
    fireEvent.click(remoteNode);
    expect(screen.getByLabelText('FastAPI URL')).toHaveValue('http://localhost:8001/run-inference-presigned');
    expect(screen.queryByLabelText('Request Format')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Service Response Timeout Seconds')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('No-Response Timeout Seconds')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Status Poll Interval Seconds')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Options JSON')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run Example' }));

    await waitFor(() => expect(screen.getByTestId('analyze-run-summary')).toHaveTextContent('completed'));
    const executeCall = global.fetch.mock.calls.find(([url]) => url === '/api/projects/proj-1/analyze/workflows/start');
    const workflow = JSON.parse(executeCall[1].body);
    const fastapiNode = workflow.nodes.find((node) => node.method_id === 'segmentation.fastapi.remote');
    expect(fastapiNode).toEqual(expect.objectContaining({
      parameters: expect.objectContaining({
        fastapi_url: 'http://localhost:8001/run-inference-presigned',
      }),
    }));
  });

  test('uses streamlined FastAPI demo defaults when running an example', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Loaded Part Images/i });
    dragMethodToGraph(/^FastAPI Segmentation/i, 'segmentation.fastapi.remote', { clientX: 1040, clientY: 120 });

    const remoteNode = screen.getByRole('button', { name: /Workflow block FastAPI Segmentation/i });
    fireEvent.click(remoteNode);
    expect(screen.getByLabelText('FastAPI URL')).toHaveValue('http://localhost:8001/run-inference-presigned');
    fireEvent.click(screen.getByRole('button', { name: 'Run Example' }));

    await waitFor(() => expect(screen.getByTestId('analyze-run-summary')).toHaveTextContent('completed'));
    const executeCall = global.fetch.mock.calls.find(([url]) => url === '/api/projects/proj-1/analyze/workflows/start');
    const workflow = JSON.parse(executeCall[1].body);
    const fastapiNode = workflow.nodes.find((node) => node.method_id === 'segmentation.fastapi.remote');
    expect(fastapiNode.parameters).toEqual({
      fastapi_url: 'http://localhost:8001/run-inference-presigned',
    });
  });

  test('shows detailed FastAPI failure diagnostics in the status panel', async () => {
    global.fetch = jest.fn((url, options = {}) => {
      if (url === '/api/analyze/toolbox') return Promise.resolve({ ok: true, json: async () => toolboxPayload });
      if (url === '/api/projects/proj-1/analyze/input-source') return Promise.resolve({ ok: true, json: async () => inputPayload });
      if (url === '/api/projects/proj-1/metadata/vista.analyze.workflow' && (!options.method || options.method === 'GET')) {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: 'not found' }) });
      }
      if (url === '/api/projects/proj-1/metadata/vista.analyze.workflow' && options.method === 'PUT') {
        const body = JSON.parse(options.body);
        return Promise.resolve({ ok: true, json: async () => ({ key: body.key, value: body.value }) });
      }
      if (url === '/api/projects/proj-1/analyze/workflows/execute' && options.method === 'POST') {
        return Promise.resolve({
          ok: true,
          text: async () => JSON.stringify({
            run_id: 'run-1',
            workflow_name: 'Part image analysis workflow',
            status: 'failed',
            execution_mode: 'execution',
            image_count: 1,
            node_results: [
              {
                node_id: 'remote',
                method_id: 'segmentation.fastapi.remote',
                status: 'failed',
                output_types: ['mask'],
                message: 'FastAPI analysis call did not produce usable annotations or overlays. Remote job failed. Connected to endpoint: yes. Endpoint attempted execution: yes. Result returned: yes. (slice-001.png)',
                summary: {
                  runtime_warning: 'Remote GPU inference job job-1 failed.',
                  fastapi_diagnostics: {
                    endpoint_connected: true,
                    endpoint_attempted_execution: 'yes',
                    result_returned: true,
                    result_usable_for_overlay: false,
                    http_status: 200,
                    remote_job_id: 'job-1',
                    remote_job_status: 'failed',
                    remote_return_code: 7,
                    failure_stage: 'remote_job',
                    detail: 'model crashed',
                    remote_log_tail: ['downloaded input', 'model crashed'],
                  },
                },
                artifacts: [],
              },
            ],
            warnings: [],
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: 'not found' }) });
    });

    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Loaded Part Images/i });
    fireEvent.click(screen.getByRole('button', { name: 'Run Example' }));

    const details = await screen.findByTestId('analyze-status-details');
    expect(details).toHaveTextContent('remote');
    expect(details).toHaveTextContent('Connected');
    expect(details).toHaveTextContent('yes');
    expect(details).toHaveTextContent('Attempted execution');
    expect(details).toHaveTextContent('Result returned');
    expect(details).toHaveTextContent('Overlay ready');
    expect(details).toHaveTextContent('Job ID');
    expect(details).toHaveTextContent('job-1');
    expect(details).toHaveTextContent('Return code');
    expect(details).toHaveTextContent('7');
    expect(details).toHaveTextContent('model crashed');
  });

  test('shows exact segmentation fallback reason in run example details', async () => {
    mockFetch();
    global.fetch.mockImplementation((url, options = {}) => {
      if (url === '/api/projects/proj-1/analyze/workflows/execute' && options.method === 'POST') {
        return Promise.resolve({
          ok: true,
          text: async () => JSON.stringify({
            run_id: 'run-yolo-fallback',
            workflow_name: 'Part image analysis workflow',
            status: 'completed',
            execution_mode: 'execution',
            image_count: 1,
            node_results: [
              { node_id: 'input-source', method_id: 'source.project_part_images', status: 'completed' },
              {
                node_id: 'yolo',
                method_id: 'segmentation.yolo.placeholder',
                status: 'completed',
                message: 'Completed segmentation component integration.',
                summary: {
                  backend: 'yolo',
                  runtime_warning: 'YOLO runtime failed; used foreground fallback (No module named ultralytics).',
                  detection_count: 1,
                  metrics: {
                    runtime: 'analysis_toolkit.yolo_fallback',
                    mask_count: 1,
                    fallback_reason: 'No module named ultralytics',
                  },
                },
              },
            ],
            warnings: ['YOLO runtime failed; used foreground fallback (No module named ultralytics).'],
          }),
        });
      }
      return mockFetchFallback(url, options);
    });

    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Loaded Part Images/i });
    fireEvent.click(screen.getByRole('button', { name: 'Run Example' }));

    const details = await screen.findByTestId('analyze-status-details');
    expect(details).toHaveTextContent('Fallback reason');
    expect(details).toHaveTextContent('No module named ultralytics');
  });

  test('clears the Analyze status panel after a run', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Loaded Part Images/i });
    fireEvent.click(screen.getByRole('button', { name: 'Run Example' }));

    await waitFor(() => expect(screen.getByTestId('analyze-run-summary')).toHaveTextContent('completed'));
    expect(screen.getByText(/Workflow execution completed for the example image/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear status' }));

    expect(screen.queryByTestId('analyze-run-summary')).not.toBeInTheDocument();
    expect(screen.queryByText(/Workflow execution completed for the example image/i)).not.toBeInTheDocument();
    expect(screen.getByText('No status message.')).toBeInTheDocument();
  });

  test('drops a toolbox block into the middle of an existing chain from the drop position', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Loaded Part Images/i });
    dragMethodToGraph(/^Min-Max Normalization/i, 'preprocess.minmax_normalization', { clientX: 430, clientY: 120 });

    expect(screen.getByRole('button', { name: /Workflow block Min-Max Normalization/i })).toHaveStyle({ left: '520px', top: '84px' });
    expect(screen.getByRole('button', { name: /Workflow block YOLO/i })).toHaveStyle({ left: '744px', top: '84px' });

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByTestId('analyze-run-summary')).toHaveTextContent('completed'));
    const executeCall = global.fetch.mock.calls.find(([url]) => url === '/api/projects/proj-1/analyze/workflows/execute');
    const workflow = JSON.parse(executeCall[1].body);
    expect(workflow.nodes.map((node) => node.method_id)).toEqual([
      'source.project_part_images',
      'preprocess.window_level_normalization',
      'preprocess.minmax_normalization',
      'segmentation.yolo.placeholder',
      'output.versioned_image_artifact',
    ]);
  });

  test('only appends a toolbox block when it is dropped near the end of a chain', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Loaded Part Images/i });
    dragMethodToGraph(/^Min-Max Normalization/i, 'preprocess.minmax_normalization', { clientX: 1040, clientY: 120 });

    expect(screen.getByRole('button', { name: /Workflow block Min-Max Normalization/i })).toHaveStyle({ left: '968px', top: '84px' });

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByTestId('analyze-run-summary')).toHaveTextContent('completed'));
    const executeCall = global.fetch.mock.calls.find(([url]) => url === '/api/projects/proj-1/analyze/workflows/execute');
    const workflow = JSON.parse(executeCall[1].body);
    expect(workflow.nodes.map((node) => node.method_id)).toEqual([
      'source.project_part_images',
      'preprocess.window_level_normalization',
      'segmentation.yolo.placeholder',
      'output.versioned_image_artifact',
      'preprocess.minmax_normalization',
    ]);
  });

  test('snaps a toolbox block dropped below existing chains to the next empty row', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Loaded Part Images/i });
    dragMethodToGraph(/^Min-Max Normalization/i, 'preprocess.minmax_normalization', { clientX: 320, clientY: 500 });

    expect(screen.getByRole('button', { name: /Workflow block Min-Max Normalization/i })).toHaveStyle({ left: '72px', top: '236px' });
  });

  test('chooses an example image and runs only the example through the pipeline', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('heading', { name: 'Pipeline Studio' });
    await waitFor(() => expect(screen.getByTestId('analyze-source-summary')).toHaveTextContent('2 images'));

    fireEvent.click(screen.getByRole('button', { name: /Workflow block Loaded Part Images/i }));
    expect(screen.getByRole('heading', { name: 'Loaded Part Images' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Loaded Images to Process' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select Images' }));
    const dialog = screen.getByRole('dialog', { name: 'Loaded Images to Process' });
    expect(dialog).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Choose Example'), { target: { value: 'img-2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close input source chooser' }));

    fireEvent.click(screen.getByRole('button', { name: 'Run Example' }));

    await waitFor(() => expect(screen.getByTestId('analyze-run-summary')).toHaveTextContent('completed'));
    const executeCall = global.fetch.mock.calls.find(([url]) => url === '/api/projects/proj-1/analyze/workflows/execute');
    const workflow = JSON.parse(executeCall[1].body);
    expect(workflow.source.kind).toBe('manual_selection');
    expect(workflow.source.selected_image_ids).toEqual(['img-2']);
    expect(workflow.source.example_image_id).toBe('img-2');
  });

  test('removes images from the process set through the input block modal', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('heading', { name: 'Pipeline Studio' });
    await waitFor(() => expect(screen.getByTestId('analyze-source-summary')).toHaveTextContent('2 images'));
    fireEvent.click(screen.getByRole('button', { name: /Workflow block Loaded Part Images/i }));
    expect(screen.queryByRole('dialog', { name: 'Loaded Images to Process' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select Images' }));
    const dialog = screen.getByRole('dialog', { name: 'Loaded Images to Process' });
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Remove' })[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close input source chooser' }));

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByTestId('analyze-run-summary')).toHaveTextContent('completed'));
    const executeCall = global.fetch.mock.calls.find(([url]) => url === '/api/projects/proj-1/analyze/workflows/execute');
    const workflow = JSON.parse(executeCall[1].body);
    expect(workflow.source.kind).toBe('manual_selection');
    expect(workflow.source.selected_image_ids).toEqual(['img-2']);
  });

  test('removes multiple selected workflow blocks from the configuration column', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /Workflow block Window \/ Level Normalization/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Workflow block Window \/ Level Normalization/i }));
    fireEvent.click(screen.getByRole('button', { name: /Workflow block YOLO/i }), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }));

    expect(screen.queryByRole('button', { name: /Workflow block Window \/ Level Normalization/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Workflow block YOLO/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByTestId('analyze-run-summary')).toHaveTextContent('completed'));
    const executeCall = global.fetch.mock.calls.find(([url]) => url === '/api/projects/proj-1/analyze/workflows/execute');
    const workflow = JSON.parse(executeCall[1].body);
    expect(workflow.nodes.map((node) => node.method_id)).not.toContain('preprocess.window_level_normalization');
  });

  test('shows readable workflow error when execute returns non-json', async () => {
    const setError = jest.fn();
    mockFetch();
    global.fetch.mockImplementation((url, options = {}) => {
      if (url === '/api/projects/proj-1/analyze/workflows/execute' && options.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 502,
          text: async () => '<html><body>Bad Gateway from OpenCV worker</body></html>',
        });
      }
      return mockFetchFallback(url, options);
    });

    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={setError} />);

    await screen.findByRole('button', { name: /Workflow block Window \/ Level Normalization/i });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(setError).toHaveBeenCalledWith(expect.stringContaining('HTTP 502')));
    expect(setError.mock.calls[0][0]).toContain('Bad Gateway from OpenCV worker');
    expect(setError.mock.calls[0][0]).not.toContain('JSON.parse');
  });

  test('shows checkpoint proxy diagnostics when checkpoint inspection returns html', async () => {
    const setError = jest.fn();
    mockFetch();
    global.fetch.mockImplementation((url, options = {}) => {
      if (url === '/api/projects/proj-1/analyze/checkpoints/diagnose' && options.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 503,
          headers: { get: (name) => (name.toLowerCase() === 'x-debug-location' ? 'api-main-block' : 'text/html') },
          text: async () => '<html><body>Service Unavailable</body></html>',
        });
      }
      return mockFetchFallback(url, options);
    });

    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={setError} />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Checkpoints' }));
    const fileInput = document.querySelector('input[type="file"]');
    fireEvent.change(fileInput, { target: { files: [new File(['checkpoint'], 'model.pt')] } });

    await waitFor(() => expect(setError).toHaveBeenCalledWith(expect.stringContaining('HTTP 503')));
    expect(setError.mock.calls[0][0]).toContain('proxy location: api-main-block');
    expect(setError.mock.calls[0][0]).toContain('large upload');
    expect(setError.mock.calls[0][0]).toContain('Service Unavailable');
  });

  test('drags workflow blocks to reposition them on the graph canvas', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    const windowNode = await screen.findByRole('button', { name: /Workflow block Window \/ Level Normalization/i });
    expect(windowNode).toHaveStyle({ left: '296px', top: '84px' });

    fireEvent.mouseDown(windowNode, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(windowNode, { clientX: 150, clientY: 132 });
    fireEvent.mouseUp(windowNode, { clientX: 150, clientY: 132 });

    await waitFor(() => expect(windowNode).toHaveStyle({ left: '296px', top: '84px' }));
  });

  test('rewires workflow order when a block is dragged between two blocks', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    const outputNode = await screen.findByRole('button', { name: /Workflow block Recipe \/ Artifact Output/i });

    fireEvent.mouseDown(outputNode, { button: 0, clientX: 600, clientY: 132 });
    fireEvent.mouseMove(outputNode, { clientX: 310, clientY: 132 });
    fireEvent.mouseUp(outputNode, { clientX: 310, clientY: 132 });

    await waitFor(() => expect(outputNode).toHaveStyle({ left: '520px', top: '84px' }));

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByTestId('analyze-run-summary')).toHaveTextContent('completed'));
    const executeCall = global.fetch.mock.calls.find(([url]) => url === '/api/projects/proj-1/analyze/workflows/execute');
    const workflow = JSON.parse(executeCall[1].body);
    expect(workflow.nodes.map((node) => node.method_id)).toEqual([
      'source.project_part_images',
      'preprocess.window_level_normalization',
      'output.versioned_image_artifact',
      'segmentation.yolo.placeholder',
    ]);
    expect(workflow.edges.map((edge) => [edge.source_node, edge.target_node])).toEqual([
      [workflow.nodes[0].id, workflow.nodes[1].id],
      [workflow.nodes[1].id, workflow.nodes[2].id],
      [workflow.nodes[2].id, workflow.nodes[3].id],
    ]);
  });

  test('adds an additional input block as a separate processing chain', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Loaded Part Images/i });

    dragMethodToGraph(/^Project Part Image Source/i, 'source.project_part_images');
    expect(screen.getByRole('button', { name: /Workflow block Loaded Part Images 2/i })).toHaveStyle({ left: '72px', top: '236px' });

    fireEvent.click(screen.getByRole('button', { name: /Workflow block Loaded Part Images 2/i }));
    dragMethodToGraph(/^Min-Max Normalization/i, 'preprocess.minmax_normalization', { clientX: 380, clientY: 260 });
    expect(screen.getByRole('button', { name: /Workflow block Min-Max Normalization/i })).toHaveStyle({ left: '296px', top: '236px' });

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByTestId('analyze-run-summary')).toHaveTextContent('completed'));
    const executeCall = global.fetch.mock.calls.find(([url]) => url === '/api/projects/proj-1/analyze/workflows/execute');
    const workflow = JSON.parse(executeCall[1].body);
    const chain2 = workflow.nodes.filter((node) => node.chain_id === 'chain-2');
    expect(chain2.map((node) => node.method_id)).toEqual([
      'source.project_part_images',
      'preprocess.minmax_normalization',
    ]);
    expect(workflow.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_node: chain2[0].id, target_node: chain2[1].id }),
    ]));
  });

  test('persists edited workflow graph as project metadata', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Loaded Part Images/i });
    dragMethodToGraph(/^Project Part Image Source/i, 'source.project_part_images');

    await waitFor(() => {
      const saveCall = global.fetch.mock.calls.find(([url, options = {}]) => (
        url === '/api/projects/proj-1/metadata/vista.analyze.workflow'
        && options.method === 'PUT'
        && JSON.parse(options.body).value.nodes.some((node) => node.chain_id === 'chain-2')
      ));
      expect(saveCall).toBeTruthy();
    });
  });

  test('restores saved two-chain workflow from project metadata', async () => {
    global.fetch = jest.fn((url, options = {}) => {
      if (url === '/api/analyze/toolbox') {
        return Promise.resolve({ ok: true, json: async () => toolboxPayload });
      }
      if (url === '/api/projects/proj-1/analyze/input-source') {
        return Promise.resolve({ ok: true, json: async () => inputPayload });
      }
      if (url === '/api/projects/proj-1/metadata/vista.analyze.workflow' && (!options.method || options.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            key: 'vista.analyze.workflow',
            value: {
              nodes: [
                { id: 'saved-input-1', method_id: 'source.project_part_images', label: 'Loaded Part Images', chain_id: 'chain-1', parameters: {}, x: 72, y: 84 },
                { id: 'saved-minmax', method_id: 'preprocess.minmax_normalization', label: 'Min-Max Normalization', chain_id: 'chain-1', parameters: { output_min: 0, output_max: 1 }, x: 296, y: 84 },
                { id: 'saved-input-2', method_id: 'source.project_part_images', label: 'Loaded Part Images 2', chain_id: 'chain-2', parameters: {}, x: 72, y: 236 },
                { id: 'saved-segment', method_id: 'segmentation.opencv.placeholder', label: 'OpenCV', chain_id: 'chain-2', parameters: { integration_mode: 'placeholder' }, x: 296, y: 236 },
              ],
              process_image_ids: ['img-2'],
              example_image_id: 'img-2',
            },
          }),
        });
      }
      if (url === '/api/projects/proj-1/metadata/vista.analyze.workflow' && options.method === 'PUT') {
        const body = JSON.parse(options.body);
        return Promise.resolve({ ok: true, json: async () => ({ key: body.key, value: body.value }) });
      }
      if (url === '/api/projects/proj-1/analyze/workflows/execute' && options.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            run_id: 'run-1',
            workflow_name: 'Part image analysis workflow',
            status: 'completed',
            execution_mode: 'execution',
            image_count: 1,
            node_results: [],
            warnings: [],
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: 'not found' }) });
    });

    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    expect(await screen.findByRole('button', { name: /Workflow block Loaded Part Images 2/i })).toHaveStyle({ left: '72px', top: '236px' });
    fireEvent.click(screen.getByRole('button', { name: 'Run Example' }));

    await waitFor(() => expect(screen.getByTestId('analyze-run-summary')).toHaveTextContent('completed'));
    const executeCall = global.fetch.mock.calls.find(([url]) => url === '/api/projects/proj-1/analyze/workflows/execute');
    const workflow = JSON.parse(executeCall[1].body);
    expect(workflow.nodes.filter((node) => node.chain_id === 'chain-2')).toHaveLength(2);
    expect(workflow.source.selected_image_ids).toEqual(['img-2']);
  });

  test('snaps a dragged processing block into a nearby chain after the eighty percent threshold', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Loaded Part Images/i });
    dragMethodToGraph(/^Project Part Image Source/i, 'source.project_part_images');
    fireEvent.click(screen.getByRole('button', { name: /Workflow block Loaded Part Images 2/i }));
    dragMethodToGraph(/^Min-Max Normalization/i, 'preprocess.minmax_normalization', { clientX: 380, clientY: 260 });

    const placeholderNode = screen.getByRole('button', { name: /Workflow block YOLO/i });
    fireEvent.mouseDown(placeholderNode, { button: 0, clientX: 600, clientY: 100 });
    fireEvent.mouseMove(placeholderNode, { clientX: 180, clientY: 225 });
    fireEvent.mouseUp(placeholderNode, { clientX: 180, clientY: 225 });

    await waitFor(() => expect(placeholderNode).toHaveStyle({ left: '296px', top: '236px' }));

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByTestId('analyze-run-summary')).toHaveTextContent('completed'));
    const executeCall = global.fetch.mock.calls.find(([url]) => url === '/api/projects/proj-1/analyze/workflows/execute');
    const workflow = JSON.parse(executeCall[1].body);
    const chain1 = workflow.nodes.filter((node) => node.chain_id === 'chain-1');
    const chain2 = workflow.nodes.filter((node) => node.chain_id === 'chain-2');
    expect(chain1.map((node) => node.method_id)).toEqual([
      'source.project_part_images',
      'preprocess.window_level_normalization',
      'output.versioned_image_artifact',
    ]);
    expect(chain2.map((node) => node.method_id)).toEqual([
      'source.project_part_images',
      'segmentation.yolo.placeholder',
      'preprocess.minmax_normalization',
    ]);
    expect(workflow.edges.map((edge) => [edge.source_node, edge.target_node])).toEqual(expect.arrayContaining([
      [chain2[0].id, chain2[1].id],
      [chain2[1].id, chain2[2].id],
    ]));
  });
});
