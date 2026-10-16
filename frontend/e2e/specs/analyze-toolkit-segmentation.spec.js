const { test, expect } = require('@playwright/test');
const { mockInspectionWorkbenchRoutes } = require('../fixtures/inspectionWorkbenchMocks');

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
      id: 'segmentation.yolo.placeholder',
      name: 'YOLO',
      category: 'Segmentation',
      description: 'YOLO segmentation adapter',
      input_types: ['image'],
      output_types: ['mask', 'detections', 'measurements'],
      parameters: [
        { name: 'integration_mode', label: 'Integration Mode', type: 'select', default: 'placeholder', options: ['placeholder', 'local_import', 'fastapi'] },
        { name: 'mode', label: 'Segmentation Mode', type: 'string', default: 'predict' },
        { name: 'checkpoint_id', label: 'Checkpoint', type: 'string', default: '' },
        { name: 'prompts', label: 'Prompts JSON', type: 'json', default: {} },
        { name: 'options', label: 'Options JSON', type: 'json', default: { model: 'yolo11n-seg.pt', confidence: 0.25, iou: 0.7 } },
      ],
      available_checkpoints: [
        { id: 'default-yolo-id', label: 'YOLO11n Segmentation', model_family: 'yolo', model_type: 'YOLO', model_version: 'YOLOv11', filename: 'yolo11n-seg.pt', available: true },
      ],
    },
    {
      id: 'segmentation.sam.placeholder',
      name: 'SAM',
      category: 'Segmentation',
      description: 'SAM segmentation adapter',
      input_types: ['image'],
      output_types: ['mask', 'measurements'],
      parameters: [
        { name: 'integration_mode', label: 'Integration Mode', type: 'select', default: 'placeholder', options: ['placeholder', 'local_import', 'fastapi'] },
        { name: 'mode', label: 'Segmentation Mode', type: 'string', default: 'default' },
        { name: 'prompts', label: 'Prompts JSON', type: 'json', default: {} },
        { name: 'options', label: 'Options JSON', type: 'json', default: {} },
      ],
    },
    {
      id: 'segmentation.anomalib.placeholder',
      name: 'Anomalib',
      category: 'Segmentation',
      description: 'Anomalib anomaly segmentation adapter',
      input_types: ['image'],
      output_types: ['mask', 'measurements', 'metadata'],
      parameters: [
        { name: 'integration_mode', label: 'Integration Mode', type: 'select', default: 'placeholder', options: ['placeholder', 'local_import', 'fastapi'] },
        { name: 'mode', label: 'Segmentation Mode', type: 'string', default: 'default' },
        { name: 'checkpoint_id', label: 'Checkpoint', type: 'string', default: '' },
        { name: 'prompts', label: 'Prompts JSON', type: 'json', default: {} },
        { name: 'options', label: 'Options JSON', type: 'json', default: { model_name: 'patchcore', threshold: 0.5, min_mask_area_px: 1 } },
      ],
      available_checkpoints: [
        { id: 'ots-anomalib-patchcore-default', label: 'Anomalib PatchCore Default', model_family: 'anomalib', model_type: 'Anomalib', model_version: 'PatchCore', filename: 'patchcore_default.ckpt', available: true },
      ],
    },
    {
      id: 'segmentation.opencv.placeholder',
      name: 'OpenCV',
      category: 'Segmentation',
      description: 'OpenCV segmentation adapter',
      input_types: ['image'],
      output_types: ['mask', 'measurements'],
      parameters: [
        { name: 'integration_mode', label: 'Integration Mode', type: 'select', default: 'placeholder', options: ['placeholder', 'local_import', 'fastapi'] },
        { name: 'mode', label: 'Segmentation Mode', type: 'string', default: 'default' },
        { name: 'options', label: 'Options JSON', type: 'json', default: { min_peak_distance_px: 1 } },
      ],
    },
    {
      id: 'output.versioned_image_artifact',
      name: 'Recipe / Artifact Output',
      category: 'Output',
      description: 'Output',
      input_types: ['image', 'mask', 'measurements', 'metadata'],
      output_types: ['metadata'],
      parameters: [
        { name: 'mode', label: 'Output Mode', type: 'select', default: 'processing_sequence', options: ['processing_sequence', 'overlay_artifact'] },
        { name: 'export_policy', label: 'Export Policy', type: 'select', default: 'materialize_on_export', options: ['materialize_on_export'] },
        { name: 'materialize_processed_images', label: 'Materialize Processed Images', type: 'boolean', default: false },
      ],
    },
  ],
};

