const projectId = 'proj-pt1';

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

async function mockInspectionWorkbenchRoutes(page, { type = 'PT1', scenario = 'advanced', images = [], mockParts = null, mockBatches = null } = {}) {
  const { batches, parts, workspaceState } = createMockData(scenario);
  const metadataNormalizationByScenario = {
    basic: {},
    intermediate: { segmentation_runs: 1 },
    advanced: { segmentation_runs: 1, measurement_runs: 1, 'legacy value[]': 2 },
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
  const responseBatches = Array.isArray(mockBatches) ? mockBatches : batches;
  let mutableAnnotations = {};
  const savedWorkspaceStates = [];
  const exportBundleArchiveRequests = [];
  const ingestValidationRequests = [];
  const savedConfigurations = [];

  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.endsWith('/api/users/me')) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Unauthorized' }) });
      return;
    }
    if (url.endsWith(`/api/projects/${projectId}`)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: projectId,
          name: `Inspection Workbench ${type}`,
          description: 'Playwright synthetic project',
          meta_group_id: 'qa-team',
          project_type: type,
        }),
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
          { id: projectId, name: `Inspection Workbench ${type}`, project_type: type },
          { id: 'proj-copy', name: `Template ${type} ${scenario}`, project_type: type },
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
    if (url.includes(`/api/projects/${projectId}/images`)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(images) });
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
        body: JSON.stringify({ project_id: projectId, user_email: 'e2e@example.com', state: workspaceState || {} }),
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
    if (url.endsWith(`/api/projects/${projectId}/report-json`) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          project: { id: projectId, project_type: type },
          summary: {
            total_images: mutableParts.length,
            total_batches: batches.length,
            total_parts: mutableParts.length,
            reviewed_parts: mutableParts.filter((part) => ['pass', 'reject_pending', 'reject_confirmed'].includes(part.review_state)).length,
            metadata_normalization: {
              dropped_non_object_items: metadataNormalizationByScenario[scenario] || {},
            },
          },
        }),
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
    getSavedConfigurations: () => savedConfigurations,
  };
}

module.exports = {
  mockInspectionWorkbenchRoutes,
};
