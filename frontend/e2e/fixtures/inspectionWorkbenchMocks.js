const projectId = 'proj-pt1';

function parseMetadataBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
  return false;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function createMockImageSvg(imageId) {
  const safeImageId = String(imageId || 'unknown');
  const hue = [...safeImageId].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">',
    `<rect width="960" height="640" fill="hsl(${hue} 55% 23%)"/>`,
    `<circle cx="480" cy="300" r="190" fill="hsl(${hue} 72% 52%)" opacity=".78"/>`,
    '<path d="M180 470L350 260l135 128 140-178 160 260z" fill="rgba(255,255,255,.28)"/>',
    `<text x="480" y="565" text-anchor="middle" fill="white" font-family="sans-serif" font-size="28">${escapeXml(safeImageId)}</text>`,
    '</svg>',
  ].join('');
}

const scenarioByUser = {
  basic: {
    workspaceState: {
      selected_batch_id: 'batch-basic',
      defect_filter: 'all',
      sort_mode: 'defect_desc',
    },
    batches: [{ id: 'batch-basic', name: 'Batch Basic' }],
    parts: [
      {
        id: 'part-basic-001',
        batch_id: 'batch-basic',
        serial_number: 'SN-BASIC-001',
        display_name: 'Housing Basic',
        review_state: 'unreviewed',
        metadata: {
          defects: [],
          configured_views: ['front', 'back'],
          modalities: ['visual'],
          volume_shape: { axial: 24, coronal: 20, sagittal: 18 },
          overlay_layers: [{ id: 'voids', label: 'Voids', color: '#f59e0b' }],
        },
      },
    ],
  },
  intermediate: {
    workspaceState: {
      selected_batch_id: 'batch-mid-a',
      defect_filter: 'critical_only',
      sort_mode: 'serial_asc',
      selected_part_id: 'part-mid-001',
      mpr: {
        slice_position: { axial: 12, coronal: 9, sagittal: 7 },
        viewport_transform: { zoom: 1.25, panX: 15, panY: -10 },
        contrast_percent: 114,
        active_overlay_ids: ['segmentation'],
        cursor_probe: { x: 61, y: 46 },
      },
    },
    batches: [
      { id: 'batch-mid-a', name: 'Batch Mid A' },
      { id: 'batch-mid-b', name: 'Batch Mid B' },
    ],
    parts: [
      {
        id: 'part-mid-001',
        batch_id: 'batch-mid-a',
        serial_number: 'SN-MID-001',
        display_name: 'Housing Mid 1',
        review_state: 'in_review',
        metadata: {
          defects: [{ severity: 'minor' }, { severity: 'critical' }],
          configured_views: ['front', 'back', 'left', 'right'],
          modalities: ['visual', 'infrared'],
          view_images: { front: 'housing-mid-front.png', right: 'housing-mid-right.png' },
          volume_shape: { axial: 64, coronal: 56, sagittal: 40 },
          overlay_layers: [
            { id: 'segmentation', label: 'Segmentation', color: '#ef4444' },
            { id: 'porosity', label: 'Porosity', color: '#8b5cf6' },
          ],
          segmentation_runs: [
            'legacy-seg-entry',
            {
              run_id: 'seeded-seg-mid',
              axis: 'axial',
              slice_index: 12,
              status: 'completed',
              overlay_id: 'segmentation-axial-12',
            },
          ],
          measurement_runs: [
            {
              run_id: 'seeded-measure-mid',
              status: 'completed',
              units: 'mm',
              values: { crack_length_mm: 11.4, pore_area_mm2: 2.4, edge_offset_mm: 0.38 },
            },
          ],
        },
      },
      {
        id: 'part-mid-002',
        batch_id: 'batch-mid-b',
        serial_number: 'SN-MID-002',
        display_name: 'Housing Mid 2',
        review_state: 'unreviewed',
        metadata: {
          defects: [],
          configured_views: ['top', 'bottom'],
          volume_shape: { axial: 48, coronal: 42, sagittal: 38 },
        },
      },
    ],
  },
  advanced: {
    workspaceState: {
      selected_batch_id: 'batch-adv-a',
      defect_filter: 'has_defects',
      sort_mode: 'defect_desc',
      selected_part_id: 'part-adv-001',
      mpr: {
        slice_position: { axial: 20, coronal: 16, sagittal: 10 },
        viewport_transform: { zoom: 1.3, panX: 20, panY: -14 },
        contrast_percent: 109,
        active_overlay_ids: ['segmentation', 'porosity'],
        cursor_probe: { x: 58, y: 52 },
      },
    },
    batches: [
      { id: 'batch-adv-a', name: 'Batch Adv A' },
      { id: 'batch-adv-b', name: 'Batch Adv B' },
    ],
    parts: [
      {
        id: 'part-adv-001',
        batch_id: 'batch-adv-a',
        serial_number: 'SN-ADV-001',
        display_name: 'Housing Adv 1',
        review_state: 'reject_pending',
        metadata: {
          defects: [{ severity: 'critical' }, { severity: 'critical' }, { severity: 'major' }],
          configured_views: ['front', 'back', 'left', 'right', 'top', 'bottom'],
          modalities: ['visual', 'infrared', 'uv'],
          view_images: { front: 'housing-adv-front.png', top: 'housing-adv-top.png' },
          volume_shape: { axial: 128, coronal: 96, sagittal: 80 },
          overlay_layers: [
            { id: 'segmentation', label: 'Segmentation', color: '#ef4444' },
            { id: 'heatmap', label: 'Heatmap', color: '#10b981' },
            { id: 'porosity', label: 'Porosity', color: '#8b5cf6' },
          ],
          segmentation_runs: [
            'legacy-seg-entry',
            {
              run_id: 'seeded-seg-adv',
              axis: 'coronal',
              slice_index: 22,
              status: 'completed',
              overlay_id: 'segmentation-coronal-22',
            },
          ],
          measurement_runs: [
            'legacy-measurement-entry',
            {
              run_id: 'seeded-measure-adv',
              status: 'completed',
              units: 'mm',
              values: { crack_length_mm: 23.9, pore_area_mm2: 4.2, edge_offset_mm: 0.27 },
            },
          ],
        },
      },
      {
        id: 'part-adv-002',
        batch_id: 'batch-adv-a',
        serial_number: 'SN-ADV-002',
        display_name: 'Housing Adv 2',
        review_state: 'in_review',
        metadata: {
          defects: [{ severity: 'major' }],
          volume_shape: { axial: 180, coronal: 140, sagittal: 120 },
        },
      },
      {
        id: 'part-adv-003',
        batch_id: 'batch-adv-b',
        serial_number: 'SN-ADV-003',
        display_name: 'Housing Adv 3',
        review_state: 'pass',
        metadata: {
          defects: [],
          volume_shape: { axial: 220, coronal: 170, sagittal: 130 },
        },
      },
    ],
  },
};