function inputSource(projectId) {
  return {
    project_id: projectId,
    source: {
      id: 'all-loaded-part-images',
      label: 'All images from loaded parts',
      kind: 'project_parts',
      project_id: projectId,
      image_count: 1,
      part_count: 1,
    },
    parts: [{ part_id: 'part-opencv-1', serial_number: 'OPENCV-1', display_name: 'OpenCV Part', image_count: 1 }],
    images: [{ image_id: '11111111-1111-4111-8111-111111111111', filename: 'opencv-source.png', part_id: 'part-opencv-1', part_serial_number: 'OPENCV-1' }],
  };
}

test('Analyze tab runs toolkit segmentation workflows and shows completion', async ({ page }) => {
  const { projectId } = await mockInspectionWorkbenchRoutes(page, { type: 'PT3', scenario: 'basic' });
  const executeRequests = [];

  await page.route('**/api/analyze/toolbox', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(toolboxPayload) });
  });
  await page.route(`**/api/projects/${projectId}/analyze/input-source`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(inputSource(projectId)) });
  });
  await page.route(`**/api/projects/${projectId}/analyze/checkpoints?scope=project`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ checkpoints: [{ id: 'default-yolo-id', filename: 'yolo11n-seg.pt', model_family: 'yolo', model_type: 'YOLO', model_version: 'YOLOv11', size_bytes: 5900000 }] }),
    });
  });
  await page.route(`**/api/projects/${projectId}/analyze/checkpoints?scope=authorized`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checkpoints: [] }) });
  });
  await page.route(`**/api/projects/${projectId}/metadata/vista.analyze.workflow`, async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: route.request().postData() || '{}' });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'not found' }) });
  });
  await page.route(`**/api/projects/${projectId}/analyze/workflows/execute`, async (route) => {
    const workflow = route.request().postDataJSON();
    executeRequests.push(workflow);
    const methodId = workflow.nodes.some((node) => node.method_id === 'segmentation.sam.placeholder')
      ? 'segmentation.sam.placeholder'
      : workflow.nodes.some((node) => node.method_id === 'segmentation.yolo.placeholder')
        ? 'segmentation.yolo.placeholder'
      : 'segmentation.opencv.placeholder';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        run_id: '22222222-2222-4222-8222-222222222222',
        workflow_name: workflow.name,
        status: 'completed',
        execution_mode: 'execution',
        image_count: 1,
        warnings: [],
        node_results: [
          { node_id: 'input-source', method_id: 'source.project_part_images', status: 'completed', output_types: ['image'], message: 'Loaded source image bytes.', summary: {}, artifacts: [] },
          { node_id: methodId, method_id: methodId, status: 'completed', output_types: ['mask', 'measurements'], message: 'Completed segmentation component integration.', summary: { backend: methodId.includes('sam') ? 'sam' : methodId.includes('yolo') ? 'yolo' : 'opencv', detection_count: methodId.includes('yolo') ? 1 : 0 }, artifacts: [] },
        ],
      }),
    });
  });

  await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Analyze' }).click();

  await expect(page.getByRole('heading', { name: 'Pipeline Studio' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Workflow block YOLO/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^SAM/i })).toBeVisible();
  await expect(page.getByText('OpenCV (placeholder)')).toHaveCount(0);
  await expect(page.getByText('SAM (placeholder)')).toHaveCount(0);
  await expect(page.getByLabel('Options JSON')).toHaveValue(JSON.stringify({ model: 'yolo11n-seg.pt', confidence: 0.25, iou: 0.7 }, null, 2));

  await page.getByRole('button', { name: 'Run Example' }).click();
  await expect(page.getByTestId('analyze-run-summary')).toContainText('completed');

  await page.getByRole('button', { name: /^SAM/i }).dragTo(page.getByTestId('analyze-graph'), {
    targetPosition: { x: 72, y: 236 },
  });
  await expect(page.getByRole('button', { name: /Workflow block SAM/i })).toBeVisible();
  await page.getByRole('button', { name: 'Run Example' }).click();
  await expect(page.getByTestId('analyze-run-summary')).toContainText('completed');

  expect(executeRequests).toHaveLength(2);
  expect(executeRequests[0].nodes.map((node) => node.method_id)).toContain('segmentation.yolo.placeholder');
  expect(executeRequests[1].nodes.map((node) => node.method_id)).toContain('segmentation.sam.placeholder');
});

