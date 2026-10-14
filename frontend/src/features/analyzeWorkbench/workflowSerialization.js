import { chainEdges, makeNode, nodeChainId, OUTPUT_METHOD_ID, SOURCE_METHOD_ID } from './workflowGraph';
import { normalizeWorkflowNodes } from './workflowParameters';

const DEFAULT_WORKFLOW_NAME = 'Part image analysis workflow';
export const ANALYZE_WORKFLOW_METADATA_KEY = 'vista.analyze.workflow';

export function imageIdFor(image) {
  return image?.image_id || image?.id || '';
}

export function buildOutputConfig(nodes) {
  const outputNode = nodes.find((node) => node.method_id === OUTPUT_METHOD_ID);
  const params = outputNode?.parameters || {};
  return {
    mode: params.mode || 'processing_sequence',
    version_strategy: params.version_strategy || 'recipe_metadata',
    artifact_policy: params.artifact_policy || 'automatic_by_output_type',
    cache_policy: params.cache_policy || 'local_on_demand',
    invalidation_policy: params.invalidation_policy || 'source_workflow_toolbox_model',
    provenance_level: params.provenance_level || 'full',
    export_policy: params.export_policy || 'materialize_on_export',
    volume_policy: params.volume_policy || 'recipe_volume_sparse_artifacts',
    destination: 'analysis_artifacts',
    preserve_original: params.preserve_original !== false,
    write_detection_metadata: params.write_detection_metadata !== false,
    write_segmentation_overlays: params.write_segmentation_overlays !== false,
    write_measurement_tables: params.write_measurement_tables !== false,
    materialize_processed_images: params.materialize_processed_images === true,
  };
}

function buildRunSource({ inputSource, selectedImageIds, exampleImageId, runScope }) {
  const images = inputSource?.images || [];
  const runImageIds = runScope === 'example'
    ? [exampleImageId].filter(Boolean)
    : selectedImageIds;
  const selectedSet = new Set(runImageIds.map(String));
  const selectedImages = images.filter((image) => selectedSet.has(String(imageIdFor(image))));
  const selectedPartIds = [];
  const allLoaded = images.length > 0 && selectedImages.length === images.length && runScope !== 'example';

  return {
    ...(inputSource?.source || {}),
    id: runScope === 'example' ? 'example-image-selection' : allLoaded ? 'all-loaded-part-images' : 'configured-process-selection',
    label: runScope === 'example' ? 'Chosen example image' : allLoaded ? 'All images from loaded parts' : 'Configured process image set',
    kind: allLoaded ? 'project_parts' : 'manual_selection',
    image_count: selectedImages.length,
    part_count: allLoaded ? (inputSource?.source?.part_count || 0) : selectedPartIds.length,
    selected_image_ids: allLoaded ? [] : runImageIds,
    selected_part_ids: selectedPartIds,
    example_image_id: exampleImageId || null,
  };
}

export function buildWorkflow({ nodes, inputSource, selectedImageIds, exampleImageId, runScope, methodById }) {
  const workflowNodes = methodById ? normalizeWorkflowNodes(nodes, methodById) : nodes;
  return {
    name: DEFAULT_WORKFLOW_NAME,
    source: buildRunSource({ inputSource, selectedImageIds, exampleImageId, runScope }),
    output: buildOutputConfig(nodes),
    nodes: workflowNodes,
    edges: chainEdges(workflowNodes),
  };
}

export function restoreSavedWorkflow(savedValue, methods, fallbackNodes, inputSource) {
  const loadedImageIds = (inputSource?.images || []).map(imageIdFor).filter(Boolean).map(String);
  const loadedImageSet = new Set(loadedImageIds);
  if (!savedValue || typeof savedValue !== 'object' || !Array.isArray(savedValue.nodes)) {
    return {
      nodes: fallbackNodes,
      processImageIds: loadedImageIds,
      exampleImageId: loadedImageIds[0] || '',
    };
  }
  const methodById = new Map(methods.map((method) => [method.id, method]));
  const restoredNodes = savedValue.nodes
    .filter((node) => node && methodById.has(node.method_id) && node.id)
    .map((node, index) => {
      const method = methodById.get(node.method_id);
      return makeNode(method, index, {
        id: String(node.id),
        label: node.label || method.name,
        chain_id: node.chain_id || 'chain-1',
        parameters: node.parameters && typeof node.parameters === 'object' ? node.parameters : {},
        x: Number.isFinite(node.x) ? node.x : undefined,
        y: Number.isFinite(node.y) ? node.y : undefined,
      });
    });
  const safeNodes = restoredNodes.some((node) => node.method_id === SOURCE_METHOD_ID)
    ? restoredNodes
    : fallbackNodes;
  const savedProcessIds = Array.isArray(savedValue.process_image_ids)
    ? savedValue.process_image_ids.map(String).filter((id) => loadedImageSet.has(id))
    : [];
  const processImageIds = savedProcessIds.length > 0 ? savedProcessIds : loadedImageIds;
  const savedExample = String(savedValue.example_image_id || '');
  return {
    nodes: safeNodes,
    processImageIds,
    exampleImageId: loadedImageSet.has(savedExample) ? savedExample : processImageIds[0] || '',
  };
}

export function workflowMetadataValue({ nodes, processImageIds, exampleImageId }) {
  return {
    version: 1,
    name: DEFAULT_WORKFLOW_NAME,
    nodes: nodes.map((node) => ({
      id: node.id,
      method_id: node.method_id,
      label: node.label,
      chain_id: nodeChainId(node),
      parameters: node.parameters || {},
      x: node.x,
      y: node.y,
    })),
    process_image_ids: processImageIds,
    example_image_id: exampleImageId || '',
    updated_at: new Date().toISOString(),
  };
}