function createMockData(scenario = 'advanced') {
  return scenarioByUser[scenario] || scenarioByUser.advanced;
}

function collectMockImageRecords(parts = []) {
  const recordsById = new Map();
  const addRecord = (candidate) => {
    if (!candidate || typeof candidate !== 'object') return;
    if (parseMetadataBoolean(candidate.deleted) || parseMetadataBoolean(candidate.is_deleted) || candidate.deleted_at) return;
    const filename = String(candidate.filename || '').trim();
    const id = String(candidate.image_id || candidate.id || filename).trim();
    if (!id || !filename || recordsById.has(id)) return;
    recordsById.set(id, { id, filename, metadata: candidate.metadata || {} });
  };

  parts.forEach((part) => {
    const metadata = part?.metadata && typeof part.metadata === 'object' ? part.metadata : {};
    ['source_images', 'analysis_outputs'].forEach((key) => {
      const records = Array.isArray(metadata[key]) ? metadata[key] : [];
      records.forEach(addRecord);
    });
    if (metadata.view_images && typeof metadata.view_images === 'object') {
      Object.values(metadata.view_images).forEach((imageRef) => {
        if (imageRef && typeof imageRef === 'object') {
          addRecord(imageRef);
          return;
        }
        const filename = String(imageRef || '').trim();
        addRecord({ id: filename, filename });
      });
    }
  });

  return Array.from(recordsById.values());
}