test('Analyze tab runs YOLO with default project checkpoint on an example image', async ({ page }) => {
  const { projectId } = await mockInspectionWorkbenchRoutes(page, { type: 'PT3', scenario: 'basic' });
  const executeRequests = [];

  await page.route('**/api/analyze/toolbox', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(toolboxPayload) });
  });
  await page.route(`**/api/projects/${projectId}/analyze/input-source`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(inputSource(projectId)) });
  });
  await page.route(`**/api/projects/${projectId}/analyze/checkpoints?scope=project`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ checkpoints: [{ id: 'default-yolo-id', filename: 'yolo11n-seg.pt', model_family: 'yolo', model_type: 'YOLO', model_version: 'YOLOv11', size_bytes: 5900000 }] }),
    });
  });
  await page.route(`**/api/projects/${projectId}/analyze/checkpoints?scope=authorized`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checkpoints: [] }) });
  });
  await page.route(`**/api/projects/${projectId}/metadata/vista.analyze.workflow`, async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: route.request().postData() || '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        key: 'vista.analyze.workflow',
        value: {
          nodes: [
            { id: 'input-source', method_id: 'source.project_part_images', label: 'Loaded Part Images', chain_id: 'chain-1', parameters: {}, x: 72, y: 84 },
            { id: 'yolo-default', method_id: 'segmentation.yolo.placeholder', label: 'YOLO', chain_id: 'chain-1', parameters: { mode: 'predict', options: { confidence: 0.25, imgsz: 640 } }, x: 296, y: 84 },
            { id: 'output', method_id: 'output.versioned_image_artifact', label: 'Recipe / Artifact Output', chain_id: 'chain-1', parameters: { mode: 'overlay_artifact' }, x: 520, y: 84 },
          ],
          process_image_ids: ['11111111-1111-4111-8111-111111111111'],
          example_image_id: '11111111-1111-4111-8111-111111111111',
        },
      }),
    });
  });
  await page.route(`**/api/projects/${projectId}/analyze/workflows/execute`, async (route) => {
    const workflow = route.request().postDataJSON();
    executeRequests.push(workflow);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        run_id: '55555555-5555-4555-8555-555555555555',
        workflow_name: workflow.name,
        status: 'completed',
        execution_mode: 'execution',
        image_count: 1,
        warnings: [],
        node_results: [
          { node_id: 'input-source', method_id: 'source.project_part_images', status: 'completed', output_types: ['image'], message: 'Loaded source image bytes.', summary: {}, artifacts: [] },
          { node_id: 'yolo-default', method_id: 'segmentation.yolo.placeholder', status: 'completed', output_types: ['mask', 'detections', 'measurements'], message: 'Computed YOLO segmentation.', summary: { backend: 'yolo', detection_count: 1, detections: [{ class_name: 'bus' }] }, artifacts: [] },
        ],
      }),
    });
  });

  await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Analyze' }).click();
  await page.getByRole('tab', { name: 'Checkpoints' }).click();
  await expect(page.getByText('yolo11n-seg.pt')).toBeVisible();
  await page.getByRole('tab', { name: 'Pipeline Studio' }).click();
  await page.getByRole('button', { name: /Workflow block YOLO/i }).click();
  await expect(page.locator('select#analyze-param-checkpoint_id')).toHaveValue('default-yolo-id');
  await page.getByRole('button', { name: 'Run Example' }).click();

  await expect(page.getByTestId('analyze-run-summary')).toContainText('completed');
  await expect(page.getByTestId('analyze-status-details')).toContainText('YOLO');
  await expect(page.getByTestId('analyze-status-details')).toContainText('bus');
  expect(executeRequests).toHaveLength(1);
  const yoloNode = executeRequests[0].nodes.find((node) => node.method_id === 'segmentation.yolo.placeholder');
  expect(yoloNode.parameters.checkpoint_id).toBe('default-yolo-id');
  expect(executeRequests[0].source.id).toBe('example-image-selection');
});

