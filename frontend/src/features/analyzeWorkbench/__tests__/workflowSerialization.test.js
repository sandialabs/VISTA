import { makeDefaultNodes } from '../workflowGraph';
import {
  buildOutputConfig,
  buildWorkflow,
  restoreSavedWorkflow,
  workflowMetadataValue,
} from '../workflowSerialization';
import { INPUT_SOURCE, METHODS, PREPROCESS } from '../__fixtures__/analyzeMethods';

const methodById = new Map(METHODS.map((method) => [method.id, method]));

function sampleNodes() {
  const nodes = makeDefaultNodes(METHODS);
  nodes[1] = { ...nodes[1], parameters: { level: '7', iterations: 2.9, function_path: 'x' } };
  nodes[2] = { ...nodes[2], chain_id: 'chain-2', y: 236, parameters: { integration_mode: 'FastAPI' } };
  nodes[3] = { ...nodes[3], parameters: { mode: 'single', preserve_original: false, materialize_processed_images: true } };
  return nodes;
}

describe('buildWorkflow', () => {
  it('builds normalized nodes, chain edges, source, and output config', () => {
    const workflow = buildWorkflow({
      nodes: sampleNodes(),
      inputSource: INPUT_SOURCE,
      selectedImageIds: ['img-1', 'img-3'],
      exampleImageId: 'img-1',
      runScope: 'process',
      methodById,
    });
    expect(workflow.name).toBe('Part image analysis workflow');
    expect(workflow.nodes.map((item) => item.parameters)).toEqual([
      { example_image_id: '' },
      { level: 0.5, iterations: 2 },
      // Visibility checks the raw mode, so mixed-case 'FastAPI' keeps fastapi_url hidden.
      { integration_mode: 'remote', checkpoint_id: '' },
      { mode: 'single' },
    ]);
    expect(workflow.edges.map((edge) => [edge.source_node, edge.target_node])).toEqual([
      ['input-source', 'preprocess.window_level_normalization-2'],
      ['preprocess.window_level_normalization-2', 'output.versioned_image_artifact-4'],
    ]);
    expect(workflow.source).toEqual({
      id: 'configured-process-selection',
      label: 'Configured process image set',
      kind: 'manual_selection',
      image_count: 2,
      part_count: 0,
      selected_image_ids: ['img-1', 'img-3'],
      selected_part_ids: [],
      example_image_id: 'img-1',
    });
    expect(workflow.output).toMatchObject({ mode: 'single', preserve_original: false, materialize_processed_images: true });
  });

  it('describes all-loaded and example run scopes', () => {
    const base = { nodes: sampleNodes(), inputSource: INPUT_SOURCE, exampleImageId: 'img-2' };
    const all = buildWorkflow({ ...base, selectedImageIds: ['img-1', 'img-2', 'img-3'], runScope: 'process' });
    expect(all.source).toMatchObject({ id: 'all-loaded-part-images', kind: 'project_parts', part_count: 2, selected_image_ids: [] });
    expect(all.nodes[1].parameters.level).toBe('7');
    const example = buildWorkflow({ ...base, selectedImageIds: [], runScope: 'example' });
    expect(example.source).toMatchObject({ id: 'example-image-selection', image_count: 1, selected_image_ids: ['img-2'] });
  });

  it('defaults the output config when there is no output node', () => {
    expect(buildOutputConfig([])).toEqual({
      mode: 'processing_sequence',
      version_strategy: 'recipe_metadata',
      artifact_policy: 'automatic_by_output_type',
      cache_policy: 'local_on_demand',
      invalidation_policy: 'source_workflow_toolbox_model',
      provenance_level: 'full',
      export_policy: 'materialize_on_export',
      volume_policy: 'recipe_volume_sparse_artifacts',
      destination: 'analysis_artifacts',
      preserve_original: true,
      write_detection_metadata: true,
      write_segmentation_overlays: true,
      write_measurement_tables: true,
      materialize_processed_images: false,
    });
  });
});

describe('workflow persistence', () => {
  it('round trips nodes and image selection through workflowMetadataValue', () => {
    const nodes = sampleNodes();
    const saved = workflowMetadataValue({ nodes, processImageIds: ['img-3'], exampleImageId: 'img-3' });
    expect(saved).toMatchObject({ version: 1, name: 'Part image analysis workflow', example_image_id: 'img-3' });
    expect(typeof saved.updated_at).toBe('string');
    const restored = restoreSavedWorkflow(JSON.parse(JSON.stringify(saved)), METHODS, [], INPUT_SOURCE);
    expect(restored.processImageIds).toEqual(['img-3']);
    expect(restored.exampleImageId).toBe('img-3');
    expect(restored.nodes.map(({ id, chain_id: chainId, x, y }) => [id, chainId, x, y]))
      .toEqual(nodes.map(({ id, chain_id: chainId, x, y }) => [id, chainId, x, y]));
    expect(restored.nodes[1].parameters).toEqual({ level: '7', iterations: 2.9, function_path: 'x' });
  });

  it('falls back to defaults for missing, sourceless, or stale saved values', () => {
    const fallback = makeDefaultNodes(METHODS);
    expect(restoreSavedWorkflow(null, METHODS, fallback, INPUT_SOURCE)).toEqual({
      nodes: fallback,
      processImageIds: ['img-1', 'img-2', 'img-3'],
      exampleImageId: 'img-1',
    });
    const sourceless = restoreSavedWorkflow({
      nodes: [{ id: 'p', method_id: PREPROCESS.id }, { id: 'u', method_id: 'unknown' }],
      process_image_ids: ['gone'],
      example_image_id: 'img-2',
    }, METHODS, fallback, INPUT_SOURCE);
    expect(sourceless).toEqual({ nodes: fallback, processImageIds: ['img-1', 'img-2', 'img-3'], exampleImageId: 'img-2' });
  });
});