async function mockInspectionWorkbenchRoutes(page, {
  type = 'PT1',
  scenario = 'advanced',
  images = [],
  mockParts = null,
  mockBatches = null,
  mockConfiguration = null,
  mockWorkspaceState = null,
  realSplatSegmentIds = null,
  seededAnnotations = null,
} = {}) {
  const { batches, parts, workspaceState } = createMockData(scenario);
  const responseWorkspaceState = mockWorkspaceState && typeof mockWorkspaceState === 'object'
    ? mockWorkspaceState
    : workspaceState;
  const routeImages = images.length > 0
    ? images
    : collectMockImageRecords(Array.isArray(mockParts) ? mockParts : parts);
  let mutableProject = {
    id: projectId,
    name: `Inspection Workbench ${type}`,
    description: 'Playwright synthetic project',
    meta_group_id: 'qa-team',
    project_type: type,
    is_archived: false,
  };
  const configurationByProjectId = {
    [projectId]: {
      image_modalities: [{ id: 'visual', label: 'Visual', calibration_required: false }],
      part_views: [{ id: `${type.toLowerCase()}-${scenario}-front`, label: 'Front', required_modalities: ['visual'], source: 'manual' }],
      defect_types: [{ name: `${scenario}-surface`, color: '#ef4444', definition: 'Synthetic defect taxonomy baseline' }],
      process_settings: {
        require_disposition_on_submit: true,
        require_measurement_for_critical: scenario !== 'basic',
        require_second_reviewer_for_reject: scenario === 'advanced',
        configurable_hotkeys: {
          accept_classification: 'a',
          reject_classification: 'r',
          toggle_shortcut_help: 'h',
        },
      },
      display_settings: {
        default_colormap: scenario === 'basic' ? 'grayscale' : 'magma',
        anomaly_colormap: 'viridis',
        grayscale_base_image: true,
      },
    },
    'proj-copy': {
      image_modalities: [{ id: 'visual', label: 'Copied Visual', calibration_required: true }],
      part_views: [{ id: `${type.toLowerCase()}-${scenario}-copied-top`, label: 'Top', required_modalities: ['visual'], source: 'auto' }],
      defect_types: [{ name: `${scenario}-copied-defect`, color: '#22c55e', definition: 'Copied synthetic defect definition' }],
      process_settings: {
        require_disposition_on_submit: true,
        require_measurement_for_critical: true,
        require_second_reviewer_for_reject: true,
        configurable_hotkeys: {
          accept_classification: 'a',
          reject_classification: 'r',
          toggle_shortcut_help: 'h',
        },
      },
      display_settings: {
        default_colormap: 'viridis',
        anomaly_colormap: 'magma',
        grayscale_base_image: true,
      },
    },
  };
  let mutableParts = Array.isArray(mockParts) ? [...mockParts] : [...parts];
  if (mockConfiguration && typeof mockConfiguration === 'object') {
    configurationByProjectId[projectId] = mockConfiguration;
  }
  const responseBatches = Array.isArray(mockBatches) ? mockBatches : batches;
  const seededAnnotationsByPart = Array.isArray(seededAnnotations)
    ? { [mutableParts[0]?.id]: seededAnnotations }
    : (seededAnnotations && typeof seededAnnotations === 'object' ? seededAnnotations : {});
  let mutableAnnotations = Object.fromEntries(
    Object.entries(seededAnnotationsByPart)
      .filter(([, annotations]) => Array.isArray(annotations))
      .map(([partId, annotations]) => [partId, annotations.map((annotation) => ({ ...annotation }))]),
  );
  const savedWorkspaceStates = [];
  const exportBundleArchiveRequests = [];
  const ingestValidationRequests = [];
  const imageDisplayOrderRequests = [];
  const imageAssignmentRequests = [];
  const imageAssetRequests = [];
  const overlayAssignmentRequests = [];
  const projectUpdateRequests = [];
  const savedConfigurations = [];
  const realSplatRequests = [];
  let realSplatJob = { status: 'missing', polls: 0 };
  const canonicalRealSplatAsset = {
    contract_version: 'pt3_real_3dgs/v1',
    representation: 'real_3dgs',
    optimization_method: 'voxel_direct_moment_fit',
    optimization_domain: 'voxel_field',
    camera_model: 'none',
    coordinate_space: 'physical',
    sh_degree: 0,
    means: [[1.7, 2.8, 4], [3.4, 3.8, 7], [4.9, 4.6, 10], [3, 5.5, 12]],
    scales: [[0.8, 0.3, 0.5], [0.7, 0.5, 0.4], [0.6, 0.3, 0.8], [0.5, 0.7, 0.4]],
    rotations: [[1, 0, 0, 0], [0.966, 0, 0, 0.259], [0.924, 0, 0.383, 0], [0.985, 0.174, 0, 0]],
    opacities: [0.82, 0.76, 0.88, 0.7],
    sh_coefficients: [[1.25, 0.35, 1.5], [0.45, 1.2, 1.55], [1.45, 0.7, 0.28], [0.25, 1.4, 0.8]],
    scalar_values: [192, 168, 224, 148],
    segment_ids: Array.isArray(realSplatSegmentIds) ? realSplatSegmentIds : [null, null, null, null],
  };

  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.endsWith('/api/users/me')) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Unauthorized' }) });
      return;
    }
    if (url.endsWith(`/api/projects/${projectId}`) && method === 'PUT') {
      const payload = route.request().postDataJSON() || {};
      projectUpdateRequests.push({ projectId, payload });
      mutableProject = { ...mutableProject, ...payload };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mutableProject),
      });
      return;
    }
    if (url.endsWith(`/api/projects/${projectId}`)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mutableProject),
      });
      return;
    }
    if (url.endsWith(`/api/projects/${projectId}/metadata-dict`)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          project_type: type,
          inspection_profile: {
            scenario,
            required_views: scenario === 'basic' ? ['front', 'back'] : ['front', 'back', 'left', 'right'],
            validation: {
              ingest_enabled: true,
              reviewer_level: scenario,
            },
          },
          data_contract: {
            batches: batches.length,
            parts: parts.length,
          },
        }),
      });
      return;
    }
    if (url.endsWith('/api/projects') || url.endsWith('/api/projects/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: projectId, name: `Inspection Workbench ${type}`, project_type: type, is_archived: false },
          { id: 'proj-copy', name: `Template ${type} ${scenario}`, project_type: type, is_archived: false },
        ]),
      });
      return;
    }
    if (url.endsWith(`/api/projects/${projectId}/classes`)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    if (url.endsWith(`/api/projects/${projectId}/has-groups`)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ has_groups: false }) });
      return;
    }
    if (url.endsWith(`/api/projects/${projectId}/data-summary`)) {
      const activeImages = routeImages.filter((image) => !image?.deleted_at);
      const deletedImages = routeImages.filter((image) => Boolean(image?.deleted_at));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          project_id: projectId,
          active_image_count: activeImages.length,
          deleted_image_count: deletedImages.length,
          total_image_bytes: activeImages.reduce((sum, image) => sum + (Number(image?.size) || 0), 0),
          part_count: mutableParts.length,
          image_metadata_fields: activeImages.reduce((sum, image) => (
            sum + Object.keys(image?.metadata || {}).length
          ), 0),
          annotation_count: mutableParts.reduce((sum, part) => (
            sum + (Array.isArray(part?.metadata?.annotations) ? part.metadata.annotations.length : 0)
          ), 0),
          overlay_layer_count: 0,
        }),
      });
      return;
    }
    if (url.includes(`/api/projects/${projectId}/images-page`)) {
      const parsedUrl = new URL(url);
      const offset = Number(parsedUrl.searchParams.get('cursor') || 0);
      const limit = Number(parsedUrl.searchParams.get('limit') || 500);
      const includeDeleted = parsedUrl.searchParams.get('include_deleted') === 'true';
      const availableImages = includeDeleted ? routeImages : routeImages.filter((image) => !image?.deleted_at);
      const items = availableImages.slice(offset, offset + limit);
      const nextOffset = offset + items.length;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items,
          total: availableImages.length,
          next_cursor: nextOffset < availableImages.length ? String(nextOffset) : null,
          has_more: nextOffset < availableImages.length,
        }),
      });
      return;
    }
    if (url.includes(`/api/projects/${projectId}/images`)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(routeImages) });
      return;
    }
    if (url.includes('/api/images/') && (url.includes('/thumbnail') || url.endsWith('/content'))) {
      const parsedUrl = new URL(url);
      const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
      const imageId = decodeURIComponent(pathParts[2] || '');
      imageAssetRequests.push({
        imageId,
        path: parsedUrl.pathname,
        search: parsedUrl.search,
      });
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: createMockImageSvg(imageId),
      });
      return;
    }
    if (url.endsWith(`/api/projects/${projectId}/batches`)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responseBatches) });
      return;
    }
    if (url.endsWith(`/api/projects/${projectId}/workspace-state`) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ project_id: projectId, user_email: 'e2e@example.com', state: responseWorkspaceState || {} }),
      });
      return;
    }
    if (url.endsWith(`/api/projects/${projectId}/workspace-state`) && method === 'PUT') {
      const payload = route.request().postDataJSON() || {};
      savedWorkspaceStates.push(payload);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ project_id: projectId, user_email: 'e2e@example.com', state: payload.state || {} }),
      });
      return;
    }
    if (url.endsWith(`/api/projects/${projectId}/export-bundle`) && method === 'GET') {
      exportBundleArchiveRequests.push({ scenario, type });
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/zip' },
        body: 'synthetic-zip-bundle',
      });
      return;
    }
    if (url.endsWith(`/api/projects/${projectId}/report-json?schema_version=3`) && method === 'GET') {
      const reportParts = mutableParts.map((part) => {
        const inspectionResult = part.review_state === 'pass'
          ? 'pass'
          : ['reject', 'reject_pending', 'reject_confirmed'].includes(part.review_state)
            ? 'reject'
            : 'unreviewed';
        return {
          part_id: part.id,
          part_identifier: part.serial_number,
          inspection_result: inspectionResult,
        };
      });
      const partStatusCounts = {
        pass: reportParts.filter((part) => part.inspection_result === 'pass').length,
        reject: reportParts.filter((part) => part.inspection_result === 'reject').length,
        unreviewed: reportParts.filter((part) => part.inspection_result === 'unreviewed').length,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema_version: 3,
          project: {
            id: projectId,
            name: `${type} inspection workbench project`,
            project_type: type,
            meta_group_id: 'qa-team',
          },
          summary: {
            total_parts: reportParts.length,
            reviewed_parts: partStatusCounts.pass + partStatusCounts.reject,
            unreviewed_parts: partStatusCounts.unreviewed,
            part_status_counts: partStatusCounts,
          },
          parts: reportParts,
        }),
      });
      return;
    }
    if (url.endsWith(`/api/projects/${projectId}/report-pdf?schema_version=3`) && method === 'GET') {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/pdf' },
        body: '%PDF-1.4 synthetic',
      });
      return;
    }
    if (url.endsWith(`/api/projects/${projectId}/ingest`) && method === 'POST') {
      const payload = route.request().postDataJSON() || {};
      ingestValidationRequests.push(payload);
      const partsReceived = Array.isArray(payload.batches)
        ? payload.batches.reduce((acc, batch) => acc + (Array.isArray(batch.parts) ? batch.parts.length : 0), 0)
        : 0;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          project_id: projectId,
          counters: {
            batches_received: Array.isArray(payload.batches) ? payload.batches.length : 0,
            parts_received: partsReceived,
            batches_created: 0,
            parts_created: 0,
            parts_skipped_existing: partsReceived,
            parts_skipped_discrepancy: 0,
          },
          discrepancies: [],
        }),
      });
      return;
    }
    if (url.endsWith(`/api/projects/${projectId}/configuration/clone`) && method === 'POST') {
      const payload = route.request().postDataJSON() || {};
      const sourceProjectId = payload.source_project_id;
      const sourceConfig = configurationByProjectId[sourceProjectId];
      if (!sourceConfig) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'source configuration not found' }),
        });
        return;
      }
      configurationByProjectId[projectId] = sourceConfig;
      savedConfigurations.push({ projectId, payload: { source_project_id: sourceProjectId, config: sourceConfig } });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ project_id: projectId, source_project_id: sourceProjectId, config: sourceConfig }),
      });
      return;
    }
    if (url.match(/\/api\/projects\/[^/]+\/configuration$/) && method === 'GET') {
      const targetProjectId = url.split('/').at(-2);
      const config = configurationByProjectId[targetProjectId];
      await route.fulfill({
        status: config ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(config ? { project_id: targetProjectId, config } : { detail: 'config not found' }),
      });
      return;
    }
    if (url.match(/\/api\/projects\/[^/]+\/configuration$/) && method === 'PUT') {
      const targetProjectId = url.split('/').at(-2);
      const payload = route.request().postDataJSON() || {};
      configurationByProjectId[targetProjectId] = payload.config || {};
      savedConfigurations.push({ projectId: targetProjectId, payload });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ project_id: targetProjectId, config: configurationByProjectId[targetProjectId] }),
      });
      return;
    }
    const imageDisplayOrderPath = new URL(url).pathname;
    if (
      imageDisplayOrderPath.startsWith(`/api/projects/${projectId}/parts/`)
      && imageDisplayOrderPath.endsWith('/image-display-order')
      && method === 'PUT'
    ) {
      const partId = decodeURIComponent(
        imageDisplayOrderPath
          .slice(`/api/projects/${projectId}/parts/`.length)
          .split('/image-display-order')[0],
      );
      const payload = route.request().postDataJSON() || {};
      imageDisplayOrderRequests.push({ partId, payload });
      mutableParts = mutableParts.map((part) => (
        String(part.id) === String(partId)
          ? {
            ...part,
            metadata: {
              ...(part.metadata || {}),
              image_display_order: Array.isArray(payload.image_refs)
                ? [...payload.image_refs]
                : [],
            },
          }
          : part
      ));
      const updatedPart = mutableParts.find((part) => String(part.id) === String(partId));
      await route.fulfill({
        status: updatedPart ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(updatedPart || { detail: 'Inspection part not found' }),
      });
      return;
    }
    if (url.endsWith(`/api/projects/${projectId}/parts/image-assignments`) && method === 'POST') {
      const payload = route.request().postDataJSON() || {};
      imageAssignmentRequests.push(payload);
      const requestedImageId = String(payload.image_id || '').trim();
      const requestedFilename = String(payload.filename || '').trim();
      const filenameMatches = routeImages.filter((image) => (
        !image?.deleted_at && String(image?.filename || '') === requestedFilename
      ));
      const catalogImage = requestedImageId
        ? routeImages.find((image) => !image?.deleted_at && String(image?.id || '') === requestedImageId)
        : (filenameMatches.length === 1 ? filenameMatches[0] : null);
      if (!catalogImage) {
        await route.fulfill({
          status: requestedImageId || filenameMatches.length === 0 ? 404 : 422,
          contentType: 'application/json',
          body: JSON.stringify({
            detail: requestedImageId
              ? 'Image not found'
              : 'Filename is ambiguous; provide image_id',
          }),
        });
        return;
      }

      const imageId = String(catalogImage.id || '');
      const filename = String(catalogImage.filename || '');
      const toPartId = payload.to_part_id == null ? '' : String(payload.to_part_id);
      mutableParts = mutableParts.map((part) => {
        const sourceImages = Array.isArray(part?.metadata?.source_images)
          ? part.metadata.source_images
          : [];
        const withoutImage = sourceImages.filter((record) => {
          const recordImageId = String(record?.image_id || '').trim();
          if (imageId) return recordImageId !== imageId;
          return recordImageId || String(record?.filename || '') !== filename;
        });
        if (String(part.id) !== toPartId) {
          if (withoutImage.length === sourceImages.length) return part;
          return {
            ...part,
            metadata: { ...part.metadata, source_images: withoutImage },
          };
        }
        return {
          ...part,
          metadata: {
            ...part.metadata,
            source_images: [
              ...withoutImage,
              {
                filename,
                image_id: imageId || null,
                overlay: false,
              },
            ],
          },
        };
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          assigned: Boolean(toPartId),
          image_id: imageId || null,
          filename,
          to_part_id: toPartId || null,
        }),
      });
      return;
    }
    if (url.endsWith(`/api/projects/${projectId}/parts/overlay-assignments`) && method === 'POST') {
      const payload = route.request().postDataJSON() || {};
      overlayAssignmentRequests.push(payload);
      const requestedOverlayImageId = String(payload.overlay_image_id || '').trim();
      const requestedOverlayFilename = String(payload.overlay_filename || '').trim();
      const overlayFilenameMatches = routeImages.filter((image) => (
        !image?.deleted_at && String(image?.filename || '') === requestedOverlayFilename
      ));
      const overlayImage = requestedOverlayImageId
        ? routeImages.find((image) => !image?.deleted_at && String(image?.id || '') === requestedOverlayImageId)
        : (overlayFilenameMatches.length === 1 ? overlayFilenameMatches[0] : null);
      if (!overlayImage) {
        await route.fulfill({
          status: requestedOverlayImageId || overlayFilenameMatches.length === 0 ? 404 : 422,
          contentType: 'application/json',
          body: JSON.stringify({
            detail: requestedOverlayImageId
              ? 'Overlay image not found'
              : 'Overlay filename is ambiguous; provide overlay_image_id',
          }),
        });
        return;
      }

      const overlayImageId = String(overlayImage.id || '');
      const overlayFilename = String(overlayImage.filename || '');
      const baseImageId = String(payload.base_image_id || '').trim();
      const baseFilename = String(payload.base_filename || '').trim();
      const baseMatches = [];
      mutableParts.forEach((part) => {
        const sourceImages = Array.isArray(part?.metadata?.source_images)
          ? part.metadata.source_images
          : [];
        sourceImages.forEach((record) => {
          if (parseMetadataBoolean(record?.overlay)) return;
          const matches = baseImageId
            ? String(record?.image_id || '') === baseImageId
            : (baseFilename && String(record?.filename || '') === baseFilename);
          if (matches) baseMatches.push({ partId: String(part.id), record });
        });
      });
      if (!baseImageId && baseFilename && baseMatches.length > 1) {
        await route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({
            detail: 'Base filename is ambiguous; provide base_image_id',
          }),
        });
        return;
      }
      const baseMatch = (baseImageId || baseFilename)
        ? (baseMatches.length === 1 ? baseMatches[0] : null)
        : null;
      if ((baseImageId || baseFilename) && !baseMatch) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Base image not found' }),
        });
        return;
      }
      const canonicalBaseImageId = String(baseMatch?.record?.image_id || baseImageId || '');
      const canonicalBaseFilename = String(baseMatch?.record?.filename || baseFilename || '');
      mutableParts = mutableParts.map((part) => {
        const sourceImages = Array.isArray(part?.metadata?.source_images)
          ? part.metadata.source_images
          : [];
        const ownsBaseImage = Boolean(
          baseMatch && String(part.id) === baseMatch.partId,
        );
        const withoutOverlay = sourceImages.filter((record) => (
          String(record?.image_id || '') !== overlayImageId
        ));
        if (!ownsBaseImage) {
          if (withoutOverlay.length === sourceImages.length) return part;
          return {
            ...part,
            metadata: { ...part.metadata, source_images: withoutOverlay },
          };
        }
        return {
          ...part,
          metadata: {
            ...part.metadata,
            source_images: [
              ...withoutOverlay,
              {
                filename: overlayFilename,
                image_id: overlayImageId,
                overlay: true,
                overlay_base_filename: canonicalBaseFilename,
                overlay_base_image_id: canonicalBaseImageId,
              },
            ],
          },
        };
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ assigned: Boolean(baseMatch) }),
      });
      return;
    }
    if (url.includes(`/api/projects/${projectId}/parts/`) && url.endsWith('/annotations') && method === 'GET') {
      const partId = url.split('/parts/').at(-1).split('/annotations')[0];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ annotations: mutableAnnotations[partId] || [] }),
      });
      return;
    }
    if (url.includes(`/api/projects/${projectId}/parts/`) && url.endsWith('/annotations') && method === 'POST') {
      const partId = url.split('/parts/').at(-1).split('/annotations')[0];
      const payload = route.request().postDataJSON() || {};
      const annotation = {
        id: `ann-${partId}-${(mutableAnnotations[partId] || []).length + 1}`,
        part_id: partId,
        annotation_kind: payload.annotation_kind || null,
        defect_class: payload.defect_class || 'Other',
        modality: payload.modality || 'visual',
        comment: payload.comment || null,
        disposition: payload.disposition || 'open',
        hidden: false,
        image_id: payload.image_id || null,
        measurements: payload.measurements || {},
        geometry: payload.geometry || null,
        metadata: payload.metadata || {},
        bbox: payload.bbox || null,
        created_by: 'e2e@example.com',
        created_at: '2026-03-28T12:30:00Z',
      };
      mutableAnnotations = {
        ...mutableAnnotations,
        [partId]: [annotation, ...(mutableAnnotations[partId] || [])],
      };
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(annotation) });
      return;
    }
    if (url.includes(`/api/projects/${projectId}/parts/`) && url.includes('/annotations/') && method === 'PATCH') {
      const partId = url.split('/parts/').at(-1).split('/annotations/')[0];
      const annotationId = url.split('/annotations/').at(-1);
      const payload = route.request().postDataJSON() || {};
      const updatedAnnotations = (mutableAnnotations[partId] || []).map((annotation) => (
        annotation.id === annotationId
          ? {
            ...annotation,
            ...payload,
            updated_by: 'e2e@example.com',
            updated_at: '2026-03-28T12:35:00Z',
          }
          : annotation
      ));
      mutableAnnotations = { ...mutableAnnotations, [partId]: updatedAnnotations };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(updatedAnnotations.find((annotation) => annotation.id === annotationId)),
      });
      return;
    }
    if (url.includes(`/api/projects/${projectId}/parts/`) && url.includes('/annotations/') && method === 'DELETE') {
      const partId = url.split('/parts/').at(-1).split('/annotations/')[0];
      const annotationId = url.split('/annotations/').at(-1);
      mutableAnnotations = {
        ...mutableAnnotations,
        [partId]: (mutableAnnotations[partId] || []).filter((annotation) => annotation.id !== annotationId),
      };
      await route.fulfill({ status: 204, contentType: 'application/json', body: '' });
      return;
    }
    if (url.includes(`/api/projects/${projectId}/parts/`) && method === 'PATCH') {
      const partId = url.split('/').pop();
      const payload = route.request().postDataJSON();
      mutableParts = mutableParts.map((part) => (part.id === partId ? { ...part, review_state: payload.review_state } : part));
      const updated = mutableParts.find((part) => part.id === partId);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) });
      return;
    }
    if (url.includes('/segmentation-runs') && method === 'POST') {
      const payload = route.request().postDataJSON() || {};
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          run_id: 'seg-run-1',
          part_id: mutableParts[0].id,
          axis: payload.axis || 'axial',
          slice_index: payload.slice_index || 0,
          status: 'completed',
          overlay_id: `segmentation-${payload.axis || 'axial'}-${payload.slice_index || 0}`,
        }),
      });
      return;
    }
    if (url.includes('/measurement-runs') && method === 'POST') {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          run_id: 'measurement-run-1',
          part_id: mutableParts[0].id,
          status: 'completed',
          measurement_profile: 'workbench-default',
          units: 'mm',
          values: {
            crack_length_mm: 14.1,
            pore_area_mm2: 2.8,
            edge_offset_mm: 0.46,
          },
        }),
      });
      return;
    }
    if (url.endsWith('/real-gaussian-splat-assets/status') && method === 'GET') {
      if (realSplatJob.status === 'pending') {
        realSplatJob.polls += 1;
        if (realSplatJob.polls === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              status: 'pending',
              stage: 'Fitting contiguous voxel groups',
              progress_percent: 37,
              metadata: { fit_mode: 'voxel_direct', voxel_direct_available: true },
            }),
          });
          return;
        }
        realSplatJob = { status: 'ready', polls: realSplatJob.polls };
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(realSplatJob.status === 'ready'
          ? {
            status: 'ready',
            stage: 'Ready',
            progress_percent: 100,
            asset_url: `/api/projects/${projectId}/parts/part-adv-001/real-gaussian-splat-assets/mock-voxel-direct.json`,
            splat_count: canonicalRealSplatAsset.means.length,
            metadata: { fit_mode: 'voxel_direct', optimization_domain: 'voxel_field' },
          }
          : {
            status: 'missing',
            progress_percent: 0,
            metadata: { voxel_direct_available: true, provider_configured: false },
          }),
      });
      return;
    }
    if (url.endsWith('/real-gaussian-splat-assets/mock-voxel-direct.json') && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(canonicalRealSplatAsset),
      });
      return;
    }
    if (url.endsWith('/real-gaussian-splat-assets') && method === 'POST') {
      const payload = route.request().postDataJSON() || {};
      realSplatRequests.push(payload);
      realSplatJob = { status: 'pending', polls: 0 };
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'pending',
          stage: 'Queued voxel-native fit',
          progress_percent: 0,
          metadata: { fit_mode: payload.fit_mode || 'voxel_direct' },
        }),
      });
      return;
    }
    if (url.includes(`/api/projects/${projectId}/parts`)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mutableParts) });
      return;
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'mock route not found' }) });
  });

  return {
    projectId,
    getParts: () => mutableParts,
    getWorkspaceStates: () => savedWorkspaceStates,
    getExportBundleArchiveRequests: () => exportBundleArchiveRequests,
    getIngestValidationRequests: () => ingestValidationRequests,
    getImageAssignmentRequests: () => imageAssignmentRequests,
    getImageAssetRequests: () => imageAssetRequests,
    getImageDisplayOrderRequests: () => imageDisplayOrderRequests,
    getOverlayAssignmentRequests: () => overlayAssignmentRequests,
    getProject: () => mutableProject,
    getProjectUpdateRequests: () => projectUpdateRequests,
    getSavedConfigurations: () => savedConfigurations,
    getAnnotations: () => mutableAnnotations,
    getRealSplatRequests: () => realSplatRequests,
  };
}

module.exports = {
  mockInspectionWorkbenchRoutes,
};