test('Analyze tab runs default Anomalib PatchCore on an example image', async ({ page }) => {
  const { projectId } = await mockInspectionWorkbenchRoutes(page, { type: 'PT3', scenario: 'basic' });
  const executeRequests = [];

  await page.route('**/api/analyze/toolbox', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(toolboxPayload) });
  });
  await page.route(`**/api/projects/${projectId}/analyze/input-source`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(inputSource(projectId)) });
  });
  await page.route(`**/api/projects/${projectId}/analyze/checkpoints?scope=project`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checkpoints: [] }) });
  });
  await page.route(`**/api/projects/${projectId}/analyze/checkpoints?scope=authorized`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checkpoints: [] }) });
  });
  await page.route(`**/api/projects/${projectId}/metadata/vista.analyze.workflow`, async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: route.request().postData() || '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        key: 'vista.analyze.workflow',
        value: {
          nodes: [
            { id: 'input-source', method_id: 'source.project_part_images', label: 'Loaded Part Images', chain_id: 'chain-1', parameters: {}, x: 72, y: 84 },
            { id: 'anomalib-default', method_id: 'segmentation.anomalib.placeholder', label: 'Anomalib', chain_id: 'chain-1', parameters: { mode: 'default', options: { model_name: 'patchcore', threshold: 0.5, min_mask_area_px: 1 } }, x: 296, y: 84 },
            { id: 'output', method_id: 'output.versioned_image_artifact', label: 'Recipe / Artifact Output', chain_id: 'chain-1', parameters: { mode: 'overlay_artifact' }, x: 520, y: 84 },
          ],
          process_image_ids: ['11111111-1111-4111-8111-111111111111'],
          example_image_id: '11111111-1111-4111-8111-111111111111',
        },
      }),
    });
  });
  await page.route(`**/api/projects/${projectId}/analyze/workflows/execute`, async (route) => {
    const workflow = route.request().postDataJSON();
    executeRequests.push(workflow);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        run_id: '66666666-6666-4666-8666-666666666666',
        workflow_name: workflow.name,
        status: 'completed',
        execution_mode: 'execution',
        image_count: 1,
        warnings: [],
        node_results: [
          { node_id: 'input-source', method_id: 'source.project_part_images', status: 'completed', output_types: ['image'], message: 'Loaded source image bytes.', summary: {}, artifacts: [] },
          { node_id: 'anomalib-default', method_id: 'segmentation.anomalib.placeholder', status: 'completed', output_types: ['mask', 'measurements', 'metadata'], message: 'Computed PatchCore anomaly segmentation.', summary: { backend: 'anomalib', metrics: { runtime: 'vista.patchcore', mask_count: 1 }, detection_count: 1, detections: [{ class_name: 'patchcore' }] }, artifacts: [] },
        ],
      }),
    });
  });

  await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Analyze' }).click();
  await page.getByRole('button', { name: /Workflow block Anomalib/i }).click();
  await expect(page.getByLabel('Options JSON')).toHaveValue(JSON.stringify({ model_name: 'patchcore', threshold: 0.5, min_mask_area_px: 1 }, null, 2));
  await page.getByRole('button', { name: 'Run Example' }).click();

  await expect(page.getByTestId('analyze-run-summary')).toContainText('completed');
  await expect(page.getByTestId('analyze-status-details')).toContainText('vista.patchcore');
  await expect(page.getByTestId('analyze-status-details')).toContainText('patchcore');
  expect(executeRequests).toHaveLength(1);
  const anomalibNode = executeRequests[0].nodes.find((node) => node.method_id === 'segmentation.anomalib.placeholder');
  expect(anomalibNode.parameters.options).toEqual({ model_name: 'patchcore', threshold: 0.5, min_mask_area_px: 1 });
  expect(executeRequests[0].source.id).toBe('example-image-selection');
});

