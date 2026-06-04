import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import InspectionWorkbenchPanel from '../InspectionWorkbenchPanel';
import ImagesToPartsTab from '../ImagesToPartsTab';

jest.setTimeout(90000);

const projectTypes = ['PT1', 'PT2', 'PT3'];

const scenarioByUser = [
  {
    user: 'basic',
    hotkeys: { accept_classification: 'q', reject_classification: 'w', toggle_shortcut_help: 'e' },
    workspaceState: {
      selected_batch_id: 'batch-basic',
      defect_filter: 'all',
      sort_mode: 'defect_desc',
      panel_layout: {
        part_list: { is_open: true, width_px: 300, height_px: 410, orientation: 'vertical' },
        inspector: { is_open: true, width_px: 340, height_px: 400, orientation: 'vertical' },
        mpr_controls: { is_open: false, width_px: 330, height_px: 350, orientation: 'horizontal' },
      },
      inspector: {
        shortcut_help_visible: false,
        normalization_triage_field: '',
        image_enabled: true,
        modalities: ['visual'],
        view_name: 'front',
        measurements: [{ id: 'basic-length', label: 'Length', value: '12.6' }],
      },
    },
    batches: [{ id: 'batch-basic', name: 'Batch Basic' }],
    parts: [
      {
        id: 'part-basic-1',
        batch_id: 'batch-basic',
        serial_number: 'SN-BASIC-0001',
        display_name: 'Basic Part',
        review_state: 'unreviewed',
        metadata: {
          defect_count: 0,
          configured_views: ['front', 'back'],
          modalities: ['visual'],
          view_images: { front: 'front-basic.png' },
          volume_shape: { axial: 20, coronal: 18, sagittal: 16 },
          overlay_layers: [{ id: 'voids', label: 'Voids', color: '#f59e0b' }],
          annotations: [
            {
              id: 'seed-annotation-basic',
              defect_class: 'seed-basic',
              modality: 'visual',
              disposition: 'open',
              hidden: false,
              updated_by: 'seed-user@example.com',
              updated_at: '2026-03-28T11:00:00Z',
            },
          ],
        },
      },
    ],
  },
  {
    user: 'intermediate',
    hotkeys: { accept_classification: 's', reject_classification: 'd', toggle_shortcut_help: 'f' },
    workspaceState: {
      selected_batch_id: 'batch-mid-a',
      defect_filter: 'critical_only',
      sort_mode: 'serial_asc',
      selected_part_id: 'part-mid-1',
      mpr: {
        slice_position: { axial: 5, coronal: 4, sagittal: 3 },
        viewport_transform: { zoom: 1.2, panX: 10, panY: -5 },
        contrast_percent: 115,
        active_overlay_ids: ['porosity'],
        cursor_probe: { x: 60, y: 45 },
      },
      panel_layout: {
        part_list: { is_open: true, width_px: 360, height_px: 520, orientation: 'vertical' },
        inspector: { is_open: false, width_px: 410, height_px: 500, orientation: 'horizontal' },
        mpr_controls: { is_open: true, width_px: 390, height_px: 380, orientation: 'horizontal' },
      },
      inspector: {
        shortcut_help_visible: true,
        normalization_triage_field: 'segmentation_runs',
        image_enabled: false,
        modalities: ['infrared'],
        view_name: 'left',
        measurements: [
          { id: 'mid-length', label: 'Crack length', value: 10.2 },
          { id: 'mid-area', label: 'Pore area', value: '1.8' },
        ],
      },
    },
    batches: [
      { id: 'batch-mid-a', name: 'Batch Mid A' },
      { id: 'batch-mid-b', name: 'Batch Mid B' },
    ],
    parts: [
      {
        id: 'part-mid-1',
        batch_id: 'batch-mid-a',
        serial_number: 'SN-MID-0101',
        display_name: 'Mid Part 1',
        review_state: 'in_review',
        metadata: {
          defects: [{ severity: 'minor' }, { severity: 'critical' }],
          configured_views: ['left', 'right', 'top'],
          modalities: ['visual', 'infrared'],
          view_images: { left: 'left-mid.png' },
          volume_shape: { axial: 32, coronal: 28, sagittal: 24 },
          overlay_layers: [
            { id: 'segmentation', label: 'Segmentation', color: '#ef4444' },
            { id: 'porosity', label: 'Porosity', color: '#8b5cf6' },
          ],
          segmentation_runs: [
            'legacy-seg-entry',
            {
              run_id: 'seeded-seg-mid',
              axis: 'axial',
              slice_index: 3,
              status: 'completed',
              overlay_id: 'segmentation-axial-3',
            },
          ],
          measurement_runs: [
            {
              run_id: 'seeded-measure-mid',
              status: 'completed',
              units: 'mm',
              values: { crack_length_mm: 10.2, pore_area_mm2: 1.8, edge_offset_mm: 0.41 },
            },
          ],
          annotations: [
            {
              id: 'seed-annotation-mid',
              defect_class: 'seed-mid',
              modality: 'infrared',
              disposition: 'needs_info',
              hidden: false,
              updated_by: 'seed-user@example.com',
              updated_at: '2026-03-28T11:00:00Z',
            },
          ],
        },
      },
      {
        id: 'part-mid-2',
        batch_id: 'batch-mid-b',
        serial_number: 'SN-MID-0102',
        display_name: 'Mid Part 2',
        review_state: 'unreviewed',
        metadata: {
          defects: [],
          configured_views: ['front', 'back'],
          volume_shape: { axial: 40, coronal: 36, sagittal: 34 },
        },
      },
    ],
  },
  {
    user: 'advanced',
    hotkeys: { accept_classification: 'z', reject_classification: 'x', toggle_shortcut_help: 'c' },
    workspaceState: {
      selected_batch_id: 'batch-adv-a',
      defect_filter: 'has_defects',
      sort_mode: 'defect_desc',
      selected_part_id: 'part-adv-1',
      mpr: {
        slice_position: { axial: 11, coronal: 8, sagittal: 6 },
        viewport_transform: { zoom: 1.3, panX: 16, panY: -12 },
        contrast_percent: 110,
        active_overlay_ids: ['segmentation', 'porosity'],
        cursor_probe: { x: 55, y: 48 },
      },
      panel_layout: {
        part_list: { is_open: 'yes', width_px: -25, height_px: 9999, orientation: 'diagonal' },
        inspector: { is_open: true, width_px: 260, height_px: 460, orientation: 'vertical' },
        mpr_controls: { is_open: true, width_px: '400', height_px: '420', orientation: 'horizontal' },
      },
      inspector: {
        shortcut_help_visible: 'yes',
        normalization_triage_field: 73,
        image_enabled: 'no',
        modalities: 'not-a-list',
        view_name: 45,
        measurements: [
          { id: 'adv-invalid-empty', label: ' ', value: '4.5' },
          { id: 'adv-invalid-missing', label: 'Depth' },
          'not-a-measurement',
        ],
      },
    },
    batches: [
      { id: 'batch-adv-a', name: 'Batch Adv A' },
      { id: 'batch-adv-b', name: 'Batch Adv B' },
    ],
    parts: [
      {
        id: 'part-adv-1',
        batch_id: 'batch-adv-a',
        serial_number: 'SN-ADV-9001',
        display_name: 'Adv Part 1',
        review_state: 'reject_pending',
        metadata: {
          defects: [{ severity: 'critical' }, { severity: 'critical' }, { severity: 'major' }],
          modalities: ['visual', 'infrared', 'uv'],
          voxel_dtype: 'uint16',
          view_images: { front: 'adv-front.png', top: 'adv-top.png' },
          volume_shape: { axial: 128, coronal: 96, sagittal: 80 },
          overlay_layers: [
            { id: 'segmentation', label: 'Segmentation', color: '#ef4444' },
            { id: 'heatmap', label: 'Heatmap', color: '#8b5cf6' },
            { id: 'porosity', label: 'Porosity', color: '#f59e0b' },
          ],
          source_images: [
            { filename: 'PT3_GEOMETRIC_DUAL_LABEL_Z000.png', image_id: 'pt3-z-000', metadata: { slice_index: 0 } },
            { filename: 'PT3_GEOMETRIC_DUAL_LABEL_Z016.png', image_id: 'pt3-z-016', metadata: { slice_index: 16 } },
            { filename: 'PT3_GEOMETRIC_DUAL_LABEL_Z032.png', image_id: 'pt3-z-032', metadata: { slice_index: 32 } },
            { filename: 'PT3_GEOMETRIC_DUAL_LABEL_Z048.png', image_id: 'pt3-z-048', metadata: { slice_index: 48 } },
            { filename: 'PT3_GEOMETRIC_DUAL_LABEL_Z063.png', image_id: 'pt3-z-063', metadata: { slice_index: 63 } },
          ],
          annotations: [
            {
              id: 'seed-annotation-adv',
              defect_class: 'seed-adv',
              modality: 'uv',
              disposition: 'open',
              hidden: false,
              updated_by: 'seed-user@example.com',
              updated_at: '2026-03-28T11:00:00Z',
            },
          ],
        },
      },
      {
        id: 'part-adv-2',
        batch_id: 'batch-adv-a',
        serial_number: 'SN-ADV-9002',
        display_name: 'Adv Part 2',
        review_state: 'in_review',
        metadata: {
          defects: [{ severity: 'major' }],
          volume_shape: { axial: 256, coronal: 192, sagittal: 144 },
        },
      },
      {
        id: 'part-adv-3',
        batch_id: 'batch-adv-b',
        serial_number: 'SN-ADV-9003',
        display_name: 'Adv Part 3',
        review_state: 'pass',
        metadata: {
          defects: [],
          volume_shape: { axial: 300, coronal: 240, sagittal: 180 },
        },
      },
    ],
  },
];

const defaultCalibration = { pixels_per_mm: 20, pixels_per_inch: 508, unit: 'mm' };

