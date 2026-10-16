export const SOURCE = {
  id: 'source.project_part_images',
  name: 'Project Part Images',
  parameters: [{ name: 'example_image_id', type: 'string', default: '' }],
};
export const PREPROCESS = {
  id: 'preprocess.window_level_normalization',
  name: 'Window Level',
  parameters: [
    { name: 'level', type: 'float', default: 0.5, min_value: 0, max_value: 1 },
    { name: 'iterations', type: 'integer', default: 3, min_value: 1, max_value: 10 },
    { name: 'function_path', type: 'string', default: 'pkg.fn' },
  ],
};
export const YOLO = {
  id: 'segmentation.yolo.placeholder',
  name: 'YOLO Segmentation',
  parameters: [
    { name: 'integration_mode', type: 'string', default: 'local' },
    { name: 'fastapi_url', type: 'string', default: 'http://remote' },
    { name: 'checkpoint_id', type: 'string', default: '' },
  ],
};
export const OUTPUT = {
  id: 'output.versioned_image_artifact',
  name: 'Versioned Output',
  parameters: [{ name: 'mode', type: 'string', default: 'processing_sequence' }],
};
export const METHODS = [SOURCE, PREPROCESS, YOLO, OUTPUT];

export function node(id, chainId, x, y, methodId = PREPROCESS.id) {
  return { id, method_id: methodId, label: id, chain_id: chainId, parameters: {}, x, y };
}

export const INPUT_SOURCE = {
  source: { id: 'project', label: 'Project', part_count: 2, image_count: 3 },
  images: [
    { image_id: 'img-1', filename: 'a.png', part_id: 'p1' },
    { image_id: 'img-2', filename: 'b.png', part_id: 'p1' },
    { id: 'img-3', filename: 'c.png', part_id: 'p2' },
  ],
};
