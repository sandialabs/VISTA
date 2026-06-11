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
        { name: 'window', label: 'Window', type: 'float', default: 400 },
        { name: 'level', label: 'Level', type: 'float', default: 40 },
        { name: 'sensitivity', label: 'Sensitivity', type: 'float', default: 0.5, min_value: 0, max_value: 1 },
        { name: 'clip', label: 'Clip Outliers', type: 'boolean', default: true },
      ],
    },
    {
      id: 'segmentation.opencv.placeholder',
      name: 'OpenCV Segmentation Placeholder',
      category: 'Segmentation',
      description: 'Placeholder segmenter',
      input_types: ['image'],
      output_types: ['mask'],
      parameters: [
        { name: 'integration_mode', label: 'Integration', type: 'select', default: 'placeholder', options: ['placeholder'] },
      ],
    },
    {
      id: 'ml.yolov8.detect',
      name: 'YOLOv8 Object Detection',
      category: 'Machine Learning',
      description: 'Detect',
      input_types: ['image'],
      output_types: ['detections'],
      parameters: [{ name: 'model', label: 'Model', type: 'string', default: 'yolov8n.pt', required: true }],
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

function mockFetch() {
  global.fetch = jest.fn((url, options = {}) => {
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
    if (url === '/api/projects/proj-1/analyze/workflows/validate' && options.method === 'POST') {
      return Promise.resolve({
        ok: true,
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
  });
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

  test('loads toolbox methods, renders graph, edits window level, and runs workflow', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Pipeline Studio' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('analyze-source-summary')).toHaveTextContent('1 parts'));
    expect(screen.getByLabelText('Analyze Workbench')).not.toBeEmptyDOMElement();
    expect(screen.getByLabelText('Analyze toolbox')).toHaveTextContent('Input');
    expect(screen.getByTestId('analyze-graph')).toHaveTextContent('Loaded Part Images');
    expect(screen.getByLabelText('Workflow block settings')).toHaveTextContent('Status');
    expect(screen.getByTestId('analyze-source-summary')).toHaveTextContent('2 images');
    expect(screen.getByRole('button', { name: /Workflow block Window \/ Level Normalization/i })).toBeInTheDocument();

    dragMethodToGraph(/YOLOv8 Object Detection/i, 'ml.yolov8.detect');
    expect(screen.getByRole('button', { name: /Workflow block YOLOv8 Object Detection/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Workflow block Recipe \/ Artifact Output/i }));
    expect(screen.getByLabelText('Output Mode')).toBeInTheDocument();
    expect(screen.getByLabelText('Export Policy')).toBeInTheDocument();
    expect(screen.queryByLabelText('Version Strategy')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cache Policy')).not.toBeInTheDocument();

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
  });

  test('steps float parameters by arrows and adaptive wheel increments', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Window \/ Level Normalization/i });
    fireEvent.click(screen.getByRole('button', { name: /Workflow block Window \/ Level Normalization/i }));

    const sensitivityInput = screen.getByLabelText('Sensitivity');
    expect(sensitivityInput).toHaveAttribute('step', '0.05');

    fireEvent.change(sensitivityInput, { target: { value: '0.55' } });
    expect(sensitivityInput).toHaveValue(0.55);

    fireEvent.wheel(sensitivityInput, { deltaY: -6 });
    await waitFor(() => expect(sensitivityInput).toHaveValue(0.56));

    fireEvent.wheel(sensitivityInput, { deltaY: 120 });
    await waitFor(() => expect(sensitivityInput).toHaveValue(0.51));

    fireEvent.change(sensitivityInput, { target: { value: '0.99' } });
    fireEvent.wheel(sensitivityInput, { deltaY: -120 });
    await waitFor(() => expect(sensitivityInput).toHaveValue(1));

    const windowInput = screen.getByLabelText('Window');
    expect(windowInput).toHaveAttribute('step', '0.05');
    const placeholderNode = screen.getByRole('button', { name: /Workflow block OpenCV Segmentation Placeholder/i });
    fireEvent.click(placeholderNode);
    expect(screen.getByLabelText('Integration')).toHaveValue('placeholder');
  });

  test('clicking a toolbox method previews its configuration without adding a workflow block', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    const toolboxMethod = await screen.findByRole('button', { name: /^YOLOv8 Object Detection/i });
    fireEvent.click(toolboxMethod);

    const inspector = screen.getByLabelText('Workflow block settings');
    expect(within(inspector).getByRole('heading', { name: 'YOLOv8 Object Detection' })).toBeInTheDocument();
    expect(within(inspector).getByText('ml.yolov8.detect')).toBeInTheDocument();
    expect(within(inspector).getByLabelText('Model')).toHaveValue('yolov8n.pt');
    expect(screen.queryByRole('button', { name: /Workflow block YOLOv8 Object Detection/i })).not.toBeInTheDocument();
  });

  test('drops a toolbox block into the middle of an existing chain from the drop position', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Loaded Part Images/i });
    dragMethodToGraph(/^YOLOv8 Object Detection/i, 'ml.yolov8.detect', { clientX: 430, clientY: 120 });

    expect(screen.getByRole('button', { name: /Workflow block YOLOv8 Object Detection/i })).toHaveStyle({ left: '520px', top: '84px' });
    expect(screen.getByRole('button', { name: /Workflow block OpenCV Segmentation Placeholder/i })).toHaveStyle({ left: '744px', top: '84px' });

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByTestId('analyze-run-summary')).toHaveTextContent('completed'));
    const executeCall = global.fetch.mock.calls.find(([url]) => url === '/api/projects/proj-1/analyze/workflows/execute');
    const workflow = JSON.parse(executeCall[1].body);
    expect(workflow.nodes.map((node) => node.method_id)).toEqual([
      'source.project_part_images',
      'preprocess.window_level_normalization',
      'ml.yolov8.detect',
      'segmentation.opencv.placeholder',
      'output.versioned_image_artifact',
    ]);
  });

  test('only appends a toolbox block when it is dropped near the end of a chain', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Loaded Part Images/i });
    dragMethodToGraph(/^YOLOv8 Object Detection/i, 'ml.yolov8.detect', { clientX: 1040, clientY: 120 });

    expect(screen.getByRole('button', { name: /Workflow block YOLOv8 Object Detection/i })).toHaveStyle({ left: '968px', top: '84px' });

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByTestId('analyze-run-summary')).toHaveTextContent('completed'));
    const executeCall = global.fetch.mock.calls.find(([url]) => url === '/api/projects/proj-1/analyze/workflows/execute');
    const workflow = JSON.parse(executeCall[1].body);
    expect(workflow.nodes.map((node) => node.method_id)).toEqual([
      'source.project_part_images',
      'preprocess.window_level_normalization',
      'segmentation.opencv.placeholder',
      'output.versioned_image_artifact',
      'ml.yolov8.detect',
    ]);
  });

  test('snaps a toolbox block dropped below existing chains to the next empty row', async () => {
    mockFetch();
    render(<AnalyzeWorkbenchTab projectId="proj-1" projectType="PT3" setError={jest.fn()} />);

    await screen.findByRole('button', { name: /Workflow block Loaded Part Images/i });
    dragMethodToGraph(/^YOLOv8 Object Detection/i, 'ml.yolov8.detect', { clientX: 320, clientY: 500 });

    expect(screen.getByRole('button', { name: /Workflow block YOLOv8 Object Detection/i })).toHaveStyle({ left: '72px', top: '236px' });
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
    fireEvent.click(screen.getByRole('button', { name: /Workflow block OpenCV Segmentation Placeholder/i }), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }));

    expect(screen.queryByRole('button', { name: /Workflow block Window \/ Level Normalization/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Workflow block OpenCV Segmentation Placeholder/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByTestId('analyze-run-summary')).toHaveTextContent('completed'));
    const executeCall = global.fetch.mock.calls.find(([url]) => url === '/api/projects/proj-1/analyze/workflows/execute');
    const workflow = JSON.parse(executeCall[1].body);
    expect(workflow.nodes.map((node) => node.method_id)).not.toContain('preprocess.window_level_normalization');
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
      'segmentation.opencv.placeholder',
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
    dragMethodToGraph(/^YOLOv8 Object Detection/i, 'ml.yolov8.detect', { clientX: 380, clientY: 260 });
    expect(screen.getByRole('button', { name: /Workflow block YOLOv8 Object Detection/i })).toHaveStyle({ left: '296px', top: '236px' });

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByTestId('analyze-run-summary')).toHaveTextContent('completed'));
    const executeCall = global.fetch.mock.calls.find(([url]) => url === '/api/projects/proj-1/analyze/workflows/execute');
    const workflow = JSON.parse(executeCall[1].body);
    const chain2 = workflow.nodes.filter((node) => node.chain_id === 'chain-2');
    expect(chain2.map((node) => node.method_id)).toEqual([
      'source.project_part_images',
      'ml.yolov8.detect',
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
                { id: 'saved-yolo', method_id: 'ml.yolov8.detect', label: 'YOLOv8 Object Detection', chain_id: 'chain-1', parameters: { model: 'yolov8n.pt' }, x: 296, y: 84 },
                { id: 'saved-input-2', method_id: 'source.project_part_images', label: 'Loaded Part Images 2', chain_id: 'chain-2', parameters: {}, x: 72, y: 236 },
                { id: 'saved-segment', method_id: 'segmentation.opencv.placeholder', label: 'OpenCV Segmentation Placeholder', chain_id: 'chain-2', parameters: { integration_mode: 'placeholder' }, x: 296, y: 236 },
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
    dragMethodToGraph(/^YOLOv8 Object Detection/i, 'ml.yolov8.detect', { clientX: 380, clientY: 260 });

    const placeholderNode = screen.getByRole('button', { name: /Workflow block OpenCV Segmentation Placeholder/i });
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
      'segmentation.opencv.placeholder',
      'ml.yolov8.detect',
    ]);
    expect(workflow.edges.map((edge) => [edge.source_node, edge.target_node])).toEqual(expect.arrayContaining([
      [chain2[0].id, chain2[1].id],
      [chain2[1].id, chain2[2].id],
    ]));
  });
});