function mockWorkbenchFetch({ user, batches, parts, workspaceState = {}, hotkeys, metadataDict = { calibration_default: defaultCalibration } }) {
  let mutableParts = [...parts];
  const uploadedImages = [];
  const savedWorkspaceStates = [];
  const savedConfigurations = [];
  const annotationsByPart = Object.fromEntries(
    mutableParts.map((part) => [part.id, Array.isArray(part.metadata?.annotations) ? [...part.metadata.annotations] : []]),
  );
  let annotationSeq = 0;

  global.fetch = jest.fn((url, options = {}) => {
    if (url.includes('/export-bundle') && !url.includes('/export-bundle-json')) {
      return Promise.resolve({
        ok: true,
        headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/zip' : null) },
        blob: async () => new Blob(['synthetic-bundle']),
      });
    }
    if (url.includes('/export-bundle-json')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          project: { id: 'proj-1', project_type: 'PT1' },
          summary: {
            images: { total: mutableParts.length, total_bytes: mutableParts.length * 2048 },
            annotations: {
              total: Object.values(annotationsByPart).reduce((acc, entries) => acc + entries.length, 0),
            },
            overlays: {
              segmentation_runs: mutableParts.reduce(
                (acc, part) => acc + (Array.isArray(part.metadata?.segmentation_runs) ? part.metadata.segmentation_runs.length : 0),
                0,
              ),
            },
          },
        }),
      });
    }
    if (url.includes('/report-json')) {
      const metadataNormalizationByUser = {
        basic: {},
        intermediate: { segmentation_runs: 1 },
        advanced: { segmentation_runs: 1, measurement_runs: 1, '': 2, 'legacy value[]': 3 },
      };
      return Promise.resolve({
        ok: true,
        json: async () => ({
          project: { id: 'proj-1', project_type: 'PT1' },
          summary: {
            total_images: mutableParts.length,
            total_batches: batches.length,
            total_parts: mutableParts.length,
            reviewed_parts: mutableParts.filter((part) => ['pass', 'reject_pending', 'reject_confirmed'].includes(part.review_state)).length,
            metadata_normalization: {
              dropped_non_object_items: metadataNormalizationByUser[user] || {},
            },
          },
        }),
      });
    }
    if (url.includes('/report-pdf')) {
      return Promise.resolve({
        ok: true,
        headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/pdf' : null) },
        blob: async () => new Blob(['synthetic-pdf']),
      });
    }
    if (url.includes('/ingest') && options.method === 'POST') {
      const payload = JSON.parse(options.body || '{}');
      const partsReceived = Array.isArray(payload.batches)
        ? payload.batches.reduce((acc, batch) => acc + (Array.isArray(batch.parts) ? batch.parts.length : 0), 0)
        : 0;
      return Promise.resolve({
        ok: true,
        json: async () => ({
          project_id: 'proj-1',
          counters: {
            batches_received: Array.isArray(payload.batches) ? payload.batches.length : 0,
            parts_received: partsReceived,
            batches_created: 0,
            parts_created: 0,
            parts_skipped_existing: partsReceived,
            parts_skipped_discrepancy: scenarioNameIncludesAdvanced(payload) ? 1 : 0,
          },
          discrepancies: scenarioNameIncludesAdvanced(payload)
            ? [
              {
                code: 'duplicate_serial_in_payload',
                batch_name: payload.batches?.[0]?.name || 'batch',
                serial_number: payload.batches?.[0]?.parts?.[0]?.serial_number || null,
                message: 'Synthetic duplicate for advanced scenario',
              },
            ]
            : [],
        }),
      });
    }
    if (url.includes('/workspace-state') && (!options.method || options.method === 'GET')) {
      return Promise.resolve({ ok: true, json: async () => ({ state: workspaceState }) });
    }
    if (url.includes('/metadata-dict') && (!options.method || options.method === 'GET')) {
      return Promise.resolve({ ok: true, json: async () => metadataDict });
    }
    if (url.includes('/metadata') && options.method === 'POST') {
      const payload = JSON.parse(options.body || '{}');
      metadataDict[payload.key] = payload.value;
      return Promise.resolve({ ok: true, json: async () => metadataDict });
    }
    if (url.includes('/images/') && url.includes('/metadata') && options.method === 'PUT') {
      return Promise.resolve({ ok: true, json: async () => ({ metadata: { calibration_override: JSON.parse(options.body || '{}').value } }) });
    }
    if (url.includes('/configuration') && (!options.method || options.method === 'GET')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          config: {
            process_settings: {
              configurable_hotkeys: hotkeys || {
                accept_classification: 'a',
                reject_classification: 'r',
                toggle_shortcut_help: 'h',
              },
            },
          },
        }),
      });
    }
    if (url.includes('/configuration') && options.method === 'PUT') {
      const payload = JSON.parse(options.body || '{}');
      savedConfigurations.push(payload);
      return Promise.resolve({
        ok: true,
        json: async () => ({ config: payload.config || {} }),
      });
    }
    if (url.includes('/workspace-state') && options.method === 'PUT') {
      savedWorkspaceStates.push(JSON.parse(options.body || '{}'));
      return Promise.resolve({ ok: true, json: async () => ({ state: workspaceState }) });
    }
    if (url.includes('/batches')) {
      return Promise.resolve({ ok: true, json: async () => batches });
    }
    if (url.includes('/projects/proj-1/images') && options.method === 'POST') {
      const file = options.body?.get?.('file');
      const metadata = JSON.parse(options.body?.get?.('metadata') || '{}');
      const created = {
        id: `uploaded-image-${uploadedImages.length + 1}`,
        filename: file?.name || `uploaded-image-${uploadedImages.length + 1}.png`,
        content_type: file?.type || 'image/png',
        metadata,
      };
      uploadedImages.push(created);
      return Promise.resolve({ ok: true, status: 201, json: async () => created });
    }
    if (url.includes('/parts/image-assignments') && options.method === 'POST') {
      const payload = JSON.parse(options.body || '{}');
      const uploaded = uploadedImages.find((image) => image.filename === payload.filename) || {};
      mutableParts = mutableParts.map((part) => {
        if (part.id !== payload.to_part_id) return part;
        const existing = Array.isArray(part.metadata?.source_images) ? part.metadata.source_images : [];
        return {
          ...part,
          metadata: {
            ...(part.metadata || {}),
            source_images: [
              ...existing.filter((record) => record.filename !== payload.filename),
              {
                filename: payload.filename,
                image_id: uploaded.id,
                side: uploaded.metadata?.side || 'crop',
                modality: uploaded.metadata?.modality || 'visual',
                overlay: false,
                crop_child_image: Boolean(uploaded.metadata?.crop_child_image),
                parent_image_id: uploaded.metadata?.parent_image_id,
                parent_image_filename: uploaded.metadata?.parent_image_filename,
                crop_annotation_id: uploaded.metadata?.crop_annotation_id,
                crop_bbox: uploaded.metadata?.crop_bbox,
              },
            ],
          },
        };
      });
      return Promise.resolve({ ok: true, json: async () => ({ filename: payload.filename, from_part_id: null, to_part_id: payload.to_part_id }) });
    }
    if (url.includes('/parts/') && options.method === 'PATCH') {
      if (url.includes('/annotations/')) {
        const segments = url.split('/');
        const partId = segments[segments.length - 3];
        const annotationId = segments[segments.length - 1];
        const payload = JSON.parse(options.body || '{}');
        const updatedItems = (annotationsByPart[partId] || []).map((annotation) =>
          annotation.id === annotationId
            ? {
              ...annotation,
              ...payload,
              updated_at: '2026-03-28T12:30:00Z',
              updated_by: 'qa-reviewer@example.com',
            }
            : annotation,
        );
        annotationsByPart[partId] = updatedItems;
        return Promise.resolve({
          ok: true,
          json: async () => updatedItems.find((annotation) => annotation.id === annotationId),
        });
      }
      const partId = url.split('/').pop();
      const payload = JSON.parse(options.body || '{}');
      mutableParts = mutableParts.map((part) =>
        part.id === partId ? { ...part, review_state: payload.review_state } : part,
      );
      const updated = mutableParts.find((part) => part.id === partId);
      return Promise.resolve({ ok: true, json: async () => updated });
    }
    if (url.includes('/parts/') && url.includes('/annotations/') && options.method === 'DELETE') {
      const segments = url.split('/');
      const partId = segments[segments.length - 3];
      const annotationId = segments[segments.length - 1];
      annotationsByPart[partId] = (annotationsByPart[partId] || []).filter((annotation) => annotation.id !== annotationId);
      return Promise.resolve({ ok: true, status: 204 });
    }
    if (url.includes('/segmentation-runs') && options.method === 'POST') {
      const payload = JSON.parse(options.body || '{}');
      return Promise.resolve({
        ok: true,
        json: async () => ({
          run_id: 'seg-run-1',
          part_id: mutableParts[0]?.id || 'part',
          axis: payload.axis || 'axial',
          slice_index: payload.slice_index || 0,
          status: 'completed',
          overlay_id: `segmentation-${payload.axis || 'axial'}-${payload.slice_index || 0}`,
        }),
      });
    }
    if (url.includes('/slice-segmentation') && options.method === 'POST') {
      const payload = JSON.parse(options.body || '{}');
      return Promise.resolve({
        ok: true,
        json: async () => ({
          run_id: 'slice-seg-run-1',
          part_id: mutableParts[0]?.id || 'part',
          axis: payload.axis || 'axial',
          slice_index: payload.slice_index || 0,
          method_id: payload.method_id || 'segmentation.connected_components',
          status: 'completed',
          cached: false,
          regions: [
            { label: 1, area_px: 256, bbox: [6, 6, 26, 26], centroid: [16, 16] },
            { label: 2, area_px: 324, bbox: [34, 34, 60, 60], centroid: [47, 47] },
          ],
          selected_region: { label: 2, area_px: 324, bbox: [34, 34, 60, 60], centroid: [47, 47] },
          summary: { region_count: 2 },
          warnings: [],
        }),
      });
    }
    if (url.includes('/measurement-runs') && options.method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          run_id: 'measure-run-1',
          part_id: mutableParts[0]?.id || 'part',
          status: 'completed',
          units: 'mm',
          values: {
            crack_length_mm: 12.4,
            pore_area_mm2: 2.1,
            edge_offset_mm: 0.46,
          },
        }),
      });
    }
    if (url.includes('/annotations') && options.method === 'POST') {
      const segments = url.split('/');
      const partId = segments[segments.length - 2];
      annotationSeq += 1;
      const payload = JSON.parse(options.body || '{}');
      const created = {
        id: `annotation-${annotationSeq}`,
        ...payload,
        created_at: '2026-03-28T12:00:00Z',
        created_by: 'qa-reviewer@example.com',
        updated_at: '2026-03-28T12:00:00Z',
        updated_by: 'qa-reviewer@example.com',
      };
      annotationsByPart[partId] = [created, ...(annotationsByPart[partId] || [])];
      return Promise.resolve({ ok: true, json: async () => created });
    }
    if (url.includes('/annotations') && (!options.method || options.method === 'GET')) {
      const segments = url.split('?')[0].split('/');
      const partId = segments[segments.length - 2];
      return Promise.resolve({
        ok: true,
        json: async () => ({ part_id: partId, annotations: annotationsByPart[partId] || [] }),
      });
    }
    if (url.includes('/analyze/overlays/') && options.method === 'DELETE') {
      const overlayId = decodeURIComponent(url.split('/').pop());
      const updatedPart = {
        ...mutableParts[0],
        metadata: {
          ...mutableParts[0].metadata,
          source_images: mutableParts[0].metadata.source_images.map((record) => (
            record.image_id === overlayId
              ? { ...record, overlay_delete_candidate: true, pending_hard_delete_at: '2026-05-02T12:00:00Z' }
              : record
          )),
          analysis_outputs: (mutableParts[0].metadata.analysis_outputs || []).map((record) => (
            record.image_id === overlayId
              ? { ...record, overlay_delete_candidate: true, pending_hard_delete_at: '2026-05-02T12:00:00Z' }
              : record
          )),
        },
      };
      mutableParts[0] = updatedPart;
      return Promise.resolve({ ok: true, json: async () => updatedPart });
    }
    if (url.includes('/parts')) {
      return Promise.resolve({ ok: true, json: async () => mutableParts });
    }
    if (url.includes('/images?include_deleted=true&limit=5000')) {
      const imageRecords = mutableParts.flatMap((part) => {
        const viewImages = part?.metadata?.view_images || {};
        const viewRecords = Object.entries(viewImages).map(([viewName, imageRef], index) => ({
          id: `${part.id}-image-${index + 1}`,
          filename: imageRef,
          metadata: {
            part_id: part.id,
            serial_number: part.serial_number,
            view_name: viewName,
          },
        }));
        const sourceRecords = Array.isArray(part?.metadata?.source_images)
          ? part.metadata.source_images.map((record, index) => ({
            id: record.image_id || `${part.id}-source-${index + 1}`,
            filename: record.filename,
            metadata: {
              part_id: part.id,
              serial_number: part.serial_number,
              ...record,
            },
          }))
          : [];
        return [...viewRecords, ...sourceRecords];
      });
      return Promise.resolve({ ok: true, json: async () => [...imageRecords, ...uploadedImages] });
    }
    return Promise.resolve({ ok: false, status: 404 });
  });

  return {
    getWorkspaceSaves: () => savedWorkspaceStates,
    getConfigurationSaves: () => savedConfigurations,
  };
}

function scenarioNameIncludesAdvanced(payload) {
  const group = payload?.batches?.[0]?.description || '';
  return /adv/i.test(group);
}