test('Analyze source chooser hides text fixtures and runs only the chosen example', async ({ page }) => {
  const jpgId = '11111111-1111-4111-8111-111111111111';
  const textId = '22222222-2222-4222-8222-222222222222';
  const overlayId = '33333333-3333-4333-8333-333333333333';
  const partId = 'part-source-filter-1';
  const sourceImage = {
    id: jpgId,
    filename: 'chosen-example.jpg',
    metadata: { modality: 'visual' },
  };
  const overlayImage = {
    id: overlayId,
    filename: 'chosen-example_analyze-overlay.png',
    content_type: 'image/png',
    metadata: {
      analysis_output: true,
      analysis_source_image_id: jpgId,
      overlay_base_image_id: jpgId,
      overlay: true,
    },
  };
  const mockPart = {
    id: partId,
    batch_id: 'batch-basic',
    serial_number: 'AN-SRC-001',
    display_name: 'Analyze Source Part',
    review_state: 'unreviewed',
    metadata: {
      configured_views: ['front'],
      modalities: ['visual'],
      source_images: [
        { filename: sourceImage.filename, image_id: jpgId, modality: 'visual', side: 'front', overlay: false },
        { filename: 'chosen-example_segmentation_true.txt', image_id: textId, modality: 'segmentation', overlay: true },
      ],
      analysis_outputs: [],
      overlay_layers: [],
    },
  };
  const routeMocks = await mockInspectionWorkbenchRoutes(page, {
    type: 'PT1',
    scenario: 'basic',
    images: [sourceImage, overlayImage],
    mockParts: [mockPart],
    mockBatches: [{ id: 'batch-basic', name: 'Batch Basic' }],
  });
  const { projectId } = routeMocks;
  const executeRequests = [];
  const sourcePayload = {
    project_id: projectId,
    source: {
      id: 'all-loaded-part-images',
      label: 'All images from loaded parts',
      kind: 'project_parts',
      project_id: projectId,
      image_count: 2,
      part_count: 1,
    },
    parts: [{ part_id: partId, serial_number: 'AN-SRC-001', display_name: 'Analyze Source Part', image_count: 2 }],
    images: [
      { image_id: jpgId, filename: sourceImage.filename, part_id: partId, part_serial_number: 'AN-SRC-001' },
      { image_id: textId, filename: 'chosen-example_segmentation_true.txt', part_id: partId, part_serial_number: 'AN-SRC-001' },
    ],
  };

  await page.route('**/api/analyze/toolbox', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(toolboxPayload) });
  });
  await page.route(`**/api/projects/${projectId}/analyze/input-source`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sourcePayload) });
  });
  await page.route(`**/api/projects/${projectId}/metadata/vista.analyze.workflow`, async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: route.request().postData() || '{}' });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'not found' }) });
  });
  await page.route(`**/api/projects/${projectId}/analyze/workflows/execute`, async (route) => {
    const workflow = route.request().postDataJSON();
    executeRequests.push(workflow);
    mockPart.metadata.analysis_outputs = [
      {
        filename: overlayImage.filename,
        image_id: overlayId,
        label: 'Segmentation Overlay :: OpenCV',
        overlay: true,
        analysis_output: true,
        analysis_method_id: 'segmentation.opencv.placeholder',
        analysis_source_image_id: jpgId,
        analysis_source_filename: sourceImage.filename,
        overlay_base_image_id: jpgId,
        overlay_base_filename: sourceImage.filename,
        modality: 'analyze-overlay',
      },
    ];
    mockPart.metadata.overlay_layers = [
      { id: `analyze-${overlayId}`, label: 'Segmentation Overlay :: OpenCV', image_id: overlayId, source_image_id: jpgId },
    ];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        run_id: '44444444-4444-4444-8444-444444444444',
        workflow_name: workflow.name,
        status: 'completed',
        execution_mode: 'execution',
        image_count: 1,
        warnings: [],
        node_results: [
          { node_id: 'input-source', method_id: 'source.project_part_images', status: 'completed', output_types: ['image'], message: 'Loaded source image bytes.', summary: { image_id: jpgId }, artifacts: [] },
        ],
      }),
    });
  });

  await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Analyze' }).click();

  await expect(page.getByTestId('analyze-source-summary')).toContainText('1 images');
  await page.getByRole('button', { name: /Workflow block Loaded Part Images/i }).click();
  await page.getByRole('button', { name: 'Select Images' }).click();
  const exampleSelect = page.locator('#analyze-param-example-image-modal');
  await expect(exampleSelect).toContainText('chosen-example.jpg');
  await expect(exampleSelect).not.toContainText('chosen-example_segmentation_true.txt');
  await exampleSelect.selectOption(jpgId);
  await page.getByLabel('Close input source chooser').click();
  await page.getByRole('button', { name: 'Run Example' }).click();
  await expect(page.getByTestId('analyze-run-summary')).toContainText('completed');

  const imageRequestsBeforeInspection = routeMocks.getImageAssetRequests().length;
  await page.getByRole('tab', { name: 'Inspection' }).click();
  await expect(page.getByText('chosen-example_analyze-overlay.png')).toBeVisible();
  await expect(page.getByTestId('inspection-overlay-composite')).toBeVisible();
  await expect
    .poll(() => routeMocks.getImageAssetRequests().filter((request) => request.imageId === overlayId).length)
    .toBeGreaterThan(0);
  expect(routeMocks.getImageAssetRequests().length).toBeGreaterThan(imageRequestsBeforeInspection);

  expect(executeRequests).toHaveLength(1);
  expect(executeRequests[0].source.id).toBe('example-image-selection');
  expect(executeRequests[0].source.selected_image_ids).toEqual([jpgId]);
  expect(executeRequests[0].source.selected_part_ids).toEqual([]);
  expect(executeRequests[0].source.example_image_id).toBe(jpgId);
});