describe('InspectionWorkbenchPanel', () => {

  test('shows part summary modality buttons only for loaded image modalities', async () => {
    mockWorkbenchFetch({
      user: 'loaded-modalities',
      batches: [{ id: 'batch-1', name: 'Batch 1' }],
      workspaceState: { selected_batch_id: 'batch-1', selected_part_id: 'part-loaded-modalities' },
      parts: [
        {
          id: 'part-loaded-modalities',
          batch_id: 'batch-1',
          serial_number: 'SN-LOADED-001',
          display_name: 'Loaded Modalities Part',
          review_state: 'unreviewed',
          metadata: {
            configured_views: ['front', 'thermal'],
            modalities: ['visual', 'infrared', 'uv'],
            view_images: { front: 'front-loaded.png', thermal: 'thermal-loaded.png' },
            source_images: [
              { filename: 'front-loaded.png', image_id: 'img-front-loaded', side: 'front', modality: 'visual', overlay: false },
              { filename: 'thermal-loaded.png', image_id: 'img-thermal-loaded', side: 'thermal', modality: 'infrared', overlay: false },
            ],
            annotations: [],
          },
        },
      ],
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    const modalityToggles = await screen.findByLabelText('Loaded Modalities Part modality toggles');
    expect(within(modalityToggles).getByRole('button', { name: 'VISUAL' })).toBeInTheDocument();
    expect(within(modalityToggles).getByRole('button', { name: 'INFRARED' })).toBeInTheDocument();
    expect(within(modalityToggles).queryByRole('button', { name: 'UV' })).not.toBeInTheDocument();
  });

  test('hides an image from the inspection workbench after moving it from a part to unassigned', async () => {
    let parts = [
      {
        id: 'part-1',
        batch_id: 'batch-1',
        serial_number: 'SN-001',
        display_name: 'Part 1',
        review_state: 'unreviewed',
        metadata: {
          configured_views: ['front'],
          modalities: ['visual'],
          view_images: { front: 'assigned-a.png' },
          source_images: [
            { filename: 'assigned-a.png', image_id: 'img-assigned-a', side: 'front', modality: 'visual', overlay: false },
          ],
          annotations: [],
        },
      },
    ];
    const images = [{ id: 'img-assigned-a', filename: 'assigned-a.png', metadata: { part_id: 'part-1', view_name: 'front' } }];
    const rebuildPartImageMaps = (part, retainedSourceImages) => ({
      ...part,
      metadata: {
        ...part.metadata,
        source_images: retainedSourceImages,
        configured_views: retainedSourceImages.map((record) => record.side).filter(Boolean),
        modalities: retainedSourceImages.map((record) => record.modality).filter(Boolean),
        view_images: retainedSourceImages.reduce((acc, record) => {
          if (record.side && !record.overlay) acc[record.side] = record.filename;
          return acc;
        }, {}),
        overlay_images: {},
      },
    });

    global.fetch = jest.fn();
    jest.spyOn(global, 'fetch').mockImplementation((url, options = {}) => {
      if (url.includes('/parts/image-assignments') && options.method === 'POST') {
        const payload = JSON.parse(options.body || '{}');
        parts = parts.map((part) => rebuildPartImageMaps(
          part,
          (part.metadata.source_images || []).filter((record) => record.filename !== payload.filename),
        ));
        return Promise.resolve({ ok: true, json: async () => ({ filename: payload.filename, from_part_id: 'part-1', to_part_id: payload.to_part_id }) });
      }
      if (url.includes('/batches')) return Promise.resolve({ ok: true, json: async () => [{ id: 'batch-1', name: 'Batch 1' }] });
      if (url.includes('/parts/') && url.includes('/annotations') && (!options.method || options.method === 'GET')) {
        return Promise.resolve({ ok: true, json: async () => ({ part_id: 'part-1', annotations: [] }) });
      }
      if (url.includes('/parts')) return Promise.resolve({ ok: true, json: async () => parts });
      if (url.includes('/workspace-state')) return Promise.resolve({ ok: true, json: async () => ({ state: { selected_batch_id: 'batch-1', selected_part_id: 'part-1' } }) });
      if (url.includes('/configuration')) return Promise.resolve({ ok: true, json: async () => ({ config: {} }) });
      if (url.includes('/metadata-dict')) return Promise.resolve({ ok: true, json: async () => ({ calibration_default: defaultCalibration }) });
      if (url.includes('/images?include_deleted=true&limit=5000')) return Promise.resolve({ ok: true, json: async () => images });
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    const { unmount } = render(
      <ImagesToPartsTab projectId="proj-1" parts={parts} images={images} />,
    );

    fireEvent.dragStart(screen.getByRole('button', { name: 'assigned-a.png' }));
    fireEvent.drop(screen.getByTestId('images-to-parts-unassigned-target'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/projects/proj-1/parts/image-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'assigned-a.png', to_part_id: null }),
      });
    });
    await waitFor(() => expect(parts[0].metadata.source_images).toHaveLength(0));
    unmount();

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    expect(await screen.findByText('No mapped images for this part.')).toBeInTheDocument();
    expect(screen.queryByAltText('front view')).not.toBeInTheDocument();
    expect(screen.queryByText('assigned-a.png')).not.toBeInTheDocument();
  });

  afterEach(() => {
    delete global.fetch;
  });

  test.each(projectTypes)('supports progressive PT workflows for %s', async (projectType) => {
    for (const scenario of scenarioByUser) {
      const workspaceTracker = mockWorkbenchFetch(scenario);
      const { unmount } = render(<InspectionWorkbenchPanel projectId="proj-1" projectType={projectType} />);

      await waitFor(() => {
        expect(screen.getByText(`Batches: ${scenario.batches.length}`)).toBeInTheDocument();
      });
      expect(screen.queryByTestId('request-ingest-validation')).not.toBeInTheDocument();
      expect(screen.getByText(`Parts: ${scenario.parts.length}`)).toBeInTheDocument();
      if (projectType === 'PT3') {
        expect(screen.getByTestId('mpr-panel')).toBeInTheDocument();
        expect(screen.getByTestId('pt3-inspection-layout')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Draw 3D box on MPR slices' })).toBeInTheDocument();
        expect(screen.queryByTestId('selected-image-panel')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Part Selection' }));
        expect(screen.getByRole('heading', { name: 'Part Selection' })).toBeInTheDocument();
      }
      expect(screen.getByLabelText('Batch')).toBeInTheDocument();
      expect(screen.getByLabelText('Status')).toBeInTheDocument();
      expect(screen.getByLabelText('Filter')).toBeInTheDocument();
      expect(screen.getByLabelText('Sort')).toBeInTheDocument();
      if (projectType !== 'PT3') {
        expect(screen.getByTestId('selected-image-panel')).toBeInTheDocument();
      }

      // Inspection-status filter
      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'pass' } });
      const filteredRows = screen.queryAllByTestId('part-review-state');
      if (filteredRows.length > 0) {
        const expectedPassedRows = scenario.parts.filter((part) => (part.review_state || '').toLowerCase() === 'pass');
        expect(filteredRows.length).toBeLessThanOrEqual(expectedPassedRows.length);
      } else {
        expect(screen.getByText('No parts found for the current filters.')).toBeInTheDocument();
      }

      // Reset filter and test batch filter
      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } });
      if (scenario.batches.length > 1) {
        fireEvent.change(screen.getByLabelText('Batch'), { target: { value: scenario.batches[0].id } });
        const expectedBatchRows = scenario.parts.filter((part) => part.batch_id === scenario.batches[0].id);
        expect(screen.getAllByTestId('part-review-state').length).toBe(expectedBatchRows.length);
      }

      // Review action updates indicator
      fireEvent.click(screen.getByRole('button', { name: /^pass$/i }));
      await waitFor(() => {
        expect(screen.getByText('Passed: 1')).toBeInTheDocument();
      });

      if (projectType === 'PT3') fireEvent.click(screen.getByRole('button', { name: 'Close Part Selection' }));
      const seedAnnotationType = scenario.parts[0].metadata.annotations[0].defect_class;
      await waitFor(() => {
        expect(screen.getByTestId('annotation-list')).toHaveTextContent(seedAnnotationType);
        expect(screen.getByTestId('annotation-list')).toHaveTextContent('seed-user@example.com');
        expect(screen.getByTestId('annotation-list')).toHaveTextContent(new Date('2026-03-28T11:00:00Z').toLocaleString());
      });
      fireEvent.click(screen.getByRole('button', { name: 'Other' }));
      fireEvent.change(screen.getByLabelText('Annotation defect type'), { target: { value: 'Other' } });
      fireEvent.change(screen.getByPlaceholderText('annotation modality'), { target: { value: 'visual' } });
      fireEvent.change(screen.getByPlaceholderText('annotation comment'), { target: { value: `${scenario.user}-crack` } });
      fireEvent.click(screen.getByRole('button', { name: /save annotation/i }));
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/annotations'),
          expect.objectContaining({ method: 'POST' }),
        );
        expect(screen.getByTestId('annotation-list')).toHaveTextContent('Other');
        expect(screen.getByTestId('annotation-list')).toHaveTextContent(`${scenario.user}-crack`);
      });
      if (projectType === 'PT3') fireEvent.click(screen.getByRole('button', { name: 'Part Selection' }));
      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } });
      fireEvent.change(screen.getByLabelText('Batch'), { target: { value: '' } });
      await waitFor(() => {
        expect(workspaceTracker.getWorkspaceSaves().length).toBeGreaterThan(0);
      });
      const lastWorkspaceSave = workspaceTracker.getWorkspaceSaves().at(-1);
      expect(lastWorkspaceSave?.state).toEqual(expect.objectContaining({
        review_filter: expect.any(String),
        part_filter: expect.any(String),
        sort_mode: expect.any(String),
      }));

      unmount();
    }
  }, 90000);


  test('shows filename-decoded image to part mappings in inspection workbench', async () => {
    const decodedScenario = {
      user: 'filename-decoding',
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
      workspaceState: { selected_part_id: 'part-decoded-1' },
      batches: [],
      parts: [
        {
          id: 'part-decoded-1',
          batch_id: null,
          serial_number: '9',
          display_name: '100 22 7 9',
          review_state: 'unreviewed',
          metadata: {
            design_number: '100',
            lot_number: '22',
            set_number: '7',
            serial_number: '9',
            configured_views: ['left', 'right'],
            modalities: ['thermal', 'visual'],
            view_images: {
              left: 'DWG100_LT22_PN7_SN9_VWleft_MDvisual_false.png',
              right: 'DWG100_LT22_PN7_SN9_VWright_MDthermal_false.png',
            },
            source_images: [
              { filename: 'DWG100_LT22_PN7_SN9_VWleft_MDvisual_false.png', image_id: 'img-left', side: 'left', modality: 'visual', overlay: false },
              { filename: 'DWG100_LT22_PN7_SN9_VWright_MDthermal_false.png', image_id: 'img-right', side: 'right', modality: 'thermal', overlay: false },
            ],
            annotations: [],
          },
        },
      ],
    };

    mockWorkbenchFetch(decodedScenario);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => {
      expect(screen.getAllByText('100 22 7 9').length).toBeGreaterThan(0);
    });
    expect(screen.getByRole('button', { name: 'LEFT' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'RIGHT' })).toBeInTheDocument();
    expect(screen.getByTestId('selected-image-panel')).toBeInTheDocument();
  });

  test.each(projectTypes)('applies configurable inspector hotkeys for %s', async (projectType) => {
    for (const scenario of scenarioByUser) {
      const workspaceTracker = mockWorkbenchFetch(scenario);
      const { unmount } = render(<InspectionWorkbenchPanel projectId="proj-1" projectType={projectType} />);

      await waitFor(() => {
        expect(screen.getByTestId('inspector-hotkey-hints')).toHaveTextContent(
          new RegExp(`pass \\(${scenario.hotkeys.accept_classification.toUpperCase()}\\)`),
        );
      });

      if (scenario.workspaceState?.inspector?.shortcut_help_visible === true) {
        await waitFor(() => {
          expect(screen.queryByTestId('shortcut-help-panel')).toBeInTheDocument();
        });
      }

      fireEvent.keyDown(document, { key: scenario.hotkeys.toggle_shortcut_help });
      if (scenario.workspaceState?.inspector?.shortcut_help_visible === true) {
        expect(screen.queryByTestId('shortcut-help-panel')).not.toBeInTheDocument();
      } else {
        expect(screen.getByTestId('shortcut-help-panel')).toHaveTextContent('Shortcut help');
      }

      fireEvent.keyDown(document, { key: scenario.hotkeys.accept_classification });
      await waitFor(() => {
        expect(screen.getByText(/Passed: \d+/)).toBeInTheDocument();
      });

      fireEvent.keyDown(document, { key: scenario.hotkeys.reject_classification });
      await waitFor(() => {
        expect(screen.getByText(/Rejected: \d+/)).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(workspaceTracker.getWorkspaceSaves().length).toBeGreaterThan(0);
      });
      const savedVisibilityStates = workspaceTracker
        .getWorkspaceSaves()
        .map((entry) => entry?.state?.inspector?.shortcut_help_visible);
      expect(savedVisibilityStates.every((value) => typeof value === 'boolean')).toBe(true);
      const savedTriageFields = workspaceTracker
        .getWorkspaceSaves()
        .map((entry) => entry?.state?.inspector?.normalization_triage_field);
      expect(savedTriageFields.every((value) => typeof value === 'string')).toBe(true);
      const savedImageEnabledStates = workspaceTracker
        .getWorkspaceSaves()
        .map((entry) => entry?.state?.inspector?.image_enabled);
      expect(savedImageEnabledStates.every((value) => typeof value === 'boolean')).toBe(true);
      const savedModalities = workspaceTracker
        .getWorkspaceSaves()
        .map((entry) => entry?.state?.inspector?.modalities);
      expect(savedModalities.every((value) => Array.isArray(value))).toBe(true);
      const savedViewNames = workspaceTracker
        .getWorkspaceSaves()
        .map((entry) => entry?.state?.inspector?.view_name);
      expect(savedViewNames.every((value) => typeof value === 'string')).toBe(true);
      unmount();
    }
  });

  test('keeps PT3 MPR quadrants constrained after clicking the 3D pane', async () => {
    mockWorkbenchFetch(scenarioByUser[2]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await waitFor(() => {
      expect(screen.getByTestId('mpr-panel')).toBeInTheDocument();
    });

    const mprGrid = screen.getByTestId('mpr-grid');
    const quadrantPaneIds = ['mpr-pane-axial', 'mpr-pane-coronal', 'mpr-pane-sagittal', 'mpr-pane-3d'];

    expect(mprGrid).toHaveClass('mpr-grid-four');
    expect(mprGrid).not.toHaveClass('mpr-grid-single');
    quadrantPaneIds.forEach((testId) => {
      expect(screen.getByTestId(testId)).not.toHaveClass('mpr-pane-hidden');
    });

    fireEvent.click(screen.getByTestId('mpr-pane-3d'));

    expect(mprGrid).toHaveClass('mpr-grid-four');
    expect(mprGrid).not.toHaveClass('mpr-grid-single');
    quadrantPaneIds.forEach((testId) => {
      expect(screen.getByTestId(testId)).not.toHaveClass('mpr-pane-hidden');
    });
  });

  test('creates PT3 cube annotations from boxes on two MPR slices', async () => {
    mockWorkbenchFetch(scenarioByUser[2]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await waitFor(() => {
      expect(screen.getByTestId('pt3-inspection-layout')).toBeInTheDocument();
    });

    expect(screen.getByTestId('annotation-controls')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Draw 3D box on MPR slices' }));

    const axialPreview = screen.getByTestId('mpr-preview-axial');
    axialPreview.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 300,
      height: 150,
      right: 300,
      bottom: 150,
    });

    fireEvent.mouseDown(axialPreview, { clientX: 30, clientY: 20, button: 0 });
    fireEvent.mouseMove(axialPreview, { clientX: 120, clientY: 80 });
    fireEvent.mouseUp(axialPreview, { clientX: 120, clientY: 80, button: 0 });

    fireEvent.change(document.querySelector('#mpr-slice-axial'), { target: { value: '12' } });

    fireEvent.mouseDown(axialPreview, { clientX: 45, clientY: 30, button: 0 });
    fireEvent.mouseMove(axialPreview, { clientX: 135, clientY: 90 });
    fireEvent.mouseUp(axialPreview, { clientX: 135, clientY: 90, button: 0 });

    await waitFor(() => {
      const cubePost = global.fetch.mock.calls.find((call) => {
        if (!call[0].includes('/annotations') || call[1]?.method !== 'POST') return false;
        const body = JSON.parse(call[1].body);
        return body.geometry?.cube;
      });
      expect(cubePost).toBeDefined();
      const body = JSON.parse(cubePost[1].body);
      expect(body.defect_class).toBe('3D Box');
      expect(body.geometry.cube.axis).toBe('axial');
      expect(body.geometry.cube.vertices).toHaveLength(8);
      expect(body.metadata).toEqual(expect.objectContaining({
        annotation_color: '#f97316',
        annotation_fill_opacity: 0.5,
      }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('annotation-list')).toHaveTextContent('3D Box');
    });
    const axialOverlay = within(axialPreview).getByLabelText('XY annotation overlay');
    const shadedRect = axialOverlay.querySelector('rect[fill="#f97316"]');
    expect(shadedRect).toBeInTheDocument();
    expect(shadedRect.getAttribute('fill-opacity') || shadedRect.getAttribute('fillOpacity')).toBe('0.5');
  });

  test.each(projectTypes)('saves configurable hotkeys for progressive %s workflows', async (projectType) => {
    for (const scenario of scenarioByUser) {
      const workspaceTracker = mockWorkbenchFetch(scenario);
      const { unmount } = render(<InspectionWorkbenchPanel projectId="proj-1" projectType={projectType} />);

      await waitFor(() => {
        expect(screen.getByTestId('inspector-hotkey-hints')).toHaveTextContent(
          new RegExp(`pass \\(${scenario.hotkeys.accept_classification.toUpperCase()}\\)`),
        );
      });

      fireEvent.keyDown(document, { key: scenario.hotkeys.accept_classification });
      await waitFor(() => {
        expect(screen.getByText(/Passed: \d+/)).toBeInTheDocument();
      });

      fireEvent.keyDown(document, { key: scenario.hotkeys.reject_classification });
      await waitFor(() => {
        expect(screen.getByText(/Rejected: \d+/)).toBeInTheDocument();
      });
      expect(workspaceTracker.getConfigurationSaves().length).toBe(0);
      unmount();
    }
  });

  test('applies configured inspection layout labels, placement, and dimensions', async () => {
    const scenario = scenarioByUser[0];
    mockWorkbenchFetch(scenario);
    window.innerWidth = 1800;
    window.dispatchEvent(new Event('resize'));
    const hierarchy = {
      leftColumn: 'part_summary',
      centerTabs: ['image_metadata', 'inspector'],
      rightColumn: 'annotations',
      layout: {
        gridTemplateColumns: '300px minmax(620px, 1fr) 380px',
        gapPx: 18,
        minHeightPx: 680,
      },
      regions: {
        part_summary: {
          slot: 'left',
          label: 'Configured Navigator',
          order: 1,
          widthPx: 300,
          minWidthPx: 260,
          maxWidthPx: 360,
          minHeightPx: 500,
        },
        image_metadata: {
          slot: 'center',
          label: 'Configured Metadata',
          tabGroup: 'center',
          order: 1,
          minWidthPx: 540,
        },
        inspector: {
          slot: 'center',
          label: 'Configured Inspector',
          tabGroup: 'center',
          order: 2,
          minWidthPx: 620,
        },
        annotations: {
          slot: 'right',
          label: 'Configured Findings',
          order: 1,
          widthPx: 380,
          minWidthPx: 300,
          maxWidthPx: 460,
        },
      },
    };

    const { unmount } = render(
      <InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" hierarchy={hierarchy} />,
    );

    await waitFor(() => {
      expect(screen.getByText(`Batches: ${scenario.batches.length}`)).toBeInTheDocument();
    });

    const grid = screen.getByTestId('inspection-layout-grid');
    expect(grid).not.toBeEmptyDOMElement();
    await waitFor(() => {
      expect(grid.style.getPropertyValue('--inspection-grid-template-columns')).toBe('220px minmax(0, 1fr) 220px');
    });
    expect(grid.style.getPropertyValue('--inspection-layout-gap')).toBe('18px');
    expect(grid.style.getPropertyValue('--inspection-layout-min-height')).toBe('680px');

    expect(screen.getByRole('tab', { name: 'Configured Navigator' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Configured Metadata' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Configured Inspector' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Configured Findings' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Configured Inspector' }));
    expect(screen.getAllByText('Configured Inspector').length).toBeGreaterThan(0);

    unmount();
  });

  test('supports drag-resizing side columns and persists widths to project configuration', async () => {
    const scenario = scenarioByUser[0];
    const workspaceTracker = mockWorkbenchFetch(scenario);
    window.innerWidth = 1800;
    window.dispatchEvent(new Event('resize'));

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT2" />);

    await waitFor(() => {
      expect(screen.getByText(`Batches: ${scenario.batches.length}`)).toBeInTheDocument();
    });

    const leftDivider = screen.getByTestId('inspection-divider-left');
    fireEvent.pointerDown(leftDivider, { clientX: 320 });
    fireEvent.pointerMove(window, { clientX: 360 });
    fireEvent.pointerUp(window, { clientX: 360 });

    await waitFor(() => {
      expect(workspaceTracker.getConfigurationSaves().length).toBeGreaterThan(0);
    });
    const latestSave = workspaceTracker.getConfigurationSaves().at(-1);
    expect(latestSave?.config?.inspection_layout?.column_widths).toEqual(expect.objectContaining({
      left_px: expect.any(Number),
      right_px: expect.any(Number),
    }));
  });

  test('renders the configured inspection layout before any parts are loaded', async () => {
    mockWorkbenchFetch({
      user: 'empty',
      batches: [],
      parts: [],
      workspaceState: {},
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    const { unmount } = render(<InspectionWorkbenchPanel projectId="proj-empty" projectType="PT1" />);

    await waitFor(() => {
      expect(screen.getByText('Batches: 0')).toBeInTheDocument();
      expect(screen.getByText('Parts: 0')).toBeInTheDocument();
    });

    expect(screen.getByTestId('inspection-empty-state')).toHaveTextContent('No part selected');
    expect(screen.getByTestId('inspection-layout-grid')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Part Summary' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Image Metadata' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Inspection' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Annotations' })).toBeInTheDocument();
    expect(screen.getByTestId('selected-image-panel')).toHaveTextContent(
      'No part selected. Select a part to inspect mapped images.',
    );
    expect(screen.getByTestId('annotation-controls')).toHaveTextContent('For selected part: No part selected');
    expect(screen.getByRole('button', { name: 'Measure on tiles' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Draw box on tiles' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Other' })).toBeDisabled();

    unmount();
  });

  test('switches center pane between inspector images and selected image metadata', async () => {
    mockWorkbenchFetch(scenarioByUser[0]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT2" />);

    await waitFor(() => {
      expect(screen.getAllByText('Basic Part').length).toBeGreaterThan(0);
    });

    expect(screen.getByAltText('front view')).toHaveAttribute('src', '/api/images/part-basic-1-image-1/content');
    fireEvent.click(screen.getByRole('tab', { name: 'Image Metadata' }));
    expect(screen.getByRole('tab', { name: 'Image Metadata' })).toHaveAttribute('aria-selected', 'true');

    await waitFor(() => {
      expect(screen.getByTestId('selected-image-metadata-panel')).toHaveTextContent(/Selected image:\s*front-basic\.png/);
    });
    expect(screen.getByTestId('selected-image-metadata-panel')).toHaveTextContent('"view_name": "front"');
  });

  test('deletes annotations from the main annotations list', async () => {
    mockWorkbenchFetch(scenarioByUser[0]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT2" />);

    await waitFor(() => expect(screen.getByTestId('annotation-list')).toHaveTextContent('seed-basic'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete annotation seed-basic' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/projects/proj-1/parts/part-basic-1/annotations/seed-annotation-basic',
        { method: 'DELETE' },
      );
      expect(screen.getByTestId('annotation-list')).not.toHaveTextContent('seed-basic');
    });
  });

  test('renders Analyze overlay outputs over their source image in the inspection window', async () => {
    mockWorkbenchFetch({
      user: 'analyze-output',
      batches: [{ id: 'batch-output', name: 'Batch Output' }],
      parts: [
        {
          id: 'part-output-1',
          batch_id: 'batch-output',
          serial_number: 'SN-OUTPUT-1',
          display_name: 'Analyze Output Part',
          review_state: 'in_review',
          metadata: {
            source_images: [
              { filename: 'source.png', image_id: 'source-image-1', side: 'front', modality: 'visual', overlay: false },
              {
                filename: 'source_analyze_overlay.png',
                image_id: 'overlay-image-1',
                label: 'Segmentation Overlay :: Watershed From Seeds',
                side: 'front',
                modality: 'analyze-overlay',
                overlay: true,
                analysis_output: true,
                overlay_base_image_id: 'source-image-1',
                overlay_base_filename: 'source.png',
              },
            ],
            analysis_outputs: [
              {
                filename: 'source_analyze_overlay.png',
                image_id: 'overlay-image-1',
                label: 'Segmentation Overlay :: Watershed From Seeds',
                overlay_base_image_id: 'source-image-1',
              },
            ],
          },
        },
      ],
      workspaceState: {},
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getAllByText('Analyze Output Part').length).toBeGreaterThan(0));
    const composite = screen.getByTestId('inspection-overlay-composite');
    const viewBoard = document.querySelector('.view-board');
    expect(screen.getByLabelText('Inspection tile columns')).toHaveAttribute('max', '1');
    expect(viewBoard.style.getPropertyValue('--inspection-tile-columns')).toBe('1');
    fireEvent.change(screen.getByLabelText('Inspection tile columns'), { target: { value: '1' } });
    expect(viewBoard.style.getPropertyValue('--inspection-tile-columns')).toBe('1');
    expect(screen.getByLabelText('Inspection tile columns value')).toHaveValue(1);
    fireEvent.change(screen.getByLabelText('Inspection tile columns value'), { target: { value: '2' } });
    expect(screen.getByLabelText('Inspection tile columns')).toHaveValue('1');
    expect(viewBoard.style.getPropertyValue('--inspection-tile-columns')).toBe('1');
    expect(screen.getByText('Watershed From Seeds :: Segmentation Overlay')).toBeInTheDocument();
    expect(within(composite).getByAltText('front source')).toHaveAttribute('src', '/api/images/source-image-1/content');
    expect(within(composite).getByAltText('front overlay')).toHaveAttribute('src', '/api/images/overlay-image-1/content');
    fireEvent.click(composite);
    expect(screen.getByAltText('Watershed From Seeds :: Segmentation Overlay fullscreen')).toBeInTheDocument();
    expect(screen.getByAltText('Watershed From Seeds :: Segmentation Overlay source fullscreen')).toHaveAttribute('src', '/api/images/source-image-1/content');
    fireEvent.click(screen.getByLabelText('Close fullscreen image'));

    fireEvent.click(screen.getByRole('button', { name: 'Delete overlay Watershed From Seeds :: Segmentation Overlay' }));
    await waitFor(() => {
      expect(screen.queryByText('Watershed From Seeds :: Segmentation Overlay')).not.toBeInTheDocument();
    });
    expect(global.fetch).toHaveBeenCalledWith('/api/projects/proj-1/analyze/overlays/overlay-image-1', { method: 'DELETE' });
  });


  test('keeps black-hat Analyze overlays attached to a single inspection tile when switching parts', async () => {
    mockWorkbenchFetch({
      user: 'black-hat-output',
      batches: [{ id: 'batch-blackhat', name: 'Batch Black Hat' }],
      parts: [
        {
          id: 'part-blackhat-1',
          batch_id: 'batch-blackhat',
          serial_number: 'SN-BLACKHAT-1',
          display_name: 'Black Hat Overlay Part',
          review_state: 'in_review',
          metadata: {
            configured_views: ['front'],
            modalities: ['visual'],
            view_images: { front: 'blackhat-source.png' },
            source_images: [
              { filename: 'blackhat-source.png', image_id: 'blackhat-source-image', side: 'front', modality: 'visual', overlay: false },
            ],
            analysis_outputs: [
              {
                filename: 'blackhat-source_blackhat_overlay.png',
                image_id: 'blackhat-overlay-image',
                label: 'Black-Hat Analysis :: Morphology Overlay',
                overlay: true,
                analysis_output: true,
                side: 'front',
                modality: 'analyze-overlay',
                overlay_base_image_id: 'blackhat-source-image',
                overlay_base_filename: 'blackhat-source.png',
              },
            ],
          },
        },
        {
          id: 'part-normal-2',
          batch_id: 'batch-blackhat',
          serial_number: 'SN-NORMAL-2',
          display_name: 'Normal Part',
          review_state: 'unreviewed',
          metadata: {
            configured_views: ['front'],
            modalities: ['visual'],
            view_images: { front: 'normal-source.png' },
            source_images: [
              { filename: 'normal-source.png', image_id: 'normal-source-image', side: 'front', modality: 'visual', overlay: false },
            ],
          },
        },
      ],
      workspaceState: { selected_batch_id: 'batch-blackhat', selected_part_id: 'part-blackhat-1' },
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getByText('Morphology Overlay :: Black-Hat Analysis')).toBeInTheDocument());
    const viewBoard = document.querySelector('.view-board');
    expect(within(viewBoard).getAllByTestId('inspection-overlay-composite')).toHaveLength(1);
    expect(within(viewBoard).queryByAltText('front view')).not.toBeInTheDocument();
    expect(within(viewBoard).getAllByAltText('front source')).toHaveLength(1);
    expect(within(viewBoard).getAllByAltText('front overlay')).toHaveLength(1);
    expect(viewBoard.querySelectorAll('.view-cell')).toHaveLength(1);

    fireEvent.click(screen.getByText('Normal Part'));
    await waitFor(() => expect(within(viewBoard).getByAltText('front view')).toHaveAttribute('src', '/api/images/normal-source-image/content'));
    expect(within(viewBoard).queryByTestId('inspection-overlay-composite')).not.toBeInTheDocument();
    expect(viewBoard.querySelectorAll('.view-cell')).toHaveLength(1);

    fireEvent.click(screen.getByText('Black Hat Overlay Part'));
    await waitFor(() => expect(within(viewBoard).getByText('Morphology Overlay :: Black-Hat Analysis')).toBeInTheDocument());
    expect(within(viewBoard).getAllByTestId('inspection-overlay-composite')).toHaveLength(1);
    expect(within(viewBoard).queryByAltText('front view')).not.toBeInTheDocument();
    expect(viewBoard.querySelectorAll('.view-cell')).toHaveLength(1);

    const blackHatFrontToggle = screen.getByLabelText('Black Hat Overlay Part view toggles').querySelector('button');
    fireEvent.click(blackHatFrontToggle);
    fireEvent.click(screen.getByText('Normal Part'));
    fireEvent.click(screen.getByText('Black Hat Overlay Part'));
    await waitFor(() => expect(within(viewBoard).getAllByTestId('inspection-overlay-composite')).toHaveLength(1));
    expect(within(viewBoard).queryByAltText('front view')).not.toBeInTheDocument();
    expect(viewBoard.querySelectorAll('.view-cell')).toHaveLength(1);
  });

  test('shows measurement instructions and persists geometry calibration payload when creating a line', async () => {
    mockWorkbenchFetch(scenarioByUser[0]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);
    await waitFor(() => expect(screen.getByAltText('front view')).toBeInTheDocument());
    fireEvent.click(screen.getByAltText('front view'));
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
    expect(screen.getByText(/Click to set first point, click again to set second point/i)).toBeInTheDocument();

    const fullscreenImage = screen.getByAltText(/fullscreen$/i);
    Object.defineProperty(fullscreenImage, 'naturalWidth', { configurable: true, value: 1000 });
    Object.defineProperty(fullscreenImage, 'naturalHeight', { configurable: true, value: 500 });
	    fullscreenImage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500 });
	    fireEvent.click(fullscreenImage, { clientX: 100, clientY: 100 });
	    fireEvent.mouseMove(fullscreenImage, { clientX: 200, clientY: 100 });
	    await waitFor(() => expect(screen.getByLabelText('fullscreen measurement overlay')).toHaveTextContent('5.00 mm'));
	    fireEvent.click(fullscreenImage, { clientX: 300, clientY: 200 });

    await waitFor(() => {
      const postCall = global.fetch.mock.calls.find((call) => call[0].includes('/annotations') && call[1]?.method === 'POST');
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall[1].body);
      expect(body.image_id).toBe('part-basic-1-image-1');
      expect(body.geometry.line).toEqual(expect.objectContaining({ imageWidth: 1000, imageHeight: 500 }));
      expect(body.measurements.length_px).toBeDefined();
      expect(body.measurements.length_mm).toBeCloseTo(11.18, 2);
    });
    await waitFor(() => expect(screen.getByLabelText('fullscreen measurement overlay')).toHaveTextContent('11.18 mm'));
  });

  test('draws measurement lines and bounding boxes directly on image tiles', async () => {
    mockWorkbenchFetch(scenarioByUser[0]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);
    await waitFor(() => expect(screen.getByAltText('front view')).toBeInTheDocument());

    const tileImage = screen.getByAltText('front view');
    Object.defineProperty(tileImage, 'naturalWidth', { configurable: true, value: 400 });
    Object.defineProperty(tileImage, 'naturalHeight', { configurable: true, value: 200 });
    tileImage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200 });

	    fireEvent.click(screen.getByRole('button', { name: 'Measure on tiles' }));
	    fireEvent.click(tileImage, { clientX: 40, clientY: 20 });
	    fireEvent.mouseMove(tileImage, { clientX: 100, clientY: 60 });
	    await waitFor(() => expect(screen.getByLabelText('tile measurement overlay')).toHaveTextContent('3.61 mm'));
	    fireEvent.click(tileImage, { clientX: 140, clientY: 70 });

    await waitFor(() => {
      const postCall = global.fetch.mock.calls.find((call) => {
        if (!call[0].includes('/annotations') || call[1]?.method !== 'POST') return false;
        const body = JSON.parse(call[1].body);
        return body.geometry?.line;
      });
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall[1].body);
      expect(body.image_id).toBe('part-basic-1-image-1');
      expect(body.geometry.line).toEqual(expect.objectContaining({
        x1: 40,
        y1: 20,
        x2: 140,
        y2: 70,
        imageWidth: 400,
        imageHeight: 200,
      }));
    });
	    await waitFor(() => expect(screen.getByLabelText('tile measurement overlay')).toHaveTextContent('5.59 mm'));
	    expect(screen.getByRole('button', { name: 'Measure on tiles' })).not.toHaveClass('active');

	    fireEvent.click(screen.getByRole('button', { name: 'Draw box on tiles' }));
	    fireEvent.mouseDown(tileImage, { clientX: 50, clientY: 30, button: 0 });
	    fireEvent.mouseMove(tileImage, { clientX: 170, clientY: 90 });
	    await waitFor(() => expect(screen.getByLabelText('tile measurement overlay')).toHaveTextContent('Width 6.00 mm'));
	    fireEvent.mouseUp(tileImage, { clientX: 210, clientY: 130, button: 0 });

	    await waitFor(() => {
      const postCall = global.fetch.mock.calls.find((call) => {
        if (!call[0].includes('/annotations') || call[1]?.method !== 'POST') return false;
        const body = JSON.parse(call[1].body);
        return body.geometry?.box;
      });
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall[1].body);
      expect(body.image_id).toBe('part-basic-1-image-1');
      expect(body.bbox).toEqual(expect.objectContaining({ x: 50, y: 30, width: 160, height: 100 }));
      expect(body.measurements).toEqual(expect.objectContaining({
        width_px: 160,
        height_px: 100,
        width_mm: 8,
        height_mm: 5,
      }));
	    });
	    await waitFor(() => expect(screen.getByLabelText('tile measurement overlay')).toHaveTextContent('Width 8.00 mm'));
	    expect(screen.getByLabelText('tile measurement overlay')).toHaveTextContent('Height 5.00 mm');
	    expect(screen.getByRole('button', { name: 'Draw box on tiles' })).not.toHaveClass('active');
	  });

  test('anchors source tile annotations to the rendered image bounds', async () => {
    mockWorkbenchFetch(scenarioByUser[0]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);
    await waitFor(() => expect(screen.getByAltText('front view')).toBeInTheDocument());

    const tileImage = screen.getByAltText('front view');
    const tileSurface = tileImage.closest('.inspection-image-annotation-surface');
    expect(tileSurface).toBeInTheDocument();
    expect(tileSurface).toContainElement(screen.getByLabelText('tile measurement overlay'));
    Object.defineProperty(tileImage, 'naturalWidth', { configurable: true, value: 400 });
    Object.defineProperty(tileImage, 'naturalHeight', { configurable: true, value: 200 });
    tileImage.getBoundingClientRect = () => ({ left: 50, top: 25, width: 400, height: 200, right: 450, bottom: 225 });
    tileSurface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 300, right: 500, bottom: 300 });

    fireEvent.click(screen.getByRole('button', { name: 'Measure on tiles' }));
    fireEvent.click(tileSurface, { clientX: 90, clientY: 45 });
    fireEvent.click(tileSurface, { clientX: 190, clientY: 95 });

    await waitFor(() => {
      const postCall = global.fetch.mock.calls.find((call) => {
        if (!call[0].includes('/annotations') || call[1]?.method !== 'POST') return false;
        const body = JSON.parse(call[1].body);
        return body.geometry?.line;
      });
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall[1].body);
      expect(body.geometry.line).toEqual(expect.objectContaining({
        x1: 40,
        y1: 20,
        x2: 140,
        y2: 70,
        imageWidth: 400,
        imageHeight: 200,
      }));
    });
  });

  test('asks for calibration before allowing fullscreen measurement when calibration is missing', async () => {
    mockWorkbenchFetch({ ...scenarioByUser[0], metadataDict: {} });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);
    await waitFor(() => expect(screen.getByAltText('front view')).toBeInTheDocument());
    fireEvent.click(screen.getByAltText('front view'));
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }));

    expect(screen.getByRole('dialog', { name: 'Measurement calibration required' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set Calibration' })).toBeInTheDocument();
    expect(screen.queryByText(/Click to set first point/i)).not.toBeInTheDocument();

    const fullscreenImage = screen.getByAltText(/fullscreen$/i);
    Object.defineProperty(fullscreenImage, 'naturalWidth', { configurable: true, value: 1000 });
    Object.defineProperty(fullscreenImage, 'naturalHeight', { configurable: true, value: 500 });
    fullscreenImage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500 });
    fireEvent.click(fullscreenImage, { clientX: 100, clientY: 100 });
    expect(global.fetch.mock.calls.some((call) => call[0].includes('/annotations') && call[1]?.method === 'POST')).toBe(false);
  });

  test('renders measurement line and length text in both tile and fullscreen overlays', async () => {
    mockWorkbenchFetch({
      ...scenarioByUser[0],
      parts: [{
        ...scenarioByUser[0].parts[0],
        metadata: {
          ...scenarioByUser[0].parts[0].metadata,
          annotations: [{
            id: 'measurement-a',
            image_id: 'part-basic-1-image-1',
            defect_class: 'Measurement',
            comment: 'Line check',
            geometry: { line: { x1: 100, y1: 80, x2: 280, y2: 160, imageWidth: 400, imageHeight: 200 } },
            measurements: { length_mm: 4.2 },
            created_by: 'inspector@example.com',
            created_at: '2026-04-01T09:15:00Z',
          }],
        },
      }],
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);
    await waitFor(() => expect(screen.getByLabelText('tile measurement overlay')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('Loading annotations…')).not.toBeInTheDocument());
    expect(screen.getByTestId('annotation-list')).toHaveTextContent('inspector@example.com');
    expect(screen.getByTestId('annotation-list')).toHaveTextContent(new Date('2026-04-01T09:15:00Z').toLocaleString());
    fireEvent.click(screen.getByTestId('annotation-list').querySelector('.annotation-entry'));
    expect(document.querySelector('.inspection-annotation-selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit annotation Line check' }));
    expect(screen.getByRole('dialog', { name: 'Edit annotation' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Edit annotation comment'), { target: { value: 'Unsaved edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edit annotation' }));
    expect(screen.queryByRole('dialog', { name: 'Edit annotation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit annotation Unsaved edit' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit annotation Line check' }));
    fireEvent.change(screen.getByLabelText('Edit annotation comment'), { target: { value: 'Saved edit' } });
    fireEvent.change(screen.getByLabelText('Edit annotation color'), { target: { value: '#22c55e' } });
    fireEvent.change(screen.getByLabelText('Edit annotation fill opacity'), { target: { value: '0.35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit annotation Saved edit' })).toBeInTheDocument());
    const stylePatchCall = global.fetch.mock.calls.find((call) => {
      if (!call[0].includes('/annotations/measurement-a') || call[1]?.method !== 'PATCH') return false;
      const body = JSON.parse(call[1].body);
      return body.comment === 'Saved edit';
    });
    expect(JSON.parse(stylePatchCall[1].body).metadata).toEqual(expect.objectContaining({
      annotation_color: '#22c55e',
      measurement_color: '#22c55e',
      annotation_fill_opacity: 0.35,
    }));
    expect(screen.getAllByText('4.20 mm').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByAltText('front view'));
    await waitFor(() => expect(screen.getAllByText('4.20 mm').length).toBeGreaterThan(1));
    expect(screen.getByTestId('fullscreen-annotation-list')).toHaveTextContent('4.20 mm');
  });

  test('crops bounding box annotations into child images assigned to the workbench', async () => {
    const originalImage = global.Image;
    const originalCreateElement = document.createElement.bind(document);
    global.Image = class MockImage {
      constructor() {
        this.naturalWidth = 400;
        this.naturalHeight = 200;
        this.width = 400;
        this.height = 200;
      }

      set src(value) {
        this._src = value;
        setTimeout(() => this.onload?.(), 0);
      }

      get src() {
        return this._src;
      }
    };
    const drawImage = jest.fn();
    const toBlob = jest.fn((callback) => callback(new Blob(['crop-bytes'], { type: 'image/png' })));
    jest.spyOn(document, 'createElement').mockImplementation((tagName, ...args) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage }),
          toBlob,
        };
      }
      return originalCreateElement(tagName, ...args);
    });

    mockWorkbenchFetch({
      ...scenarioByUser[0],
      parts: [{
        ...scenarioByUser[0].parts[0],
        metadata: {
          ...scenarioByUser[0].parts[0].metadata,
          annotations: [{
            id: 'box-crop-a',
            image_id: 'part-basic-1-image-1',
            defect_class: 'Scratch',
            modality: 'visual',
            comment: 'Scratch box',
            bbox: { x: 25, y: 40, width: 80, height: 50 },
            geometry: { imageWidth: 400, imageHeight: 200, box: { x: 25, y: 40, width: 80, height: 50, imageWidth: 400, imageHeight: 200 } },
            measurements: { width_px: 80, height_px: 50 },
            created_by: 'inspector@example.com',
            created_at: '2026-04-01T09:15:00Z',
          }],
        },
      }],
    });

    try {
      render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Crop annotation Scratch box' })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Crop annotation Scratch box' }));

      await waitFor(() => expect(drawImage).toHaveBeenCalled());
      expect(drawImage).toHaveBeenCalledWith(expect.any(Object), 25, 40, 80, 50, 0, 0, 80, 50);
      await waitFor(() => expect(global.fetch.mock.calls.some((call) => call[0] === '/api/projects/proj-1/images' && call[1]?.method === 'POST')).toBe(true));
      const uploadCall = global.fetch.mock.calls.find((call) => call[0] === '/api/projects/proj-1/images' && call[1]?.method === 'POST');
      const uploadedFile = uploadCall[1].body.get('file');
      const uploadedMetadata = JSON.parse(uploadCall[1].body.get('metadata'));
      expect(uploadedFile.name).toBe('25_40_crop of front-basic.png.png');
      expect(uploadedMetadata).toEqual(expect.objectContaining({
        crop_child_image: true,
        parent_image_id: 'part-basic-1-image-1',
        parent_image_filename: 'front-basic.png',
        crop_annotation_id: 'box-crop-a',
      }));
      expect(uploadedMetadata.crop_bbox).toEqual(expect.objectContaining({ x: 25, y: 40, width: 80, height: 50 }));
      expect(global.fetch).toHaveBeenCalledWith('/api/projects/proj-1/parts/image-assignments', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ filename: '25_40_crop of front-basic.png.png', to_part_id: 'part-basic-1' }),
      }));
      await waitFor(() => expect(screen.getByAltText('crop view')).toBeInTheDocument());
    } finally {
      document.createElement.mockRestore();
      global.Image = originalImage;
    }
  });

  test('preserves fullscreen zoom while drawing repeated bounding boxes', async () => {
    mockWorkbenchFetch(scenarioByUser[0]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);
    await waitFor(() => expect(screen.getByAltText('front view')).toBeInTheDocument());
    fireEvent.click(screen.getByAltText('front view'));

    const fullscreenImage = screen.getByAltText(/fullscreen$/i);
    Object.defineProperty(fullscreenImage, 'naturalWidth', { configurable: true, value: 500 });
    Object.defineProperty(fullscreenImage, 'naturalHeight', { configurable: true, value: 250 });
    fullscreenImage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 250, right: 500, bottom: 250 });

    fireEvent.wheel(fullscreenImage, { deltaY: -80, clientX: 250, clientY: 125 });
    const zoomLayer = document.querySelector('.inspection-fullscreen-image-zoom-layer');
    expect(zoomLayer.style.transform).toBe('translate(0px, 0px) scale(1.15)');
    expect(zoomLayer.style.transformOrigin).toBe('50% 50%');

    fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
    expect(screen.getByRole('button', { name: 'Measure' })).toHaveClass('active');
    expect(zoomLayer.style.transform).toBe('translate(0px, 0px) scale(1.15)');
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
    expect(screen.getByRole('button', { name: 'Measure' })).not.toHaveClass('active');
    expect(zoomLayer.style.transform).toBe('translate(0px, 0px) scale(1.15)');

    fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));
    expect(screen.getByText(/Press and drag to draw a bounding box/i)).toBeInTheDocument();
    expect(zoomLayer.style.transform).toBe('translate(0px, 0px) scale(1.15)');
    expect(zoomLayer.style.transformOrigin).toBe('50% 50%');

    fireEvent.mouseDown(fullscreenImage, { clientX: 80, clientY: 40, button: 0 });
    fireEvent.mouseMove(fullscreenImage, { clientX: 180, clientY: 100 });
    await waitFor(() => expect(screen.getByLabelText('fullscreen measurement overlay')).toHaveTextContent('Width 5.00 mm'));
    fireEvent.mouseUp(fullscreenImage, { clientX: 230, clientY: 120, button: 0 });

    await waitFor(() => {
      const postCall = global.fetch.mock.calls.find((call) => {
        if (!call[0].includes('/annotations') || call[1]?.method !== 'POST') return false;
        const body = JSON.parse(call[1].body);
        return body.geometry?.box;
      });
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall[1].body);
      expect(body.image_id).toBe('part-basic-1-image-1');
      expect(body.bbox).toEqual(expect.objectContaining({ x: 80, y: 40, width: 150, height: 80 }));
    });
    await waitFor(() => expect(screen.getByLabelText('fullscreen measurement overlay')).toHaveTextContent('Width 7.50 mm'));
    expect(screen.getByLabelText('fullscreen measurement overlay')).toHaveTextContent('Height 4.00 mm');
    expect(screen.getByTestId('fullscreen-annotation-list')).toHaveTextContent('Width 7.50 mm');
    expect(screen.getByRole('button', { name: 'Draw box' })).toHaveClass('active');
    expect(zoomLayer.style.transform).toBe('translate(0px, 0px) scale(1.15)');

    fireEvent.mouseDown(fullscreenImage, { clientX: 260, clientY: 130, button: 0 });
    fireEvent.mouseMove(fullscreenImage, { clientX: 320, clientY: 170 });
    await waitFor(() => expect(screen.getByLabelText('fullscreen measurement overlay')).toHaveTextContent('Width 3.00 mm'));
    fireEvent.mouseUp(fullscreenImage, { clientX: 340, clientY: 180, button: 0 });

    await waitFor(() => {
      const boxPostCalls = global.fetch.mock.calls.filter((call) => {
        if (!call[0].includes('/annotations') || call[1]?.method !== 'POST') return false;
        const body = JSON.parse(call[1].body);
        return body.geometry?.box;
      });
      expect(boxPostCalls).toHaveLength(2);
      const secondBody = JSON.parse(boxPostCalls[1][1].body);
      expect(secondBody.bbox).toEqual(expect.objectContaining({ x: 260, y: 130, width: 80, height: 50 }));
    });
    expect(zoomLayer.style.transform).toBe('translate(0px, 0px) scale(1.15)');

    expect(screen.getByRole('button', { name: 'Draw box' })).toHaveClass('active');
  });


  test('maps fullscreen zoomed-and-panned pointer tip pixels to bounding box geometry', async () => {
    mockWorkbenchFetch(scenarioByUser[0]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);
    await waitFor(() => expect(screen.getByAltText('front view')).toBeInTheDocument());
    fireEvent.click(screen.getByAltText('front view'));

    const fullscreenImage = screen.getByAltText(/fullscreen$/i);
    Object.defineProperty(fullscreenImage, 'naturalWidth', { configurable: true, value: 500 });
    Object.defineProperty(fullscreenImage, 'naturalHeight', { configurable: true, value: 250 });
    fullscreenImage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 250, right: 500, bottom: 250 });

    fireEvent.wheel(fullscreenImage, { deltaY: -80, clientX: 250, clientY: 125 });
    fireEvent.mouseDown(fullscreenImage, { clientX: 250, clientY: 125, button: 0 });
    fireEvent.mouseMove(fullscreenImage, { clientX: 290, clientY: 155 });
    fireEvent.mouseUp(fullscreenImage, { clientX: 290, clientY: 155, button: 0 });

    const zoomLayer = document.querySelector('.inspection-fullscreen-image-zoom-layer');
    expect(zoomLayer.style.transform).toBe('translate(40px, 30px) scale(1.15)');
    expect(zoomLayer.style.transformOrigin).toBe('50% 50%');

    // Simulate the browser's post-transform image bounds so the event client
    // coordinate represents the exact pixel beneath the rendered pointer tip on
    // the zoomed, panned image.
    const transformedRect = {
      left: 2.5,
      top: 11.25,
      width: 575,
      height: 287.5,
      right: 577.5,
      bottom: 298.75,
    };
    fullscreenImage.getBoundingClientRect = () => transformedRect;
    const clientForNaturalPixel = (x, y) => ({
      clientX: transformedRect.left + ((x / 500) * transformedRect.width),
      clientY: transformedRect.top + ((y / 250) * transformedRect.height),
    });

    const pointerTipStart = clientForNaturalPixel(130, 65);
    const pointerTipEnd = clientForNaturalPixel(330, 185);

    fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));
    fireEvent.mouseDown(fullscreenImage, { ...pointerTipStart, button: 0 });
    fireEvent.mouseMove(fullscreenImage, pointerTipEnd);
    await waitFor(() => expect(screen.getByLabelText('fullscreen measurement overlay')).toHaveTextContent('Width 10.00 mm'));
    fireEvent.mouseUp(fullscreenImage, { ...pointerTipEnd, button: 0 });

    await waitFor(() => {
      const postCall = global.fetch.mock.calls.find((call) => {
        if (!call[0].includes('/annotations') || call[1]?.method !== 'POST') return false;
        const body = JSON.parse(call[1].body);
        return body.geometry?.box;
      });
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall[1].body);
      expect(body.geometry.box).toEqual(expect.objectContaining({
        x: 130,
        y: 65,
        width: 200,
        height: 120,
        imageWidth: 500,
        imageHeight: 250,
      }));
      expect(body.bbox).toEqual(expect.objectContaining({ x: 130, y: 65, width: 200, height: 120 }));
      expect(body.measurements).toEqual(expect.objectContaining({
        width_px: 200,
        height_px: 120,
        width_mm: 10,
        height_mm: 6,
      }));
    });
  });

  test('shares source-image annotations across Analyze overlays and saves overlay measurements to the source image', async () => {
    mockWorkbenchFetch({
      user: 'overlay-measurements',
      batches: [{ id: 'batch-overlay', name: 'Batch Overlay' }],
      parts: [{
        id: 'part-overlay-1',
        batch_id: 'batch-overlay',
        serial_number: 'SN-OVERLAY-1',
        display_name: 'Overlay Part',
        review_state: 'in_review',
        metadata: {
          source_images: [
            { filename: 'source.png', image_id: 'source-image-1', side: 'front', modality: 'visual', overlay: false },
            {
              filename: 'source_overlay.png',
              image_id: 'overlay-image-1',
              label: 'Segmentation Overlay',
              side: 'front',
              modality: 'analyze-overlay',
              overlay: true,
              analysis_output: true,
              overlay_base_image_id: 'source-image-1',
              overlay_base_filename: 'source.png',
            },
          ],
          analysis_outputs: [],
          annotations: [{
            id: 'source-measurement-a',
            image_id: 'source-image-1',
            comment: 'Shared source length',
            geometry: { line: { x1: 40, y1: 40, x2: 140, y2: 40, imageWidth: 200, imageHeight: 100 } },
            measurements: { length_mm: 5 },
            metadata: { measurement_color: '#10b981' },
          }],
        },
      }],
      workspaceState: {},
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);
    await waitFor(() => expect(screen.getAllByText('5.00 mm').length).toBeGreaterThan(1));

    fireEvent.click(screen.getByTestId('inspection-overlay-composite'));
    await waitFor(() => expect(screen.getByTestId('fullscreen-annotation-list')).toHaveTextContent('Shared source length'));
    expect(screen.getByAltText('Segmentation Overlay source fullscreen')).toHaveAttribute('src', '/api/images/source-image-1/content');
    expect(screen.getByAltText('Segmentation Overlay fullscreen')).toHaveAttribute('src', '/api/images/overlay-image-1/content');
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }));

    const fullscreenImage = screen.getByAltText('Segmentation Overlay fullscreen');
    Object.defineProperty(fullscreenImage, 'naturalWidth', { configurable: true, value: 200 });
    Object.defineProperty(fullscreenImage, 'naturalHeight', { configurable: true, value: 100 });
    fullscreenImage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 });
    fireEvent.click(fullscreenImage, { clientX: 20, clientY: 20 });
    fireEvent.click(fullscreenImage, { clientX: 80, clientY: 40 });

    await waitFor(() => {
      const postCall = global.fetch.mock.calls.find((call) => call[0].includes('/annotations') && call[1]?.method === 'POST');
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall[1].body);
      expect(body.image_id).toBe('source-image-1');
    });
  });

  test('highlights, repositions, and deletes fullscreen measurement endpoints (PT2 lens)', async () => {
    mockWorkbenchFetch({
      ...scenarioByUser[0],
      parts: [{
        ...scenarioByUser[0].parts[0],
        metadata: {
          ...scenarioByUser[0].parts[0].metadata,
          annotations: [{
            id: 'measurement-endpoint-a',
            image_id: 'part-basic-1-image-1',
            comment: 'Endpoint check',
            geometry: { line: { x1: 100, y1: 80, x2: 280, y2: 160, imageWidth: 400, imageHeight: 200 } },
            measurements: { length_mm: 4.2, length_px: 196.98 },
            metadata: { measurement_color: '#3b82f6' },
          }],
        },
      }],
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);
    await waitFor(() => expect(screen.getByAltText('front view')).toBeInTheDocument());
    fireEvent.click(screen.getByAltText('front view'));

    const fullscreenImage = screen.getByAltText(/fullscreen$/i);
    Object.defineProperty(fullscreenImage, 'naturalWidth', { configurable: true, value: 400 });
    Object.defineProperty(fullscreenImage, 'naturalHeight', { configurable: true, value: 200 });
    fullscreenImage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200 });

    fireEvent.click(screen.getByText('Endpoint check'));
    const endpointDot = await screen.findByLabelText('Reposition end endpoint for Endpoint check');
    expect(screen.getByLabelText('Reposition start endpoint for Endpoint check')).toBeInTheDocument();
    fireEvent.click(endpointDot, { clientX: 282, clientY: 160 });
    expect(screen.queryByTestId('fullscreen-measurement-zoom-lens')).not.toBeInTheDocument();
        fireEvent.click(endpointDot, { clientX: 280, clientY: 160 });

    await waitFor(() => {
      const patchCall = global.fetch.mock.calls.find((call) => call[0].includes('/annotations/measurement-endpoint-a') && call[1]?.method === 'PATCH');
      expect(patchCall).toBeDefined();
      const body = JSON.parse(patchCall[1].body);
      expect(body.geometry.line).toEqual(expect.objectContaining({ x2: 280, y2: 160 }));
      expect(body.measurements.length_px).toBeCloseTo(196.98, 2);
    });

    fireEvent.mouseMove(fullscreenImage, { clientX: 100, clientY: 80 });
    const startDot = await screen.findByLabelText('Reposition start endpoint for Endpoint check');
    fireEvent.click(startDot, { clientX: 100, clientY: 80 });
    fireEvent.click(fullscreenImage, { clientX: 120, clientY: 90 });
    await waitFor(() => {
      const patchCalls = global.fetch.mock.calls.filter((call) => call[0].includes('/annotations/measurement-endpoint-a') && call[1]?.method === 'PATCH');
      expect(patchCalls.length).toBeGreaterThan(1);
      const body = JSON.parse(patchCalls.at(-1)[1].body);
      expect(body.geometry.line.x1).toBeGreaterThanOrEqual(100);
      expect(body.geometry.line.y1).toBeGreaterThanOrEqual(80);
    });
    await waitFor(() => expect(screen.queryByTestId('fullscreen-measurement-zoom-lens')).not.toBeInTheDocument());

	    fireEvent.wheel(fullscreenImage, { deltaY: -80, clientX: 200, clientY: 100 });
	    const zoomLayer = document.querySelector('.inspection-fullscreen-image-zoom-layer');
	    expect(zoomLayer.style.transform).toBe('translate(0px, 0px) scale(1.15)');
	    expect(zoomLayer.style.transformOrigin).toBe('50% 50%');

	    fireEvent.mouseDown(fullscreenImage, { clientX: 200, clientY: 100, button: 0 });
	    fireEvent.mouseMove(fullscreenImage, { clientX: 240, clientY: 130 });
	    fireEvent.mouseUp(fullscreenImage, { clientX: 240, clientY: 130, button: 0 });
	    expect(zoomLayer.style.transform).toBe('translate(40px, 30px) scale(1.15)');

	    fireEvent.click(screen.getByRole('button', { name: 'Delete Endpoint check' }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/projects/proj-1/parts/part-basic-1/annotations/measurement-endpoint-a',
        { method: 'DELETE' },
      );
      expect(screen.getByTestId('fullscreen-annotation-list')).not.toHaveTextContent('Endpoint check');
    });
  });

  test('does not render fine-tune zoom lens overlay while editing endpoints', async () => {
    mockWorkbenchFetch({
      ...scenarioByUser[0],
      parts: [{
        ...scenarioByUser[0].parts[0],
        metadata: {
          ...scenarioByUser[0].parts[0].metadata,
          annotations: [{
            id: 'measurement-lens-overlay-a',
            image_id: 'part-basic-1-image-1',
            comment: 'Lens overlay check',
            geometry: { line: { x1: 80, y1: 50, x2: 260, y2: 120, imageWidth: 400, imageHeight: 200 } },
            measurements: { length_mm: 3.8, length_px: 193.13 },
            metadata: { measurement_color: '#22c55e' },
          }],
        },
      }],
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);
    await waitFor(() => expect(screen.getByAltText('front view')).toBeInTheDocument());
    fireEvent.click(screen.getByAltText('front view'));

    const fullscreenImage = screen.getByAltText(/fullscreen$/i);
    Object.defineProperty(fullscreenImage, 'naturalWidth', { configurable: true, value: 400 });
    Object.defineProperty(fullscreenImage, 'naturalHeight', { configurable: true, value: 200 });
    fullscreenImage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200 });

    fireEvent.click(screen.getByText('Lens overlay check'));
    const endDot = await screen.findByLabelText('Reposition end endpoint for Lens overlay check');
    fireEvent.click(endDot, { clientX: 260, clientY: 120 });

    expect(screen.queryByLabelText('Measurement fine-tune overlay')).not.toBeInTheDocument();
  });

  test('commits endpoint using the clicked image position after annotation-column selection', async () => {
    mockWorkbenchFetch({
      ...scenarioByUser[0],
      parts: [{
        ...scenarioByUser[0].parts[0],
        metadata: {
          ...scenarioByUser[0].parts[0].metadata,
          annotations: [{
            id: 'measurement-lens-commit-a',
            image_id: 'part-basic-1-image-1',
            comment: 'Lens commit check',
            geometry: { line: { x1: 100, y1: 80, x2: 280, y2: 160, imageWidth: 400, imageHeight: 200 } },
            measurements: { length_mm: 4.2, length_px: 196.98 },
            metadata: { measurement_color: '#3b82f6' },
          }],
        },
      }],
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);
    await waitFor(() => expect(screen.getByAltText('front view')).toBeInTheDocument());
    fireEvent.click(screen.getByAltText('front view'));

    const fullscreenImage = screen.getByAltText(/fullscreen$/i);
    Object.defineProperty(fullscreenImage, 'naturalWidth', { configurable: true, value: 400 });
    Object.defineProperty(fullscreenImage, 'naturalHeight', { configurable: true, value: 200 });
    fullscreenImage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200 });

    fireEvent.click(screen.getByText('Lens commit check'));
    const endDot = await screen.findByLabelText('Reposition end endpoint for Lens commit check');
    fireEvent.click(endDot, { clientX: 280, clientY: 160 });

    fireEvent.mouseMove(fullscreenImage, { clientX: 320, clientY: 170 });
    fireEvent.click(fullscreenImage, { clientX: 120, clientY: 45 });

    await waitFor(() => {
      const patchCall = global.fetch.mock.calls.find((call) => call[0].includes('/annotations/measurement-lens-commit-a') && call[1]?.method === 'PATCH');
      expect(patchCall).toBeDefined();
      const body = JSON.parse(patchCall[1].body);
      expect(body.geometry.line).toEqual(expect.objectContaining({ x2: 120, y2: 45 }));
    });
  });

  test('part summary modality buttons toggle matching images in the view window', async () => {
    mockWorkbenchFetch({
      user: 'modality-toggle',
      batches: [{ id: 'batch-modal', name: 'Batch Modal' }],
      parts: [
        {
          id: 'part-modal-1',
          batch_id: 'batch-modal',
          serial_number: 'SN-MODAL-1',
          display_name: 'Modal Part',
          review_state: 'in_review',
          metadata: {
            configured_views: ['front'],
            modalities: ['visual', 'thermal'],
            view_images: { front: 'modal-front-visual.png' },
            source_images: [
              { filename: 'modal-front-visual.png', image_id: 'modal-visual-image', side: 'front', modality: 'visual', overlay: false },
              { filename: 'modal-front-thermal.png', image_id: 'modal-thermal-image', side: 'front', modality: 'thermal', overlay: true },
            ],
          },
        },
      ],
      workspaceState: { inspector: { image_enabled: true, modalities: ['visual'], view_name: 'front' } },
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getAllByText('Modal Part').length).toBeGreaterThan(0));
    expect(screen.getAllByAltText('front view')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'THERMAL' }));
    await waitFor(() => expect(screen.getAllByAltText('front view')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'VISUAL' }));
    await waitFor(() => expect(screen.getAllByAltText('front view')).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'FRONT' }));
    await waitFor(() => expect(screen.queryByAltText('front view')).not.toBeInTheDocument());
  });

  test('does not duplicate original front and back images from source_images when view_images exists', async () => {
    mockWorkbenchFetch({
      user: 'dedupe-originals',
      batches: [{ id: 'batch-dedupe', name: 'Batch Dedupe' }],
      parts: [
        {
          id: 'part-dedupe-1',
          batch_id: 'batch-dedupe',
          serial_number: 'SN-DEDUPE-1',
          display_name: 'Dedupe Part',
          review_state: 'in_review',
          metadata: {
            configured_views: ['front', 'back'],
            view_images: { front: 'front.png', back: 'back.png' },
            source_images: [
              { filename: 'front.png', image_id: 'front-image-1', side: 'front', modality: 'visual', overlay: false },
              { filename: 'back.png', image_id: 'back-image-1', side: 'back', modality: 'visual', overlay: false },
            ],
          },
        },
      ],
      workspaceState: {},
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getAllByText('Dedupe Part').length).toBeGreaterThan(0));
    expect(screen.getAllByAltText('front view')).toHaveLength(1);
    expect(screen.getAllByAltText('back view')).toHaveLength(1);
    expect(screen.queryByText('IMAGE 1')).not.toBeInTheDocument();
    expect(screen.queryByText('IMAGE 2')).not.toBeInTheDocument();
  });

  test('uses loaded 16-bit TIFF value range for PT3 display window controls', async () => {
    mockWorkbenchFetch({
      user: 'pt3-uint16-window',
      batches: [{ id: 'batch-uint16', name: 'Batch UInt16' }],
      parts: [
        {
          id: 'part-uint16-1',
          batch_id: 'batch-uint16',
          serial_number: 'SN-U16-1',
          display_name: 'UInt16 TIFF Part',
          review_state: 'in_review',
          metadata: {
            voxel_dtype: 'uint16',
            volume_shape: { axial: 2, coronal: 2, sagittal: 2 },
            source_images: [
              {
                filename: 'slice-low.tif',
                image_id: 'slice-low-id',
                metadata: {
                  slice_index: 0,
                  pixel_dtype: 'uint16',
                  bit_depth: 16,
                  pixel_value_range: { min: 1024, max: 4096 },
                },
              },
              {
                filename: 'slice-high.tif',
                image_id: 'slice-high-id',
                metadata: {
                  slice_index: 1,
                  pixel_dtype: 'uint16',
                  bit_depth: 16,
                  pixel_value_range: { min: 2048, max: 12000 },
                },
              },
            ],
          },
        },
      ],
      workspaceState: { selected_part_id: 'part-uint16-1' },
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await waitFor(() => expect(screen.getByText('UInt16 TIFF Part')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('3D view'), { target: { value: 'stack' } });

    expect(screen.getByText('1024-12000 loaded image range')).toBeInTheDocument();
    expect(screen.getByLabelText('Display window minimum handle')).toHaveAttribute('min', '1024');
    expect(screen.getByLabelText('Display window maximum handle')).toHaveAttribute('max', '12000');
    expect(screen.getAllByTestId('mpr-preview-axial')[0].querySelector('.mpr-slice-canvas')).toHaveAttribute('data-display-domain', '1024-12000');

    fireEvent.change(screen.getByLabelText('Display window maximum handle'), { target: { value: '8000' } });
    expect(screen.getByLabelText('Display window maximum')).toHaveValue(8000);
  });

  test('defaults PT3 to focused four-quadrant MPR with modal access and wheel controls', async () => {
    mockWorkbenchFetch(scenarioByUser[2]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await waitFor(() => {
      expect(screen.getByTestId('mpr-panel')).toBeInTheDocument();
    });

    expect(screen.queryByRole('tab', { name: 'MPR' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('inspection-layout-grid')).not.toBeInTheDocument();
    expect(screen.getByTestId('mpr-panel')).toHaveTextContent('XY');
    expect(screen.getByTestId('mpr-panel')).toHaveTextContent('XZ');
    expect(screen.getByTestId('mpr-panel')).toHaveTextContent('YZ');
    expect(screen.getByTestId('mpr-pane-3d')).toHaveTextContent('3D');
    expect(screen.getByLabelText('3D view')).toHaveValue('orientation');
    expect(screen.getByTestId('mpr-part-selector')).toHaveValue('part-adv-1');
    fireEvent.change(screen.getByTestId('mpr-part-selector'), { target: { value: 'part-adv-2' } });
    expect(screen.getByTestId('mpr-part-selector')).toHaveValue('part-adv-2');
    expect(screen.getByTestId('mpr-pane-coronal')).toHaveTextContent('No volume stack images');
    fireEvent.change(screen.getByTestId('mpr-part-selector'), { target: { value: 'part-adv-1' } });
    expect(screen.getByTestId('mpr-part-selector')).toHaveValue('part-adv-1');
    expect(screen.queryByRole('img', { name: /Volume reconstruction slice/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/axial/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/coronal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sagittal/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('3D view'), { target: { value: 'stack' } });
    expect(screen.getAllByRole('img', { name: /Volume reconstruction slice/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: /Volume reconstruction slice/ })[0]).toHaveAttribute('draggable', 'false');

    const coronalPreview = screen.getByTestId('mpr-preview-coronal');
    const initialCoronalCrosshairY = coronalPreview.style.getPropertyValue('--crosshair-y');
    expect(coronalPreview.style.getPropertyValue('--crosshair-h-color')).toBe('#3b82f6');
    expect(coronalPreview.style.getPropertyValue('--crosshair-v-color')).toBe('#10b981');
    fireEvent.wheel(screen.getByTestId('mpr-pane-axial'), { deltaY: 80 });
    expect(coronalPreview.style.getPropertyValue('--crosshair-y')).not.toBe(initialCoronalCrosshairY);

    const axialPreview = screen.getByTestId('mpr-preview-axial');
    const sagittalPreview = screen.getByTestId('mpr-preview-sagittal');
    const initialAxialCrosshairY = axialPreview.style.getPropertyValue('--crosshair-y');
    const initialSagittalCrosshairX = sagittalPreview.style.getPropertyValue('--crosshair-x');
    fireEvent.click(screen.getByLabelText('Mirror', { selector: '#mpr-mirror-coronal' }));
    expect(axialPreview.style.getPropertyValue('--projection-scale-y')).toBe('-1');
    expect(axialPreview.style.getPropertyValue('--crosshair-y')).not.toBe(initialAxialCrosshairY);
    expect(sagittalPreview.style.getPropertyValue('--projection-scale-x')).toBe('-1');
    expect(sagittalPreview.style.getPropertyValue('--crosshair-x')).not.toBe(initialSagittalCrosshairX);
    expect(coronalPreview.style.getPropertyValue('--projection-scale-x')).toBe('1');
    expect(coronalPreview.style.getPropertyValue('--projection-scale-y')).toBe('1');

    expect(screen.getByTestId('mpr-pane-coronal')).toHaveTextContent('Y 8 / 95');
    fireEvent.wheel(screen.getByTestId('mpr-pane-coronal'), { deltaY: 80 });
    expect(screen.getByTestId('mpr-pane-coronal')).toHaveTextContent('Y 9 / 95');

    expect(screen.getByTestId('mpr-pane-3d')).toHaveTextContent('Zoom 1.30x');
    fireEvent.wheel(screen.getByTestId('mpr-pane-3d'), { deltaY: -80 });
    expect(screen.getByTestId('mpr-pane-3d')).toHaveTextContent('Zoom 1.42x');
    expect(document.querySelector('.mpr-grid')).toHaveClass('mpr-grid-four');

    const minSlider = screen.getByLabelText('Display window minimum');
    const maxSlider = screen.getByLabelText('Display window maximum');
    fireEvent.change(minSlider, { target: { value: '30' } });
    fireEvent.change(maxSlider, { target: { value: '180' } });
    expect(screen.getByTestId('mpr-panel')).toHaveTextContent('30-180');
    expect(screen.getAllByTestId('mpr-preview-axial')[0].querySelector('.mpr-slice-canvas')).toHaveAttribute('data-display-window', '30-180');
    expect(screen.getAllByTestId('mpr-preview-axial')[0].querySelector('.mpr-slice-canvas')).toHaveAttribute('data-display-domain', '0-65535');
    expect(screen.getByLabelText('Display window maximum handle')).toHaveAttribute('max', '65535');

    fireEvent.change(screen.getByLabelText('Display window minimum'), { target: { value: '4096' } });
    expect(screen.getByLabelText('Display window minimum handle')).toHaveValue('4096');
    fireEvent.change(screen.getByLabelText('Display window maximum handle'), { target: { value: '32768' } });
    expect(screen.getByLabelText('Display window maximum')).toHaveValue(32768);

    fireEvent.click(screen.getByTestId('mpr-pane-axial'));
    const zoomLayer = document.querySelector('.inspection-fullscreen-image-zoom-layer');
    expect(zoomLayer).toHaveStyle({ transform: 'translate(0px, 0px) scale(1)' });
    expect(document.querySelector('.mpr-grid')).toHaveClass('mpr-grid-four');

    fireEvent.click(screen.getByRole('button', { name: 'Part Selection' }));
    expect(screen.getByRole('heading', { name: 'Part Selection' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close Part Selection' })).toBeInTheDocument();
  });

  test('opens PT3 segmentation helpers with editable segments and slice drawing tools', async () => {
    mockWorkbenchFetch(scenarioByUser[2]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await waitFor(() => expect(screen.getByTestId('mpr-panel')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Segmentation Helpers' }));
    expect(screen.getByRole('dialog', { name: 'Segmentation Helpers' })).toBeInTheDocument();
    expect(screen.getByTestId('segmentation-segment-list')).toHaveTextContent('Segment A');
    expect(screen.getByLabelText('View orientation')).toHaveTextContent('XY');
    expect(screen.getByLabelText('View orientation')).toHaveTextContent('XZ');
    expect(screen.getByLabelText('View orientation')).toHaveTextContent('YZ');
    expect(screen.getByLabelText('Slice navigation')).toHaveTextContent('Z');
    expect(screen.getByRole('button', { name: /Connected: Seed a contiguous area/i })).toHaveAttribute('data-tooltip', expect.stringContaining('Connected'));
    expect(screen.getByRole('button', { name: /Level Trace: Trace an equal-intensity contour/i })).toHaveAttribute('data-tooltip', expect.stringContaining('Level Trace'));
    expect(screen.getByRole('button', { name: /Scissors: Mark cut paths/i })).toHaveAttribute('data-tooltip', expect.stringContaining('Scissors'));

    fireEvent.click(screen.getByRole('button', { name: /Edit Segment A/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Void core' } });
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#e11d48' } });
    expect(screen.getByTestId('segmentation-segment-list')).toHaveTextContent('Void core');

    fireEvent.click(screen.getByRole('button', { name: 'Add new segment' }));
    expect(screen.getByTestId('segmentation-segment-list')).toHaveTextContent('Segment B');

    fireEvent.click(screen.getByRole('button', { name: 'XZ' }));
    fireEvent.change(screen.getByLabelText('Y'), { target: { value: '12' } });
    expect(screen.getAllByText('Y 12 / 95').length).toBeGreaterThan(0);

    const stage = screen.getByTestId('segmentation-helper-stage');
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 });
    fireEvent.wheel(stage, { deltaY: 80 });
    expect(screen.getAllByText('Y 13 / 95').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Brush size'), { target: { value: '32' } });
    fireEvent.mouseMove(stage, { clientX: 200, clientY: 120 });
    expect(stage).toHaveClass('show-brush-pointer');
    expect(stage.style.getPropertyValue('--brush-pointer-size')).toBe('32px');

    fireEvent.click(screen.getByRole('button', { name: /Connected/i }));
    const connectedCanvas = stage.querySelector('canvas.mpr-slice-canvas');
    const connectedWidth = 80;
    const connectedHeight = 96;
    const connectedPixels = new Uint8ClampedArray(connectedWidth * connectedHeight * 4);
    for (let index = 0; index < connectedWidth * connectedHeight; index += 1) {
      const offset = index * 4;
      connectedPixels[offset] = 255;
      connectedPixels[offset + 1] = 255;
      connectedPixels[offset + 2] = 255;
      connectedPixels[offset + 3] = 255;
    }
    for (let y = 20; y < 36; y += 1) {
      for (let x = 20; x < 44; x += 1) {
        const offset = (y * connectedWidth + x) * 4;
        connectedPixels[offset] = 0;
        connectedPixels[offset + 1] = 0;
        connectedPixels[offset + 2] = 0;
        connectedPixels[offset + 3] = 255;
      }
    }
    connectedCanvas.width = connectedWidth;
    connectedCanvas.height = connectedHeight;
    Object.defineProperty(connectedCanvas, 'getContext', {
      configurable: true,
      value: jest.fn(() => ({
        getImageData: jest.fn(() => ({ width: connectedWidth, height: connectedHeight, data: connectedPixels })),
      })),
    });
    fireEvent.mouseDown(stage, { clientX: 120, clientY: 90, button: 0 });
    expect(stage.querySelector('.segmentation-helper-point')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Segmentation helper overlay').querySelector('ellipse')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add selection' }));
    expect(screen.getByTestId('segmentation-segment-list')).toHaveTextContent('1 areas');

    fireEvent.click(screen.getByRole('button', { name: /Polygon/i }));
    fireEvent.mouseDown(stage, { clientX: 80, clientY: 70, button: 0 });
    fireEvent.mouseDown(stage, { clientX: 180, clientY: 80, button: 0 });
    fireEvent.mouseDown(stage, { clientX: 140, clientY: 160, button: 0 });
    expect(stage.querySelectorAll('.segmentation-helper-point').length).toBeGreaterThanOrEqual(3);
    fireEvent.doubleClick(stage, { clientX: 140, clientY: 160, button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Subtract selection' }));
    expect(screen.getByTestId('segmentation-segment-list')).toHaveTextContent('2 areas');

    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = jest.fn(() => 'data:image/png;base64,c2xpY2U=');
    fireEvent.click(screen.getByRole('button', { name: /ML Helper/i }));
    expect(screen.getByLabelText('ML helper options')).toHaveTextContent('OpenCV');
    fireEvent.change(screen.getByLabelText('Method family'), { target: { value: 'sam' } });
    expect(screen.getByLabelText('Segment function')).toHaveValue('ml.sam.segment_anything');
    fireEvent.change(screen.getByLabelText('Variant'), { target: { value: 'sam_vit_b' } });
    const beforeMlCalls = global.fetch.mock.calls.filter((call) => call[0].includes('/slice-segmentation')).length;
    fireEvent.mouseDown(stage, { clientX: 220, clientY: 110, button: 0 });
    await waitFor(() => expect(screen.getByText(/Selected ML region 2/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Add selection' }));
    expect(screen.getByTestId('segmentation-segment-list')).toHaveTextContent('3 areas');
    const afterFirstMlCalls = global.fetch.mock.calls.filter((call) => call[0].includes('/slice-segmentation')).length;
    expect(afterFirstMlCalls).toBe(beforeMlCalls + 1);
    const mlPayload = JSON.parse(global.fetch.mock.calls.find((call) => call[0].includes('/slice-segmentation'))[1].body);
    expect(mlPayload.method_id).toBe('ml.sam.segment_anything');
    expect(mlPayload.parameters.variant).toBe('sam_vit_b');

    fireEvent.mouseDown(stage, { clientX: 221, clientY: 111, button: 0 });
    expect(global.fetch.mock.calls.filter((call) => call[0].includes('/slice-segmentation')).length).toBe(afterFirstMlCalls);
    HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
  });

  test('connected segmentation helper selects distinct contiguous black and white shapes at default sensitivity', async () => {
    mockWorkbenchFetch(scenarioByUser[2]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await waitFor(() => expect(screen.getByTestId('mpr-panel')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Segmentation Helpers' }));

    const stage = screen.getByTestId('segmentation-helper-stage');
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 480, right: 400, bottom: 480 });
    const canvas = stage.querySelector('canvas.mpr-slice-canvas');
    expect(canvas).toBeInTheDocument();

    const installSlicePixels = ({ background, shape }) => {
      const width = 80;
      const height = 96;
      const data = new Uint8ClampedArray(width * height * 4);
      for (let index = 0; index < width * height; index += 1) {
        const offset = index * 4;
        data[offset] = background;
        data[offset + 1] = background;
        data[offset + 2] = background;
        data[offset + 3] = 255;
      }
      for (let y = shape.y; y < shape.y + shape.height; y += 1) {
        for (let x = shape.x; x < shape.x + shape.width; x += 1) {
          const offset = (y * width + x) * 4;
          data[offset] = shape.value;
          data[offset + 1] = shape.value;
          data[offset + 2] = shape.value;
          data[offset + 3] = 255;
        }
      }
      canvas.width = width;
      canvas.height = height;
      Object.defineProperty(canvas, 'getContext', {
        configurable: true,
        value: jest.fn(() => ({
          getImageData: jest.fn(() => ({ width, height, data })),
        })),
      });
    };

    const assertConnectedShape = (shape) => {
      installSlicePixels(shape);
      fireEvent.click(screen.getByRole('button', { name: /Connected/i }));
      fireEvent.mouseDown(stage, {
        clientX: ((shape.shape.x + Math.floor(shape.shape.width / 2)) / 80) * 400,
        clientY: ((shape.shape.y + Math.floor(shape.shape.height / 2)) / 96) * 480,
        button: 0,
      });
      const path = screen.getByLabelText('Segmentation helper overlay').querySelector('.segmentation-helper-shape.preview');
      expect(path).toBeInTheDocument();
      const pathData = path.getAttribute('d');
      expect(pathData).toContain(`M ${shape.shape.x} ${shape.shape.y} h ${shape.shape.width}`);
      expect((pathData.match(new RegExp(`h ${shape.shape.width}`, 'g')) || []).length).toBe(shape.shape.height);
      expect(pathData).not.toContain('h 80');
      expect(stage.querySelector('.segmentation-helper-point')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Add selection' }));
    };

    assertConnectedShape({
      background: 255,
      shape: { x: 18, y: 24, width: 20, height: 16, value: 0 },
    });
    expect(screen.getByTestId('segmentation-segment-list')).toHaveTextContent('1 areas');

    assertConnectedShape({
      background: 0,
      shape: { x: 42, y: 50, width: 14, height: 18, value: 255 },
    });
    expect(screen.getByTestId('segmentation-segment-list')).toHaveTextContent('2 areas');
  });

  test('renders a fast visual shell fallback for PT3 parts without volume metadata', async () => {
    mockWorkbenchFetch(scenarioByUser[0]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await waitFor(() => {
      expect(screen.getByTestId('mpr-panel')).toBeInTheDocument();
    });

    expect(screen.queryByRole('img', { name: /Volume reconstruction slice/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /fallback projection from front view/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('img', { name: /Fallback visual hull shell front view/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('3D view'), { target: { value: 'shell' } });
    expect(screen.getByRole('img', { name: /Fallback visual hull shell front view/i })).toBeInTheDocument();
    expect(screen.queryByText('No stack')).not.toBeInTheDocument();
  });

});
