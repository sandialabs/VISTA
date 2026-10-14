import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import InspectionWorkbenchPanel, {
  applyInspectionImageDisplayOrder,
  createServerVolumeDescriptor,
  getInspectionImageOrderKey,
  getCanonicalSegmentationSliceIndex,
  getAnnotationOpacityMultiplier,
  getMprFallbackModelZoom,
  getMprVolumeCacheKey,
  getMprSliceCachingMessage,
  projectMprPointToOverlay,
  normalizeAnnotationTransparencyPercent,
  shouldApplyDisplayWindowToVolumeCache,
  sortInspectionImageDisplayEntries,
} from '../InspectionWorkbenchPanel';
import ImagesToPartsTab from '../ImagesToPartsTab';
import * as pt3SliceLocator from '../pt3SliceLocator';
import * as pt3ThreeRenderer from '../pt3ThreeRenderer';
import * as pt3VectorAnnotations from '../pt3VectorAnnotations';

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

function makeImageOrderScenario() {
  return {
    user: 'image-order',
    hotkeys: {
      accept_classification: 'a',
      reject_classification: 'r',
      toggle_shortcut_help: 'h',
    },
    workspaceState: {
      selected_batch_id: 'batch-image-order',
      selected_part_id: 'part-image-order',
      inspector: {
        image_enabled: true,
        modalities: ['visual'],
        view_name: 'front',
      },
    },
    batches: [{ id: 'batch-image-order', name: 'Batch Image Order' }],
    parts: [
      {
        id: 'part-image-order',
        batch_id: 'batch-image-order',
        serial_number: 'SN-IMAGE-ORDER',
        display_name: 'Image Order Part',
        review_state: 'in_review',
        metadata: {
          configured_views: ['front', 'back'],
          modalities: ['visual'],
          view_images: {
            front: 'order-front.png',
            back: 'order-back.png',
          },
          source_images: [
            {
              filename: 'order-front.png',
              image_id: 'order-front-id',
              side: 'front',
              modality: 'visual',
            },
            {
              filename: 'order-back.png',
              image_id: 'order-back-id',
              side: 'back',
              modality: 'visual',
            },
          ],
          analysis_outputs: [
            {
              filename: 'order-overlay.png',
              image_id: 'order-overlay-id',
              label: 'Porosity overlay',
              analysis_output: true,
              overlay: true,
            },
          ],
        },
      },
    ],
    projectImages: [
      { id: 'order-front-id', filename: 'order-front.png', metadata: { camera: 'alpha', layer: '2' } },
      { id: 'order-back-id', filename: 'order-back.png', metadata: { camera: 'alpha', layer: '1' } },
      { id: 'order-overlay-id', filename: 'order-overlay.png', metadata: { camera: 'beta', layer: '1' } },
    ],
  };
}

function makePt3ScenarioWithMetadata(metadataPatch = {}) {
  const scenario = scenarioByUser[2];
  return {
    ...scenario,
    workspaceState: { ...scenario.workspaceState, selected_part_id: 'part-adv-1' },
    batches: scenario.batches.map((batch) => ({ ...batch })),
    parts: scenario.parts.map((part) => ({
      ...part,
      metadata: part.id === 'part-adv-1'
        ? { ...part.metadata, ...metadataPatch }
        : { ...part.metadata },
    })),
  };
}

function makeVistaSegmentAnnotation(overrides = {}) {
  return {
    id: 'vista-segment-1',
    annotation_kind: 'vista_segment',
    defect_class: 'Internal pore',
    modality: 'volume',
    comment: 'Persisted helper segment',
    disposition: 'open',
    hidden: false,
    geometry: {
      segment: {
        version: 1,
        axis: 'axial',
        min_slice: 3,
        max_slice: 9,
        image_width: 80,
        image_height: 96,
        areas: [],
      },
    },
    metadata: {
      annotation_color: '#22d3ee',
      annotation_fill_opacity: 0.24,
    },
    created_by: 'segmenter@example.com',
    created_at: '2026-04-01T09:15:00Z',
    ...overrides,
  };
}

function makePersistedMprGeometryAnnotations() {
  return [
    {
      id: 'persisted-mpr-line',
      image_id: 'pt3-z-016',
      annotation_kind: 'measurement',
      defect_class: 'Measurement',
      modality: 'volume',
      comment: 'Axial persisted line',
      disposition: 'open',
      hidden: false,
      geometry: {
        axis: 'axial',
        slice_index: 11,
        line: {
          x1: 10,
          y1: 12,
          x2: 30,
          y2: 32,
          imageWidth: 80,
          imageHeight: 96,
          axis: 'axial',
          slice_index: 11,
        },
      },
      measurements: { length_px: 28.28, length_mm: 1.41 },
      metadata: { measurement_color: '#3b82f6', annotation_color: '#3b82f6' },
      created_by: 'inspector@example.com',
      created_at: '2026-04-01T09:15:00Z',
    },
    {
      id: 'persisted-mpr-box',
      image_id: 'pt3-z-032',
      annotation_kind: 'annotation',
      defect_class: 'Bounding Box',
      modality: 'volume',
      comment: 'Axial persisted box',
      disposition: 'open',
      hidden: false,
      geometry: {
        axis: 'axial',
        slice_index: 11,
        imageWidth: 80,
        imageHeight: 96,
        box: {
          x: 40,
          y: 20,
          width: 20,
          height: 25,
          imageWidth: 80,
          imageHeight: 96,
          axis: 'axial',
          slice_index: 11,
        },
      },
      bbox: { x: 40, y: 20, width: 20, height: 25 },
      measurements: { width_px: 20, height_px: 25 },
      metadata: { annotation_color: '#f59e0b', annotation_fill_opacity: 0.2 },
      created_by: 'inspector@example.com',
      created_at: '2026-04-01T09:16:00Z',
    },
  ];
}

function fireCoordinatePointerEvent(target, type, init = {}) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperties(event, {
    pointerId: { configurable: true, value: init.pointerId ?? 1 },
    pointerType: { configurable: true, value: init.pointerType || 'mouse' },
    isPrimary: { configurable: true, value: init.isPrimary !== false },
  });
  return fireEvent(target, event);
}

const defaultCalibration = { pixels_per_mm: 20, pixels_per_inch: 508, unit: 'mm' };

function mockWorkbenchFetch({
  user,
  batches,
  parts,
  workspaceState = {},
  hotkeys,
  metadataDict = { calibration_default: defaultCalibration },
  projectImages = null,
  projectConfiguration = {},
  volumeMetadataById = {},
}) {
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
      return Promise.resolve({
        ok: true,
        json: async () => ({
          schema_version: 3,
          project: {
            id: 'proj-1',
            name: 'Inspection workbench project',
            project_type: 'PT1',
            meta_group_id: 'inspection-test-group',
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
    }
    if (url.includes('/report-pdf')) {
      return Promise.resolve({
        ok: true,
        headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/pdf' : null) },
        blob: async () => new Blob(['%PDF-1.4 synthetic']),
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
    if (url.includes('/volume-metadata') && (!options.method || options.method === 'GET')) {
      const imageId = decodeURIComponent(url.split('/images/')[1].split('/')[0]);
      const configured = volumeMetadataById[imageId];
      if (configured === false) return Promise.resolve({ ok: false, status: 500 });
      if (configured) return Promise.resolve({ ok: true, json: async () => configured });
      const projectRecord = (Array.isArray(projectImages) ? projectImages : [])
        .find((image) => String(image.id) === imageId);
      const sourceRecord = mutableParts
        .flatMap((part) => (Array.isArray(part?.metadata?.source_images) ? part.metadata.source_images : []))
        .find((record) => String(record.image_id || '') === imageId);
      const metadata = projectRecord?.metadata || sourceRecord?.metadata || sourceRecord || {};
      const dimensions = metadata.volume_shape || sourceRecord?.volume_shape;
      if (!dimensions) return Promise.resolve({ ok: false, status: 404 });
      const channelCount = Number(metadata.channel_count || sourceRecord?.channel_count || 1);
      const colorMode = metadata.color_mode || sourceRecord?.color_mode || 'scalar';
      return Promise.resolve({
        ok: true,
        json: async () => ({
          dimensions,
          channel_count: channelCount,
          color_mode: colorMode,
          pixel_dtype: metadata.pixel_dtype || metadata.voxel_dtype || 'uint8',
          voxel_dtype: metadata.voxel_dtype || metadata.pixel_dtype || 'uint8',
          bit_depth: metadata.bit_depth || 8,
        }),
      });
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
            ...projectConfiguration,
            ui_sections: {
              'inspection.part_summary.views_row': true,
              ...(projectConfiguration.ui_sections || {}),
            },
            process_settings: {
              ...(projectConfiguration.process_settings || {}),
              configurable_hotkeys: hotkeys
                || projectConfiguration.process_settings?.configurable_hotkeys
                || {
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
    if (url.includes('/image-display-order') && options.method === 'PUT') {
      const segments = url.split('/');
      const partId = segments[segments.indexOf('parts') + 1];
      const payload = JSON.parse(options.body || '{}');
      mutableParts = mutableParts.map((part) => (
        String(part.id) === String(partId)
          ? {
            ...part,
            metadata: {
              ...(part.metadata || {}),
              image_display_order: [...(payload.image_refs || [])],
            },
          }
          : part
      ));
      return Promise.resolve({
        ok: true,
        json: async () => mutableParts.find((part) => String(part.id) === String(partId)),
      });
    }
    if (url.includes('/parts/') && url.includes('/source-images/') && options.method === 'PATCH') {
      const segments = url.split('/');
      const partId = segments[segments.indexOf('parts') + 1];
      const imageKey = decodeURIComponent(segments[segments.length - 1]);
      const payload = JSON.parse(options.body || '{}');
      mutableParts = mutableParts.map((part) => {
        if (String(part.id) !== String(partId)) return part;
        const sourceImages = Array.isArray(part.metadata?.source_images) ? part.metadata.source_images : [];
        return {
          ...part,
          metadata: {
            ...(part.metadata || {}),
            source_images: sourceImages.map((record) => (
              String(record.image_id || record.filename || '') === imageKey
                ? { ...record, ...payload }
                : record
            )),
          },
        };
      });
      return Promise.resolve({
        ok: true,
        json: async () => mutableParts.find((part) => String(part.id) === String(partId)),
      });
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
          method_id: payload.method_id || 'segmentation.opencv.placeholder',
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
    if (url.includes('/volume-splat-assets/status') && (!options.method || options.method === 'GET')) {
      const segments = url.split('/');
      const partId = segments[segments.indexOf('parts') + 1] || mutableParts[0]?.id || 'part';
      return Promise.resolve({
        ok: true,
        json: async () => ({
          status: 'missing',
          part_id: partId,
          volume_stack_id: null,
          asset_url: null,
          cache_key: null,
          output_format: null,
          splat_count: null,
          error: null,
          metadata: {},
        }),
      });
    }
    if (url.includes('/volume-splat-assets') && options.method === 'POST') {
      const segments = url.split('/');
      const partId = segments[segments.indexOf('parts') + 1] || mutableParts[0]?.id || 'part';
      const payload = JSON.parse(options.body || '{}');
      return Promise.resolve({
        ok: true,
        json: async () => ({
          status: 'pending',
          part_id: partId,
          volume_stack_id: payload.volume_stack_id || null,
          asset_url: null,
          cache_key: null,
          output_format: payload.output_format || 'json',
          splat_count: null,
          error: null,
          metadata: { conversion_parameters: payload },
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
    if (url.includes('/images-page?')) {
      const imageRecords = Array.isArray(projectImages) ? projectImages : mutableParts.flatMap((part) => {
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
        const analysisRecords = Array.isArray(part?.metadata?.analysis_outputs)
          ? part.metadata.analysis_outputs.map((record, index) => ({
            id: record.image_id || `${part.id}-analysis-${index + 1}`,
            filename: record.filename,
            metadata: {
              part_id: part.id,
              serial_number: part.serial_number,
              ...record,
            },
          }))
          : [];
        return [...viewRecords, ...sourceRecords, ...analysisRecords];
      });
      const allImages = [...imageRecords, ...uploadedImages];
      const parsedUrl = new URL(url, 'http://vista.test');
      const offset = Number(parsedUrl.searchParams.get('cursor') || 0);
      const limit = Number(parsedUrl.searchParams.get('limit') || 500);
      const items = allImages.slice(offset, offset + limit);
      const nextOffset = offset + items.length;
      return Promise.resolve({
        ok: true,
        json: async () => ({
          items,
          total: allImages.length,
          next_cursor: nextOffset < allImages.length ? String(nextOffset) : null,
          has_more: nextOffset < allImages.length,
        }),
      });
    }
    if (url.includes('/parts')) {
      return Promise.resolve({ ok: true, json: async () => mutableParts });
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
  const getImageOrderSaveCalls = () => global.fetch.mock.calls.filter(([url, options = {}]) => (
    url.includes('/image-display-order') && options.method === 'PUT'
  ));

  const getViewTileLabels = () => Array.from(document.querySelectorAll('.view-cell-title-text > span'))
    .map((element) => element.textContent);

  const openSortMenu = async () => {
    const sortButton = await screen.findByRole('button', { name: 'Sort images' });
    fireEvent.click(sortButton);
    return {
      sortButton,
      menu: screen.getByRole('dialog', { name: 'Image sorting options' }),
    };
  };

  const saveSortAndGetPayload = async (optionName = 'View A-Z') => {
    const { menu } = await openSortMenu();
    const option = within(menu).getByRole('option', { name: optionName });
    fireEvent.change(within(menu).getByRole('combobox', { name: 'Primary image sort' }), {
      target: { value: option.getAttribute('value') },
    });
    fireEvent.click(within(menu).getByRole('button', { name: 'Apply sort' }));
    await waitFor(() => {
      expect(getImageOrderSaveCalls().length).toBeGreaterThan(0);
    });
    return JSON.parse(getImageOrderSaveCalls().at(-1)[1].body);
  };

  test('applies canonical image order keys stably and sorts common options', () => {
    const entries = [
      { imageId: 'front-id', filename: 'front-10.png', imageRef: 'front.png', label: 'FRONT', viewName: 'front' },
      { imageId: 'back-id', filename: 'back-2.png', imageRef: 'back-id', label: 'BACK', viewName: 'back' },
      { filename: 'legacy.png', imageRef: 'legacy.png', label: 'Legacy overlay', viewName: 'overlay', overlay: true },
      { imageId: 'crop-id', filename: 'crop-1.png', imageRef: 'crop-id', label: 'Crop', viewName: 'crop', cropChild: true },
    ];

    expect(entries.map(getInspectionImageOrderKey)).toEqual([
      'front-id',
      'back-id',
      'legacy.png',
      'crop-id',
    ]);
    expect(
      applyInspectionImageDisplayOrder(entries, ['legacy.png', 'front.png'])
        .map(getInspectionImageOrderKey),
    ).toEqual(['legacy.png', 'front-id', 'back-id', 'crop-id']);
    expect(
      sortInspectionImageDisplayEntries(entries, 'filename_asc')
        .map(getInspectionImageOrderKey),
    ).toEqual(['back-id', 'crop-id', 'front-id', 'legacy.png']);
    expect(
      sortInspectionImageDisplayEntries(entries, 'filename_desc')
        .map(getInspectionImageOrderKey),
    ).toEqual(['legacy.png', 'front-id', 'crop-id', 'back-id']);
    expect(
      sortInspectionImageDisplayEntries(entries, 'type_asc')
        .map(getInspectionImageOrderKey),
    ).toEqual(['back-id', 'front-id', 'legacy.png', 'crop-id']);
    expect(
      sortInspectionImageDisplayEntries(entries, ['view_asc', 'filename_desc'])
        .map(getInspectionImageOrderKey),
    ).toEqual(['back-id', 'crop-id', 'front-id', 'legacy.png']);
  });

  test('sorts by image metadata keys hierarchically', () => {
    const entries = [
      { imageId: 'a-id', filename: 'a.png', imageRef: 'a.png', metadata: { batch: 'B', layer: '2' } },
      { imageId: 'b-id', filename: 'b.png', imageRef: 'b.png', metadata: { batch: 'A', layer: '2' } },
      { imageId: 'c-id', filename: 'c.png', imageRef: 'c.png', metadata: { batch: 'A', layer: '10' } },
      { imageId: 'd-id', filename: 'd.png', imageRef: 'd.png', metadata: { batch: 'B', layer: '1' } },
    ];

    expect(
      sortInspectionImageDisplayEntries(entries, ['metadata:batch', 'metadata:layer'])
        .map(getInspectionImageOrderKey),
    ).toEqual(['b-id', 'c-id', 'd-id', 'a-id']);
  });

  test('saves a selected sort order for the full mapped image list', async () => {
    mockWorkbenchFetch(makeImageOrderScenario());
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    const { sortButton, menu } = await openSortMenu();
    expect(sortButton).toHaveAttribute('aria-expanded', 'true');
    const primarySort = within(menu).getByRole('combobox', { name: 'Primary image sort' });
    expect(within(primarySort).getAllByRole('option').map((item) => item.textContent)).toEqual(expect.arrayContaining([
      'Filename A-Z',
      'Filename Z-A',
      'View A-Z',
      'Image type',
      'Metadata: camera',
      'Metadata: filename',
    ]));
    expect(within(menu).getByRole('button', { name: 'Add image sort layer' })).toBeInTheDocument();
    expect(within(menu).queryByRole('button', { name: 'Remove deepest image sort layer' })).not.toBeInTheDocument();

    fireEvent.change(primarySort, { target: { value: 'filename_desc' } });
    fireEvent.click(within(menu).getByRole('button', { name: 'Apply sort' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Image sorting options' })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sort images' })).toHaveFocus();
    });
    const saveCalls = getImageOrderSaveCalls();
    expect(saveCalls).toHaveLength(1);
    expect(JSON.parse(saveCalls[0][1].body)).toEqual({
      image_refs: ['order-overlay-id', 'order-front-id', 'order-back-id'],
    });
    await waitFor(() => {
      expect(getViewTileLabels()[0]).toBe('order-overlay.png');
    });
  });

  test('sorts View All Images locally without saving a part image order', async () => {
    mockWorkbenchFetch({
      user: 'all-images-sort',
      batches: [{ id: 'batch-a', name: 'Batch A' }],
      workspaceState: { selected_part_id: 'part-sort-a' },
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
      parts: ['a', 'b'].map((suffix) => ({
        id: `part-sort-${suffix}`,
        batch_id: 'batch-a',
        serial_number: `SN-SORT-${suffix.toUpperCase()}`,
        display_name: `Sort Part ${suffix.toUpperCase()}`,
        review_state: 'unreviewed',
        metadata: {
          source_images: [{ filename: `sort-${suffix}-front.png`, image_id: `sort-${suffix}-front-id`, side: 'front', modality: 'visual' }],
        },
      })),
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);
    const viewAllImagesTab = await screen.findByRole('tab', { name: 'View All Images' });
    fireEvent.click(viewAllImagesTab);
    await waitFor(() => expect(viewAllImagesTab).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(getViewTileLabels()).toEqual(['sort-a-front.png', 'sort-b-front.png']));

    const { menu } = await openSortMenu();
    fireEvent.change(within(menu).getByRole('combobox', { name: 'Primary image sort' }), { target: { value: 'filename_desc' } });
    fireEvent.click(within(menu).getByRole('button', { name: 'Apply sort' }));

    await waitFor(() => expect(getViewTileLabels()).toEqual(['sort-b-front.png', 'sort-a-front.png']));
    expect(screen.getByText('Images sorted by Filename Z-A.')).toBeInTheDocument();
    expect(getImageOrderSaveCalls()).toHaveLength(0);
  });

  test('adds and removes hierarchical metadata sort layers from the sort selector', async () => {
    mockWorkbenchFetch(makeImageOrderScenario());
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    const { menu } = await openSortMenu();
    const primarySort = within(menu).getByRole('combobox', { name: 'Primary image sort' });
    fireEvent.change(primarySort, { target: { value: 'metadata:camera' } });
    fireEvent.click(within(menu).getByRole('button', { name: 'Add image sort layer' }));

    const secondarySort = within(menu).getByRole('combobox', { name: 'Image sort layer 2' });
    expect(within(menu).getByRole('button', { name: 'Remove deepest image sort layer' })).toBeInTheDocument();
    fireEvent.change(secondarySort, { target: { value: 'metadata:layer' } });
    fireEvent.click(within(menu).getByRole('button', { name: 'Apply sort' }));

    await waitFor(() => {
      expect(getImageOrderSaveCalls()).toHaveLength(1);
    });
    expect(JSON.parse(getImageOrderSaveCalls()[0][1].body)).toEqual({
      image_refs: ['order-back-id', 'order-front-id', 'order-overlay-id'],
    });
    await waitFor(() => {
      expect(getViewTileLabels()).toEqual(['order-back.png', 'order-front.png', 'order-overlay.png']);
    });

    const { menu: secondMenu } = await openSortMenu();
    fireEvent.click(within(secondMenu).getByRole('button', { name: 'Remove deepest image sort layer' }));
    expect(within(secondMenu).queryByRole('combobox', { name: 'Image sort layer 2' })).not.toBeInTheDocument();
    expect(within(secondMenu).queryByRole('button', { name: 'Remove deepest image sort layer' })).not.toBeInTheDocument();
  });

  test('closes the sort menu without saving when dismissed', async () => {
    mockWorkbenchFetch(makeImageOrderScenario());
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    const { sortButton } = await openSortMenu();
    expect(screen.getByRole('dialog', { name: 'Image sorting options' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Image sorting options' })).not.toBeInTheDocument();
    expect(sortButton).toHaveFocus();
    expect(getViewTileLabels()[0]).toBe('order-front.png');
    expect(getImageOrderSaveCalls()).toHaveLength(0);
  });

  test('does not expose image sorting in read-only inspection', async () => {
    mockWorkbenchFetch(makeImageOrderScenario());
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" readOnly />);

    await screen.findByAltText('front view');
    expect(screen.queryByRole('button', { name: 'Sort images' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Image sorting options' })).not.toBeInTheDocument();
  });

  test('shows a local error when saving a sort option fails', async () => {
    mockWorkbenchFetch(makeImageOrderScenario());
    const defaultFetch = global.fetch;
    global.fetch = jest.fn((url, options = {}) => {
      if (url.includes('/image-display-order') && options.method === 'PUT') {
        return Promise.resolve({ ok: false, status: 503 });
      }
      return defaultFetch(url, options);
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    const { menu } = await openSortMenu();
    fireEvent.change(within(menu).getByRole('combobox', { name: 'Primary image sort' }), {
      target: { value: 'filename_desc' },
    });
    fireEvent.click(within(menu).getByRole('button', { name: 'Apply sort' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to save image order (503)',
    );
    expect(screen.queryByRole('dialog', { name: 'Image sorting options' })).not.toBeInTheDocument();
    expect(getViewTileLabels()[0]).toBe('order-front.png');
  });

  test('excludes a deleted overlay from the next sort save', async () => {
    mockWorkbenchFetch(makeImageOrderScenario());
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    fireEvent.click(await screen.findByRole('button', {
      name: 'Delete overlay Porosity overlay',
    }));
    await waitFor(() => {
      expect(getViewTileLabels()).not.toContain('order-overlay.png');
    });

    const payload = await saveSortAndGetPayload('Filename A-Z');
    expect(payload).toEqual({
      image_refs: ['order-back-id', 'order-front-id'],
    });
  });

  test('includes a newly mapped image in the next sorted save', async () => {
    const scenario = makeImageOrderScenario();
    scenario.projectImages.push({
      id: 'order-side-id',
      filename: 'order-side.png',
      metadata: {},
    });
    mockWorkbenchFetch(scenario);
    const defaultFetch = global.fetch;
    global.fetch = jest.fn((url, options = {}) => {
      if (
        url.endsWith('/parts/part-image-order')
        && options.method === 'PATCH'
      ) {
        const payload = JSON.parse(options.body || '{}');
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ...scenario.parts[0],
            review_state: payload.review_state,
            metadata: {
              ...scenario.parts[0].metadata,
              source_images: [
                ...scenario.parts[0].metadata.source_images,
                {
                  filename: 'order-side.png',
                  image_id: 'order-side-id',
                  side: 'side',
                  modality: 'visual',
                },
              ],
            },
          }),
        });
      }
      return defaultFetch(url, options);
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await screen.findByRole('button', { name: 'Sort images' });
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    await waitFor(() => {
      expect(getViewTileLabels()).toContain('order-side.png');
    });

    const payload = await saveSortAndGetPayload('Image type');
    expect(payload).toEqual({
      image_refs: [
        'order-back-id',
        'order-front-id',
        'order-side-id',
        'order-overlay-id',
      ],
    });
  });

  test('closes an open sort menu when the part loses sortable image keys', async () => {
    const scenario = makeImageOrderScenario();
    scenario.parts[0].metadata.analysis_outputs = [];
    scenario.projectImages = scenario.projectImages.filter(
      (image) => image.id !== 'order-overlay-id',
    );
    mockWorkbenchFetch(scenario);
    const defaultFetch = global.fetch;
    global.fetch = jest.fn((url, options = {}) => {
      if (
        url.endsWith('/parts/part-image-order')
        && options.method === 'PATCH'
      ) {
        const payload = JSON.parse(options.body || '{}');
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ...scenario.parts[0],
            review_state: payload.review_state,
            metadata: {
              ...scenario.parts[0].metadata,
              configured_views: ['front'],
              view_images: { front: 'order-front.png' },
              source_images: [scenario.parts[0].metadata.source_images[0]],
            },
          }),
        });
      }
      return defaultFetch(url, options);
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await openSortMenu();
    expect(screen.getByRole('dialog', { name: 'Image sorting options' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));

    await waitFor(() => {
      expect(getViewTileLabels()).toEqual(['order-front.png']);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Image sorting options' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Sort images' })).toBeDisabled();
    expect(getImageOrderSaveCalls()).toHaveLength(0);
  });

  test('focuses tile size after an in-flight sort save leaves one image', async () => {
    const scenario = makeImageOrderScenario();
    scenario.parts[0].metadata.analysis_outputs = [];
    scenario.projectImages = scenario.projectImages.filter(
      (image) => image.id !== 'order-overlay-id',
    );
    mockWorkbenchFetch(scenario);
    const defaultFetch = global.fetch;
    let resolveSave;
    global.fetch = jest.fn((url, options = {}) => {
      if (url.includes('/image-display-order') && options.method === 'PUT') {
        const payload = JSON.parse(options.body || '{}');
        return new Promise((resolve) => {
          resolveSave = () => resolve({
            ok: true,
            json: async () => ({
              ...scenario.parts[0],
              metadata: {
                ...scenario.parts[0].metadata,
                image_display_order: payload.image_refs,
              },
            }),
          });
        });
      }
      if (
        url.endsWith('/parts/part-image-order')
        && options.method === 'PATCH'
      ) {
        const payload = JSON.parse(options.body || '{}');
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ...scenario.parts[0],
            review_state: payload.review_state,
            metadata: {
              ...scenario.parts[0].metadata,
              configured_views: ['front'],
              view_images: { front: 'order-front.png' },
              source_images: [scenario.parts[0].metadata.source_images[0]],
            },
          }),
        });
      }
      return defaultFetch(url, options);
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    const { menu } = await openSortMenu();
    fireEvent.change(within(menu).getByRole('combobox', { name: 'Primary image sort' }), {
      target: { value: 'filename_desc' },
    });
    fireEvent.click(within(menu).getByRole('button', { name: 'Apply sort' }));
    await waitFor(() => {
      expect(resolveSave).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    await waitFor(() => {
      expect(getViewTileLabels()).toEqual(['order-front.png']);
    });

    resolveSave();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sort images' })).toBeDisabled();
    });
    expect(screen.getByLabelText('Inspection tile columns')).toHaveFocus();
  });

  test('merges a delayed sort save into fresh same-part metadata and review state', async () => {
    const scenario = makeImageOrderScenario();
    scenario.projectImages.push({
      id: 'concurrent-image-id',
      filename: 'concurrent.png',
      metadata: {},
    });
    mockWorkbenchFetch(scenario);
    const defaultFetch = global.fetch;
    let resolveSave;
    global.fetch = jest.fn((url, options = {}) => {
      if (url.includes('/image-display-order') && options.method === 'PUT') {
        const payload = JSON.parse(options.body || '{}');
        return new Promise((resolve) => {
          resolveSave = () => resolve({
            ok: true,
            json: async () => ({
              ...scenario.parts[0],
              metadata: {
                ...scenario.parts[0].metadata,
                image_display_order: payload.image_refs,
              },
            }),
          });
        });
      }
      if (
        url.endsWith('/parts/part-image-order')
        && options.method === 'PATCH'
      ) {
        const payload = JSON.parse(options.body || '{}');
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ...scenario.parts[0],
            review_state: payload.review_state,
            metadata: {
              ...scenario.parts[0].metadata,
              concurrent_marker: 'preserve-me',
              source_images: [
                ...scenario.parts[0].metadata.source_images,
                {
                  filename: 'concurrent.png',
                  image_id: 'concurrent-image-id',
                  side: 'concurrent',
                  modality: 'visual',
                },
              ],
            },
          }),
        });
      }
      return defaultFetch(url, options);
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    const { menu } = await openSortMenu();
    fireEvent.change(within(menu).getByRole('combobox', { name: 'Primary image sort' }), {
      target: { value: 'filename_desc' },
    });
    fireEvent.click(within(menu).getByRole('button', { name: 'Apply sort' }));
    await waitFor(() => {
      expect(resolveSave).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    await waitFor(() => {
      expect(getViewTileLabels()).toContain('concurrent.png');
    });

    resolveSave();
    await waitFor(() => {
      expect(screen.getByText('Passed: 1')).toBeInTheDocument();
    });
    expect(getViewTileLabels()).toContain('concurrent.png');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sort images' })).toHaveFocus();
    });
  });

  test('applies a successful sort save after switching away from the part in flight', async () => {
    const scenario = makeImageOrderScenario();
    scenario.parts.push({
      id: 'part-image-order-second',
      batch_id: 'batch-image-order',
      serial_number: 'SN-IMAGE-ORDER-2',
      display_name: 'Second Image Order Part',
      review_state: 'in_review',
      metadata: {
        configured_views: ['front', 'back'],
        modalities: ['visual'],
        view_images: {
          front: 'second-front.png',
          back: 'second-back.png',
        },
        source_images: [
          {
            filename: 'second-front.png',
            image_id: 'second-front-id',
            side: 'front',
            modality: 'visual',
          },
          {
            filename: 'second-back.png',
            image_id: 'second-back-id',
            side: 'back',
            modality: 'visual',
          },
        ],
      },
    });
    scenario.projectImages.push(
      { id: 'second-front-id', filename: 'second-front.png', metadata: {} },
      { id: 'second-back-id', filename: 'second-back.png', metadata: {} },
    );
    mockWorkbenchFetch(scenario);
    const defaultFetch = global.fetch;
    let resolveSave;
    global.fetch = jest.fn((url, options = {}) => {
      if (url.includes('/image-display-order') && options.method === 'PUT') {
        const payload = JSON.parse(options.body || '{}');
        return new Promise((resolve) => {
          resolveSave = () => resolve({
            ok: true,
            json: async () => ({
              ...scenario.parts[0],
              metadata: {
                ...scenario.parts[0].metadata,
                image_display_order: payload.image_refs,
              },
            }),
          });
        });
      }
      return defaultFetch(url, options);
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    const { menu } = await openSortMenu();
    fireEvent.change(within(menu).getByRole('combobox', { name: 'Primary image sort' }), {
      target: { value: 'view_asc' },
    });
    fireEvent.click(within(menu).getByRole('button', { name: 'Apply sort' }));
    await waitFor(() => {
      expect(resolveSave).toBeDefined();
    });

    const secondPartRow = document.querySelectorAll('.workbench-part-row')[1];
    secondPartRow.focus();
    fireEvent.click(secondPartRow);
    await waitFor(() => {
      expect(document.querySelector('.view-board .view-cell-title span')).toHaveTextContent('second-front.png');
    });
    resolveSave();
    await waitFor(() => {
      expect(screen.getAllByText('Second Image Order Part').length).toBeGreaterThan(0);
    });
    expect(secondPartRow).toHaveFocus();

    fireEvent.click(document.querySelectorAll('.workbench-part-row')[0]);
    await waitFor(() => {
      expect(document.querySelector('.view-board .view-cell-title span')).toHaveTextContent('order-back.png');
    });
  });

  test('excludes a stale view mapping backed by a deleted source from image sorting', async () => {
    const scenario = makeImageOrderScenario();
    scenario.parts[0].metadata = {
      configured_views: ['front', 'back', 'side'],
      modalities: ['visual'],
      view_images: {
        front: 'deleted.png',
        back: 'alive-back.png',
        overlay: 'deleted-overlay.png',
        legacy: 'view-only-legacy.png',
      },
      source_images: [
        {
          filename: 'deleted.png',
          image_id: 'deleted-id',
          side: 'front',
          modality: 'visual',
          delete_candidate: true,
        },
        {
          filename: 'alive-back.png',
          image_id: 'alive-back-id',
          side: 'back',
          modality: 'visual',
        },
        {
          filename: 'alive-side.png',
          image_id: 'alive-side-id',
          side: 'side',
          modality: 'visual',
        },
      ],
      analysis_outputs: [
        {
          filename: 'deleted-overlay.png',
          image_id: 'deleted-overlay-id',
          analysis_output: true,
          overlay_delete_candidate: true,
        },
      ],
    };
    scenario.projectImages = [
      { id: 'deleted-id', filename: 'deleted.png', metadata: {} },
      { id: 'alive-back-id', filename: 'alive-back.png', metadata: {} },
      { id: 'alive-side-id', filename: 'alive-side.png', metadata: {} },
      { id: 'deleted-overlay-id', filename: 'deleted-overlay.png', metadata: {} },
      { id: 'view-only-legacy-id', filename: 'view-only-legacy.png', metadata: {} },
    ];
    mockWorkbenchFetch(scenario);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await screen.findByRole('button', { name: 'Sort images' });
    expect(getViewTileLabels()).toEqual(['alive-back.png', 'alive-side.png', 'view-only-legacy.png']);

    const payload = await saveSortAndGetPayload('View A-Z');
    expect(payload).toEqual({
      image_refs: ['alive-back-id', 'view-only-legacy.png', 'alive-side-id'],
    });
  });

  test('does not resurrect a deleted view ID from an active image with the same filename', async () => {
    const scenario = makeImageOrderScenario();
    scenario.parts[0].metadata = {
      configured_views: ['front', 'back', 'side'],
      modalities: ['visual'],
      view_images: {
        front: {
          image_id: 'deleted-id',
          filename: 'shared.png',
        },
      },
      source_images: [
        {
          filename: 'shared.png',
          image_id: 'deleted-id',
          side: 'front',
          modality: 'visual',
          delete_candidate: true,
        },
        {
          filename: 'shared.png',
          image_id: 'active-id',
          side: 'back',
          modality: 'visual',
        },
        {
          filename: 'alive-side.png',
          image_id: 'alive-side-id',
          side: 'side',
          modality: 'visual',
        },
      ],
    };
    scenario.projectImages = [
      { id: 'deleted-id', filename: 'shared.png', metadata: {} },
      { id: 'active-id', filename: 'shared.png', metadata: {} },
      { id: 'alive-side-id', filename: 'alive-side.png', metadata: {} },
    ];
    mockWorkbenchFetch(scenario);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await screen.findByRole('button', { name: 'Sort images' });
    expect(getViewTileLabels()).toEqual(['shared.png', 'alive-side.png']);

    const payload = await saveSortAndGetPayload('View A-Z');
    expect(payload).toEqual({
      image_refs: ['active-id', 'alive-side-id'],
    });
  });

  test('does not treat a deleted concrete ID as loaded through an active filename alias', async () => {
    const scenario = makeImageOrderScenario();
    scenario.parts[0].metadata = {
      configured_views: ['front', 'back', 'side'],
      modalities: ['visual'],
      view_images: {
        front: {
          image_id: 'deleted-id',
          filename: 'shared.png',
        },
      },
      source_images: [
        {
          filename: 'shared.png',
          image_id: 'active-id',
          side: 'back',
          modality: 'visual',
        },
        {
          filename: 'alive-side.png',
          image_id: 'alive-side-id',
          side: 'side',
          modality: 'visual',
        },
      ],
    };
    scenario.projectImages = [
      {
        id: 'deleted-id',
        filename: 'shared.png',
        deleted_at: '2026-07-25T12:00:00Z',
        metadata: {},
      },
      { id: 'active-id', filename: 'shared.png', metadata: {} },
      { id: 'alive-side-id', filename: 'alive-side.png', metadata: {} },
    ];
    mockWorkbenchFetch(scenario);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await screen.findByRole('button', { name: 'Sort images' });
    expect(getViewTileLabels()).toEqual(['shared.png', 'alive-side.png']);

    const payload = await saveSortAndGetPayload('View A-Z');
    expect(payload).toEqual({
      image_refs: ['active-id', 'alive-side-id'],
    });
  });

  test('reserves a deleted UUID before an active image with that UUID as its filename', async () => {
    const collidingDeletedId = '8bd25f48-8d17-4b90-a534-e53258dca37f';
    const scenario = makeImageOrderScenario();
    scenario.parts[0].metadata = {
      configured_views: ['front', 'back', 'side'],
      modalities: ['visual'],
      view_images: {
        front: {
          image_id: collidingDeletedId,
          filename: 'deleted-original.png',
        },
      },
      source_images: [
        {
          filename: collidingDeletedId,
          image_id: 'active-filename-collision-id',
          side: 'back',
          modality: 'visual',
          delete_candidate: 'false',
        },
        {
          filename: 'alive-side.png',
          image_id: 'alive-side-id',
          side: 'side',
          modality: 'visual',
        },
      ],
    };
    scenario.projectImages = [
      {
        id: collidingDeletedId,
        filename: 'deleted-original.png',
        deleted_at: '2026-07-25T12:00:00Z',
        metadata: {},
      },
      {
        id: 'active-filename-collision-id',
        filename: collidingDeletedId,
        metadata: {},
      },
      { id: 'alive-side-id', filename: 'alive-side.png', metadata: {} },
    ];
    mockWorkbenchFetch(scenario);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await screen.findByRole('button', { name: 'Sort images' });
    expect(getViewTileLabels()).toEqual([collidingDeletedId, 'alive-side.png']);

    const payload = await saveSortAndGetPayload('View A-Z');
    expect(payload).toEqual({
      image_refs: ['active-filename-collision-id', 'alive-side-id'],
    });
  });

  test('maps UI slice indices into the canonical cache dimensions used for editing', () => {
    const uiDimensions = { sagittal: 160, coronal: 128, axial: 64 };
    const canonicalDimensions = [80, 96, 32];
    expect(getCanonicalSegmentationSliceIndex(
      'coronal',
      64,
      uiDimensions,
      canonicalDimensions,
    )).toBe(48);
    expect(getCanonicalSegmentationSliceIndex(
      'sagittal',
      159,
      uiDimensions,
      canonicalDimensions,
    )).toBe(79);
    expect(getCanonicalSegmentationSliceIndex(
      'axial',
      0,
      uiDimensions,
      canonicalDimensions,
    )).toBe(0);
  });


  test('normalizes annotation transparency and converts it to an opacity multiplier', () => {
    expect(normalizeAnnotationTransparencyPercent(-9)).toBe(0);
    expect(normalizeAnnotationTransparencyPercent(44.6)).toBe(45);
    expect(normalizeAnnotationTransparencyPercent(140)).toBe(100);
    expect(normalizeAnnotationTransparencyPercent('invalid')).toBe(0);
    expect(getAnnotationOpacityMultiplier(0)).toBe(1);
    expect(getAnnotationOpacityMultiplier(25)).toBe(0.75);
    expect(getAnnotationOpacityMultiplier(100)).toBe(0);
  });

  test('formats MPR loading progress while volume slices are expected', () => {
    expect(getMprSliceCachingMessage({ loadedSlices: 1, totalSlices: 3 })).toBe('Caching MPR slices 1/3');
    expect(getMprSliceCachingMessage({ loadedSlices: 0, totalSlices: 0 })).toBe('Caching MPR slices');
  });

  test('projects fallback 3D annotations through the same fixed model, zoom, mirror, and perspective', () => {
    const dimensions = { sagittal: 100, coronal: 100, axial: 100 };
    const rotation = { x: 0, y: 0 };
    const identityMirror = { x: 1, y: 1, z: 1 };
    const compactZoom = getMprFallbackModelZoom(1, false);
    const fullscreenZoom = getMprFallbackModelZoom(1, true);

    expect(compactZoom).toBe(1);
    expect(fullscreenZoom).toBe(3);
    expect(getMprFallbackModelZoom(2, true)).toBe(3.4);

    expect(projectMprPointToOverlay(
      49.5, 49.5, 49.5, dimensions, rotation, compactZoom, 400, 300, identityMirror,
    )).toEqual({ x: 200, y: 150, z: 0 });

    const compactLeft = projectMprPointToOverlay(
      -0.5, 49.5, 49.5, dimensions, rotation, compactZoom, 400, 300, identityMirror,
    );
    const fullscreenLeft = projectMprPointToOverlay(
      -0.5, 49.5, 49.5, dimensions, rotation, fullscreenZoom, 400, 300, identityMirror,
    );
    const mirroredLeft = projectMprPointToOverlay(
      -0.5, 49.5, 49.5, dimensions, rotation, compactZoom, 400, 300, { x: -1, y: 1, z: 1 },
    );
    expect(compactLeft.x).toBeCloseTo(105, 6);
    expect(fullscreenLeft.x).toBeCloseTo(-85, 6);
    expect(mirroredLeft.x).toBeCloseTo(295, 6);

    const frontRight = projectMprPointToOverlay(
      99.5, 49.5, 99.5, dimensions, rotation, compactZoom, 400, 300, identityMirror,
    );
    expect(frontRight.x).toBeCloseTo(302.2663, 3);
  });

  test('hydrates the inspection image lookup across every cursor page', async () => {
    const projectImages = Array.from({ length: 501 }, (_, index) => ({
      id: `image-${index}`,
      filename: `image-${index}.png`,
      metadata: {},
    }));
    mockWorkbenchFetch({
      user: 'pagination',
      batches: [{ id: 'batch-1', name: 'Batch 1' }],
      workspaceState: { selected_batch_id: 'batch-1', selected_part_id: 'part-page' },
      projectImages,
      parts: [{
        id: 'part-page',
        batch_id: 'batch-1',
        serial_number: 'SN-PAGE',
        display_name: 'Paginated Part',
        review_state: 'unreviewed',
        metadata: {
          configured_views: ['front'],
          view_images: { front: 'image-500.png' },
          source_images: [{ filename: 'image-500.png', image_id: 'image-500', side: 'front', modality: 'visual' }],
          annotations: [],
        },
      }],
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    expect(await screen.findByRole('heading', { name: 'Paginated Part' })).toBeInTheDocument();
    const pageCalls = global.fetch.mock.calls.filter(([url]) => String(url).includes('/images-page?'));
    expect(pageCalls).toHaveLength(2);
    expect(new URL(pageCalls[1][0], 'http://vista.test').searchParams.get('cursor')).toBe('500');
  });

  test('aborts the previous project load and ignores its late response after a project switch', async () => {
    let resolveProjectAParts;
    const projectAPartsResponse = new Promise((resolve) => {
      resolveProjectAParts = resolve;
    });
    const response = (payload) => ({ ok: true, json: async () => payload });
    const partFor = (projectId) => ({
      id: `part-${projectId}`,
      batch_id: `batch-${projectId}`,
      serial_number: `SN-${projectId}`,
      display_name: `Part ${projectId.toUpperCase()}`,
      review_state: 'unreviewed',
      metadata: { configured_views: [], source_images: [], annotations: [] },
    });

    global.fetch = jest.fn((url, options = {}) => {
      const requestUrl = String(url);
      const projectId = requestUrl.includes('/project-a/') ? 'project-a' : 'project-b';
      if (options.method === 'PUT') return Promise.resolve(response({ state: {} }));
      if (requestUrl.includes('/batches')) {
        return Promise.resolve(response([{ id: `batch-${projectId}`, name: `Batch ${projectId}` }]));
      }
      if (requestUrl.includes('/parts')) {
        if (projectId === 'project-a') return projectAPartsResponse;
        return Promise.resolve(response([partFor(projectId)]));
      }
      if (requestUrl.includes('/workspace-state')) {
        return Promise.resolve(response({
          state: {
            selected_batch_id: `batch-${projectId}`,
            selected_part_id: `part-${projectId}`,
          },
        }));
      }
      if (requestUrl.includes('/configuration')) return Promise.resolve(response({ config: {} }));
      if (requestUrl.includes('/metadata-dict')) return Promise.resolve(response({}));
      if (requestUrl.includes('/images-page?')) {
        return Promise.resolve(response({ items: [], total: 0, next_cursor: null, has_more: false }));
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    const { rerender } = render(
      <InspectionWorkbenchPanel projectId="project-a" projectType="PT1" />,
    );
    await waitFor(() => {
      expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('/project-a/'))).toHaveLength(6);
    });
    const projectASignals = new Set(
      global.fetch.mock.calls
        .filter(([url]) => String(url).includes('/project-a/'))
        .map(([, options]) => options?.signal),
    );
    expect(projectASignals.size).toBe(1);
    const [projectASignal] = projectASignals;
    expect(projectASignal).toBeTruthy();
    expect(projectASignal.aborted).toBe(false);

    rerender(<InspectionWorkbenchPanel projectId="project-b" projectType="PT1" />);
    expect(projectASignal.aborted).toBe(true);
    expect(await screen.findByRole('heading', { name: 'Part PROJECT-B' })).toBeInTheDocument();

    resolveProjectAParts(response([partFor('project-a')]));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Part PROJECT-B' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Part PROJECT-A' })).not.toBeInTheDocument();
    });
  });

  test('does not reapply stale launch filters after a PT1 user selects another part', async () => {
    const parts = [
      {
        id: 'part-overlay-1',
        batch_id: 'batch-1',
        serial_number: 'SN-OVERLAY-001',
        display_name: 'Overlay Part 1',
        review_state: 'unreviewed',
        metadata: {
          configured_views: ['front'],
          modalities: ['visual'],
          view_images: { front: 'overlay-part-1.png' },
          source_images: [{ filename: 'overlay-part-1.png', image_id: 'img-overlay-1', side: 'front', modality: 'visual', overlay: false }],
          annotations: [],
        },
      },
      {
        id: 'part-overlay-2',
        batch_id: 'batch-1',
        serial_number: 'SN-OVERLAY-002',
        display_name: 'Overlay Part 2',
        review_state: 'unreviewed',
        metadata: {
          configured_views: ['front'],
          modalities: ['visual'],
          view_images: { front: 'overlay-part-2.png' },
          source_images: [{ filename: 'overlay-part-2.png', image_id: 'img-overlay-2', side: 'front', modality: 'visual', overlay: false }],
          annotations: [],
        },
      },
    ];
    const launchFilters = { selected_part_id: 'part-overlay-1' };
    mockWorkbenchFetch({
      user: 'stale-launch-filter',
      batches: [{ id: 'batch-1', name: 'Batch 1' }],
      workspaceState: { selected_batch_id: 'batch-1', selected_part_id: 'part-overlay-1' },
      parts,
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" launchFilters={launchFilters} />);

    expect(await screen.findByRole('heading', { name: 'Overlay Part 1' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Overlay Part 2').closest('article'));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Overlay Part 2' })).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(screen.getByRole('heading', { name: 'Overlay Part 2' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Overlay Part 1' })).not.toBeInTheDocument();
  });

  test('applies a launch filter selected_image_ref for the launched part', async () => {
    const parts = [
      {
        id: 'part-launch-1',
        batch_id: 'batch-1',
        serial_number: 'SN-LAUNCH-001',
        display_name: 'Launch Part 1',
        review_state: 'unreviewed',
        metadata: {
          configured_views: ['front', 'back'],
          modalities: ['visual'],
          view_images: { front: 'launch-front.png', back: 'launch-back.png' },
          source_images: [
            { filename: 'launch-front.png', image_id: 'img-launch-front', side: 'front', modality: 'visual', overlay: false },
            { filename: 'launch-back.png', image_id: 'img-launch-back', side: 'back', modality: 'visual', overlay: false },
          ],
          annotations: [],
        },
      },
    ];
    mockWorkbenchFetch({
      user: 'launch-image-ref',
      batches: [{ id: 'batch-1', name: 'Batch 1' }],
      workspaceState: { selected_batch_id: 'batch-1' },
      parts,
    });

    render(
      <InspectionWorkbenchPanel
        projectId="proj-1"
        projectType="PT1"
        launchFilters={{ selected_part_id: 'part-launch-1', selected_image_ref: 'launch-back.png' }}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Launch Part 1' })).toBeInTheDocument();
    // The requested image ref must survive the image-selection fallback effect,
    // which otherwise resets the selection to the first available image.
    await waitFor(() => {
      expect(document.body.textContent).toContain('launch-back.png');
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(document.body.textContent).toContain('launch-back.png');
  });

  test('opens PT3 current-part metadata modal with .nsipro and other tabs', async () => {
    mockWorkbenchFetch({
      user: 'metadata-modal',
      batches: [{ id: 'batch-1', name: 'Batch 1' }],
      workspaceState: { selected_batch_id: 'batch-1', selected_part_id: 'part-nsipro-1' },
      parts: [
        {
          id: 'part-nsipro-1',
          batch_id: 'batch-1',
          serial_number: 'SN-NSIPRO-001',
          display_name: 'Metadata Rich Part',
          review_state: 'unreviewed',
          metadata: {
            nsipro_metadata: {
              source_filename: 'PT3_GEOMETRIC_DUAL_LABEL.nsipro',
              parser: 'nsipro-key-value',
              fields: { voltage_kv: 90, exposure_ms: 8.75 },
              deployment: { deployment_id: 'DEP-42', line_id: 'LINE-7' },
              custom_fields: { inspection_lot: 'LOT-ALPHA', operator_badge: 'QA-17', scan_mode: 'micro CT' },
              metadata: {
                Application: { application_info: 'NIS-Elements AR 5.30.00 (Build 1688)' },
                Microscope: { microscope_name: 'Nikon Ti2-E Inverted Microscope', objective_name: 'Plan Apo Lambda 20x' },
                Camera: { camera_name: 'DS-Qi2 Monochrome Camera', exposure_ms: 12.5, bit_depth: 16 },
                Calibration: { pixel_size_um: 2.5, z_step_um: 5 },
                Volume: { width_px: 128, height_px: 96, slices: 64 },
              },
            },
            alloy: 'Ti-6Al-4V',
            source_images: [
              {
                filename: 'slice-001.png',
                image_id: 'img-slice-001',
                side: 'front',
                modality: 'visual',
                selected_metadata_file: 'PT3_GEOMETRIC_DUAL_LABEL.nsipro',
                nsipro_payload: { voltage_kv: 80, voxel_size_um: 1.25 },
              },
            ],
            annotations: [],
          },
        },
      ],
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await waitFor(() => expect(screen.getByTestId('pt3-inspection-layout')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Metadata' }));

    const modal = screen.getByRole('heading', { name: 'Part Metadata' }).closest('.modal-content');
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByText('Metadata Rich Part')).toBeInTheDocument();
    expect(within(modal).getByRole('tab', { name: '.nsipro' })).toHaveAttribute('aria-selected', 'true');
    expect(within(modal).getByText('metadata.nsipro_metadata.source_filename')).toBeInTheDocument();
    expect(within(modal).getAllByText(/PT3_GEOMETRIC_DUAL_LABEL\.nsipro/).length).toBeGreaterThan(0);
    expect(within(modal).getByText('metadata.nsipro_metadata.fields.voltage_kv')).toBeInTheDocument();
    expect(within(modal).getByText('90')).toBeInTheDocument();
    expect(within(modal).getByText('metadata.nsipro_metadata.fields.exposure_ms')).toBeInTheDocument();
    expect(within(modal).getByText('8.75')).toBeInTheDocument();
    expect(within(modal).getByText('metadata.nsipro_metadata.custom_fields.inspection_lot')).toBeInTheDocument();
    expect(within(modal).getByText('LOT-ALPHA')).toBeInTheDocument();
    expect(within(modal).getByText('metadata.nsipro_metadata.custom_fields.operator_badge')).toBeInTheDocument();
    expect(within(modal).getByText('QA-17')).toBeInTheDocument();
    expect(within(modal).getByText('metadata.nsipro_metadata.custom_fields.scan_mode')).toBeInTheDocument();
    expect(within(modal).getByText('micro CT')).toBeInTheDocument();
    expect(within(modal).getByText('metadata.nsipro_metadata.deployment.deployment_id')).toBeInTheDocument();
    expect(within(modal).getByText('DEP-42')).toBeInTheDocument();
    expect(within(modal).getByText('metadata.nsipro_metadata.metadata.Application.application_info')).toBeInTheDocument();
    expect(within(modal).getByText('NIS-Elements AR 5.30.00 (Build 1688)')).toBeInTheDocument();
    expect(within(modal).getByText('metadata.nsipro_metadata.metadata.Microscope.microscope_name')).toBeInTheDocument();
    expect(within(modal).getByText('Nikon Ti2-E Inverted Microscope')).toBeInTheDocument();
    expect(within(modal).getByText('metadata.nsipro_metadata.metadata.Camera.exposure_ms')).toBeInTheDocument();
    expect(within(modal).getByText('12.5')).toBeInTheDocument();
    expect(within(modal).getByText('metadata.nsipro_metadata.metadata.Volume.slices')).toBeInTheDocument();
    expect(within(modal).getByText('metadata.source_images[0].nsipro_payload.voltage_kv')).toBeInTheDocument();
    expect(within(modal).getByText('metadata.source_images[0].nsipro_payload.voxel_size_um')).toBeInTheDocument();
    expect(within(modal).getByText('1.25')).toBeInTheDocument();
    expect(within(modal).queryByText('metadata.alloy')).not.toBeInTheDocument();

    fireEvent.click(within(modal).getByRole('tab', { name: 'Other' }));
    expect(within(modal).getByRole('tab', { name: 'Other' })).toHaveAttribute('aria-selected', 'true');
    expect(within(modal).getByText('metadata.alloy')).toBeInTheDocument();
    expect(within(modal).getByText('Ti-6Al-4V')).toBeInTheDocument();
    expect(within(modal).queryByText('metadata.nsipro_metadata.source_filename')).not.toBeInTheDocument();
    expect(within(modal).queryByText('metadata.nsipro_metadata.fields.voltage_kv')).not.toBeInTheDocument();
    expect(within(modal).queryByText('metadata.nsipro_metadata.fields.exposure_ms')).not.toBeInTheDocument();
    expect(within(modal).queryByText('metadata.nsipro_metadata.custom_fields.inspection_lot')).not.toBeInTheDocument();
    expect(within(modal).queryByText('metadata.nsipro_metadata.custom_fields.operator_badge')).not.toBeInTheDocument();
    expect(within(modal).queryByText('metadata.nsipro_metadata.custom_fields.scan_mode')).not.toBeInTheDocument();
    expect(within(modal).queryByText('metadata.nsipro_metadata.deployment.deployment_id')).not.toBeInTheDocument();
    expect(within(modal).queryByText('metadata.source_images[0].nsipro_payload.voxel_size_um')).not.toBeInTheDocument();
    expect(within(modal).queryByText('metadata.source_images[0].selected_metadata_file')).not.toBeInTheDocument();
  });

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

  test('part summary filter selectors only list metadata keys that distinguish loaded images', async () => {
    mockWorkbenchFetch({
      user: 'part-summary-distinguishing-filter-keys',
      batches: [{ id: 'batch-1', name: 'Batch 1' }],
      workspaceState: { selected_batch_id: 'batch-1', selected_part_id: 'part-filter-keys' },
      parts: [
        {
          id: 'part-filter-keys',
          batch_id: 'batch-1',
          serial_number: 'SN-FILTER-001',
          display_name: 'Filter Key Part',
          review_state: 'unreviewed',
          metadata: {
            configured_views: ['front', 'back'],
            modalities: ['visual', 'thermal'],
            view_images: { front: 'filter-front.png', back: 'filter-back.png' },
            source_images: [
              { filename: 'filter-front.png', image_id: 'img-filter-front', side: 'front', modality: 'visual', overlay: false, metadata: { project_type: 'PT1', station: 'alpha' } },
              { filename: 'filter-back.png', image_id: 'img-filter-back', side: 'back', modality: 'thermal', overlay: false, metadata: { project_type: 'PT1', station: 'beta' } },
            ],
            annotations: [],
          },
        },
      ],
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    const primarySelect = await screen.findByLabelText('Filter Key Part primary image filter key');
    const modalitySelect = screen.getByLabelText('Filter Key Part modality image filter key');
    const secondarySelect = screen.getByLabelText('Filter Key Part secondary image filter key');
    expect(primarySelect).toHaveValue('view');
    expect(modalitySelect).toHaveValue('modality');
    expect(secondarySelect).toHaveValue('layer');
    const primaryOptions = within(primarySelect).getAllByRole('option').map((option) => option.value);
    expect(primaryOptions).toEqual(expect.arrayContaining(['view', 'side', 'modality', 'station']));
    expect(primaryOptions).not.toContain('project_type');
    expect(primaryOptions).not.toContain('missing_key');
  });

  test('shows loaded images when normalized workspace state has no saved modalities', async () => {
    mockWorkbenchFetch({
      user: 'new-project-empty-modalities',
      batches: [{ id: 'batch-1', name: 'Batch 1' }],
      workspaceState: {
        selected_batch_id: 'batch-1',
        selected_part_id: 'part-new-project',
        inspector: {
          shortcut_help_visible: false,
          normalization_triage_field: '',
          image_enabled: true,
          modalities: [],
          view_name: '',
          viewport_transform: { zoom: 1, panX: 0, panY: 0 },
          measurements: [],
        },
      },
      parts: [
        {
          id: 'part-new-project',
          batch_id: 'batch-1',
          serial_number: 'SN-NEW-001',
          display_name: 'New Project Part',
          review_state: 'unreviewed',
          metadata: {
            configured_views: ['front'],
            modalities: ['visual'],
            view_images: { front: 'new-project-front.png' },
            source_images: [
              { filename: 'new-project-front.png', image_id: 'img-new-front', side: 'front', modality: 'visual', overlay: false },
            ],
            annotations: [],
          },
        },
      ],
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getByAltText('front view')).toBeInTheDocument());
    expect(screen.queryByText('No mapped images match the current filters.')).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('New Project Part modality toggles')).getByRole('button', { name: 'VISUAL' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('lists configured source modalities without duplicating overlays as modalities', async () => {
    mockWorkbenchFetch({
      user: 'configured-source-modalities',
      batches: [{ id: 'batch-1', name: 'Batch 1' }],
      workspaceState: { selected_batch_id: 'batch-1', selected_part_id: 'part-configured-modalities' },
      projectConfiguration: {
        image_modalities: [
          { id: 'optical', label: 'Optical' },
          { id: 'thermal', label: 'Thermal' },
        ],
      },
      parts: [
        {
          id: 'part-configured-modalities',
          batch_id: 'batch-1',
          serial_number: 'SN-CONFIG-001',
          display_name: 'Configured Modalities Part',
          review_state: 'unreviewed',
          metadata: {
            configured_views: ['front'],
            modalities: ['optical', 'thermal', 'segmentation'],
            view_images: { front: 'front-optical.png' },
            source_images: [
              { filename: 'front-optical.png', image_id: 'img-optical', side: 'front', modality: 'optical', overlay: false },
              { filename: 'front-thermal.png', image_id: 'img-thermal', side: 'front', modality: 'thermal', overlay: false },
              { filename: 'front-segmentation.png', image_id: 'img-overlay', side: 'front', modality: 'segmentation', overlay: true },
            ],
            annotations: [],
          },
        },
      ],
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    const modalityToggles = await screen.findByLabelText('Configured Modalities Part modality toggles');
    expect(within(modalityToggles).getByRole('button', { name: 'OPTICAL' })).toBeInTheDocument();
    expect(within(modalityToggles).getByRole('button', { name: 'THERMAL' })).toBeInTheDocument();
    expect(within(modalityToggles).queryByRole('button', { name: 'SEGMENTATION' })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('Configured Modalities Part layer toggles')).getByRole('button', { name: 'OVERLAY' })).toBeInTheDocument();
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
      if (url.includes('/images-page?')) return Promise.resolve({
        ok: true,
        json: async () => ({ items: images, total: images.length, next_cursor: null, has_more: false }),
      });
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
        body: JSON.stringify({ filename: 'assigned-a.png', image_id: 'img-assigned-a', to_part_id: null }),
      });
    });
    await waitFor(() => expect(parts[0].metadata.source_images).toHaveLength(0));
    unmount();

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    expect(await screen.findByText('No mapped images for this part.')).toBeInTheDocument();
    expect(screen.queryByAltText('front view')).not.toBeInTheDocument();
    expect(screen.queryByText('assigned-a.png')).not.toBeInTheDocument();
  });

  const buildRegressionPart = (id, displayName, filename, imageId, batchId = 'batch-1') => ({
    id,
    batch_id: batchId,
    serial_number: id.toUpperCase(),
    display_name: displayName,
    review_state: 'unreviewed',
    metadata: {
      configured_views: ['front'],
      modalities: ['visual'],
      view_images: { front: filename },
      source_images: [
        { filename, image_id: imageId, side: 'front', modality: 'visual', overlay: false },
      ],
      annotations: [],
    },
  });

  test('keeps remaining parts and images visible in inspection after another part is deleted', async () => {
    const remainingPart = buildRegressionPart('part-remaining', 'Remaining Part', 'remaining-part.png', 'img-remaining-part');
    mockWorkbenchFetch({
      user: 'part-delete-regression',
      batches: [{ id: 'batch-1', name: 'Batch 1' }],
      workspaceState: { selected_batch_id: 'batch-1', selected_part_id: 'part-deleted' },
      parts: [remainingPart],
      projectImages: [
        { id: 'img-remaining-part', filename: 'remaining-part.png', metadata: { part_id: 'part-remaining', view_name: 'front' } },
        { id: 'img-deleted-part', filename: 'deleted-part.png', metadata: { part_id: 'part-deleted', view_name: 'front' } },
      ],
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    expect(await screen.findAllByText('Remaining Part')).toHaveLength(2);
    expect(screen.getByText('Parts: 1')).toBeInTheDocument();
    expect(screen.getByAltText('front view')).toHaveAttribute('src', '/api/images/img-remaining-part/content');
    expect(screen.queryByText('Deleted Part')).not.toBeInTheDocument();
    expect(screen.queryByText('deleted-part.png')).not.toBeInTheDocument();
  });

  test('keeps loaded images visible and hides unloaded images in inspection', async () => {
    const part = {
      ...buildRegressionPart('part-with-unload', 'Part With Unload', 'remaining-image.png', 'img-remaining-image'),
      metadata: {
        configured_views: ['front', 'back'],
        modalities: ['visual'],
        view_images: { front: 'remaining-image.png', back: 'unloaded-image.png' },
        source_images: [
          { filename: 'remaining-image.png', image_id: 'img-remaining-image', side: 'front', modality: 'visual', overlay: false },
          { filename: 'unloaded-image.png', image_id: 'img-unloaded-image', side: 'back', modality: 'visual', overlay: false },
        ],
        annotations: [],
      },
    };
    mockWorkbenchFetch({
      user: 'image-unload-regression',
      batches: [{ id: 'batch-1', name: 'Batch 1' }],
      workspaceState: { selected_batch_id: 'batch-1', selected_part_id: 'part-with-unload' },
      parts: [part],
      projectImages: [
        { id: 'img-remaining-image', filename: 'remaining-image.png', metadata: { part_id: 'part-with-unload', view_name: 'front' } },
        { id: 'img-unloaded-image', filename: 'unloaded-image.png', deleted_at: '2026-06-25T12:00:00Z', metadata: { part_id: 'part-with-unload', view_name: 'back' } },
      ],
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    expect(await screen.findAllByText('Part With Unload')).toHaveLength(2);
    expect(screen.getByAltText('front view')).toHaveAttribute('src', '/api/images/img-remaining-image/content');
    expect(screen.queryByAltText('back view')).not.toBeInTheDocument();
    expect(screen.queryByText('unloaded-image.png')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Part With Unload view toggles')).toHaveTextContent('FRONT');
    expect(screen.getByLabelText('Part With Unload view toggles')).not.toHaveTextContent('BACK');
  });

  test('keeps remaining parts and loaded images visible after part deletion and image unload happen together', async () => {
    const survivor = {
      ...buildRegressionPart('part-survivor', 'Survivor Part', 'survivor-loaded.png', 'img-survivor-loaded'),
      metadata: {
        configured_views: ['front', 'back'],
        modalities: ['visual'],
        view_images: { front: 'survivor-loaded.png', back: 'survivor-unloaded.png' },
        source_images: [
          { filename: 'survivor-loaded.png', image_id: 'img-survivor-loaded', side: 'front', modality: 'visual', overlay: false },
          { filename: 'survivor-unloaded.png', image_id: 'img-survivor-unloaded', side: 'back', modality: 'visual', overlay: false },
        ],
        annotations: [],
      },
    };
    const secondSurvivor = buildRegressionPart('part-second-survivor', 'Second Survivor Part', 'second-survivor.png', 'img-second-survivor');
    mockWorkbenchFetch({
      user: 'combined-delete-unload-regression',
      batches: [{ id: 'batch-1', name: 'Batch 1' }],
      workspaceState: { selected_batch_id: 'batch-1', selected_part_id: 'part-deleted' },
      parts: [survivor, secondSurvivor],
      projectImages: [
        { id: 'img-survivor-loaded', filename: 'survivor-loaded.png', metadata: { part_id: 'part-survivor', view_name: 'front' } },
        { id: 'img-survivor-unloaded', filename: 'survivor-unloaded.png', deleted_at: '2026-06-25T12:00:00Z', metadata: { part_id: 'part-survivor', view_name: 'back' } },
        { id: 'img-second-survivor', filename: 'second-survivor.png', metadata: { part_id: 'part-second-survivor', view_name: 'front' } },
        { id: 'img-deleted-part', filename: 'deleted-combined.png', metadata: { part_id: 'part-deleted', view_name: 'front' } },
      ],
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    expect(await screen.findAllByText('Survivor Part')).toHaveLength(2);
    expect(screen.getByText('Second Survivor Part')).toBeInTheDocument();
    expect(screen.getByText('Parts: 2')).toBeInTheDocument();
    expect(screen.getByAltText('front view')).toHaveAttribute('src', '/api/images/img-survivor-loaded/content');
    expect(screen.queryByAltText('back view')).not.toBeInTheDocument();
    expect(screen.queryByText('survivor-unloaded.png')).not.toBeInTheDocument();
    expect(screen.queryByText('Deleted Combined Part')).not.toBeInTheDocument();
    expect(screen.queryByText('deleted-combined.png')).not.toBeInTheDocument();
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

      // Review action updates indicator, and Reset returns the part to unreviewed.
      // Wait for the pass PATCH instead of only the summary text: some seeded
      // scenarios already have one passed part, so `Passed: 1` can be true
      // before the async save finishes and the Reset button is enabled again.
      fireEvent.click(screen.getByRole('button', { name: /^pass$/i }));
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining(`/parts/${scenario.parts[0].id}`),
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ review_state: 'pass' }),
          }),
        );
      });
      const expectedPassedAfterPass = scenario.parts.filter(
        (part) => part.id === scenario.parts[0].id || (part.review_state || '').toLowerCase() === 'pass',
      ).length;
      await waitFor(() => {
        expect(screen.getByText(`Passed: ${expectedPassedAfterPass}`)).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /^reset$/i }));
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining(`/parts/${scenario.parts[0].id}`),
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ review_state: 'unreviewed' }),
          }),
        );
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


  test('clears stale batch filter so unbatched selected part images stay visible', async () => {
    mockWorkbenchFetch({
      user: 'unbatched-selection',
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
      workspaceState: {
        selected_batch_id: 'batch-1',
        selected_part_id: 'part-unbatched',
        inspector: { image_enabled: true, modalities: ['visual'], view_name: 'front' },
      },
      batches: [{ id: 'batch-1', name: 'Batch 1' }],
      parts: [
        {
          id: 'part-unbatched',
          batch_id: null,
          serial_number: 'UNBATCHED-1',
          display_name: 'Unbatched Part',
          review_state: 'unreviewed',
          metadata: {
            configured_views: ['front'],
            modalities: ['visual'],
            source_images: [
              { filename: 'unbatched-front.png', image_id: 'img-unbatched-front', side: 'front', modality: 'visual', overlay: false },
            ],
            annotations: [],
          },
        },
      ],
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getAllByText('Unbatched Part').length).toBeGreaterThan(0));
    expect(screen.getByLabelText('Batch')).toHaveValue('');
    expect(screen.getByText('unbatched-front.png')).toBeInTheDocument();
    expect(screen.getByAltText('front view')).toBeInTheDocument();
  });

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
    expect(screen.getAllByRole('button', { name: 'LEFT' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'RIGHT' }).length).toBeGreaterThan(0);
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
      unmount();
    }
  });

  test('does not activate PT3 internal overlay layers when selecting a part', async () => {
    mockWorkbenchFetch(scenarioByUser[0]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await screen.findByTestId('mpr-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Part Selection' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: /Voids/i })).not.toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: /Basic Part/i })[0]);

    expect(screen.queryByRole('button', { name: /Voids/i })).not.toBeInTheDocument();
  });

  test('exposes every axis slice for a 300 frame 300px 3D TIFF stack', async () => {
    const onMprSessionChange = jest.fn();
    const mprSession = {
      slicePosition: { axial: 17, coronal: 23, sagittal: 31 },
      activePane: 'coronal',
      lastActiveAxis: 'coronal',
      viewportTransform: { zoom: 1.5, panX: 12, panY: -8 },
      rotation: { x: -12, y: 42 },
    };
    const tiffScenario = {
      user: 'tiff-300',
      batches: [{ id: 'batch-tiff-300', name: 'Batch TIFF 300' }],
      workspaceState: { selected_batch_id: 'batch-tiff-300', selected_part_id: 'part-tiff-300' },
      parts: [
        {
          id: 'part-tiff-300',
          batch_id: 'batch-tiff-300',
          serial_number: 'STACK-300',
          display_name: '300 image 300px TIFF stack',
          review_state: 'unreviewed',
          metadata: {
            volume_shape: { axial: 300, coronal: 300, sagittal: 300 },
            source_images: [
              {
                filename: 'stack_300x300x300.tif',
                image_id: 'img-tiff-300',
                metadata: {
                  tiff_dimensionality: '3d',
                  load_mode: 'volume',
                  frame_count: 300,
                  volume_shape: { axial: 300, coronal: 300, sagittal: 300 },
                },
              },
            ],
          },
        },
      ],
      projectImages: [
        {
          id: 'img-tiff-300',
          filename: 'stack_300x300x300.tif',
          metadata: { tiff_dimensionality: '3d', load_mode: 'volume', frame_count: 300, volume_shape: { axial: 300, coronal: 300, sagittal: 300 } },
        },
      ],
    };
    mockWorkbenchFetch(tiffScenario);
    render(
      <InspectionWorkbenchPanel
        projectId="proj-1"
        projectType="PT3"
        mprSession={mprSession}
        onMprSessionChange={onMprSessionChange}
      />,
    );

    await screen.findByTestId('mpr-panel');

    expect(document.querySelector('#mpr-slice-axial')).toHaveAttribute('max', '299');
    expect(document.querySelector('#mpr-slice-coronal')).toHaveAttribute('max', '299');
    expect(document.querySelector('#mpr-slice-sagittal')).toHaveAttribute('max', '299');
    expect(document.querySelector('#mpr-slice-axial')).toHaveValue('17');
    expect(document.querySelector('#mpr-slice-coronal')).toHaveValue('23');
    expect(document.querySelector('#mpr-slice-sagittal')).toHaveValue('31');
    expect(screen.getByTestId('mpr-pane-3d')).toHaveTextContent('3D');

    fireEvent.change(document.querySelector('#mpr-slice-axial'), { target: { value: '299' } });
    expect(onMprSessionChange).toHaveBeenLastCalledWith({
      ...mprSession,
      slicePosition: { axial: 299, coronal: 23, sagittal: 31 },
    });
    fireEvent.change(document.querySelector('#mpr-slice-coronal'), { target: { value: '299' } });
    fireEvent.change(document.querySelector('#mpr-slice-sagittal'), { target: { value: '299' } });

    expect(screen.getByTestId('mpr-pane-axial')).toHaveTextContent(/299 \/ 299/);
    expect(screen.getByTestId('mpr-pane-coronal')).toHaveTextContent(/299 \/ 299/);
    expect(screen.getByTestId('mpr-pane-sagittal')).toHaveTextContent(/299 \/ 299/);
  });

  test('uses voxel source metadata and volume-slice endpoints for single npy MPR volumes', async () => {
    const npyScenario = {
      user: 'npy-volume',
      batches: [{ id: 'batch-npy', name: 'Batch NPY' }],
      workspaceState: { selected_batch_id: 'batch-npy', selected_part_id: 'part-npy' },
      parts: [
        {
          id: 'part-npy',
          batch_id: 'batch-npy',
          serial_number: 'NPY-200',
          display_name: 'Single NPY volume',
          review_state: 'unreviewed',
          metadata: {
            source_images: [
              {
                filename: 'scan_200x550x300.npy',
                image_id: 'img-npy-200',
                metadata: { load_mode: 'volume', frame_count: 200, volume_shape: { axial: 200, coronal: 550, sagittal: 300 } },
              },
            ],
          },
        },
      ],
      projectImages: [
        {
          id: 'img-npy-200',
          filename: 'scan_200x550x300.npy',
          metadata: { load_mode: 'volume', frame_count: 200, volume_shape: { axial: 200, coronal: 550, sagittal: 300 } },
        },
      ],
    };
    const rendererSpy = jest.spyOn(pt3ThreeRenderer, 'createThreeMechanicalRenderer')
      .mockResolvedValue({
        rendererType: 'three-webgl-raymarch',
        render: jest.fn(),
        dispose: jest.fn(),
      });
    let view;
    try {
      mockWorkbenchFetch(npyScenario);
      view = render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

      await screen.findByTestId('mpr-panel');

      expect(document.querySelector('#mpr-slice-axial')).toHaveAttribute('max', '199');
      expect(document.querySelector('#mpr-slice-coronal')).toHaveAttribute('max', '549');
      expect(document.querySelector('#mpr-slice-sagittal')).toHaveAttribute('max', '299');
      expect(screen.getByTestId('mpr-pane-axial')).toHaveTextContent(/99 \/ 199/);
      expect(screen.getByTestId('mpr-pane-coronal')).toHaveTextContent(/274 \/ 549/);
      expect(screen.getByTestId('mpr-pane-sagittal')).toHaveTextContent(/149 \/ 299/);
      await waitFor(() => {
        const axialCanvas = screen.getByTestId('mpr-preview-axial').querySelector('canvas');
        expect(axialCanvas).toHaveAttribute('width', '300');
        expect(axialCanvas).toHaveAttribute('height', '550');
      });

      fireEvent.change(screen.getByLabelText('3D view'), {
        target: { value: 'ray-march:composite' },
      });
      await waitFor(() => expect(rendererSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          volumeDescriptor: expect.objectContaining({
            source: expect.objectContaining({ imageId: 'img-npy-200' }),
          }),
        }),
      ));
    } finally {
      view?.unmount();
      rendererSpy.mockRestore();
    }
  });

  test('keeps an aligned 3D overlay loaded while annotation rendering is toggled', async () => {
    const dimensions = { axial: 4, coronal: 6, sagittal: 8 };
    const baseSource = {
      filename: 'toggle-base.npy',
      image_id: 'toggle-base',
      load_mode: 'volume',
      volume_shape: dimensions,
      channel_count: 1,
      color_mode: 'scalar',
    };
    const overlaySource = {
      filename: 'toggle-segments.npy',
      image_id: 'toggle-segments',
      load_mode: 'volume',
      volume_shape: dimensions,
      channel_count: 4,
      color_mode: 'rgba',
      overlay: true,
      overlay_base_image_id: 'toggle-base',
    };
    const renderer = {
      rendererType: 'three-webgl-raymarch',
      hasExternalOverlay: true,
      render: jest.fn(),
      dispose: jest.fn(),
    };
    const rendererSpy = jest.spyOn(pt3ThreeRenderer, 'createThreeMechanicalRenderer')
      .mockResolvedValue(renderer);
    let view;
    try {
      mockWorkbenchFetch({
        user: 'overlay-render-toggle',
        batches: [{ id: 'batch-toggle', name: 'Toggle batch' }],
        workspaceState: { selected_batch_id: 'batch-toggle', selected_part_id: 'part-toggle' },
        parts: [{
          id: 'part-toggle',
          batch_id: 'batch-toggle',
          serial_number: 'TOGGLE-001',
          display_name: 'Overlay toggle volume',
          review_state: 'in_review',
          metadata: {
            volume_shape: dimensions,
            source_images: [baseSource, overlaySource],
          },
        }],
        projectImages: [
          { id: 'toggle-base', filename: baseSource.filename, metadata: baseSource },
          { id: 'toggle-segments', filename: overlaySource.filename, metadata: overlaySource },
        ],
      });
      view = render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

      await screen.findByTestId('mpr-panel');
      fireEvent.change(screen.getByLabelText('3D view'), {
        target: { value: 'ray-march:composite' },
      });
      const viewer = await screen.findByTestId('pt3-gaussian-splat-viewer');
      await waitFor(() => expect(viewer)
        .toHaveAttribute('data-external-overlay-rendered', 'true'));

      fireEvent.keyDown(
        screen.getByRole('button', { name: 'Open 3D part view fullscreen' }),
        { key: 'Enter' },
      );
      const fullscreen = screen.getByRole('dialog', { name: '3D reconstruction' });
      const renderAnnotationsToggle = within(fullscreen).getByLabelText('Render annotations');
      const initializationCount = rendererSpy.mock.calls.length;

      fireEvent.click(renderAnnotationsToggle);
      expect(viewer).toHaveAttribute('data-external-overlay-rendered', 'false');
      fireEvent.click(renderAnnotationsToggle);
      await waitFor(() => expect(viewer)
        .toHaveAttribute('data-external-overlay-rendered', 'true'));
      expect(rendererSpy).toHaveBeenCalledTimes(initializationCount);
    } finally {
      view?.unmount();
      rendererSpy.mockRestore();
    }
  });

  test('probes legacy volume metadata once and renders an RGBA overlay over a scalar source', async () => {
    const sourceId = 'legacy-scalar-source';
    const overlayId = 'legacy-rgba-overlay';
    mockWorkbenchFetch({
      user: 'legacy-rgba-volume-overlay',
      batches: [{ id: 'batch-legacy-rgba', name: 'Legacy RGBA' }],
      workspaceState: { selected_part_id: 'part-legacy-rgba' },
      parts: [{
        id: 'part-legacy-rgba',
        batch_id: 'batch-legacy-rgba',
        serial_number: 'LEGACY-RGBA',
        display_name: 'Legacy RGBA overlay',
        metadata: {
          source_images: [
            { filename: 'source.npy', image_id: sourceId, overlay: false },
            {
              filename: 'segments.npy',
              image_id: overlayId,
              overlay: true,
              overlay_base_image_id: sourceId,
            },
          ],
        },
      }],
      projectImages: [
        { id: sourceId, filename: 'source.npy', metadata: {} },
        { id: overlayId, filename: 'segments.npy', metadata: {} },
      ],
      volumeMetadataById: {
        [sourceId]: {
          dimensions: { axial: 2, coronal: 3, sagittal: 4 },
          channel_count: 1,
          color_mode: 'scalar',
          pixel_dtype: 'uint16',
          voxel_dtype: 'uint16',
          bit_depth: 16,
        },
        [overlayId]: {
          dimensions: { axial: 2, coronal: 3, sagittal: 4 },
          channel_count: 4,
          color_mode: 'rgba',
          pixel_dtype: 'uint8',
          voxel_dtype: 'uint8',
          bit_depth: 8,
        },
      },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    const panel = await screen.findByTestId('mpr-panel');
    await waitFor(() => {
      const axialCanvas = within(panel).getByTestId('mpr-preview-axial').querySelector('canvas');
      expect(axialCanvas).toHaveAttribute('data-volume-color-mode', 'scalar');
      expect(axialCanvas).toHaveAttribute('data-overlay-color-modes', 'rgba');
      expect(axialCanvas).toHaveAttribute('width', '4');
      expect(axialCanvas).toHaveAttribute('height', '3');
    });
    expect(screen.queryByTestId('volume-metadata-probe-warning')).not.toBeInTheDocument();
    expect(global.fetch.mock.calls.filter(([url]) => url === `/api/images/${sourceId}/volume-metadata`)).toHaveLength(1);
    expect(global.fetch.mock.calls.filter(([url]) => url === `/api/images/${overlayId}/volume-metadata`)).toHaveLength(1);
    expect(Array.from(document.querySelectorAll('img')).some((image) => (
      image.getAttribute('src') === `/api/images/${sourceId}/content`
      || image.getAttribute('src') === `/api/images/${overlayId}/content`
    ))).toBe(false);
  });

  test('retries a transient legacy volume probe after reselection without using image content fallback', async () => {
    const sourceId = 'legacy-unreadable-volume';
    mockWorkbenchFetch({
      user: 'legacy-volume-probe-failure',
      batches: [{ id: 'batch-legacy-failure', name: 'Legacy failure' }],
      workspaceState: { selected_part_id: 'part-legacy-failure' },
      parts: [
        {
          id: 'part-legacy-failure',
          batch_id: 'batch-legacy-failure',
          serial_number: 'LEGACY-FAILURE',
          display_name: 'Legacy volume probe failure',
          metadata: {
            source_images: [{ filename: 'unreadable.npy', image_id: sourceId, overlay: false }],
          },
        },
        {
          id: 'part-probe-reset',
          batch_id: 'batch-legacy-failure',
          serial_number: 'PROBE-RESET',
          display_name: 'Probe reset part',
          metadata: {},
        },
      ],
      projectImages: [{ id: sourceId, filename: 'unreadable.npy', metadata: {} }],
    });
    const baseFetch = global.fetch;
    let metadataAttempts = 0;
    global.fetch = jest.fn((url, options = {}) => {
      if (url === `/api/images/${sourceId}/volume-metadata`) {
        metadataAttempts += 1;
        if (metadataAttempts === 1) return Promise.resolve({ ok: false, status: 503 });
        return Promise.resolve({
          ok: true,
          json: async () => ({
            dimensions: { axial: 2, coronal: 3, sagittal: 4 },
            channel_count: 1,
            color_mode: 'scalar',
            pixel_dtype: 'uint16',
            voxel_dtype: 'uint16',
            bit_depth: 16,
          }),
        });
      }
      return baseFetch(url, options);
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    const warning = await screen.findByTestId('volume-metadata-probe-warning');
    expect(warning).toHaveTextContent('The volume was not rendered as a regular image');
    expect(Array.from(document.querySelectorAll('img')).some((image) => (
      image.getAttribute('src') === `/api/images/${sourceId}/content`
    ))).toBe(false);

    fireEvent.change(screen.getByTestId('mpr-part-selector'), { target: { value: 'part-probe-reset' } });
    await waitFor(() => expect(screen.queryByTestId('volume-metadata-probe-warning')).not.toBeInTheDocument());
    fireEvent.change(screen.getByTestId('mpr-part-selector'), { target: { value: 'part-legacy-failure' } });

    await waitFor(() => {
      const axialCanvas = screen.getByTestId('mpr-preview-axial').querySelector('canvas');
      expect(axialCanvas).toHaveAttribute('data-volume-color-mode', 'scalar');
      expect(axialCanvas).toHaveAttribute('width', '4');
      expect(axialCanvas).toHaveAttribute('height', '3');
    });
    expect(metadataAttempts).toBe(2);
    expect(screen.queryByTestId('volume-metadata-probe-warning')).not.toBeInTheDocument();
    expect(Array.from(document.querySelectorAll('img')).some((image) => (
      image.getAttribute('src') === `/api/images/${sourceId}/content`
    ))).toBe(false);
  });

  test('carries RGB and RGBA server volume layout through cache identity and windowing', () => {
    const rgb = createServerVolumeDescriptor({
      filename: 'rgb.npy',
      image_id: 'rgb-image',
      volume_shape: { axial: 2, coronal: 3, sagittal: 4 },
      channel_count: 3,
      color_mode: 'rgb',
    });
    const rgba = createServerVolumeDescriptor({
      filename: 'rgba.npy',
      image_id: 'rgba-image',
      metadata: {
        volume_shape: { axial: 2, coronal: 3, sagittal: 4 },
        channel_count: 4,
        color_mode: 'rgba',
      },
    });
    const legacyWithoutLayout = createServerVolumeDescriptor({
      filename: 'legacy.npy',
      image_id: 'legacy-image',
      volume_shape: { axial: 2, coronal: 3, sagittal: 4 },
    });

    expect(rgb).toMatchObject({ channelCount: 3, colorMode: 'rgb' });
    expect(rgba).toMatchObject({ channelCount: 4, colorMode: 'rgba' });
    expect(legacyWithoutLayout).toBeNull();
    expect(getMprVolumeCacheKey(rgb)).toContain('rgb-image:3:rgb');
    expect(getMprVolumeCacheKey(rgba)).toContain('rgba-image:4:rgba');
    expect(shouldApplyDisplayWindowToVolumeCache(rgb)).toBe(false);
    expect(shouldApplyDisplayWindowToVolumeCache(rgba)).toBe(false);
    expect(shouldApplyDisplayWindowToVolumeCache({})).toBe(true);
  });

  test('opens the 3D pane as an accessible fullscreen view without mounting a duplicate scene', async () => {
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

    expect(screen.getByRole('button', { name: 'Open 3D part view fullscreen' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open 3D part view fullscreen' }), { key: 'Enter' });

    const fullscreen = screen.getByRole('dialog', { name: '3D reconstruction' });
    expect(fullscreen).toHaveAttribute('aria-modal', 'true');
    expect(within(fullscreen).getByRole('application', { name: 'Fullscreen 3D part view. Use arrow keys to orbit, plus and minus to zoom, and zero to reset.' })).toBeInTheDocument();
    expect(document.querySelectorAll('.mpr-volume-scene')).toHaveLength(1);
    expect(within(fullscreen).getByRole('button', { name: 'Close fullscreen 3D view' })).toHaveFocus();
    const renderAnnotationsToggle = within(fullscreen).getByLabelText('Render annotations');
    const annotationsListToggle = within(fullscreen).getByLabelText('Show annotations list');
    const reconstructionSettingsToggle = within(fullscreen).getByLabelText('Show reconstruction settings');
    expect(renderAnnotationsToggle).toBeChecked();
    expect(annotationsListToggle).toBeChecked();
    expect(reconstructionSettingsToggle).toBeChecked();
    expect(within(fullscreen).getByLabelText('3D annotations')).toBeInTheDocument();

    fireEvent.click(renderAnnotationsToggle);
    expect(renderAnnotationsToggle).not.toBeChecked();
    expect(within(fullscreen).getByLabelText('3D annotations')).toBeInTheDocument();
    expect(annotationsListToggle).toBeChecked();

    fireEvent.click(annotationsListToggle);
    expect(within(fullscreen).queryByLabelText('3D annotations')).not.toBeInTheDocument();
    expect(renderAnnotationsToggle).not.toBeChecked();
    fireEvent.click(renderAnnotationsToggle);
    expect(renderAnnotationsToggle).toBeChecked();
    expect(within(fullscreen).queryByLabelText('3D annotations')).not.toBeInTheDocument();
    fireEvent.click(annotationsListToggle);
    expect(within(fullscreen).getByLabelText('3D annotations')).toBeInTheDocument();

    expect(mprGrid).toHaveClass('mpr-grid-four');
    expect(mprGrid).not.toHaveClass('mpr-grid-single');
    quadrantPaneIds.forEach((testId) => {
      expect(screen.getByTestId(testId)).not.toHaveClass('mpr-pane-hidden');
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '3D reconstruction' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.mpr-volume-scene')).toHaveLength(1);
  });

  test('normalizes legacy project configurations to canonical shared 3D guide defaults', async () => {
    mockWorkbenchFetch({
      ...scenarioByUser[2],
      projectConfiguration: {
        display_settings: {
          default_colormap: 'grayscale',
        },
      },
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await screen.findByTestId('mpr-panel');
    await waitFor(() => {
      const model = document.querySelector('.mpr-volume-model');
      expect(model).toBeInTheDocument();
      expect(model.style.getPropertyValue('--pt3-crosshair-opacity')).toBe('0.5');
      expect(model.style.getPropertyValue('--pt3-crosshair-line-width')).toBe('1.25px');
      expect(model.style.getPropertyValue('--pt3-crosshair-half-line-width')).toBe('0.625px');
      expect(model.style.getPropertyValue('--pt3-plane-outline-opacity')).toBe('1');
      expect(model.style.getPropertyValue('--pt3-plane-outline-line-width')).toBe('1.25px');
      expect(model.style.getPropertyValue('--pt3-inactive-plane-outline-line-width')).toBe('0.625px');
    });
  });

  test('applies configured 3D guide appearance to legacy, renderer, and helper views', async () => {
    const guideSettings = {
      crosshair_transparency_percent: 75,
      crosshair_line_width_px: 4,
      plane_outline_transparency_percent: 40,
      plane_outline_line_width_px: 3,
    };
    const locatorSpy = jest.spyOn(pt3SliceLocator, 'drawPt3SliceLocator')
      .mockReturnValue(null);
    const rendererSpy = jest.spyOn(pt3ThreeRenderer, 'createThreeMechanicalRenderer')
      .mockResolvedValue({
        rendererType: 'three-webgl-raymarch',
        render: jest.fn(),
        dispose: jest.fn(),
      });

    try {
      mockWorkbenchFetch({
        ...scenarioByUser[2],
        projectConfiguration: {
          display_settings: { pt3_3d_guides: guideSettings },
        },
      });
      render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

      await screen.findByTestId('mpr-panel');
      await waitFor(() => {
        const model = document.querySelector('.mpr-volume-model');
        expect(model).toBeInTheDocument();
        expect(model.style.getPropertyValue('--pt3-crosshair-opacity')).toBe('0.25');
        expect(model.style.getPropertyValue('--pt3-crosshair-line-width')).toBe('4px');
        expect(model.style.getPropertyValue('--pt3-crosshair-half-line-width')).toBe('2px');
        expect(model.style.getPropertyValue('--pt3-plane-outline-opacity')).toBe('0.6');
        expect(model.style.getPropertyValue('--pt3-plane-outline-line-width')).toBe('3px');
        expect(model.style.getPropertyValue('--pt3-inactive-plane-outline-line-width')).toBe('1.5px');
      });

      fireEvent.click(screen.getByTestId('mpr-pane-sagittal'));
      await waitFor(() => {
        expect(document.querySelector('.plane-sagittal')).toHaveClass('active');
        expect(document.querySelector('.plane-axial')).not.toHaveClass('active');
        expect(document.querySelector('.plane-coronal')).not.toHaveClass('active');
      });
      fireEvent.click(screen.getByTestId('mpr-pane-3d'));
      await waitFor(() => {
        expect(document.querySelector('.plane-sagittal')).toHaveClass('active');
        expect(document.querySelector('.plane-axial')).not.toHaveClass('active');
        expect(document.querySelector('.plane-coronal')).not.toHaveClass('active');
      });

      fireEvent.change(screen.getByLabelText('3D view'), {
        target: { value: 'ray-march:composite' },
      });
      await waitFor(() => expect(locatorSpy.mock.calls.some(([, options]) => (
        options?.guideSettings
          && Object.entries(guideSettings).every(([key, value]) => (
            options.guideSettings[key] === value
          ))
      ))).toBe(true));

      fireEvent.click(screen.getByRole('button', { name: 'Segmentation Helpers' }));
      const helperTabs = screen.getByRole('tablist', { name: 'Segmentation workspace views' });
      locatorSpy.mockClear();
      fireEvent.click(within(helperTabs).getByRole('tab', { name: '3D' }));
      await screen.findByTestId('segmentation-helper-3d-stage');
      await waitFor(() => expect(locatorSpy.mock.calls.some(([, options]) => (
        options?.guideSettings
          && Object.entries(guideSettings).every(([key, value]) => (
            options.guideSettings[key] === value
          ))
      ))).toBe(true));
    } finally {
      locatorSpy.mockRestore();
      rendererSpy.mockRestore();
    }
  });

  test('opens XY, XZ, and YZ slices as frozen fullscreen MPR canvases', async () => {
    mockWorkbenchFetch(scenarioByUser[2]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await screen.findByTestId('mpr-panel');

    fireEvent.click(screen.getByLabelText('Mirror', { selector: '#mpr-mirror-coronal' }));
    const compactAxialScaleY = screen.getByTestId('mpr-preview-axial').style.getPropertyValue('--projection-scale-y');
    expect(compactAxialScaleY).toBe('-1');

    const cases = [
      { axis: 'axial', slice: 16, width: 80, height: 96, backingImageId: 'pt3-z-016' },
      { axis: 'coronal', slice: 50, width: 80, height: 128, backingImageId: 'pt3-z-000' },
      { axis: 'sagittal', slice: 64, width: 96, height: 128, backingImageId: 'pt3-z-000' },
    ];

    for (const testCase of cases) {
      fireEvent.change(document.querySelector(`#mpr-slice-${testCase.axis}`), {
        target: { value: String(testCase.slice) },
      });
      fireEvent.click(screen.getByTestId(`mpr-pane-${testCase.axis}`));

      const fullscreenCanvas = screen.getByTestId('fullscreen-mpr-slice');
      expect(fullscreenCanvas.tagName).toBe('CANVAS');
      expect(fullscreenCanvas).toHaveAttribute('role', 'img');
      expect(fullscreenCanvas).toHaveAttribute('data-mpr-axis', testCase.axis);
      expect(fullscreenCanvas).toHaveAttribute('data-mpr-slice-index', String(testCase.slice));
      expect(fullscreenCanvas).toHaveAttribute('data-mpr-slice-key', `${testCase.axis}:${testCase.slice}`);
      expect(fullscreenCanvas).toHaveAttribute('data-mpr-backing-image-id', testCase.backingImageId);
      expect(fullscreenCanvas).toHaveAttribute('width', String(testCase.width));
      expect(fullscreenCanvas).toHaveAttribute('height', String(testCase.height));
      const fullscreenOverlay = screen.getByLabelText('fullscreen measurement overlay');
      expect(fullscreenOverlay).toHaveAttribute('viewBox', `0 0 ${testCase.width} ${testCase.height}`);
      expect(fullscreenOverlay).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
      if (testCase.axis === 'axial') {
        expect(fullscreenCanvas.style.getPropertyValue('--projection-scale-y')).toBe(compactAxialScaleY);
        expect(fullscreenOverlay.style.getPropertyValue('--projection-scale-y')).toBe(compactAxialScaleY);
      }
      expect(document.querySelector('.inspection-fullscreen-image-zoom-layer img')).not.toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Close fullscreen image'));
    }
  });

  test('maps letterboxed fullscreen XZ pointer coordinates back to the reconstructed slice', async () => {
    mockWorkbenchFetch(scenarioByUser[2]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await screen.findByTestId('mpr-panel');
    fireEvent.click(screen.getByLabelText('Mirror', { selector: '#mpr-mirror-sagittal' }));
    fireEvent.change(document.querySelector('#mpr-slice-coronal'), { target: { value: '50' } });
    fireEvent.click(screen.getByTestId('mpr-pane-coronal'));

    const fullscreenCanvas = screen.getByTestId('fullscreen-mpr-slice');
    fullscreenCanvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 400,
      right: 400,
      bottom: 400,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));

    // The 80x128 XZ bitmap occupies x=75..325 in this square element, and the
    // sagittal mirror reverses the displayed X coordinate back into source space.
    // A press in the left letterbox must not start an annotation.
    fireEvent.mouseDown(fullscreenCanvas, { clientX: 20, clientY: 100, button: 0 });
    fireEvent.mouseUp(fullscreenCanvas, { clientX: 225, clientY: 300, button: 0 });
    expect(global.fetch.mock.calls.some((call) => call[0].includes('/annotations') && call[1]?.method === 'POST')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));
    fireEvent.mouseDown(fullscreenCanvas, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseUp(fullscreenCanvas, { clientX: 225, clientY: 300, button: 0 });

    await waitFor(() => {
      const postCall = global.fetch.mock.calls.find((call) => {
        if (!call[0].includes('/annotations') || call[1]?.method !== 'POST') return false;
        const body = JSON.parse(call[1].body);
        return body.geometry?.axis === 'coronal' && body.geometry?.slice_index === 50;
      });
      expect(postCall).toBeDefined();
      const payload = JSON.parse(postCall[1].body);
      expect(payload.image_id).toBe('pt3-z-000');
      expect(payload.bbox).toEqual({ x: 32, y: 32, width: 40, height: 64 });
      expect(payload.geometry.box).toEqual(expect.objectContaining({
        axis: 'coronal',
        slice_index: 50,
        imageWidth: 80,
        imageHeight: 128,
      }));
    });
  });

  test('keeps one 3D scene and exposes renderer-specific controls only in fullscreen', async () => {
    const rayRenderer = { rendererType: 'three-webgl-raymarch', render: jest.fn(), dispose: jest.fn() };
    const rayRendererSpy = jest.spyOn(pt3ThreeRenderer, 'createThreeMechanicalRenderer')
      .mockResolvedValue(rayRenderer);
    try {
      mockWorkbenchFetch(scenarioByUser[2]);
      render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await screen.findByTestId('mpr-panel');
    fireEvent.change(screen.getByLabelText('3D view'), { target: { value: 'ray-march:composite' } });
    expect(screen.queryByRole('group', { name: 'Ray-march controls' })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open 3D part view fullscreen' }), { key: 'Enter' });

    const modeSelect = screen.getByLabelText('3D view');
    const rayMarchGroup = modeSelect.querySelector('optgroup[label="Ray marching"]');
    expect(rayMarchGroup).not.toBeNull();
    expect(Array.from(rayMarchGroup.querySelectorAll('option')).map((option) => [option.value, option.textContent])).toEqual([
      ['ray-march:composite', 'Composite'],
      ['ray-march:mip', 'MIP'],
      ['ray-march:xray', 'X-ray'],
      ['ray-march:iso', 'Iso'],
      ['ray-march:window', 'Window'],
    ]);
    const modeLabels = Array.from(modeSelect.options).map((option) => option.textContent);
    expect(modeLabels).not.toContain('Reference shell');
    expect(modeLabels).not.toContain('Hybrid part view');
    const cases = [
      ['orientation', 'Orientation only'],
      ['stack', 'Stack reconstruction'],
      ['ray-march:composite', 'Ray marching — Composite'],
      ['ray-march:mip', 'Ray marching — MIP'],
      ['ray-march:xray', 'Ray marching — X-ray'],
      ['ray-march:iso', 'Ray marching — Iso'],
      ['ray-march:window', 'Ray marching — Window'],
      ['real_splat', 'Real 3DGS'],
    ];

    cases.forEach(([value, label]) => {
      fireEvent.change(modeSelect, { target: { value } });
      expect(screen.getByRole('dialog', { name: '3D reconstruction' })).toHaveTextContent(label);
      expect(document.querySelectorAll('.mpr-volume-scene')).toHaveLength(1);
      expect(screen.queryAllByTestId('pt3-gaussian-splat-viewer')).toHaveLength(
        value === 'real_splat' || value.startsWith('ray-march:') ? 1 : 0,
      );
      expect(screen.queryByRole('group', { name: 'Ray-march controls' }) !== null).toBe(value.startsWith('ray-march:'));
      expect(screen.queryByRole('group', { name: '3DGS controls' }) !== null).toBe(value === 'real_splat');
    });

    fireEvent.change(modeSelect, { target: { value: 'ray-march:composite' } });
    expect(screen.getAllByTestId('pt3-gaussian-splat-viewer')).toHaveLength(1);
    expect(document.querySelector('.mpr-volume-model')).not.toBeInTheDocument();
    expect(document.querySelector('.mpr-volume-overlay')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('3D viewer mode')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('3DGS opacity')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Volume opacity')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Clip/crop')).not.toBeInTheDocument();

    fireEvent.change(modeSelect, { target: { value: 'ray-march:composite' } });
    await waitFor(() => expect(screen.getByRole('group', { name: 'Ray-march controls' })).toBeEnabled());
    const reconstructionSettingsToggle = screen.getByLabelText('Show reconstruction settings');
    fireEvent.click(reconstructionSettingsToggle);
    expect(screen.queryByRole('group', { name: 'Ray-march controls' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('3D annotations')).toBeInTheDocument();
    fireEvent.click(reconstructionSettingsToggle);
    await waitFor(() => expect(screen.getByRole('group', { name: 'Ray-march controls' })).toBeEnabled());
    const density = screen.getByLabelText('Ray-march density');
    const threshold = screen.getByLabelText('Ray-march intensity threshold');
    const quality = screen.getByLabelText('Quality profile');
    const guides = screen.getByLabelText('Show slice guides');
    const reconstructionStyle = screen.getByLabelText('Ray-march reconstruction style');
    const boundaryEnhancement = screen.getByLabelText('Ray-march boundary enhancement');
    const boundaryStrength = screen.getByLabelText('Ray-march boundary strength');
    const orbitX = screen.getByRole('slider', { name: 'Orbit X' });
    const orbitY = screen.getByRole('slider', { name: 'Orbit Y' });
    expect(density).toHaveValue('1.25');
    expect(threshold).toHaveValue('0.08');
    expect(reconstructionStyle).toHaveValue('composite');
    expect(boundaryEnhancement).not.toBeChecked();
    expect(boundaryStrength).toHaveValue('0.45');
    expect(boundaryStrength).toBeDisabled();
    expect(screen.queryByLabelText('Transfer function preset')).not.toBeInTheDocument();
    expect(screen.getByTestId('ray-march-transfer-summary')).toHaveTextContent('α(I) = ρ · smoothstep');
    expect(screen.getByLabelText('Ray-march opacity ramp width')).toHaveValue('0.52');
    expect(quality).toHaveValue('balanced');
    expect(guides).toBeChecked();
    expect(orbitX).toHaveValue('-22');
    expect(orbitY).toHaveValue('32');
    expect(document.querySelector('.mpr-volume-model')).not.toBeInTheDocument();
    expect(document.querySelector('.mpr-volume-overlay')).not.toBeInTheDocument();

    fireEvent.change(density, { target: { value: '0.4' } });
    fireEvent.change(threshold, { target: { value: '0.3' } });
    fireEvent.change(quality, { target: { value: 'quality' } });
    fireEvent.click(guides);
    fireEvent.change(reconstructionStyle, { target: { value: 'window' } });
    const windowCenter = screen.getByLabelText('Ray-march window center');
    const windowWidth = screen.getByLabelText('Ray-march window width');
    fireEvent.change(windowCenter, { target: { value: '0.38' } });
    fireEvent.change(windowWidth, { target: { value: '0.12' } });
    fireEvent.click(boundaryEnhancement);
    fireEvent.change(boundaryStrength, { target: { value: '0.8' } });
    expect(density).toHaveValue('0.4');
    expect(screen.queryByLabelText('Ray-march intensity threshold')).not.toBeInTheDocument();
    expect(quality).toHaveValue('quality');
    expect(guides).not.toBeChecked();
    expect(reconstructionStyle).toHaveValue('window');
    expect(windowCenter).toHaveValue('0.38');
    expect(windowWidth).toHaveValue('0.12');
    expect(boundaryEnhancement).toBeChecked();
    expect(boundaryStrength).toHaveValue('0.8');
    expect(boundaryStrength).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Reset ray-march settings' }));
    expect(density).toHaveValue('1.25');
    expect(screen.getByLabelText('Ray-march intensity threshold')).toHaveValue('0.08');
    expect(screen.queryByLabelText('Transfer function preset')).not.toBeInTheDocument();
    expect(screen.getByTestId('ray-march-transfer-summary')).toHaveTextContent('α(I) = ρ · smoothstep');
    expect(screen.getByLabelText('Ray-march opacity ramp width')).toHaveValue('0.52');
    expect(quality).toHaveValue('balanced');
    expect(guides).toBeChecked();
    expect(reconstructionStyle).toHaveValue('composite');
    expect(screen.queryByLabelText('Ray-march window center')).not.toBeInTheDocument();
    expect(boundaryEnhancement).not.toBeChecked();
    expect(boundaryStrength).toHaveValue('0.45');
    expect(boundaryStrength).toBeDisabled();

    fireEvent.change(orbitX, { target: { value: '-40' } });
    fireEvent.change(orbitY, { target: { value: '75' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom +' }));
    expect(orbitX).toHaveValue('-40');
    expect(orbitY).toHaveValue('75');
    expect(screen.getByRole('dialog', { name: '3D reconstruction' })).toHaveTextContent('Zoom 1.42x');
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(orbitX).toHaveValue('-22');
    expect(orbitY).toHaveValue('32');
    expect(screen.getByRole('dialog', { name: '3D reconstruction' })).toHaveTextContent('Zoom 1.00x');

    fireEvent.change(modeSelect, { target: { value: 'real_splat' } });
    const splatControls = screen.getByRole('group', { name: '3DGS controls' });
    const splatOpacity = within(splatControls).getByLabelText('3DGS opacity');
    const splatPointSize = within(splatControls).getByLabelText('3DGS point size');
    const splatContrast = within(splatControls).getByLabelText('3DGS contrast');
    const splatGuides = within(splatControls).getByLabelText('Show slice guides');
    const splatOrbitX = within(splatControls).getByLabelText('3DGS Orbit X');
    const splatOrbitY = within(splatControls).getByLabelText('3DGS Orbit Y');
    expect(splatOpacity).toHaveValue('1.25');
    expect(splatPointSize).toHaveValue('1.35');
    expect(splatContrast).toHaveValue('1.2');
    expect(splatGuides).toBeChecked();
    expect(splatOrbitX).toHaveValue('-22');
    expect(splatOrbitY).toHaveValue('32');
    expect(document.querySelector('.mpr-volume-model')).not.toBeInTheDocument();
    expect(document.querySelector('.mpr-volume-overlay')).not.toBeInTheDocument();

    fireEvent.change(splatOpacity, { target: { value: '0.7' } });
    fireEvent.change(splatPointSize, { target: { value: '2.1' } });
    fireEvent.change(splatContrast, { target: { value: '1.6' } });
    fireEvent.click(splatGuides);
    expect(splatOpacity).toHaveValue('0.7');
    expect(splatPointSize).toHaveValue('2.1');
    expect(splatContrast).toHaveValue('1.6');
    expect(splatGuides).not.toBeChecked();
    fireEvent.click(within(splatControls).getByRole('button', { name: 'Reset 3DGS settings' }));
    expect(splatOpacity).toHaveValue('1.25');
    expect(splatPointSize).toHaveValue('1.35');
    expect(splatContrast).toHaveValue('1.2');
    expect(splatGuides).toBeChecked();

    fireEvent.change(splatOrbitX, { target: { value: '-35' } });
    fireEvent.change(splatOrbitY, { target: { value: '64' } });
    fireEvent.click(within(splatControls).getByRole('button', { name: '3DGS Zoom +' }));
    expect(splatOrbitX).toHaveValue('-35');
    expect(splatOrbitY).toHaveValue('64');
    expect(screen.getByRole('dialog', { name: '3D reconstruction' })).toHaveTextContent('Zoom 1.12x');
    fireEvent.click(within(splatControls).getByRole('button', { name: 'Reset 3DGS view' }));
    expect(splatOrbitX).toHaveValue('-22');
    expect(splatOrbitY).toHaveValue('32');
    expect(screen.getByRole('dialog', { name: '3D reconstruction' })).toHaveTextContent('Zoom 1.00x');

    const fullscreenScene = screen.getByRole('application', { name: 'Fullscreen 3D part view. Use arrow keys to orbit, plus and minus to zoom, and zero to reset.' });
    const dispatchOrbitPointer = (type, pointerId, clientY) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 60, clientY });
      Object.defineProperty(event, 'pointerId', { value: pointerId });
      fireEvent(fullscreenScene, event);
    };
    dispatchOrbitPointer('pointerdown', 71, 100);
    dispatchOrbitPointer('pointermove', 71, 80);
    expect(splatOrbitX).toHaveValue('-29');
    dispatchOrbitPointer('pointerup', 71, 80);
    fireEvent.click(within(splatControls).getByRole('button', { name: 'Reset 3DGS view' }));
    dispatchOrbitPointer('pointerdown', 72, 100);
    dispatchOrbitPointer('pointermove', 72, 120);
    expect(splatOrbitX).toHaveValue('-15');
    dispatchOrbitPointer('pointerup', 72, 120);
    fireEvent.click(within(splatControls).getByRole('button', { name: 'Reset 3DGS view' }));
    fireEvent.keyDown(fullscreenScene, { key: 'ArrowUp' });
    expect(splatOrbitX).toHaveValue('-27');
    fireEvent.keyDown(fullscreenScene, { key: 'ArrowDown' });
    expect(splatOrbitX).toHaveValue('-22');
    await waitFor(() => {
      expect(screen.getByTestId('pt3-gaussian-splat-viewer')).toHaveTextContent(
        'Real 3DGS unavailable',
      );
    });

    const lastControl = within(splatControls).getByRole('button', { name: '3DGS Zoom +' });
    const annotationVisibilityControl = within(screen.getByLabelText('3D annotations'))
      .getByRole('button', { name: 'Hide 3D annotation seed-adv' });
    lastControl.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(annotationVisibilityControl).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(within(screen.getByRole('dialog', { name: '3D reconstruction' })).getByRole('button', { name: 'Close fullscreen 3D view' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(annotationVisibilityControl).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(lastControl).toHaveFocus();
      fireEvent.keyDown(lastControl, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: '3D reconstruction' })).not.toBeInTheDocument();
    } finally {
      rayRendererSpy.mockRestore();
    }
  });

  test('applies each MPR axis mirror to the single CSS and PT3 3D scene', async () => {
    mockWorkbenchFetch(scenarioByUser[2]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await screen.findByTestId('mpr-panel');
    const scene = screen.getByRole('button', { name: 'Open 3D part view fullscreen' });
    const modeSelect = screen.getByLabelText('3D view');
    const sagittalMirror = screen.getByLabelText('Mirror', { selector: '#mpr-mirror-sagittal' });
    const coronalMirror = screen.getByLabelText('Mirror', { selector: '#mpr-mirror-coronal' });
    const axialMirror = screen.getByLabelText('Mirror', { selector: '#mpr-mirror-axial' });

    const expectMirrorAttributes = (element, { x, y, z }) => {
      expect(element).toHaveAttribute('data-mirror-x', String(x));
      expect(element).toHaveAttribute('data-mirror-y', String(y));
      expect(element).toHaveAttribute('data-mirror-z', String(z));
    };
    const expectCssMirror = ({ x, y, z }) => {
      const model = document.querySelector('.mpr-volume-model');
      expect(model).toBeInTheDocument();
      expect(model.style.getPropertyValue('--volume-mirror-x')).toBe(String(x));
      expect(model.style.getPropertyValue('--volume-mirror-y')).toBe(String(y));
      expect(model.style.getPropertyValue('--volume-mirror-z')).toBe(String(z));
    };
    const expectSingleStableScene = () => {
      expect(document.querySelectorAll('.mpr-volume-scene')).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Open 3D part view fullscreen' })).toBe(scene);
    };

    expectMirrorAttributes(scene, { x: 1, y: 1, z: 1 });
    expectCssMirror({ x: 1, y: 1, z: 1 });

    fireEvent.click(sagittalMirror);
    expectMirrorAttributes(scene, { x: -1, y: 1, z: 1 });
    expectCssMirror({ x: -1, y: 1, z: 1 });
    expectSingleStableScene();

    fireEvent.click(coronalMirror);
    expectMirrorAttributes(scene, { x: -1, y: -1, z: 1 });
    expectCssMirror({ x: -1, y: -1, z: 1 });
    expectSingleStableScene();

    fireEvent.click(axialMirror);
    expectMirrorAttributes(scene, { x: -1, y: -1, z: -1 });
    expectCssMirror({ x: -1, y: -1, z: -1 });
    expectSingleStableScene();

    fireEvent.change(modeSelect, { target: { value: 'ray-march:composite' } });
    const pt3Viewer = screen.getByTestId('pt3-gaussian-splat-viewer');
    expectMirrorAttributes(pt3Viewer, { x: -1, y: -1, z: -1 });
    expect(screen.getAllByTestId('pt3-gaussian-splat-viewer')).toHaveLength(1);
    expectSingleStableScene();

    fireEvent.click(sagittalMirror);
    expectMirrorAttributes(pt3Viewer, { x: 1, y: -1, z: -1 });
    fireEvent.click(coronalMirror);
    expectMirrorAttributes(pt3Viewer, { x: 1, y: 1, z: -1 });
    fireEvent.click(axialMirror);
    expectMirrorAttributes(pt3Viewer, { x: 1, y: 1, z: 1 });
    expectSingleStableScene();

    fireEvent.click(axialMirror);
    expectMirrorAttributes(pt3Viewer, { x: 1, y: 1, z: -1 });
    expect(screen.getAllByTestId('pt3-gaussian-splat-viewer')).toHaveLength(1);
    expectSingleStableScene();

    fireEvent.change(modeSelect, { target: { value: 'orientation' } });
    expect(screen.queryByTestId('pt3-gaussian-splat-viewer')).not.toBeInTheDocument();
    expectCssMirror({ x: 1, y: 1, z: -1 });
    expectSingleStableScene();
  });

  test('keeps a deterministic spatial fallback visible when ray marching has no volume stack', async () => {
    mockWorkbenchFetch(scenarioByUser[0]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await screen.findByTestId('mpr-panel');
    fireEvent.change(screen.getByLabelText('3D view'), { target: { value: 'ray-march:composite' } });

    await waitFor(() => {
      expect(screen.getByText(/Showing deterministic volume bounds fallback/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Three.js mechanical volume renderer')).not.toBeVisible();
    expect(screen.getByLabelText('Mechanical 3DGS preview')).toBeVisible();
  });

  test('releases an active fullscreen orbit capture when the view closes or loses focus', async () => {
    mockWorkbenchFetch(scenarioByUser[2]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await screen.findByTestId('mpr-panel');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open 3D part view fullscreen' }), { key: 'Enter' });
    let scene = screen.getByRole('application', { name: 'Fullscreen 3D part view. Use arrow keys to orbit, plus and minus to zoom, and zero to reset.' });
    const setPointerCapture = jest.fn();
    const releasePointerCapture = jest.fn();
    scene.setPointerCapture = setPointerCapture;
    scene.hasPointerCapture = jest.fn(() => true);
    scene.releasePointerCapture = releasePointerCapture;
    const dispatchPointerDown = (target, pointerId) => {
      const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 30, clientY: 30 });
      Object.defineProperty(event, 'pointerId', { value: pointerId });
      fireEvent(target, event);
    };

    dispatchPointerDown(scene, 31);
    expect(setPointerCapture).toHaveBeenCalledWith(31);
    fireEvent.click(screen.getByRole('button', { name: 'Close fullscreen 3D view' }));
    expect(releasePointerCapture).toHaveBeenCalledWith(31);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Open 3D part view fullscreen' }), { key: 'Enter' });
    scene = screen.getByRole('application', { name: 'Fullscreen 3D part view. Use arrow keys to orbit, plus and minus to zoom, and zero to reset.' });
    const blurReleasePointerCapture = jest.fn();
    scene.setPointerCapture = jest.fn();
    scene.hasPointerCapture = jest.fn(() => true);
    scene.releasePointerCapture = blurReleasePointerCapture;
    dispatchPointerDown(scene, 32);
    fireEvent.blur(window);
    expect(blurReleasePointerCapture).toHaveBeenCalledWith(32);
  });

  test('red team: orbit drag does not open fullscreen and repeated keyboard and backdrop cycles remain operable at narrow width', async () => {
    const originalWidth = window.innerWidth;
    window.innerWidth = 375;
    fireEvent(window, new Event('resize'));
    mockWorkbenchFetch(scenarioByUser[2]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await screen.findByTestId('mpr-panel');
    const scene = screen.getByRole('button', { name: 'Open 3D part view fullscreen' });
    const dispatchPointer = (type, { pointerId, ...init }) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
      Object.defineProperty(event, 'pointerId', { value: pointerId });
      fireEvent(scene, event);
    };

    dispatchPointer('pointerdown', { pointerId: 17, button: 0, clientX: 40, clientY: 40 });
    dispatchPointer('pointermove', { pointerId: 17, clientX: 85, clientY: 65 });
    dispatchPointer('pointerup', { pointerId: 17, button: 0, clientX: 85, clientY: 65 });
    fireEvent.click(scene);
    expect(screen.queryByRole('dialog', { name: '3D reconstruction' })).not.toBeInTheDocument();

    scene.focus();
    fireEvent.keyDown(scene, { key: 'Enter' });
    let closeButton = screen.getByRole('button', { name: 'Close fullscreen 3D view' });
    expect(closeButton).toHaveFocus();
    expect(screen.getByTestId('mpr-pane-3d')).toHaveClass('mpr-pane-volume-fullscreen');
    fireEvent.keyDown(document, { key: 'Tab' });
    const fullscreenDialog = screen.getByRole('dialog', { name: '3D reconstruction' });
    const renderAnnotationsToggle = within(fullscreenDialog).getByLabelText('Render annotations');
    const annotationsListToggle = within(fullscreenDialog).getByLabelText('Show annotations list');
    const reconstructionSettingsToggle = within(fullscreenDialog).getByLabelText('Show reconstruction settings');
    expect(renderAnnotationsToggle).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(annotationsListToggle).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(reconstructionSettingsToggle).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    const fullscreenScene = screen.getByRole('application', { name: 'Fullscreen 3D part view. Use arrow keys to orbit, plus and minus to zoom, and zero to reset.' });
    expect(fullscreenScene).toHaveFocus();
    const patchCallsBeforeHotkey = global.fetch.mock.calls.filter((call) => call[1]?.method === 'PATCH').length;
    fireEvent.keyDown(document, { key: 'a' });
    expect(global.fetch.mock.calls.filter((call) => call[1]?.method === 'PATCH')).toHaveLength(patchCallsBeforeHotkey);
    const zoomBeforeKeyboard = screen.getByTestId('mpr-pane-3d').textContent;
    fireEvent.keyDown(fullscreenScene, { key: '+' });
    expect(screen.getByTestId('mpr-pane-3d').textContent).not.toBe(zoomBeforeKeyboard);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(reconstructionSettingsToggle).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(annotationsListToggle).toHaveFocus();
    fireEvent.click(closeButton);
    await waitFor(() => expect(scene).toHaveFocus());

    fireEvent.keyDown(scene, { key: ' ' });
    expect(screen.getByRole('dialog', { name: '3D reconstruction' })).toBeInTheDocument();
    fireEvent.click(document.querySelector('.mpr-3d-fullscreen-backdrop'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '3D reconstruction' })).not.toBeInTheDocument());
    await waitFor(() => expect(scene).toHaveFocus());

    fireEvent.click(scene);
    closeButton = screen.getByRole('button', { name: 'Close fullscreen 3D view' });
    expect(closeButton).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '3D reconstruction' })).not.toBeInTheDocument());
    await waitFor(() => expect(scene).toHaveFocus());

    window.innerWidth = originalWidth;
    fireEvent(window, new Event('resize'));
  });

  test('red team: a canceled orbit gesture does not consume the next intentional fullscreen click', async () => {
    mockWorkbenchFetch(scenarioByUser[2]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await screen.findByTestId('mpr-panel');
    const scene = screen.getByRole('button', { name: 'Open 3D part view fullscreen' });
    const dispatchPointer = (type, { pointerId, ...init }) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
      Object.defineProperty(event, 'pointerId', { value: pointerId });
      fireEvent(scene, event);
    };

    dispatchPointer('pointerdown', { pointerId: 23, button: 0, clientX: 30, clientY: 30 });
    dispatchPointer('pointermove', { pointerId: 23, clientX: 80, clientY: 70 });
    dispatchPointer('pointercancel', { pointerId: 23, clientX: 80, clientY: 70 });
    fireEvent.click(scene);

    expect(screen.getByRole('dialog', { name: '3D reconstruction' })).toBeInTheDocument();
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

    fireEvent.mouseDown(axialPreview, { clientX: 100, clientY: 20, button: 0 });
    fireEvent.mouseMove(axialPreview, { clientX: 170, clientY: 80 });
    fireEvent.mouseUp(axialPreview, { clientX: 170, clientY: 80, button: 0 });

    fireEvent.change(document.querySelector('#mpr-slice-axial'), { target: { value: '12' } });

    fireEvent.mouseDown(axialPreview, { clientX: 110, clientY: 30, button: 0 });
    fireEvent.mouseMove(axialPreview, { clientX: 180, clientY: 90 });
    fireEvent.mouseUp(axialPreview, { clientX: 180, clientY: 90, button: 0 });

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
      centerTabs: ['image_metadata', 'view_parts'],
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
        view_parts: {
          slot: 'center',
          label: 'Configured Parts',
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
    expect(screen.getByRole('tab', { name: 'View All Images' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Configured Metadata' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Configured Parts' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Inspection' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Configured Findings' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Configured Parts' }));
    expect(screen.getAllByText('Configured Parts').length).toBeGreaterThan(0);

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
    expect(screen.getByRole('tab', { name: 'View All Images' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'View Parts' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Inspection' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Annotations' })).toBeInTheDocument();
    expect(screen.getByTestId('selected-image-panel')).toHaveTextContent(
      'No part selected. Select a part to inspect mapped images.',
    );
    expect(screen.getByTestId('annotation-controls')).toHaveTextContent('For selected part: No part selected');
    expect(screen.getByRole('button', { name: 'Measure on tiles' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Draw box on tiles' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New Crop on tiles' })).toBeDisabled();
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
      expect(screen.getByLabelText('Metadata for front-basic.png')).toHaveTextContent('view_name');
    });
    expect(screen.queryByText(/Selected image:/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Metadata for front-basic.png')).toHaveTextContent('front');
    const viewPartsTab = screen.getByRole('tab', { name: 'View Parts' });
    fireEvent.click(viewPartsTab);
    await waitFor(() => expect(viewPartsTab).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('tab', { name: 'Part Summary' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Filter Images' })).not.toBeInTheDocument();
  });

  test('View All Images replaces part summary with aggregate image filters and batch filtering', async () => {
    const scenario = {
      user: 'view-all-images',
      batches: [{ id: 'batch-a', name: 'Batch A' }, { id: 'batch-b', name: 'Batch B' }],
      workspaceState: { selected_part_id: 'part-all-a' },
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
      parts: [
        {
          id: 'part-all-a',
          batch_id: 'batch-a',
          serial_number: 'SN-ALL-A',
          display_name: 'All Part A',
          review_state: 'unreviewed',
          metadata: {
            source_images: [{ filename: 'all-a-front.png', image_id: 'all-a-front-id', side: 'front', modality: 'visual' }],
          },
        },
        {
          id: 'part-all-b',
          batch_id: 'batch-b',
          serial_number: 'SN-ALL-B',
          display_name: 'All Part B',
          review_state: 'unreviewed',
          metadata: {
            source_images: [{ filename: 'all-b-front.png', image_id: 'all-b-front-id', side: 'front', modality: 'visual' }],
          },
        },
      ],
    };
    mockWorkbenchFetch(scenario);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    const viewAllImagesTab = await screen.findByRole('tab', { name: 'View All Images' });
    fireEvent.click(viewAllImagesTab);
    await waitFor(() => expect(viewAllImagesTab).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('tab', { name: 'Filter Images' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Part Summary' })).not.toBeInTheDocument();
    expect(screen.getByText('All Images')).toBeInTheDocument();
    expect(screen.getByText('2 parts • 2 mapped')).toBeInTheDocument();
    expect(screen.getByText('all-a-front.png')).toBeInTheDocument();
    expect(screen.getByText('all-b-front.png')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Batch'), { target: { value: 'batch-b' } });

    await waitFor(() => expect(screen.getByText('1 parts • 1 mapped')).toBeInTheDocument());
    expect(screen.queryByText('all-a-front.png')).not.toBeInTheDocument();
    expect(screen.getByText('all-b-front.png')).toBeInTheDocument();
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
                analysis_method_name: 'Watershed From Seeds',
                completed_at: '2026-04-01T09:15:00Z',
                overlay_base_image_id: 'source-image-1',
                overlay_base_filename: 'source.png',
              },
            ],
            analysis_outputs: [
              {
                filename: 'source_analyze_overlay.png',
                image_id: 'overlay-image-1',
                label: 'Segmentation Overlay :: Watershed From Seeds',
                analysis_output: true,
                analysis_method_name: 'Watershed From Seeds',
                completed_at: '2026-04-01T09:15:00Z',
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
    const viewBoard = document.querySelector('.view-board');
    expect(screen.queryByLabelText('Image categories')).not.toBeInTheDocument();
    const layerControls = screen.getByLabelText('Analyze Output Part layer toggles');
    expect(within(layerControls).getByRole('button', { name: 'SOURCE' })).toHaveAttribute('aria-pressed', 'true');
    const analysisOverlayToggle = within(layerControls).getByRole('button', { name: 'OVERLAY' });
    expect(analysisOverlayToggle).toHaveAttribute('aria-pressed', 'true');
    const restoredComposite = await screen.findByTestId('inspection-overlay-composite');
    expect(restoredComposite).toBeInTheDocument();
    expect(screen.getByLabelText('Inspection tile columns')).toHaveAttribute('max', '1');
    expect(viewBoard.style.getPropertyValue('--inspection-tile-columns')).toBe('1');
    fireEvent.change(screen.getByLabelText('Inspection tile columns'), { target: { value: '1' } });
    expect(viewBoard.style.getPropertyValue('--inspection-tile-columns')).toBe('1');
    expect(screen.getByLabelText('Inspection tile columns value')).toHaveValue(1);
    fireEvent.change(screen.getByLabelText('Inspection tile columns value'), { target: { value: '2' } });
    expect(screen.getByLabelText('Inspection tile columns')).toHaveValue('1');
    expect(viewBoard.style.getPropertyValue('--inspection-tile-columns')).toBe('1');
    expect(screen.getByText('source_analyze_overlay.png')).toBeInTheDocument();
    expect(screen.getByText(`Analysis: Watershed From Seeds • ${new Date('2026-04-01T09:15:00Z').toLocaleString()}`)).toBeInTheDocument();
    expect(within(restoredComposite).getByAltText('front source')).toHaveAttribute('src', '/api/images/source-image-1/content');
    expect(within(restoredComposite).getByAltText('front overlay')).toHaveAttribute('src', '/api/images/overlay-image-1/content');
    fireEvent.click(restoredComposite);
    expect(screen.getByAltText('Watershed From Seeds :: Segmentation Overlay fullscreen')).toBeInTheDocument();
    expect(screen.getByAltText('Watershed From Seeds :: Segmentation Overlay source fullscreen')).toHaveAttribute('src', '/api/images/source-image-1/content');
    fireEvent.click(screen.getByLabelText('Close fullscreen image'));

    fireEvent.click(screen.getByRole('button', { name: 'Delete overlay Watershed From Seeds :: Segmentation Overlay' }));
    await waitFor(() => {
      expect(screen.queryByText('Watershed From Seeds :: Segmentation Overlay')).not.toBeInTheDocument();
    });
    expect(global.fetch).toHaveBeenCalledWith('/api/projects/proj-1/analyze/overlays/overlay-image-1', { method: 'DELETE' });
  });

  test('labels assigned external overlay tiles with their overlay filename', async () => {
    mockWorkbenchFetch({
      user: 'external-overlay-subtext',
      batches: [{ id: 'batch-external-overlay', name: 'Batch External Overlay' }],
      parts: [
        {
          id: 'part-external-overlay-1',
          batch_id: 'batch-external-overlay',
          serial_number: 'SN-EXTERNAL-OVERLAY-1',
          display_name: 'External Overlay Part',
          review_state: 'in_review',
          metadata: {
            configured_views: ['front'],
            modalities: ['visual'],
            view_images: { front: 'external-overlay-front.png' },
            source_images: [
              { filename: 'external-overlay-front.png', image_id: 'external-overlay-source', side: 'front', modality: 'visual', overlay: false },
              {
                filename: 'external-mask.png',
                image_id: 'external-mask-image',
                side: 'front',
                modality: 'overlay',
                overlay: true,
                overlay_base_image_id: 'external-overlay-source',
                overlay_base_filename: 'external-overlay-front.png',
              },
            ],
          },
        },
      ],
      workspaceState: { inspector: { image_enabled: true, modalities: ['visual'], view_name: 'front' } },
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getByText('external-mask.png')).toBeInTheDocument());
    expect(screen.getByText('Overlay: external-mask.png')).toBeInTheDocument();
  });

  test('limits inspection tile columns to the configured project maximum', async () => {
    const scenario = makeImageOrderScenario();
    scenario.parts[0].metadata.source_images = Array.from({ length: 10 }, (_, index) => ({
      image_ref: `image-${index}.png`,
      image_id: `image-${index}`,
      label: `Image ${index}`,
      view: `view-${index}`,
      modality: 'visual',
    }));
    scenario.projectImages = scenario.parts[0].metadata.source_images.map((sourceImage) => ({
      id: sourceImage.image_id,
      filename: sourceImage.image_ref,
      metadata: { view: sourceImage.view, modality: 'visual' },
    }));
    mockWorkbenchFetch({
      ...scenario,
      projectConfiguration: {
        display_settings: {
          inspection_tile_max_columns: 4,
        },
      },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getByLabelText('Inspection tile columns')).toHaveAttribute('max', '4'));
    const viewBoard = document.querySelector('.view-board');
    expect(viewBoard.style.getPropertyValue('--inspection-tile-columns')).toBe('3');
    fireEvent.change(screen.getByLabelText('Inspection tile columns value'), { target: { value: '10' } });
    expect(screen.getByLabelText('Inspection tile columns')).toHaveValue('4');
    expect(viewBoard.style.getPropertyValue('--inspection-tile-columns')).toBe('4');
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

    await waitFor(() => expect(screen.getAllByText('Black Hat Overlay Part').length).toBeGreaterThan(0));
    const viewBoard = document.querySelector('.view-board');
    const blackHatLayerControls = screen.getByLabelText('Black Hat Overlay Part layer toggles');
    const blackHatOverlayToggle = within(blackHatLayerControls).getByRole('button', { name: 'OVERLAY' });
    expect(blackHatOverlayToggle).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(within(viewBoard).getAllByTestId('inspection-overlay-composite')).toHaveLength(1));
    expect(within(viewBoard).queryByAltText('front view')).not.toBeInTheDocument();
    expect(within(viewBoard).getAllByAltText('front source')).toHaveLength(1);
    expect(within(viewBoard).getAllByAltText('front overlay')).toHaveLength(1);
    expect(viewBoard.querySelectorAll('.view-cell')).toHaveLength(1);

    fireEvent.click(screen.getByText('Normal Part'));
    await waitFor(() => expect(within(viewBoard).getByAltText('front view')).toHaveAttribute('src', '/api/images/normal-source-image/content'));
    expect(within(viewBoard).queryByTestId('inspection-overlay-composite')).not.toBeInTheDocument();
    expect(viewBoard.querySelectorAll('.view-cell')).toHaveLength(1);

    fireEvent.click(screen.getByText('Black Hat Overlay Part'));
    await waitFor(() => expect(within(viewBoard).getByText('blackhat-source_blackhat_overlay.png')).toBeInTheDocument());
    expect(within(viewBoard).getAllByTestId('inspection-overlay-composite')).toHaveLength(1);
    expect(within(viewBoard).queryByAltText('front view')).not.toBeInTheDocument();
    expect(viewBoard.querySelectorAll('.view-cell')).toHaveLength(1);

    const blackHatFrontToggle = screen.getByLabelText('Black Hat Overlay Part view toggles').querySelector('button');
    fireEvent.click(blackHatFrontToggle);
    fireEvent.click(screen.getByText('Normal Part'));
    fireEvent.click(screen.getByText('Black Hat Overlay Part'));
    await waitFor(() => expect(within(viewBoard).getByText('blackhat-source_blackhat_overlay.png')).toBeInTheDocument());
    const filteredViewBoard = document.querySelector('.view-board');
    expect(within(filteredViewBoard).getAllByTestId('inspection-overlay-composite')).toHaveLength(1);
    expect(within(filteredViewBoard).queryByAltText('front view')).not.toBeInTheDocument();
    expect(filteredViewBoard.querySelectorAll('.view-cell')).toHaveLength(1);
  });

  test('shows measurement instructions and persists geometry calibration payload when creating a line', async () => {
    mockWorkbenchFetch(scenarioByUser[0]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);
    await waitFor(() => expect(screen.getByAltText('front view')).toBeInTheDocument());
    fireEvent.click(screen.getByAltText('front view'));
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
    expect(screen.getByText(/Click and drag to draw a measurement line/i)).toBeInTheDocument();

    const fullscreenImage = screen.getByAltText(/fullscreen$/i);
    expect(fullscreenImage.tagName).toBe('IMG');
    expect(fullscreenImage).toHaveAttribute('src', '/api/images/part-basic-1-image-1/content');
    expect(screen.queryByTestId('fullscreen-mpr-slice')).not.toBeInTheDocument();
    Object.defineProperty(fullscreenImage, 'width', { configurable: true, value: 1000 });
    Object.defineProperty(fullscreenImage, 'height', { configurable: true, value: 500 });
    fullscreenImage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500 });
    fireEvent.click(fullscreenImage, { clientX: 100, clientY: 100 });
    fireEvent.click(fullscreenImage, { clientX: 300, clientY: 200 });
    expect(global.fetch.mock.calls.some((call) => call[0].includes('/annotations') && call[1]?.method === 'POST')).toBe(false);

    Object.defineProperty(fullscreenImage, 'naturalWidth', { configurable: true, value: 1000 });
    Object.defineProperty(fullscreenImage, 'naturalHeight', { configurable: true, value: 500 });
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
	    fireCoordinatePointerEvent(tileImage, 'pointermove', { clientX: 100, clientY: 60, pointerId: 1 });
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
	    fireCoordinatePointerEvent(tileImage, 'pointerdown', { clientX: 50, clientY: 30, button: 0, pointerId: 2 });
	    fireCoordinatePointerEvent(tileImage, 'pointermove', { clientX: 170, clientY: 90, pointerId: 2 });
	    await waitFor(() => expect(screen.getByLabelText('tile measurement overlay')).toHaveTextContent('Width 6.00 mm'));
	    fireCoordinatePointerEvent(tileImage, 'pointerup', { clientX: 210, clientY: 130, button: 0, pointerId: 2 });

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

  test('resets fullscreen zoom and closes the fullscreen image from the backdrop only', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    expect(zoomLayer.style.transform).toBe('translate(0px, 0px) scale(1)');
    expect(screen.getByTestId('fullscreen-annotation-list')).toBeInTheDocument();

    fireEvent.click(document.querySelector('.inspection-fullscreen-modal-content'));
    expect(screen.getByLabelText('Close fullscreen image')).toBeInTheDocument();
    fireEvent.click(document.querySelector('.inspection-fullscreen-modal'));
    expect(screen.queryByLabelText('Close fullscreen image')).not.toBeInTheDocument();
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

  test('applies a calibration set from the fullscreen prompt and resumes measurement', async () => {
    mockWorkbenchFetch({ ...scenarioByUser[0], metadataDict: {} });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);
    await waitFor(() => expect(screen.getByAltText('front view')).toBeInTheDocument());
    fireEvent.click(screen.getByAltText('front view'));
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
    const prompt = screen.getByRole('dialog', { name: 'Measurement calibration required' });

    fireEvent.click(within(prompt).getByRole('button', { name: 'Set Calibration' }));
    fireEvent.change(within(prompt).getByPlaceholderText('Enter pixels per mm'), { target: { value: '12' } });
    fireEvent.click(within(prompt).getByRole('button', { name: 'Save as Project Default' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Measurement calibration required' })).not.toBeInTheDocument();
    });
    expect(screen.getByText(/draw a measurement line/i)).toBeInTheDocument();
    const metadataPost = global.fetch.mock.calls.find(([url, options = {}]) => url.includes('/metadata') && options.method === 'POST');
    expect(JSON.parse(metadataPost[1].body)).toEqual(expect.objectContaining({ key: 'calibration_default' }));
  });

  test('asks for calibration before allowing tile measurement boxes when calibration is missing', async () => {
    mockWorkbenchFetch({ ...scenarioByUser[0], metadataDict: {} });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);
    await waitFor(() => expect(screen.getByAltText('front view')).toBeInTheDocument());

    const tileImage = screen.getByAltText('front view');
    Object.defineProperty(tileImage, 'naturalWidth', { configurable: true, value: 400 });
    Object.defineProperty(tileImage, 'naturalHeight', { configurable: true, value: 200 });
    tileImage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200 });

    fireEvent.click(screen.getByRole('button', { name: 'Draw box on tiles' }));
    fireCoordinatePointerEvent(tileImage, 'pointerdown', { clientX: 50, clientY: 30, button: 0, pointerId: 3 });
    fireCoordinatePointerEvent(tileImage, 'pointermove', { clientX: 170, clientY: 90, pointerId: 3 });
    fireCoordinatePointerEvent(tileImage, 'pointerup', { clientX: 210, clientY: 130, button: 0, pointerId: 3 });

    expect(await screen.findByRole('dialog', { name: 'Measurement calibration required' })).toBeInTheDocument();
    expect(screen.getByText('No Calibration Set')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set Calibration' })).toBeInTheDocument();
    expect(screen.getByLabelText('tile measurement overlay')).not.toHaveTextContent('0.00 mm');
    expect(global.fetch.mock.calls.some((call) => call[0].includes('/annotations') && call[1]?.method === 'POST')).toBe(false);
  });

  test('removes calibration and annotation mutation tools for archived projects', async () => {
    mockWorkbenchFetch({ ...scenarioByUser[0], metadataDict: {} });
    const tileView = render(
      <InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" readOnly />,
    );
    await waitFor(() => expect(screen.getByAltText('front view')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: 'Measure on tiles' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Draw box on tiles' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set Calibration' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Measurement calibration required' })).not.toBeInTheDocument();

    tileView.unmount();
    mockWorkbenchFetch({ ...scenarioByUser[0], metadataDict: {} });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" readOnly />);
    const fullscreenTileImage = await screen.findByAltText('front view');
    fireEvent.click(fullscreenTileImage);

    expect(screen.getByRole('button', { name: 'Measure' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Draw box' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New Crop' })).toBeDisabled();
    expect(screen.queryByRole('dialog', { name: 'Measurement calibration required' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set Calibration' })).not.toBeInTheDocument();
  });

  test('keeps archived inspection viewing controls local and sends no mutation requests', async () => {
    mockWorkbenchFetch(scenarioByUser[0]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" readOnly />);

    await waitFor(() => expect(screen.getByAltText('front view')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('Loading annotations…')).not.toBeInTheDocument());
    expect(screen.getByTestId('annotation-list')).toHaveTextContent('seed-basic');

    const hideButton = screen.getByRole('button', { name: /Hide seed-basic/i });
    fireEvent.click(hideButton);
    expect(await screen.findByRole('button', { name: /Show seed-basic/i })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Edit annotation seed-basic/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Delete annotation seed-basic/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pass' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();

    fireEvent.keyDown(document, { key: 'q' });
    const forbiddenRequests = global.fetch.mock.calls.filter(([, options = {}]) => (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(options.method || 'GET').toUpperCase())
    ));
    expect(forbiddenRequests).toEqual([]);
  });

  test('read-only overlay visibility uses an explicit image ID without matching another filename', async () => {
    const targetOverlay = {
      filename: 'target-overlay.npy',
      image_id: 'overlay-explicit-id',
      label: 'Target overlay',
      modality: 'segmentation',
      overlay: true,
      hidden: false,
    };
    const filenameCollisionOverlay = {
      filename: 'overlay-explicit-id',
      image_id: 'different-overlay-id',
      label: 'Filename collision overlay',
      modality: 'segmentation',
      overlay: true,
      hidden: false,
    };
    const baseSourceImages = scenarioByUser[2].parts[0].metadata.source_images;
    mockWorkbenchFetch(makePt3ScenarioWithMetadata({
      source_images: [
        ...baseSourceImages,
        targetOverlay,
        filenameCollisionOverlay,
      ],
    }));
    render(
      <InspectionWorkbenchPanel
        projectId="proj-1"
        projectType="PT3"
        readOnly
      />,
    );

    const annotationList = await screen.findByTestId('annotation-list');
    await waitFor(() => {
      expect(within(annotationList).queryByText('Loading annotations…'))
        .not.toBeInTheDocument();
    });
    fireEvent.click(within(annotationList).getByRole(
      'button',
      { name: 'Hide external overlay Target overlay' },
    ));

    expect(await within(annotationList).findByRole(
      'button',
      { name: 'Show external overlay Target overlay' },
    )).toBeInTheDocument();
    expect(within(annotationList).getByRole(
      'button',
      { name: 'Hide external overlay Filename collision overlay' },
    )).toBeInTheDocument();
    const forbiddenRequests = global.fetch.mock.calls.filter(([, options = {}]) => (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(options.method || 'GET').toUpperCase())
    ));
    expect(forbiddenRequests).toEqual([]);
  });

  test('keeps archived PT3 segments viewable without exposing segment mutations', async () => {
    const scenario = makePt3ScenarioWithMetadata({
      annotations: [makeVistaSegmentAnnotation()],
    });
    mockWorkbenchFetch(scenario);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" readOnly />);

    const helperButton = await screen.findByRole('button', { name: 'Segmentation Helpers' });
    expect(helperButton).toBeDisabled();
    await waitFor(() => expect(screen.queryByText('Loading annotations…')).not.toBeInTheDocument());
    expect(screen.getByTestId('annotation-list')).toHaveTextContent('Internal pore');
    expect(screen.queryByRole('button', { name: 'Edit Internal pore' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete annotation Internal pore/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Hide vista segment Internal pore/i }));
    expect(await screen.findByRole('button', { name: /Show vista segment Internal pore/i })).toBeInTheDocument();

    const axialPane = screen.getByTestId('mpr-pane-axial');
    fireEvent.click(axialPane.querySelector('.mpr-pane-header'));
    expect(await screen.findByTestId('fullscreen-mpr-slice')).toHaveAttribute('data-mpr-axis', 'axial');

    const forbiddenRequests = global.fetch.mock.calls.filter(([, options = {}]) => (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(options.method || 'GET').toUpperCase())
    ));
    expect(forbiddenRequests).toEqual([]);
  });

  test('renders measurement line and length text in both tile and fullscreen overlays', async () => {
    mockWorkbenchFetch({
      ...scenarioByUser[0],
      projectConfiguration: {
        defect_types: [
          { name: ' Surface Crack ' },
          { name: 'surface crack' },
          { name: 'Porosity' },
          { name: ' other ' },
        ],
      },
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
    expect(screen.queryByRole('dialog', { name: 'Edit annotation' })).not.toBeInTheDocument();
    expect(document.querySelector('.inspection-annotation-selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit annotation Line check' }));
    expect(screen.getByRole('dialog', { name: 'Edit annotation' })).toBeInTheDocument();
    const defectTypeSelect = screen.getByLabelText('Edit annotation defect type');
    expect(defectTypeSelect).toHaveValue('Measurement');
    expect(within(defectTypeSelect).getAllByRole('option').map((option) => option.value)).toEqual([
      '',
      'Surface Crack',
      'Porosity',
      'Other',
      'Measurement',
    ]);
    fireEvent.change(screen.getByLabelText('Edit annotation comment'), { target: { value: 'Unsaved edit' } });
    fireEvent.change(defectTypeSelect, { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edit annotation' }));
    expect(screen.queryByRole('dialog', { name: 'Edit annotation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit annotation Unsaved edit' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit annotation Line check' }));
    fireEvent.change(screen.getByLabelText('Edit annotation defect type'), { target: { value: 'Surface Crack' } });
    fireEvent.change(screen.getByLabelText('Edit annotation comment'), { target: { value: 'Saved edit' } });
    fireEvent.change(screen.getByLabelText('Edit annotation overlay color'), { target: { value: '#22c55e' } });
    fireEvent.change(screen.getByLabelText('Edit annotation overlay transparency percent'), { target: { value: '65' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit annotation Saved edit' })).toBeInTheDocument());
    const stylePatchCall = global.fetch.mock.calls.find((call) => {
      if (!call[0].includes('/annotations/measurement-a') || call[1]?.method !== 'PATCH') return false;
      const body = JSON.parse(call[1].body);
      return body.comment === 'Saved edit';
    });
    const stylePatchBody = JSON.parse(stylePatchCall[1].body);
    expect(stylePatchBody.defect_class).toBe('Surface Crack');
    expect(stylePatchBody.metadata).toEqual(expect.objectContaining({
      annotation_color: '#22c55e',
      measurement_color: '#22c55e',
      annotation_fill_opacity: 0.35,
    }));
    expect(screen.getAllByText('4.20 mm').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByAltText('front view'));
    await waitFor(() => expect(screen.getAllByText('4.20 mm').length).toBeGreaterThan(1));
    expect(screen.getByTestId('fullscreen-annotation-list')).toHaveTextContent('4.20 mm');
  });

  test('reject part annotations reject the part and can be focused from part summary', async () => {
    const rejectPart = {
      ...scenarioByUser[0].parts[0],
      id: 'reject-part-target',
      batch_id: 'batch-reject',
      serial_number: 'SN-REJECT-TARGET',
      display_name: 'Reject Target Part',
      metadata: {
        ...scenarioByUser[0].parts[0].metadata,
        view_images: { front: 'reject-target-front.png' },
        annotations: [{
          id: 'reject-annotation-a',
          image_id: 'reject-part-target-image-1',
          defect_class: 'Surface Crack',
          comment: 'Rejecting crack',
          disposition: 'reject_part',
          bbox: { x: 50, y: 30, width: 120, height: 60 },
          geometry: { imageWidth: 400, imageHeight: 200, box: { x: 50, y: 30, width: 120, height: 60, imageWidth: 400, imageHeight: 200 } },
          measurements: { width_px: 120, height_px: 60 },
          created_by: 'inspector@example.com',
          created_at: '2026-04-01T09:15:00Z',
        }],
      },
    };
    mockWorkbenchFetch({
      ...scenarioByUser[0],
      batches: [{ id: 'batch-basic', name: 'Batch Basic' }, { id: 'batch-reject', name: 'Batch Reject' }],
      workspaceState: {
        selected_batch_id: '',
        selected_part_id: 'reject-part-target',
        inspector: { image_enabled: true, modalities: ['visual'], view_name: 'front' },
      },
      parts: [
        {
          ...scenarioByUser[0].parts[0],
          id: 'other-rejected-part',
          serial_number: 'SN-OTHER-REJECTED',
          display_name: 'Other Rejected Part',
          review_state: 'reject_confirmed',
          metadata: {
            ...scenarioByUser[0].parts[0].metadata,
            view_images: { front: 'other-rejected-front.png' },
          },
        },
        rejectPart,
      ],
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'View Reject Annotation' })).toHaveLength(1));
    expect(screen.getAllByText('Other Rejected Part').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reject Target Part').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'View Reject Annotation' }));

    await waitFor(() => expect(screen.queryByText('Other Rejected Part')).not.toBeInTheDocument());
    expect(screen.getAllByText('Reject Target Part').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Batch')).toHaveValue('batch-reject');
    expect(screen.getByLabelText('Status')).toHaveValue('reject_confirmed');
    expect(screen.getByLabelText('Filter')).toHaveValue('reject-part-target');
    expect(screen.getByLabelText('Inspection tile columns value')).toHaveValue(1);
    await waitFor(() => {
      expect(screen.getByTestId('annotation-list').querySelector('.annotation-entry.selected')).toHaveTextContent('Surface Crack');
      expect(document.querySelector('.inspection-annotation-selected')).toBeInTheDocument();
    });
  });

  test('creation and edit modals include Reject Part disposition and send it to the API', async () => {
    mockWorkbenchFetch({
      ...scenarioByUser[0],
      projectConfiguration: {
        defect_types: [{ name: 'Surface Crack' }],
      },
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Other' }));
    fireEvent.change(screen.getByLabelText('Annotation defect type'), { target: { value: 'Surface Crack' } });
    fireEvent.change(screen.getByLabelText('Annotation disposition'), { target: { value: 'reject_part' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save annotation' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'View Reject Annotation' })).toBeInTheDocument());
    const createCall = global.fetch.mock.calls.find((call) => call[0].endsWith('/annotations') && call[1]?.method === 'POST');
    expect(JSON.parse(createCall[1].body).disposition).toBe('reject_part');
    expect(screen.getAllByTestId('part-review-state')[0]).toHaveTextContent('Reject');

    fireEvent.click(await screen.findByRole('button', { name: 'Edit annotation seed-basic' }));
    fireEvent.change(screen.getByLabelText('Edit annotation disposition'), { target: { value: 'reject_part' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const patchCall = global.fetch.mock.calls.find((call) => call[0].includes('/annotations/seed-annotation-basic') && call[1]?.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      expect(JSON.parse(patchCall[1].body).disposition).toBe('reject_part');
    });
  });

  test('translates a persisted PT1 measurement from its fullscreen interior without creating a replacement', async () => {
    mockWorkbenchFetch({
      ...scenarioByUser[0],
      parts: [{
        ...scenarioByUser[0].parts[0],
        metadata: {
          ...scenarioByUser[0].parts[0].metadata,
          annotations: [{
            id: 'pt1-fullscreen-translate',
            image_id: 'part-basic-1-image-1',
            annotation_kind: 'measurement',
            defect_class: 'Measurement',
            comment: 'Fullscreen translated line',
            geometry: {
              line: { x1: 100, y1: 80, x2: 280, y2: 160, imageWidth: 400, imageHeight: 200 },
            },
            measurements: { length_mm: 4.92, length_px: 196.98 },
            metadata: { measurement_color: '#3b82f6', annotation_color: '#3b82f6' },
            hidden: false,
          }],
        },
      }],
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    const tileImage = await screen.findByAltText('front view');
    fireEvent.click(tileImage);
    const fullscreenImage = screen.getByAltText(/fullscreen$/i);
    Object.defineProperty(fullscreenImage, 'naturalWidth', { configurable: true, value: 400 });
    Object.defineProperty(fullscreenImage, 'naturalHeight', { configurable: true, value: 200 });
    fullscreenImage.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 200,
      right: 400,
      bottom: 200,
    });

    const fullscreenOverlay = screen.getByLabelText('fullscreen measurement overlay');
    const lineTarget = fullscreenOverlay.querySelector('line.inspection-annotation-drag-target');
    expect(lineTarget).toBeInTheDocument();
    fireCoordinatePointerEvent(lineTarget, 'pointerdown', { clientX: 190, clientY: 120, button: 0 });
    fireCoordinatePointerEvent(lineTarget, 'pointermove', { clientX: 210, clientY: 130, buttons: 1 });
    fireCoordinatePointerEvent(lineTarget, 'pointerup', { clientX: 210, clientY: 130, button: 0 });

    const annotationUrl = '/api/projects/proj-1/parts/part-basic-1/annotations/pt1-fullscreen-translate';
    await waitFor(() => {
      const calls = global.fetch.mock.calls.filter(([url, options]) => url === annotationUrl && options?.method === 'PATCH');
      expect(calls).toHaveLength(1);
      const body = JSON.parse(calls[0][1].body);
      expect(body.image_id).toBe('part-basic-1-image-1');
      expect(body.geometry.line).toEqual(expect.objectContaining({
        x1: 120,
        y1: 90,
        x2: 300,
        y2: 170,
        imageWidth: 400,
        imageHeight: 200,
      }));
      expect(body.geometry.line.x2 - body.geometry.line.x1).toBe(180);
      expect(body.geometry.line.y2 - body.geometry.line.y1).toBe(80);
    });
    const annotationPosts = global.fetch.mock.calls.filter(([url, options]) => (
      String(url).includes('/annotations') && options?.method === 'POST'
    ));
    expect(annotationPosts).toHaveLength(0);
  });

  test('translates PT1 tile measurements and resizes tile boxes in registered source coordinates', async () => {
    mockWorkbenchFetch({
      ...scenarioByUser[0],
      parts: [{
        ...scenarioByUser[0].parts[0],
        metadata: {
          ...scenarioByUser[0].parts[0].metadata,
          annotations: [
            {
              id: 'pt1-tile-line',
              image_id: 'part-basic-1-image-1',
              annotation_kind: 'measurement',
              defect_class: 'Measurement',
              comment: 'Tile translated line',
              geometry: {
                line: { x1: 100, y1: 80, x2: 280, y2: 160, imageWidth: 400, imageHeight: 200 },
              },
              measurements: { length_mm: 4.92, length_px: 196.98 },
              metadata: { measurement_color: '#3b82f6', annotation_color: '#3b82f6' },
              hidden: false,
            },
            {
              id: 'pt1-tile-box',
              image_id: 'part-basic-1-image-1',
              annotation_kind: 'annotation',
              defect_class: 'Bounding Box',
              comment: 'Tile resized box',
              geometry: {
                imageWidth: 400,
                imageHeight: 200,
                box: { x: 40, y: 30, width: 100, height: 60, imageWidth: 400, imageHeight: 200 },
              },
              bbox: { x: 40, y: 30, width: 100, height: 60 },
              measurements: { width_px: 100, height_px: 60 },
              metadata: { annotation_color: '#f97316', annotation_fill_opacity: 0.2 },
              hidden: false,
            },
          ],
        },
      }],
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    const tileImage = await screen.findByAltText('front view');
    Object.defineProperty(tileImage, 'naturalWidth', { configurable: true, value: 400 });
    Object.defineProperty(tileImage, 'naturalHeight', { configurable: true, value: 200 });
    tileImage.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 200,
      right: 400,
      bottom: 200,
    });

    const lineTarget = await screen.findByLabelText('Move tile measurement Tile translated line');
    fireCoordinatePointerEvent(lineTarget, 'pointerdown', { clientX: 190, clientY: 120, button: 0, pointerId: 31 });
    fireCoordinatePointerEvent(lineTarget, 'pointermove', { clientX: 210, clientY: 130, buttons: 1, pointerId: 31 });
    fireCoordinatePointerEvent(lineTarget, 'pointerup', { clientX: 210, clientY: 130, button: 0, pointerId: 31 });

    await waitFor(() => {
      const call = global.fetch.mock.calls.find(([url, options]) => (
        url.endsWith('/annotations/pt1-tile-line') && options?.method === 'PATCH'
      ));
      expect(call).toBeDefined();
      expect(JSON.parse(call[1].body).geometry.line).toEqual(expect.objectContaining({
        x1: 120,
        y1: 90,
        x2: 300,
        y2: 170,
      }));
    });

    const boxTarget = screen.getByLabelText('Move tile box Tile resized box');
    fireCoordinatePointerEvent(boxTarget, 'pointerdown', { clientX: 80, clientY: 60, button: 0, pointerId: 30 });
    fireCoordinatePointerEvent(boxTarget, 'pointerup', { clientX: 80, clientY: 60, button: 0, pointerId: 30 });
    const bottomRight = await screen.findByLabelText('Reposition tile bottomRight corner for Tile resized box');
    fireCoordinatePointerEvent(bottomRight, 'pointerdown', { clientX: 140, clientY: 90, button: 0, pointerId: 32 });
    fireCoordinatePointerEvent(bottomRight, 'pointermove', { clientX: 180, clientY: 120, buttons: 1, pointerId: 32 });
    fireCoordinatePointerEvent(bottomRight, 'pointerup', { clientX: 180, clientY: 120, button: 0, pointerId: 32 });

    await waitFor(() => {
      const call = global.fetch.mock.calls.find(([url, options]) => (
        url.endsWith('/annotations/pt1-tile-box') && options?.method === 'PATCH'
      ));
      expect(call).toBeDefined();
      expect(JSON.parse(call[1].body).geometry.box).toEqual(expect.objectContaining({
        x: 40,
        y: 30,
        width: 140,
        height: 90,
      }));
    });
  });

  test('pans the selected tile viewport with a middle-mouse drag without creating annotations', async () => {
    mockWorkbenchFetch(scenarioByUser[0]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    const tileImage = await screen.findByAltText('front view');
    const viewport = () => tileImage.closest('[data-viewport-pan-x]');
    expect(viewport()).not.toBeNull();
    fireCoordinatePointerEvent(tileImage, 'pointerdown', { clientX: 100, clientY: 100, button: 1, buttons: 4, pointerId: 41 });
    fireCoordinatePointerEvent(tileImage, 'pointermove', { clientX: 130, clientY: 85, buttons: 4, pointerId: 41 });
    fireCoordinatePointerEvent(tileImage, 'pointerup', { clientX: 130, clientY: 85, button: 1, pointerId: 41 });

    await waitFor(() => {
      expect(viewport()).toHaveAttribute('data-viewport-pan-x', '30');
      expect(viewport()).toHaveAttribute('data-viewport-pan-y', '-15');
    });
    expect(global.fetch.mock.calls.some(([url, options]) => (
      String(url).includes('/annotations') && ['POST', 'PATCH'].includes(options?.method)
    ))).toBe(false);
  });

  test('keeps the fullscreen line hit target above visible paint and translates in saved geometry coordinates', async () => {
    mockWorkbenchFetch({
      ...scenarioByUser[0],
      parts: [{
        ...scenarioByUser[0].parts[0],
        metadata: {
          ...scenarioByUser[0].parts[0].metadata,
          annotations: [{
            id: 'pt1-fullscreen-scaled-line',
            image_id: 'part-basic-1-image-1',
            annotation_kind: 'measurement',
            defect_class: 'Measurement',
            comment: 'Scaled fullscreen line',
            geometry: {
              line: { x1: 100, y1: 80, x2: 280, y2: 160, imageWidth: 400, imageHeight: 200 },
            },
            measurements: { length_mm: 4.92, length_px: 196.98 },
            metadata: { measurement_color: '#3b82f6', annotation_color: '#3b82f6' },
            hidden: false,
          }],
        },
      }],
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    fireEvent.click(await screen.findByAltText('front view'));
    const fullscreenImage = screen.getByAltText(/fullscreen$/i);
    Object.defineProperty(fullscreenImage, 'naturalWidth', { configurable: true, value: 800 });
    Object.defineProperty(fullscreenImage, 'naturalHeight', { configurable: true, value: 400 });
    fullscreenImage.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 400,
      right: 800,
      bottom: 400,
    });

    const fullscreenOverlay = screen.getByLabelText('fullscreen measurement overlay');
    const visibleLine = fullscreenOverlay.querySelector('line[stroke="#3b82f6"]');
    const hitTarget = fullscreenOverlay.querySelector('line.inspection-annotation-drag-target');
    const label = visibleLine.parentElement.querySelector('text');
    expect(visibleLine).toHaveAttribute('pointer-events', 'none');
    expect(label).toHaveAttribute('pointer-events', 'none');
    expect(hitTarget).toHaveAttribute('x1', visibleLine.getAttribute('x1'));
    expect(hitTarget).toHaveAttribute('y1', visibleLine.getAttribute('y1'));
    expect([...visibleLine.parentElement.children].indexOf(hitTarget)).toBeGreaterThan(
      [...visibleLine.parentElement.children].indexOf(label),
    );

    fireCoordinatePointerEvent(hitTarget, 'pointerdown', { clientX: 380, clientY: 240, button: 0 });
    fireCoordinatePointerEvent(hitTarget, 'pointermove', { clientX: 420, clientY: 260, buttons: 1 });
    fireCoordinatePointerEvent(hitTarget, 'pointerup', { clientX: 420, clientY: 260, button: 0 });

    const annotationUrl = '/api/projects/proj-1/parts/part-basic-1/annotations/pt1-fullscreen-scaled-line';
    await waitFor(() => {
      const calls = global.fetch.mock.calls.filter(([url, options]) => url === annotationUrl && options?.method === 'PATCH');
      expect(calls).toHaveLength(1);
      expect(JSON.parse(calls[0][1].body).geometry.line).toEqual(expect.objectContaining({
        x1: 120,
        y1: 90,
        x2: 300,
        y2: 170,
        imageWidth: 400,
        imageHeight: 200,
      }));
    });
  });

  test('maps mismatched fullscreen line endpoint and box translate and corner drags to each saved geometry space', async () => {
    mockWorkbenchFetch({
      ...scenarioByUser[0],
      parts: [{
        ...scenarioByUser[0].parts[0],
        metadata: {
          ...scenarioByUser[0].parts[0].metadata,
          annotations: [
            {
              id: 'pt1-fullscreen-scaled-endpoint',
              image_id: 'part-basic-1-image-1',
              annotation_kind: 'measurement',
              defect_class: 'Measurement',
              comment: 'Scaled endpoint line',
              geometry: {
                line: { x1: 100, y1: 80, x2: 280, y2: 160, imageWidth: 400, imageHeight: 200 },
              },
              measurements: { length_mm: 4.92, length_px: 196.98 },
              metadata: { measurement_color: '#3b82f6', annotation_color: '#3b82f6' },
              hidden: false,
            },
            {
              id: 'pt1-fullscreen-scaled-box',
              image_id: 'part-basic-1-image-1',
              annotation_kind: 'annotation',
              defect_class: 'Bounding Box',
              comment: 'Scaled fullscreen box',
              geometry: {
                box: { x: 50, y: 20, width: 50, height: 30, imageWidth: 200, imageHeight: 100 },
              },
              bbox: { x: 50, y: 20, width: 50, height: 30 },
              measurements: { width_px: 50, height_px: 30 },
              metadata: { annotation_color: '#f59e0b', annotation_fill_opacity: 0.2 },
              hidden: false,
            },
          ],
        },
      }],
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    fireEvent.click(await screen.findByAltText('front view'));
    const fullscreenImage = screen.getByAltText(/fullscreen$/i);
    Object.defineProperty(fullscreenImage, 'naturalWidth', { configurable: true, value: 800 });
    Object.defineProperty(fullscreenImage, 'naturalHeight', { configurable: true, value: 400 });
    fullscreenImage.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 400,
      right: 800,
      bottom: 400,
    });

    const fullscreenList = screen.getByTestId('fullscreen-annotation-list');
    fireEvent.click(within(fullscreenList).getByText('Scaled endpoint line'));
    const startEndpoint = await screen.findByLabelText('Reposition start endpoint for Scaled endpoint line');
    fireCoordinatePointerEvent(startEndpoint, 'pointerdown', { clientX: 200, clientY: 160, button: 0 });
    fireCoordinatePointerEvent(startEndpoint, 'pointermove', { clientX: 160, clientY: 140, buttons: 1 });
    fireCoordinatePointerEvent(startEndpoint, 'pointerup', { clientX: 160, clientY: 140, button: 0 });

    const lineUrl = '/api/projects/proj-1/parts/part-basic-1/annotations/pt1-fullscreen-scaled-endpoint';
    await waitFor(() => {
      const calls = global.fetch.mock.calls.filter(([url, options]) => url === lineUrl && options?.method === 'PATCH');
      expect(calls).toHaveLength(1);
      expect(JSON.parse(calls[0][1].body).geometry.line).toEqual(expect.objectContaining({
        x1: 80,
        y1: 70,
        x2: 280,
        y2: 160,
        imageWidth: 400,
        imageHeight: 200,
      }));
    });

    const fullscreenOverlay = screen.getByLabelText('fullscreen measurement overlay');
    const boxTarget = fullscreenOverlay.querySelector('rect.inspection-annotation-drag-target');
    fireCoordinatePointerEvent(boxTarget, 'pointerdown', { clientX: 300, clientY: 140, button: 0 });
    fireCoordinatePointerEvent(boxTarget, 'pointermove', { clientX: 340, clientY: 180, buttons: 1 });
    fireCoordinatePointerEvent(boxTarget, 'pointerup', { clientX: 340, clientY: 180, button: 0 });

    const boxUrl = '/api/projects/proj-1/parts/part-basic-1/annotations/pt1-fullscreen-scaled-box';
    await waitFor(() => {
      const calls = global.fetch.mock.calls.filter(([url, options]) => url === boxUrl && options?.method === 'PATCH');
      expect(calls).toHaveLength(1);
      expect(JSON.parse(calls[0][1].body).geometry.box).toEqual(expect.objectContaining({
        x: 60,
        y: 30,
        width: 50,
        height: 30,
        imageWidth: 200,
        imageHeight: 100,
      }));
    });

    const bottomRight = await screen.findByLabelText('Reposition bottomRight corner for Scaled fullscreen box');
    fireCoordinatePointerEvent(bottomRight, 'pointerdown', { clientX: 440, clientY: 240, button: 0 });
    fireCoordinatePointerEvent(bottomRight, 'pointermove', { clientX: 480, clientY: 320, buttons: 1 });
    fireCoordinatePointerEvent(bottomRight, 'pointerup', { clientX: 480, clientY: 320, button: 0 });

    await waitFor(() => {
      const calls = global.fetch.mock.calls.filter(([url, options]) => url === boxUrl && options?.method === 'PATCH');
      expect(calls).toHaveLength(2);
      expect(JSON.parse(calls[1][1].body).geometry.box).toEqual(expect.objectContaining({
        x: 60,
        y: 30,
        width: 60,
        height: 50,
        imageWidth: 200,
        imageHeight: 100,
      }));
    });
  });

  test('toggles annotation overlay visibility from the inspection panel', async () => {
    mockWorkbenchFetch({
      ...scenarioByUser[0],
      parts: [{
        ...scenarioByUser[0].parts[0],
        metadata: {
          ...scenarioByUser[0].parts[0].metadata,
          annotations: [{
            id: 'measurement-toggle-a',
            image_id: 'part-basic-1-image-1',
            defect_class: 'Measurement',
            comment: 'Toggle line check',
            geometry: { line: { x1: 100, y1: 80, x2: 280, y2: 160, imageWidth: 400, imageHeight: 200 } },
            measurements: { length_mm: 4.2 },
            created_by: 'inspector@example.com',
            created_at: '2026-04-01T09:15:00Z',
          }],
        },
      }],
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    const displayToggle = await screen.findByLabelText('Show annotations');
    await waitFor(() => expect(screen.getByLabelText('tile measurement overlay')).toHaveTextContent('4.20 mm'));
    expect(displayToggle).toBeChecked();
    expect(screen.getByTestId('annotation-list')).toHaveTextContent('4.20 mm');

    fireEvent.click(displayToggle);
    await waitFor(() => expect(screen.getByLabelText('tile measurement overlay')).not.toHaveTextContent('4.20 mm'));
    expect(screen.getByTestId('annotation-list')).toHaveTextContent('4.20 mm');

    fireEvent.click(displayToggle);
    await waitFor(() => expect(screen.getByLabelText('tile measurement overlay')).toHaveTextContent('4.20 mm'));
  });

  test('uses per-annotation transparency without a global annotation transparency control', async () => {
    mockWorkbenchFetch({
      ...scenarioByUser[0],
      parts: [{
        ...scenarioByUser[0].parts[0],
        metadata: {
          ...scenarioByUser[0].parts[0].metadata,
          annotations: [{
            id: 'measurement-transparency-a',
            image_id: 'part-basic-1-image-1',
            defect_class: 'Measurement',
            comment: 'Transparency line check',
            geometry: { line: { x1: 100, y1: 80, x2: 280, y2: 160, imageWidth: 400, imageHeight: 200 } },
            measurements: { length_mm: 4.2 },
          }],
        },
      }],
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await screen.findByLabelText('Show annotations');
    expect(screen.queryByLabelText('Annotation transparency percent')).not.toBeInTheDocument();
    const overlay = await screen.findByLabelText('tile measurement overlay');
    fireEvent.click(screen.getByRole('button', { name: 'Edit annotation Transparency line check' }));
    fireEvent.change(screen.getByLabelText('Edit annotation overlay transparency percent'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit annotation' })).not.toBeInTheDocument());
    await waitFor(() => expect(overlay.querySelector('g[opacity="0.75"]')).toBeInTheDocument());
    expect(overlay.querySelector('.inspection-annotation-drag-target')).not.toHaveAttribute('opacity');
  });

  test('zooms only the selected tile image under the mouse wheel', async () => {
    mockWorkbenchFetch(makeImageOrderScenario());
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    const frontImage = await screen.findByAltText('front view');
    const backImage = await screen.findByAltText('back view');
    const frontSurface = frontImage.closest('.inspection-image-annotation-surface');
    const backSurface = backImage.closest('.inspection-image-annotation-surface');
    expect(frontSurface).toHaveAttribute('data-viewport-zoom', '1');
    expect(backSurface).toHaveAttribute('data-viewport-zoom', '1');

    Object.defineProperty(frontImage, 'naturalWidth', { configurable: true, value: 400 });
    Object.defineProperty(frontImage, 'naturalHeight', { configurable: true, value: 200 });
    Object.defineProperty(backImage, 'naturalWidth', { configurable: true, value: 400 });
    Object.defineProperty(backImage, 'naturalHeight', { configurable: true, value: 200 });
    frontImage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200 });
    backImage.getBoundingClientRect = () => ({ left: 0, top: 220, width: 400, height: 200, right: 400, bottom: 420 });

    fireEvent.wheel(backSurface, { deltaY: -80, clientX: 200, clientY: 320 });
    expect(frontSurface).toHaveAttribute('data-viewport-zoom', '1');
    expect(backSurface).toHaveAttribute('data-viewport-zoom', '1');

    fireEvent.click(backImage);
    fireEvent.wheel(backSurface, { deltaY: -80, clientX: 200, clientY: 320 });
    await waitFor(() => expect(backSurface).toHaveAttribute('data-viewport-zoom', '1.15'));
    expect(backSurface.style.transform).toBe('translate(0px, 0px) scale(1.15)');
    expect(frontSurface).toHaveAttribute('data-viewport-zoom', '1');
    expect(frontSurface.style.transform).toBe('');

    fireEvent.wheel(frontSurface, { deltaY: -80, clientX: 200, clientY: 100 });
    expect(frontSurface).toHaveAttribute('data-viewport-zoom', '1');
    expect(backSurface).toHaveAttribute('data-viewport-zoom', '1.15');
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
          modalities: ['optical'],
          source_images: [
            {
              filename: 'part-basic-1-image-1',
              image_id: 'filename-collision-image',
              side: 'collision',
              modality: 'wrong-collision-modality',
              overlay: false,
            },
            {
              filename: 'front-basic.png',
              image_id: 'part-basic-1-image-1',
              side: 'front',
              modality: 'optical',
              overlay: false,
            },
          ],
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
      expect(uploadedFile.name).toBe('25_40_child of front-basic.png.png');
      expect(uploadedMetadata).toEqual(expect.objectContaining({
        crop_child_image: true,
        parent_image_id: 'part-basic-1-image-1',
        parent_image_filename: 'front-basic.png',
        crop_annotation_id: 'box-crop-a',
        crop_title: 'Child of front-basic.png',
      }));
      expect(uploadedMetadata.modality).toBe('optical');
      expect(uploadedMetadata.crop_bbox).toEqual(expect.objectContaining({ x: 25, y: 40, width: 80, height: 50 }));
      expect(global.fetch).toHaveBeenCalledWith('/api/projects/proj-1/parts/image-assignments', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          filename: '25_40_child of front-basic.png.png',
          image_id: 'uploaded-image-1',
          to_part_id: 'part-basic-1',
        }),
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

    const measureButton = screen.getByRole('button', { name: 'Measure' });
    fireEvent.click(measureButton);
    expect(measureButton).toHaveClass('active');
    expect(screen.getByText(/Click and drag to draw a measurement line/i).closest('.inspection-fullscreen-tool-notice')).toBeInTheDocument();
    expect(document.querySelector('.inspection-fullscreen-stage')?.firstElementChild).toHaveClass('inspection-fullscreen-tool-notice');
    expect(document.querySelector('.inspection-fullscreen-workspace')).toBeInTheDocument();
    expect(zoomLayer.style.transform).toBe('translate(0px, 0px) scale(1.15)');
    fireEvent.click(measureButton);
    expect(measureButton).not.toHaveClass('active');
    expect(document.querySelector('.inspection-fullscreen-tool-notice')).not.toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Draw box' })).not.toHaveClass('active');
    expect(zoomLayer.style.transform).toBe('translate(0px, 0px) scale(1.15)');

    fireEvent.click(screen.getByRole('button', { name: 'Draw box' }));
    expect(screen.getByRole('button', { name: 'Draw box' })).toHaveClass('active');
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

    await waitFor(() => expect(screen.getByRole('button', { name: 'Draw box' })).not.toHaveClass('active'));
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
    await waitFor(() => expect(screen.getAllByText('5.00 mm').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getAllByText('5.00 mm').length).toBeGreaterThan(1));

    fireEvent.click(screen.getByTestId('inspection-overlay-composite'));
    await waitFor(() => expect(screen.getByTestId('fullscreen-annotation-list')).toHaveTextContent('Shared source length'));
    expect(screen.getByAltText('Segmentation Overlay source fullscreen')).toHaveAttribute('src', '/api/images/source-image-1/content');
    expect(screen.getByAltText('Segmentation Overlay fullscreen')).toHaveAttribute('src', '/api/images/overlay-image-1/content');

    const fullscreenAnnotationList = screen.getByTestId('fullscreen-annotation-list');
    fireEvent.click(within(fullscreenAnnotationList).getByRole('button', {
      name: 'Hide fullscreen annotation External: Segmentation Overlay',
    }));
    await waitFor(() => {
      expect(screen.queryByAltText('Segmentation Overlay source fullscreen')).not.toBeInTheDocument();
      expect(screen.getByAltText('Segmentation Overlay fullscreen')).toHaveAttribute('src', '/api/images/source-image-1/content');
      expect(within(fullscreenAnnotationList).getByRole('button', {
        name: 'Show fullscreen annotation External: Segmentation Overlay',
      })).toBeInTheDocument();
    });
    fireEvent.click(within(fullscreenAnnotationList).getByRole('button', {
      name: 'Show fullscreen annotation External: Segmentation Overlay',
    }));
    await waitFor(() => {
      expect(screen.getByAltText('Segmentation Overlay source fullscreen')).toHaveAttribute('src', '/api/images/source-image-1/content');
      expect(screen.getByAltText('Segmentation Overlay fullscreen')).toHaveAttribute('src', '/api/images/overlay-image-1/content');
    });

    const fullscreenModal = screen.getByAltText('Segmentation Overlay fullscreen').closest('.inspection-fullscreen-modal-content');
    const fullscreenGlobalVisibility = within(fullscreenModal).getByLabelText('Show annotations');
    fireEvent.click(fullscreenGlobalVisibility);
    expect(screen.queryByAltText('Segmentation Overlay source fullscreen')).not.toBeInTheDocument();
    expect(screen.getByAltText('Segmentation Overlay fullscreen')).toHaveAttribute('src', '/api/images/source-image-1/content');
    fireEvent.click(fullscreenGlobalVisibility);
    await waitFor(() => {
      expect(screen.getByAltText('Segmentation Overlay source fullscreen')).toHaveAttribute('src', '/api/images/source-image-1/content');
      expect(screen.getByAltText('Segmentation Overlay fullscreen')).toHaveAttribute('src', '/api/images/overlay-image-1/content');
    });
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

  test('assigned overlays are visible by default on PT1 part selection', async () => {
    const views = ['front', 'back'];
    const parts = [1, 2, 3].map((partNumber) => {
      const sourceImages = views.flatMap((view) => {
        const baseFilename = `part-${partNumber}-${view}.png`;
        const baseImageId = `part-${partNumber}-${view}-source`;
        return [
          {
            filename: baseFilename,
            image_id: baseImageId,
            side: view,
            modality: 'visual',
            overlay: false,
          },
          {
            filename: `part-${partNumber}-${view}-overlay.png`,
            image_id: `part-${partNumber}-${view}-overlay`,
            side: view,
            modality: 'overlay',
            overlay: true,
            overlay_base_image_id: baseImageId,
            overlay_base_filename: baseFilename,
          },
        ];
      });
      return {
        id: `part-overlay-${partNumber}`,
        batch_id: 'batch-overlay',
        serial_number: `SN-OVERLAY-${partNumber}`,
        display_name: `Overlay Part ${partNumber}`,
        review_state: 'in_review',
        metadata: {
          configured_views: views,
          modalities: ['visual', 'overlay'],
          view_images: {
            front: `part-${partNumber}-front.png`,
            back: `part-${partNumber}-back.png`,
          },
          source_images: sourceImages,
        },
      };
    });

    mockWorkbenchFetch({
      user: 'assigned-overlays',
      batches: [{ id: 'batch-overlay', name: 'Batch Overlay' }],
      parts,
      workspaceState: {
        selected_batch_id: 'batch-overlay',
        selected_part_id: 'part-overlay-1',
        inspector: { image_enabled: true, modalities: ['visual'], view_name: 'front' },
      },
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getAllByText('Overlay Part 1').length).toBeGreaterThan(0));
    expect(screen.getByText('Overlay Part 2')).toBeInTheDocument();
    expect(screen.getByText('Overlay Part 3')).toBeInTheDocument();

    expect(screen.queryByLabelText('Image categories')).not.toBeInTheDocument();
    const layerControls = screen.getByLabelText('Overlay Part 1 layer toggles');
    const sourceToggle = within(layerControls).getByRole('button', { name: 'SOURCE' });
    const overlayToggle = within(layerControls).getByRole('button', { name: 'OVERLAY' });
    expect(sourceToggle).toHaveAttribute('aria-pressed', 'true');
    expect(overlayToggle).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.getAllByTestId('inspection-overlay-composite')).toHaveLength(2));
    expect(screen.getAllByAltText('front source')).toHaveLength(1);
    expect(screen.getAllByAltText('front overlay')).toHaveLength(1);
    expect(screen.getByText('part-1-front-overlay.png')).toBeInTheDocument();
    expect(screen.getByText('part-1-back-overlay.png')).toBeInTheDocument();
    expect(screen.getByText('Overlay: part-1-front-overlay.png')).toBeInTheDocument();
    expect(screen.getByText('Overlay: part-1-back-overlay.png')).toBeInTheDocument();
    expect(screen.getAllByAltText('back source')).toHaveLength(1);
    expect(screen.getAllByAltText('back overlay')).toHaveLength(1);
    expect(screen.queryByAltText('front view')).not.toBeInTheDocument();
    expect(overlayToggle).toHaveAttribute('aria-pressed', 'true');
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
      projectConfiguration: {
        image_modalities: [
          { id: 'visual', label: 'Visual' },
          { id: 'thermal', label: 'Thermal' },
        ],
      },
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getAllByText('Modal Part').length).toBeGreaterThan(0));
    expect(screen.getAllByAltText('front view')).toHaveLength(1);

    const partModalityToggles = screen.getByLabelText('Modal Part modality toggles');
    expect(within(partModalityToggles).getByRole('button', { name: 'ALL' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(within(partModalityToggles).getByRole('button', { name: 'THERMAL' }));
    await waitFor(() => expect(screen.getAllByAltText('front view')).toHaveLength(1));
    expect(screen.getByAltText('front view')).toHaveAttribute('src', '/api/images/modal-thermal-image/content');
    expect(within(partModalityToggles).getByRole('button', { name: 'VISUAL' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(partModalityToggles).getByRole('button', { name: 'THERMAL' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(partModalityToggles).getByRole('button', { name: 'ALL' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(within(partModalityToggles).getByRole('button', { name: 'VISUAL' }));
    await waitFor(() => expect(screen.getAllByAltText('front view')).toHaveLength(1));
    expect(screen.getByAltText('front view')).toHaveAttribute('src', '/api/images/modal-visual-image/content');

    fireEvent.click(within(partModalityToggles).getByRole('button', { name: 'ALL' }));
    await waitFor(() => expect(screen.getAllByAltText('front view')).toHaveLength(2));
    expect(within(partModalityToggles).getByRole('button', { name: 'ALL' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(screen.getByLabelText('Modal Part view toggles')).getByRole('button', { name: 'FRONT' }));
    await waitFor(() => expect(screen.getAllByAltText('front view')).toHaveLength(2));
  });



  test('All part aggregates view and modality filters across visible parts and collapses rows', async () => {
    mockWorkbenchFetch({
      user: 'all-part-aggregate',
      batches: [{ id: 'batch-all', name: 'Batch All' }],
      parts: [
        {
          id: 'part-all-1',
          batch_id: 'batch-all',
          serial_number: 'SN-ALL-1',
          display_name: 'All Part A',
          review_state: 'unreviewed',
          metadata: {
            configured_views: ['top', 'side'],
            modalities: ['optical', 'thermal'],
            view_images: { top: 'part-a-top-optical.png', side: 'part-a-side-thermal.png' },
            source_images: [
              { filename: 'part-a-top-optical.png', image_id: 'all-a-top-optical', side: 'top', modality: 'optical', overlay: false },
              { filename: 'part-a-side-thermal.png', image_id: 'all-a-side-thermal', side: 'side', modality: 'thermal', overlay: false },
            ],
            annotations: [],
          },
        },
        {
          id: 'part-all-2',
          batch_id: 'batch-all',
          serial_number: 'SN-ALL-2',
          display_name: 'All Part B',
          review_state: 'pass',
          metadata: {
            configured_views: ['top', 'side'],
            modalities: ['optical', 'thermal'],
            view_images: { top: 'part-b-top-optical.png', side: 'part-b-side-thermal.png' },
            source_images: [
              { filename: 'part-b-top-optical.png', image_id: 'all-b-top-optical', side: 'top', modality: 'optical', overlay: false },
              { filename: 'part-b-side-thermal.png', image_id: 'all-b-side-thermal', side: 'side', modality: 'thermal', overlay: false },
            ],
            annotations: [],
          },
        },
      ],
      workspaceState: {
        selected_batch_id: 'batch-all',
        selected_part_id: '__all_parts__',
        inspector: { image_enabled: true, modalities: ['optical'], view_name: 'top' },
      },
      projectConfiguration: {
        image_modalities: [
          { id: 'optical', label: 'Optical' },
          { id: 'thermal', label: 'Thermal' },
        ],
      },
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    const viewAllImagesTab = await screen.findByRole('tab', { name: 'View All Images' });
    fireEvent.click(viewAllImagesTab);
    await waitFor(() => expect(viewAllImagesTab).toHaveAttribute('aria-selected', 'true'));
    const allRow = document.querySelector('.workbench-part-row-all');
    const rows = document.querySelectorAll('.workbench-part-row');
    expect(rows[0]).toHaveTextContent('All Images');
    expect(allRow).toHaveClass('selected');
    await waitFor(() => expect(screen.getAllByAltText('top view')).toHaveLength(2));
    expect(screen.getAllByText('All Part A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('All Part B').length).toBeGreaterThan(0);
    expect(Array.from(document.querySelectorAll('.inspection-image-part-label')).map((element) => element.textContent)).toEqual([
      'All Part A',
      'All Part B',
    ]);

    const { menu } = await openSortMenu();
    fireEvent.change(within(menu).getByRole('combobox', { name: 'Primary image sort' }), {
      target: { value: 'filename_desc' },
    });
    fireEvent.click(within(menu).getByRole('button', { name: 'Apply sort' }));
    await waitFor(() => {
      expect(Array.from(document.querySelectorAll('.inspection-image-part-label')).map((element) => element.textContent)).toEqual([
        'All Part B',
        'All Part A',
      ]);
    });
    expect(getImageOrderSaveCalls()).toHaveLength(0);

    fireEvent.click(within(screen.getByLabelText('All Images modality toggles')).getByRole('button', { name: 'THERMAL' }));
    await waitFor(() => expect(screen.queryByAltText('top view')).not.toBeInTheDocument());
    expect(screen.getAllByAltText('side view')).toHaveLength(2);
    expect(within(screen.getByLabelText('All Images modality toggles')).getByRole('button', { name: 'ALL' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(within(screen.getByLabelText('All Images modality toggles')).getByRole('button', { name: 'ALL' }));
    await waitFor(() => expect(screen.getAllByAltText('top view')).toHaveLength(2));
    expect(screen.getAllByAltText('side view')).toHaveLength(2);
    expect(within(screen.getByLabelText('All Images modality toggles')).getByRole('button', { name: 'ALL' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(screen.getByLabelText('All Images view toggles')).getByRole('button', { name: 'TOP' }));
    await waitFor(() => expect(screen.getAllByAltText('top view')).toHaveLength(2));
    expect(screen.queryByAltText('side view')).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('All Images view toggles')).getByRole('button', { name: 'ALL' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(within(screen.getByLabelText('All Images view toggles')).getByRole('button', { name: 'ALL' }));
    await waitFor(() => expect(screen.getAllByAltText('side view')).toHaveLength(2));
    expect(within(screen.getByLabelText('All Images view toggles')).getByRole('button', { name: 'ALL' })).toHaveAttribute('aria-pressed', 'true');

    const collapseAll = within(allRow).getByRole('button', { name: 'Collapse row' });
    fireEvent.click(collapseAll);
    expect(allRow).toHaveClass('collapsed');
    expect(within(allRow).queryByLabelText('All Images view toggles')).not.toBeInTheDocument();
    expect(within(allRow).getByRole('button', { name: 'Expand row' })).toBeInTheDocument();

    const viewPartsTab = screen.getByRole('tab', { name: 'View Parts' });
    fireEvent.click(viewPartsTab);
    await waitFor(() => expect(viewPartsTab).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByLabelText('All Part A view toggles')).toBeInTheDocument();
    expect(screen.getByLabelText('All Part B view toggles')).toBeInTheDocument();
  });

  test('part summary layer filters deselect All on meta and real part rows', async () => {
    const parts = [
      {
        id: 'part-layer-a',
        batch_id: 'batch-layer',
        serial_number: 'SN-LAYER-A',
        display_name: 'Layer Part A',
        review_state: 'unreviewed',
        metadata: {
          configured_views: ['front'],
          modalities: ['visual'],
          view_images: { front: 'layer-a-front.png' },
          source_images: [
            { filename: 'layer-a-front.png', image_id: 'layer-a-front', side: 'front', modality: 'visual', overlay: false },
            {
              filename: 'layer-a-overlay.png',
              image_id: 'layer-a-overlay',
              side: 'front',
              modality: 'overlay',
              overlay: true,
              overlay_base_image_id: 'layer-a-front',
              overlay_base_filename: 'layer-a-front.png',
            },
          ],
        },
      },
      {
        id: 'part-layer-b',
        batch_id: 'batch-layer',
        serial_number: 'SN-LAYER-B',
        display_name: 'Layer Part B',
        review_state: 'unreviewed',
        metadata: {
          configured_views: ['front'],
          modalities: ['visual'],
          view_images: { front: 'layer-b-front.png' },
          source_images: [
            { filename: 'layer-b-front.png', image_id: 'layer-b-front', side: 'front', modality: 'visual', overlay: false },
            {
              filename: 'layer-b-overlay.png',
              image_id: 'layer-b-overlay',
              side: 'front',
              modality: 'overlay',
              overlay: true,
              overlay_base_image_id: 'layer-b-front',
              overlay_base_filename: 'layer-b-front.png',
            },
          ],
        },
      },
    ];

    mockWorkbenchFetch({
      user: 'layer-filter-all-state',
      batches: [{ id: 'batch-layer', name: 'Batch Layer' }],
      parts,
      workspaceState: {
        selected_batch_id: 'batch-layer',
        selected_part_id: '__all_parts__',
        inspector: { image_enabled: true, modalities: ['visual'], view_name: 'front' },
      },
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getAllByTestId('inspection-overlay-composite')).toHaveLength(2));

    fireEvent.click(within(screen.getByLabelText('All Images layer toggles')).getByRole('button', { name: 'SOURCE' }));
    await waitFor(() => expect(screen.getAllByAltText('front view')).toHaveLength(2));
    expect(screen.queryByTestId('inspection-overlay-composite')).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('All Images layer toggles')).getByRole('button', { name: 'ALL' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(within(screen.getByLabelText('All Images layer toggles')).getByRole('button', { name: 'ALL' }));
    await waitFor(() => expect(screen.getAllByTestId('inspection-overlay-composite')).toHaveLength(2));
    expect(within(screen.getByLabelText('All Images layer toggles')).getByRole('button', { name: 'ALL' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('All part ignores stale saved modalities that would hide every loaded image', async () => {
    mockWorkbenchFetch({
      user: 'all-part-stale-modalities',
      batches: [{ id: 'batch-all-stale', name: 'Batch All Stale' }],
      parts: [
        {
          id: 'part-all-stale-1',
          batch_id: 'batch-all-stale',
          serial_number: 'SN-STALE-1',
          display_name: 'All Stale A',
          review_state: 'unreviewed',
          metadata: {
            configured_views: ['top'],
            modalities: ['optical'],
            view_images: { top: 'stale-a-top-optical.png' },
            source_images: [
              { filename: 'stale-a-top-optical.png', image_id: 'stale-a-top-optical', side: 'top', modality: 'optical', overlay: false },
            ],
            annotations: [],
          },
        },
        {
          id: 'part-all-stale-2',
          batch_id: 'batch-all-stale',
          serial_number: 'SN-STALE-2',
          display_name: 'All Stale B',
          review_state: 'unreviewed',
          metadata: {
            configured_views: ['side'],
            modalities: ['thermal'],
            view_images: { side: 'stale-b-side-thermal.png' },
            source_images: [
              { filename: 'stale-b-side-thermal.png', image_id: 'stale-b-side-thermal', side: 'side', modality: 'thermal', overlay: false },
            ],
            annotations: [],
          },
        },
      ],
      workspaceState: {
        selected_batch_id: 'batch-all-stale',
        selected_part_id: '__all_parts__',
        inspector: { image_enabled: true, modalities: ['visual'], view_name: 'front' },
      },
      projectConfiguration: {
        image_modalities: [
          { id: 'optical', label: 'Optical' },
          { id: 'thermal', label: 'Thermal' },
        ],
      },
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getAllByAltText('top view')).toHaveLength(1));
    expect(screen.getAllByAltText('side view')).toHaveLength(1);
    expect(screen.queryByText('No mapped images match the current filters.')).not.toBeInTheDocument();
    const modalityToggles = screen.getByLabelText('All Images modality toggles');
    expect(within(modalityToggles).getByRole('button', { name: 'OPTICAL' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(modalityToggles).getByRole('button', { name: 'THERMAL' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('All part shows source images whose modalities are not in project configuration', async () => {
    mockWorkbenchFetch({
      user: 'all-part-unconfigured-source-modalities',
      batches: [{ id: 'batch-all-unconfigured', name: 'Batch All Unconfigured' }],
      parts: [
        {
          id: 'part-all-unconfigured-1',
          batch_id: 'batch-all-unconfigured',
          serial_number: 'SN-UNCONFIGURED-1',
          display_name: 'All Unconfigured A',
          review_state: 'unreviewed',
          metadata: {
            configured_views: ['top'],
            modalities: ['optical'],
            view_images: { top: 'unconfigured-a-top-optical.png' },
            source_images: [
              { filename: 'unconfigured-a-top-optical.png', image_id: 'unconfigured-a-top-optical', side: 'top', modality: 'optical', overlay: false },
            ],
            annotations: [],
          },
        },
        {
          id: 'part-all-unconfigured-2',
          batch_id: 'batch-all-unconfigured',
          serial_number: 'SN-UNCONFIGURED-2',
          display_name: 'All Unconfigured B',
          review_state: 'unreviewed',
          metadata: {
            configured_views: ['side'],
            modalities: ['thermal'],
            view_images: { side: 'unconfigured-b-side-thermal.png' },
            source_images: [
              { filename: 'unconfigured-b-side-thermal.png', image_id: 'unconfigured-b-side-thermal', side: 'side', modality: 'thermal', overlay: false },
            ],
            annotations: [],
          },
        },
      ],
      workspaceState: {
        selected_batch_id: 'batch-all-unconfigured',
        selected_part_id: '__all_parts__',
        inspector: { image_enabled: true, modalities: [], view_name: '' },
      },
      projectConfiguration: {
        image_modalities: [{ id: 'visual', label: 'Visual' }],
      },
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getAllByAltText('top view')).toHaveLength(1));
    expect(screen.getAllByAltText('side view')).toHaveLength(1);
    expect(screen.queryByText('No mapped images match the current filters.')).not.toBeInTheDocument();
  });

  test('part summary keeps segmentation and heatmap overlays in the layers row', async () => {
    mockWorkbenchFetch({
      user: 'overlay-modality-toggle',
      batches: [{ id: 'batch-overlay-modal', name: 'Batch Overlay Modal' }],
      parts: [
        {
          id: 'part-overlay-modal-1',
          batch_id: 'batch-overlay-modal',
          serial_number: 'SN-OVERLAY-MODAL-1',
          display_name: 'Overlay Modality Part',
          review_state: 'in_review',
          metadata: {
            configured_views: ['front'],
            modalities: ['visual', 'segmentation', 'heatmap'],
            view_images: { front: 'overlay-modal-front.png' },
            source_images: [
              { filename: 'overlay-modal-front.png', image_id: 'overlay-modal-source', side: 'front', modality: 'visual', overlay: false },
              {
                filename: 'overlay-modal-segmentation.png',
                image_id: 'overlay-modal-segmentation',
                side: 'front',
                modality: 'segmentation',
                overlay: true,
                overlay_base_image_id: 'overlay-modal-source',
                overlay_base_filename: 'overlay-modal-front.png',
              },
              {
                filename: 'overlay-modal-heatmap.png',
                image_id: 'overlay-modal-heatmap',
                side: 'front',
                modality: 'heatmap',
                overlay: true,
                overlay_base_image_id: 'overlay-modal-source',
                overlay_base_filename: 'overlay-modal-front.png',
              },
            ],
          },
        },
      ],
      workspaceState: { inspector: { image_enabled: true, modalities: ['visual'], view_name: 'front' } },
      projectConfiguration: {
        image_modalities: [{ id: 'visual', label: 'Visual' }],
      },
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getAllByText('Overlay Modality Part').length).toBeGreaterThan(0));
    const modalityToggles = screen.getByLabelText('Overlay Modality Part modality toggles');
    expect(within(modalityToggles).getByRole('button', { name: 'VISUAL' })).toBeInTheDocument();
    expect(within(modalityToggles).queryByRole('button', { name: 'SEGMENTATION' })).not.toBeInTheDocument();
    expect(within(modalityToggles).queryByRole('button', { name: 'HEATMAP' })).not.toBeInTheDocument();

    const layerToggles = screen.getByLabelText('Overlay Modality Part layer toggles');
    const overlayToggle = within(layerToggles).getByRole('button', { name: 'OVERLAY' });
    expect(overlayToggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByAltText('front overlay')).toHaveLength(2);

    fireEvent.click(overlayToggle);
    await waitFor(() => expect(screen.getAllByAltText('front overlay')).toHaveLength(2));
    expect(within(layerToggles).getByRole('button', { name: 'SOURCE' })).toHaveAttribute('aria-pressed', 'false');
    expect(overlayToggle).toHaveAttribute('aria-pressed', 'true');
    expect(within(layerToggles).getByRole('button', { name: 'ALL' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(within(layerToggles).getByRole('button', { name: 'ALL' }));
    await waitFor(() => expect(screen.getAllByAltText('front overlay')).toHaveLength(2));
    expect(within(layerToggles).getByRole('button', { name: 'ALL' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('shows non-overlay mixed-modality source images alongside configured view images', async () => {
    mockWorkbenchFetch({
      user: 'mixed-modality-source',
      batches: [{ id: 'batch-mixed', name: 'Batch Mixed' }],
      parts: [
        {
          id: 'part-mixed-1',
          batch_id: 'batch-mixed',
          serial_number: 'SN-MIXED-1',
          display_name: 'Mixed Modality Part',
          review_state: 'in_review',
          metadata: {
            configured_views: ['front'],
            modalities: ['visual', 'thermal'],
            view_images: { front: 'SN-MIXED-1_front_visual.png' },
            source_images: [
              { filename: 'SN-MIXED-1_front_visual.png', image_id: 'mixed-visual-image', side: 'front', modality: 'visual', overlay: false },
              { filename: 'SN-MIXED-1_front_thermal.png', image_id: 'mixed-thermal-image', side: 'front', modality: 'thermal', overlay: false },
            ],
          },
        },
      ],
      workspaceState: { inspector: { image_enabled: true, modalities: ['visual', 'thermal'], view_name: 'front' } },
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getAllByText('Mixed Modality Part').length).toBeGreaterThan(0));
    const modalityToggles = screen.getByLabelText('Mixed Modality Part modality toggles');
    expect(within(modalityToggles).getByRole('button', { name: 'VISUAL' })).toBeInTheDocument();
    expect(within(modalityToggles).getByRole('button', { name: 'THERMAL' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByAltText('front view')).toHaveLength(2));
    const visibleImageSources = screen.getAllByAltText('front view').map((image) => image.getAttribute('src'));
    expect(visibleImageSources).toEqual(expect.arrayContaining([
      '/api/images/mixed-visual-image/content',
      '/api/images/mixed-thermal-image/content',
    ]));
  });

  test('red team: keeps same-side adversarial filenames from hiding different modalities', async () => {
    mockWorkbenchFetch({
      user: 'mixed-modality-red-team',
      batches: [{ id: 'batch-red-team', name: 'Batch Red Team' }],
      parts: [
        {
          id: 'part-red-team-1',
          batch_id: 'batch-red-team',
          serial_number: 'SN_RED_TEAM_001',
          display_name: 'Red Team Mixed Part',
          review_state: 'in_review',
          metadata: {
            configured_views: ['front'],
            modalities: ['visual', 'infrared', 'uv'],
            view_images: { front: 'SN_RED_TEAM_001__front__visual.png' },
            source_images: [
              { filename: 'SN_RED_TEAM_001__front__visual.png', image_id: 'red-team-visual', side: 'front', modality: 'visual', overlay: 'false' },
              { filename: 'SN_RED_TEAM_001__front__visual.backup.infrared.png', image_id: 'red-team-infrared', side: 'front', modality: 'infrared', overlay: 'false' },
              { filename: 'SN_RED_TEAM_001__front__visual.backup.uv.png', image_id: 'red-team-uv', side: 'front', modality: 'uv', overlay: 'false' },
            ],
          },
        },
      ],
      workspaceState: {},
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getAllByText('Red Team Mixed Part').length).toBeGreaterThan(0));
    const modalityToggles = screen.getByLabelText('Red Team Mixed Part modality toggles');
    expect(within(modalityToggles).getByRole('button', { name: 'VISUAL' })).toBeInTheDocument();
    expect(within(modalityToggles).getByRole('button', { name: 'INFRARED' })).toBeInTheDocument();
    expect(within(modalityToggles).getByRole('button', { name: 'UV' })).toBeInTheDocument();
    expect(within(modalityToggles).getByRole('button', { name: 'VISUAL' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(modalityToggles).getByRole('button', { name: 'INFRARED' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(modalityToggles).getByRole('button', { name: 'UV' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.getAllByAltText('front view')).toHaveLength(3));
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

  test('keeps distinct image IDs inspectable when they share the same filename', async () => {
    mockWorkbenchFetch({
      user: 'same-filename-distinct-ids',
      batches: [{ id: 'batch-shared-name', name: 'Batch Shared Name' }],
      parts: [
        {
          id: 'part-shared-name',
          batch_id: 'batch-shared-name',
          serial_number: 'SN-SHARED-NAME',
          display_name: 'Shared Filename Part',
          review_state: 'in_review',
          metadata: {
            configured_views: ['front', 'back'],
            source_images: [
              { filename: 'capture.png', image_id: 'capture-front-id', side: 'front', modality: 'visual', overlay: false },
              { filename: 'capture.png', image_id: 'capture-back-id', side: 'back', modality: 'visual', overlay: false },
            ],
          },
        },
      ],
      workspaceState: {},
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    await waitFor(() => expect(screen.getAllByText('Shared Filename Part').length).toBeGreaterThan(0));
    const front = screen.getAllByAltText('front view');
    const back = screen.getAllByAltText('back view');
    expect(front).toHaveLength(1);
    expect(back).toHaveLength(1);
    expect(front[0]).toHaveAttribute('src', '/api/images/capture-front-id/content');
    expect(back[0]).toHaveAttribute('src', '/api/images/capture-back-id/content');
  });

  test('suppresses only an overlay exact base UUID and displays duplicate filename ordinals', async () => {
    mockWorkbenchFetch({
      user: 'same-name-overlay-base',
      batches: [{ id: 'batch-same-name-overlay', name: 'Batch Same Name Overlay' }],
      parts: [{
        id: 'part-same-name-overlay',
        batch_id: 'batch-same-name-overlay',
        serial_number: 'SN-SAME-NAME-OVERLAY',
        display_name: 'Same Name Overlay Part',
        review_state: 'in_review',
        metadata: {
          configured_views: ['front', 'back'],
          modalities: ['visual'],
          source_images: [
            {
              filename: 'capture.png',
              image_id: 'capture-a',
              side: 'front',
              modality: 'visual',
              overlay: 'false',
            },
            {
              filename: 'capture.png',
              image_id: 'capture-b',
              side: 'back',
              modality: 'visual',
              overlay: 'false',
            },
            {
              filename: 'capture-mask.png',
              image_id: 'capture-overlay',
              side: 'front',
              modality: 'analyze-overlay',
              overlay: 'true',
              analysis_output: 'true',
              overlay_base_image_id: 'capture-a',
              overlay_base_filename: 'capture.png',
            },
          ],
        },
      }],
      projectImages: [
        { id: 'capture-a', filename: 'capture.png', created_at: '2026-01-01T00:00:00Z', metadata: { modality: 'visual' } },
        { id: 'capture-b', filename: 'capture.png', created_at: '2026-01-02T00:00:00Z', metadata: { modality: 'visual' } },
        { id: 'capture-overlay', filename: 'capture-mask.png', created_at: '2026-01-03T00:00:00Z', metadata: { analysis_output: true } },
      ],
      workspaceState: {},
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);

    const composite = await screen.findByTestId('inspection-overlay-composite');
    expect(within(composite).getByAltText('front source'))
      .toHaveAttribute('src', '/api/images/capture-a/content');
    expect(within(composite).getByAltText('front overlay'))
      .toHaveAttribute('src', '/api/images/capture-overlay/content');
    expect(screen.getByAltText('back view'))
      .toHaveAttribute('src', '/api/images/capture-b/content');
    expect(document.querySelectorAll('.view-board .view-cell')).toHaveLength(2);
    expect(screen.getByText('capture (1).png')).toBeInTheDocument();
    expect(screen.getByLabelText('Filename capture (1).png')).toBeInTheDocument();
  });

  test.each([
    {
      extension: 'png',
      label: 'PNG 8-bit',
      bitDepth: 8,
      dtype: 'uint8',
      lowRange: { min: 12, max: 96 },
      highRange: { min: 64, max: 240 },
      editValue: 180,
    },
    {
      extension: 'png',
      label: 'PNG 16-bit',
      bitDepth: 16,
      dtype: 'uint16',
      lowRange: { min: 1024, max: 4096 },
      highRange: { min: 2048, max: 12000 },
      editValue: 8000,
    },
    {
      extension: 'tif',
      label: 'TIFF 8-bit',
      bitDepth: 8,
      dtype: 'uint8',
      lowRange: { min: 12, max: 96 },
      highRange: { min: 64, max: 240 },
      editValue: 180,
    },
    {
      extension: 'tif',
      label: 'TIFF 16-bit',
      bitDepth: 16,
      dtype: 'uint16',
      lowRange: { min: 1024, max: 4096 },
      highRange: { min: 2048, max: 12000 },
      editValue: 8000,
    },
  ])('uses loaded $label value range for PT3 display window controls', async ({
    extension,
    label,
    bitDepth,
    dtype,
    lowRange,
    highRange,
    editValue,
  }) => {
    const expectedDomain = `${lowRange.min}-${highRange.max}`;
    mockWorkbenchFetch({
      user: `pt3-${extension}-${bitDepth}-window`,
      batches: [{ id: `batch-${extension}-${bitDepth}`, name: `Batch ${label}` }],
      parts: [
        {
          id: `part-${extension}-${bitDepth}-1`,
          batch_id: `batch-${extension}-${bitDepth}`,
          serial_number: `SN-${extension.toUpperCase()}-${bitDepth}-1`,
          display_name: `${label} Part`,
          review_state: 'in_review',
          metadata: {
            voxel_dtype: dtype,
            volume_shape: { axial: 2, coronal: 2, sagittal: 2 },
            source_images: [
              {
                filename: `slice-low.${extension}`,
                image_id: `slice-low-${extension}-${bitDepth}-id`,
                metadata: {
                  slice_index: 0,
                  pixel_dtype: dtype,
                  bit_depth: bitDepth,
                  pixel_value_range: lowRange,
                },
              },
              {
                filename: `slice-high.${extension}`,
                image_id: `slice-high-${extension}-${bitDepth}-id`,
                metadata: {
                  slice_index: 1,
                  pixel_dtype: dtype,
                  bit_depth: bitDepth,
                  pixel_value_range: highRange,
                },
              },
            ],
          },
        },
      ],
      workspaceState: { selected_part_id: `part-${extension}-${bitDepth}-1` },
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await waitFor(() => expect(screen.getByText(`${label} Part`)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('3D view'), { target: { value: 'stack' } });

    expect(screen.getByText(`${expectedDomain} loaded image range`)).toBeInTheDocument();
    expect(screen.getByLabelText('Display window minimum handle')).toHaveAttribute('min', String(lowRange.min));
    expect(screen.getByLabelText('Display window maximum handle')).toHaveAttribute('max', String(highRange.max));
    expect(screen.getAllByTestId('mpr-preview-axial')[0].querySelector('.mpr-slice-canvas')).toHaveAttribute(
      'data-display-domain',
      expectedDomain,
    );

    fireEvent.change(screen.getByLabelText('Display window maximum handle'), {
      target: { value: String(editValue) },
    });
    expect(screen.getByLabelText('Display window maximum')).toHaveValue(editValue);
  });

  test('remaps a saved uint8 window for uint16 parts and preserves it across the same domain', async () => {
    const makePart = (id, dtype) => ({
      id,
      batch_id: 'batch-window-domain',
      serial_number: id,
      display_name: id,
      review_state: 'in_review',
      metadata: {
        voxel_dtype: dtype,
        volume_shape: { axial: 2, coronal: 2, sagittal: 2 },
        source_images: [{
          filename: `${id}.npy`,
          image_id: `${id}-image`,
          metadata: { voxel_dtype: dtype, pixel_dtype: dtype },
        }],
      },
    });
    mockWorkbenchFetch({
      user: 'pt3-window-domain-switch',
      batches: [{ id: 'batch-window-domain', name: 'Window domains' }],
      parts: [
        makePart('part-uint8', 'uint8'),
        makePart('part-uint16-a', 'uint16'),
        makePart('part-uint16-b', 'uint16'),
      ],
      workspaceState: {
        selected_part_id: 'part-uint8',
        mpr: { display_window: { min: 64, max: 192 } },
      },
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);
    await screen.findByTestId('mpr-panel');
    expect(screen.getByLabelText('Display window minimum')).toHaveValue(64);
    expect(screen.getByLabelText('Display window maximum')).toHaveValue(192);

    fireEvent.change(screen.getByTestId('mpr-part-selector'), { target: { value: 'part-uint16-a' } });
    await waitFor(() => {
      expect(screen.getByLabelText('Display window minimum')).toHaveValue(16448);
      expect(screen.getByLabelText('Display window maximum')).toHaveValue(49344);
    });

    fireEvent.change(screen.getByLabelText('Display window minimum'), { target: { value: '20000' } });
    fireEvent.change(screen.getByLabelText('Display window maximum'), { target: { value: '50000' } });
    fireEvent.change(screen.getByTestId('mpr-part-selector'), { target: { value: 'part-uint16-b' } });
    await waitFor(() => {
      expect(screen.getByLabelText('Display window minimum')).toHaveValue(20000);
      expect(screen.getByLabelText('Display window maximum')).toHaveValue(50000);
      expect(screen.getByTestId('annotation-list')).toHaveTextContent('No annotations captured.');
      expect(screen.getByTestId('volume-metadata-probe-warning')).toHaveTextContent('part-uint16-b.npy');
    });
  });

  test('updates the MPR probe readout from the display window and slice position', async () => {
    mockWorkbenchFetch({
      user: 'pt3-probe-readout',
      batches: [{ id: 'batch-probe', name: 'Probe batch' }],
      parts: [{
        id: 'part-probe',
        batch_id: 'batch-probe',
        serial_number: 'PROBE-001',
        display_name: 'Probe part',
        review_state: 'in_review',
        metadata: { volume_shape: { axial: 20, coronal: 18, sagittal: 16 } },
      }],
      workspaceState: {
        selected_part_id: 'part-probe',
        mpr: {
          slice_position: { axial: 5, coronal: 4, sagittal: 3 },
          cursor_probe: { x: 60, y: 45 },
          display_window: { min: 0, max: 255 },
        },
      },
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    const { container } = render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);
    await screen.findByTestId('mpr-panel');
    // round(60 * 0.35 + 45 * 0.65 + (5 + 4 + 3)) = 62 in the default 0..255 domain and window.
    await waitFor(() => {
      expect(container.querySelector('.mpr-probe-readout')).toHaveTextContent('Probe 62');
    });

    // Window 31..255: round((62 - 31) / 224 * 255) = 35.
    fireEvent.change(screen.getByLabelText('Display window minimum'), { target: { value: '31' } });
    await waitFor(() => {
      expect(container.querySelector('.mpr-probe-readout')).toHaveTextContent('Probe 35');
    });

    // Axial 10 raises the seed to 17, so unit 67 maps to round((67 - 31) / 224 * 255) = 41.
    fireEvent.change(container.querySelector('#mpr-slice-axial'), { target: { value: '10' } });
    await waitFor(() => {
      expect(container.querySelector('.mpr-probe-readout')).toHaveTextContent('Probe 41');
    });
  });

  test('reloads annotations after A to B to A navigation instead of reusing embedded part metadata', async () => {
    const makePart = (id, label) => ({
      id,
      batch_id: 'batch-navigation',
      serial_number: id,
      display_name: label,
      review_state: 'in_review',
      metadata: {
        volume_shape: { axial: 4, coronal: 4, sagittal: 4 },
        annotations: [{ id: `embedded-${id}`, defect_class: `Embedded ${label}`, modality: 'volume' }],
      },
    });
    mockWorkbenchFetch({
      user: 'annotation-navigation',
      batches: [{ id: 'batch-navigation', name: 'Navigation' }],
      parts: [makePart('part-nav-a', 'Part A'), makePart('part-nav-b', 'Part B')],
      workspaceState: { selected_part_id: 'part-nav-a' },
    });
    const baseFetch = global.fetch;
    let aLoads = 0;
    global.fetch = jest.fn((url, options = {}) => {
      if (url.endsWith('/parts/part-nav-a/annotations') && (!options.method || options.method === 'GET')) {
        aLoads += 1;
        const version = aLoads === 1 ? 'Remote A first' : 'Remote A refreshed';
        return Promise.resolve({
          ok: true,
          json: async () => ({
            part_id: 'part-nav-a',
            annotations: [{ id: `remote-a-${aLoads}`, defect_class: version, modality: 'volume' }],
          }),
        });
      }
      if (url.endsWith('/parts/part-nav-b/annotations') && (!options.method || options.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            part_id: 'part-nav-b',
            annotations: [{ id: 'remote-b', defect_class: 'Remote B', modality: 'volume' }],
          }),
        });
      }
      return baseFetch(url, options);
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);
    const annotationList = await screen.findByTestId('annotation-list');
    await waitFor(() => expect(annotationList).toHaveTextContent('Remote A first'));

    fireEvent.change(screen.getByTestId('mpr-part-selector'), { target: { value: 'part-nav-b' } });
    await waitFor(() => expect(annotationList).toHaveTextContent('Remote B'));
    expect(annotationList).not.toHaveTextContent('Remote A first');

    fireEvent.change(screen.getByTestId('mpr-part-selector'), { target: { value: 'part-nav-a' } });
    await waitFor(() => expect(annotationList).toHaveTextContent('Remote A refreshed'));
    expect(aLoads).toBe(2);
  });

  test('does not insert a delayed annotation response into a newly selected part', async () => {
    const makePart = (id, label, annotationId) => ({
      id,
      batch_id: 'batch-mutation-scope',
      serial_number: id,
      display_name: label,
      review_state: 'in_review',
      metadata: {
        volume_shape: { axial: 4, coronal: 4, sagittal: 4 },
        annotations: [{ id: annotationId, defect_class: `${label} seed`, modality: 'volume' }],
      },
    });
    mockWorkbenchFetch({
      user: 'annotation-mutation-scope',
      batches: [{ id: 'batch-mutation-scope', name: 'Mutation scope' }],
      parts: [
        makePart('part-scope-a', 'Part A', 'scope-a-seed'),
        makePart('part-scope-b', 'Part B', 'scope-b-seed'),
      ],
      workspaceState: { selected_part_id: 'part-scope-a' },
    });
    const baseFetch = global.fetch;
    let resolvePost;
    let delayedJsonRead = false;
    global.fetch = jest.fn((url, options = {}) => {
      if (url.endsWith('/parts/part-scope-a/annotations') && options.method === 'POST') {
        return new Promise((resolve) => {
          resolvePost = () => resolve({
            ok: true,
            json: async () => {
              delayedJsonRead = true;
              return {
                id: 'late-a-annotation',
                defect_class: 'Late A annotation',
                modality: 'volume',
                hidden: false,
              };
            },
          });
        });
      }
      return baseFetch(url, options);
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);
    const annotationList = await screen.findByTestId('annotation-list');
    await waitFor(() => expect(annotationList).toHaveTextContent('Part A seed'));
    fireEvent.click(screen.getByRole('button', { name: 'Other' }));
    fireEvent.change(screen.getByLabelText('Annotation defect type'), { target: { value: 'Other' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save annotation' }));
    await waitFor(() => expect(resolvePost).toBeDefined());

    fireEvent.change(screen.getByTestId('mpr-part-selector'), { target: { value: 'part-scope-b' } });
    await waitFor(() => expect(annotationList).toHaveTextContent('Part B seed'));
    fireEvent.change(screen.getByTestId('mpr-part-selector'), { target: { value: 'part-scope-a' } });
    await waitFor(() => expect(annotationList).toHaveTextContent('Part A seed'));
    resolvePost();
    await waitFor(() => expect(delayedJsonRead).toBe(true));
    expect(annotationList).toHaveTextContent('Part A seed');
    expect(annotationList).not.toHaveTextContent('Late A annotation');
  });

  test('keeps the last active 2D MPR axis highlighted in the 3D slice locator', async () => {
    mockWorkbenchFetch(scenarioByUser[2]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);
    await screen.findByTestId('mpr-panel');

    fireEvent.click(screen.getByTestId('mpr-pane-sagittal'));
    fireEvent.change(screen.getByLabelText('3D view'), { target: { value: 'ray-march:composite' } });
    await waitFor(() => expect(screen.getByTestId('pt3-gaussian-splat-viewer')).toHaveAttribute(
      'data-active-slice-axis',
      'sagittal',
    ));

    fireEvent.wheel(screen.getByTestId('mpr-pane-3d'), { deltaY: -80 });
    expect(screen.getByTestId('pt3-gaussian-splat-viewer')).toHaveAttribute(
      'data-active-slice-axis',
      'sagittal',
    );
    fireEvent.click(screen.getByTestId('mpr-pane-coronal'));
    await waitFor(() => expect(screen.getByTestId('pt3-gaussian-splat-viewer')).toHaveAttribute(
      'data-active-slice-axis',
      'coronal',
    ));
  });

  test('publishes PT3 inspection share state with the active pane and replace semantics', async () => {
    const onInspectionShareStateChange = jest.fn();
    mockWorkbenchFetch(scenarioByUser[2]);
    render(
      <InspectionWorkbenchPanel
        projectId="proj-1"
        projectType="PT3"
        launchFilters={{ active_mpr_pane: 'coronal' }}
        onInspectionShareStateChange={onInspectionShareStateChange}
      />,
    );

    const panel = await screen.findByTestId('mpr-panel');
    await waitFor(() => expect(panel).toHaveAttribute('data-active-pane', 'coronal'));
    await waitFor(() => expect(onInspectionShareStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeMprPane: 'coronal',
        activeOverlayIds: ['segmentation', 'porosity'],
        selectedImageRef: 'pt3-z-000',
      }),
      { replace: true },
    ));
    const [sharedState] = onInspectionShareStateChange.mock.calls.at(-1);
    expect(Object.keys(sharedState).sort()).toEqual([
      'activeMetadataTab',
      'activeMprPane',
      'activeOverlayIds',
      'reviewFilter',
      'selectedBatchId',
      'selectedImageRef',
      'selectedPartId',
    ]);
    expect(sharedState.selectedPartId).toBeTruthy();
  });

  test('uses launch pane over the clamped parent session and publishes each navigation action once', async () => {
    const onMprSessionChange = jest.fn();
    const parentSession = {
      slicePosition: { axial: 900, coronal: 34, sagittal: -8 },
      activePane: 'coronal',
      lastActiveAxis: 'coronal',
      viewportTransform: { zoom: 2, panX: 24, panY: -16 },
      rotation: { x: -12, y: 42 },
    };
    mockWorkbenchFetch(scenarioByUser[2]);
    render(
      <InspectionWorkbenchPanel
        projectId="proj-1"
        projectType="PT3"
        launchFilters={{ active_mpr_pane: 'sagittal' }}
        mprSession={parentSession}
        onMprSessionChange={onMprSessionChange}
      />,
    );

    const panel = await screen.findByTestId('mpr-panel');
    await waitFor(() => expect(panel).toHaveAttribute('data-active-pane', 'sagittal'));
    expect(panel).toHaveAttribute('data-last-active-axis', 'sagittal');
    expect(panel).toHaveAttribute('data-zoom', '2');
    expect(panel).toHaveAttribute('data-pan-x', '24');
    expect(panel).toHaveAttribute('data-pan-y', '-16');
    expect(panel).toHaveAttribute('data-rotation-x', '-12');
    expect(panel).toHaveAttribute('data-rotation-y', '42');
    expect(document.querySelector('#mpr-slice-axial')).toHaveValue('127');
    expect(document.querySelector('#mpr-slice-coronal')).toHaveValue('34');
    expect(document.querySelector('#mpr-slice-sagittal')).toHaveValue('0');
    expect(onMprSessionChange).toHaveBeenCalledTimes(1);
    expect(onMprSessionChange).toHaveBeenLastCalledWith({
      ...parentSession,
      slicePosition: { axial: 127, coronal: 34, sagittal: 0 },
      activePane: 'sagittal',
      lastActiveAxis: 'sagittal',
    });

    onMprSessionChange.mockClear();
    fireEvent.change(document.querySelector('#mpr-slice-coronal'), { target: { value: '45' } });
    expect(onMprSessionChange).toHaveBeenCalledTimes(1);
    expect(onMprSessionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      slicePosition: { axial: 127, coronal: 45, sagittal: 0 },
      activePane: 'sagittal',
      lastActiveAxis: 'sagittal',
    }));

    fireEvent.wheel(screen.getByTestId('mpr-pane-3d'), { deltaY: -80 });
    expect(onMprSessionChange).toHaveBeenCalledTimes(2);
    expect(onMprSessionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      activePane: 'volume',
      lastActiveAxis: 'sagittal',
      viewportTransform: { zoom: 2.12, panX: 24, panY: -16 },
    }));

    const scene = screen.getByRole('button', { name: 'Open 3D part view fullscreen' });
    fireEvent.keyDown(scene, { key: 'Enter' });
    const fullscreenScene = screen.getByRole('application', {
      name: 'Fullscreen 3D part view. Use arrow keys to orbit, plus and minus to zoom, and zero to reset.',
    });
    onMprSessionChange.mockClear();
    fireEvent.keyDown(fullscreenScene, { key: 'ArrowRight' });
    expect(onMprSessionChange).toHaveBeenCalledTimes(1);
    expect(onMprSessionChange).toHaveBeenLastCalledWith(expect.objectContaining({
      rotation: { x: -12, y: 47 },
    }));
  });

  test.each([
    ['shell', 'orientation'],
    ['splat', 'orientation'],
    ['hybrid3d', 'ray-march:composite'],
    ['unknown-mode', 'orientation'],
  ])('normalizes removed saved 3D mode %s to %s', async (savedMode, expectedSelection) => {
    mockWorkbenchFetch({
      ...scenarioByUser[2],
      workspaceState: {
        selected_batch_id: 'batch-adv-a',
        selected_part_id: 'part-adv-1',
        mpr: { reconstruction_mode: savedMode },
      },
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await waitFor(() => expect(screen.getByLabelText('3D view')).toHaveValue(expectedSelection));
  });

  test('hydrates, persists, and retains ray style across part changes', async () => {
    const fetchState = mockWorkbenchFetch({
      ...scenarioByUser[2],
      workspaceState: {
        selected_batch_id: 'batch-adv-a',
        selected_part_id: 'part-adv-1',
        mpr: {
          reconstruction_mode: 'volume3d',
          ray_march_settings: { reconstructionStyle: 'mip' },
        },
      },
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    const modeSelect = await screen.findByLabelText('3D view');
    await waitFor(() => expect(modeSelect).toHaveValue('ray-march:mip'));
    fireEvent.change(modeSelect, { target: { value: 'ray-march:xray' } });
    await waitFor(() => expect(fetchState.getWorkspaceSaves()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: expect.objectContaining({
            mpr: expect.objectContaining({
              reconstruction_mode: 'volume3d',
              ray_march_settings: expect.objectContaining({ reconstructionStyle: 'xray' }),
            }),
          }),
        }),
      ]),
    ));

    fireEvent.change(screen.getByTestId('mpr-part-selector'), { target: { value: 'part-adv-2' } });
    await waitFor(() => {
      expect(modeSelect).toHaveValue('ray-march:xray');
      expect(screen.getByTestId('annotation-list')).toHaveTextContent('No annotations captured.');
      expect(screen.getByTestId('pt3-gaussian-splat-viewer')).not.toHaveAttribute(
        'data-renderer-type',
        'pending',
      );
    });
  });

  test('legacy hybrid hydration always resets ray style to Composite', async () => {
    mockWorkbenchFetch({
      ...scenarioByUser[2],
      workspaceState: {
        selected_batch_id: 'batch-adv-a',
        selected_part_id: 'part-adv-1',
        mpr: {
          reconstruction_mode: 'hybrid3d',
          ray_march_settings: { reconstructionStyle: 'xray' },
        },
      },
    });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await waitFor(() => expect(screen.getByLabelText('3D view')).toHaveValue('ray-march:composite'));
  });

  test('opens PT3 splat configuration with histogram-aware defaults scoped to the 3D quadrant', async () => {
    mockWorkbenchFetch({
      user: 'pt3-splat-config',
      batches: [{ id: 'batch-splat-config', name: 'Batch Splat Config' }],
      parts: [
        {
          id: 'part-splat-config-1',
          batch_id: 'batch-splat-config',
          serial_number: 'SN-SPLAT-CONFIG-1',
          display_name: 'Histogram Splat Part',
          review_state: 'in_review',
          metadata: {
            volume_shape: { axial: 2, coronal: 2, sagittal: 2 },
            source_images: [
              {
                filename: 'histogram-slice-0.png',
                image_id: 'histogram-slice-0-id',
                metadata: {
                  slice_index: 0,
                  bit_depth: 8,
                  pixel_value_range: { min: 0, max: 200 },
                  pixel_histogram: { bins: [0, 50, 100, 150], counts: [10, 20, 30, 40] },
                },
              },
              {
                filename: 'histogram-slice-1.png',
                image_id: 'histogram-slice-1-id',
                metadata: {
                  slice_index: 1,
                  bit_depth: 8,
                  pixel_value_range: { min: 0, max: 200 },
                },
              },
            ],
          },
        },
      ],
      workspaceState: { selected_part_id: 'part-splat-config-1' },
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await waitFor(() => expect(screen.getByTestId('mpr-panel')).toBeInTheDocument());
    expect(screen.queryByTestId('splat-config-button')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('3D view'), { target: { value: 'splat' } });

    expect(screen.getByTestId('pt3-gaussian-splat-viewer')).toBeInTheDocument();
    expect(screen.getAllByTestId('mpr-preview-axial')[0].querySelector('.mpr-slice-canvas')).toBeInTheDocument();
    expect(screen.getAllByTestId('mpr-preview-coronal')[0].querySelector('.mpr-slice-canvas')).toBeInTheDocument();
    expect(screen.getAllByTestId('mpr-preview-sagittal')[0].querySelector('.mpr-slice-canvas')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('splat-config-button'));
    const modal = screen.getByRole('dialog', { name: 'Simplified 3DGS configuration' });
    expect(within(modal).getByLabelText('Intensity threshold')).toHaveValue(150);
    expect(within(modal).getByText(/0-200 loaded image range/)).toBeInTheDocument();
    expect(within(modal).getByTestId('splat-config-summary')).toHaveTextContent('threshold 150');
    expect(within(modal).getByLabelText('Maximum splats')).toHaveAttribute('max', '100000');
    fireEvent.change(within(modal).getByLabelText('Maximum splats'), { target: { value: '250000' } });
    expect(within(modal).getByLabelText('Maximum splats')).toHaveValue(100000);

    fireEvent.change(within(modal).getByLabelText('Downsample stride'), { target: { value: '3' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Apply splat parameters' }));
    await waitFor(() => expect(screen.getByTestId('pt3-gaussian-splat-viewer')).toHaveTextContent('threshold 150'));
    expect(screen.getByTestId('mpr-pane-axial')).not.toHaveTextContent('Gaussian splat');
    expect(screen.getByTestId('mpr-pane-coronal')).not.toHaveTextContent('Gaussian splat');
    expect(screen.getByTestId('mpr-pane-sagittal')).not.toHaveTextContent('Gaussian splat');
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
    await waitFor(() => {
      expect(screen.getByTestId('mpr-part-selector')).toHaveValue('part-adv-1');
      expect(screen.getByTestId('annotation-list')).toHaveTextContent('seed-adv');
    });
    expect(screen.queryByRole('img', { name: /Volume reconstruction slice/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/axial/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/coronal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sagittal/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('3D view'), { target: { value: 'stack' } });
    expect(screen.getAllByRole('img', { name: /Volume reconstruction slice/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: /Volume reconstruction slice/ })[0]).toHaveAttribute('draggable', 'false');

    expect(screen.queryByTestId('pt3-gaussian-splat-viewer')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('3D view'), { target: { value: 'ray-march:composite' } });
    expect(screen.getByTestId('pt3-gaussian-splat-viewer')).toHaveTextContent('Ray march loading');
    expect(screen.queryByLabelText('3DGS opacity')).not.toBeInTheDocument();
    expect(screen.getByTestId('pt3-gaussian-splat-viewer')).toHaveTextContent('Ray march');
    fireEvent.change(screen.getByLabelText('3D view'), { target: { value: 'orientation' } });
    expect(screen.queryByTestId('pt3-gaussian-splat-viewer')).not.toBeInTheDocument();

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

  test('translates persisted PT3 MPR line and box interiors without resizing or synthesizing image ids', async () => {
    const annotations = makePersistedMprGeometryAnnotations();
    mockWorkbenchFetch(makePt3ScenarioWithMetadata({ annotations }));
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    const axialPreview = await screen.findByTestId('mpr-preview-axial');
    axialPreview.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 300,
      right: 400,
      bottom: 300,
    });
    const sourcePoint = (x, y) => ({
      clientX: 75 + (x * 3.125),
      clientY: y * 3.125,
    });

    const lineTarget = await screen.findByLabelText('Move Axial persisted line');
    fireCoordinatePointerEvent(lineTarget, 'pointerdown', { ...sourcePoint(20, 22), button: 0 });
    fireCoordinatePointerEvent(lineTarget, 'pointermove', { ...sourcePoint(24, 28), buttons: 1 });
    fireCoordinatePointerEvent(lineTarget, 'pointerup', { ...sourcePoint(24, 28), button: 0 });

    const lineUrl = '/api/projects/proj-1/parts/part-adv-1/annotations/persisted-mpr-line';
    await waitFor(() => {
      const calls = global.fetch.mock.calls.filter(([url, options]) => url === lineUrl && options?.method === 'PATCH');
      expect(calls).toHaveLength(1);
      const body = JSON.parse(calls[0][1].body);
      expect(body.image_id).toBe('pt3-z-016');
      expect(body.geometry.line).toEqual(expect.objectContaining({ imageWidth: 80, imageHeight: 96 }));
      expect(body.geometry.line.x1).toBeGreaterThan(10);
      expect(body.geometry.line.y1).toBeGreaterThan(12);
      expect(body.geometry.line.x2 - body.geometry.line.x1).toBeCloseTo(20, 6);
      expect(body.geometry.line.y2 - body.geometry.line.y1).toBeCloseTo(20, 6);
    });

    const boxTarget = await screen.findByLabelText('Move Axial persisted box');
    fireCoordinatePointerEvent(boxTarget, 'pointerdown', { ...sourcePoint(50, 32), button: 0 });
    fireCoordinatePointerEvent(boxTarget, 'pointermove', { ...sourcePoint(45, 36), buttons: 1 });
    fireCoordinatePointerEvent(boxTarget, 'pointerup', { ...sourcePoint(45, 36), button: 0 });

    const boxUrl = '/api/projects/proj-1/parts/part-adv-1/annotations/persisted-mpr-box';
    await waitFor(() => {
      const calls = global.fetch.mock.calls.filter(([url, options]) => url === boxUrl && options?.method === 'PATCH');
      expect(calls).toHaveLength(1);
      const body = JSON.parse(calls[0][1].body);
      expect(body.image_id).toBe('pt3-z-032');
      expect(body.geometry.box).toEqual(expect.objectContaining({
        width: 20,
        height: 25,
        imageWidth: 80,
        imageHeight: 96,
      }));
      expect(body.geometry.box.x).toBeLessThan(40);
      expect(body.geometry.box.y).toBeGreaterThan(20);
      expect(body.bbox.width).toBe(20);
      expect(body.bbox.height).toBe(25);
    });

    const annotationPosts = global.fetch.mock.calls.filter(([url, options]) => (
      String(url).includes('/annotations') && options?.method === 'POST'
    ));
    expect(annotationPosts).toHaveLength(0);
  });

  test('renders read-only PT3 MPR panes with headers, slice controls, overlays, and no edit handles', async () => {
    const annotations = makePersistedMprGeometryAnnotations();
    mockWorkbenchFetch(makePt3ScenarioWithMetadata({ annotations }));
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" readOnly />);

    const layout = await screen.findByTestId('pt3-inspection-layout');
    fireEvent.change(document.querySelector('#mpr-slice-axial'), { target: { value: '11' } });
    await waitFor(() => {
      const overlay = within(screen.getByTestId('mpr-preview-axial')).getByLabelText('XY annotation overlay');
      expect(overlay.querySelectorAll('line').length).toBeGreaterThan(0);
    });
    const expectedHeaders = { axial: ['XY', 'Z'], coronal: ['XZ', 'Y'], sagittal: ['YZ', 'X'] };
    Object.entries(expectedHeaders).forEach(([axis, [label, sliceLabel]]) => {
      const pane = within(layout).getByTestId(`mpr-pane-${axis}`);
      const slider = document.querySelector(`#mpr-slice-${axis}`);
      const header = pane.querySelector('.mpr-pane-header');
      expect(header.querySelector('strong')).toHaveTextContent(label);
      expect(header).toHaveTextContent(`${sliceLabel} ${slider.value} / ${slider.getAttribute('max')}`);
      expect(within(pane).getByLabelText(`${label} annotation overlay`)).toBeInTheDocument();
      expect(within(pane).getByLabelText('Mirror')).not.toBeChecked();
    });
    const axialOverlay = within(screen.getByTestId('mpr-preview-axial')).getByLabelText('XY annotation overlay');
    expect(axialOverlay.querySelectorAll('line').length).toBeGreaterThan(0);
    expect(axialOverlay.querySelector('.mpr-annotation-drag-target')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Move Axial persisted line')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Move Axial persisted box')).not.toBeInTheDocument();
    const volumePane = screen.getByTestId('mpr-pane-3d');
    expect(volumePane.querySelector('.mpr-pane-header')).toHaveTextContent('3DZoom 1.30x');
    expect(within(volumePane).getByLabelText('MPR axis legend')).toHaveTextContent('XYXZYZ');
    expect(screen.getByRole('button', { name: 'Segmentation Helpers' })).toBeDisabled();
    ['Pass', 'Reset', 'Reject'].forEach((name) => {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    });
    expect(screen.getByRole('button', { name: 'Part Selection' })).toBeEnabled();
    expect(document.querySelector('.pt3-mpr-context')).toHaveTextContent(/Batches: \d+Parts: \d+Passed: \d+Rejected: \d+/);
  });

  test('resizes selected PT3 MPR line endpoints and box corners by PATCHing existing annotations', async () => {
    const annotations = makePersistedMprGeometryAnnotations();
    mockWorkbenchFetch(makePt3ScenarioWithMetadata({ annotations }));
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    const axialPreview = await screen.findByTestId('mpr-preview-axial');
    axialPreview.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 300,
      right: 400,
      bottom: 300,
    });
    const sourcePoint = (x, y) => ({
      clientX: 75 + (x * 3.125),
      clientY: y * 3.125,
    });

    const startHandle = await screen.findByLabelText('Resize start endpoint for Axial persisted line');
    fireCoordinatePointerEvent(startHandle, 'pointerdown', { ...sourcePoint(10, 12), button: 0 });
    fireCoordinatePointerEvent(startHandle, 'pointermove', { ...sourcePoint(5, 8), buttons: 1 });
    fireCoordinatePointerEvent(startHandle, 'pointerup', { ...sourcePoint(5, 8), button: 0 });

    const lineUrl = '/api/projects/proj-1/parts/part-adv-1/annotations/persisted-mpr-line';
    await waitFor(() => {
      const calls = global.fetch.mock.calls.filter(([url, options]) => url === lineUrl && options?.method === 'PATCH');
      expect(calls).toHaveLength(1);
      const body = JSON.parse(calls[0][1].body);
      expect(body.image_id).toBe('pt3-z-016');
      expect(body.geometry.line.x1).toBeCloseTo(5, 0);
      expect(body.geometry.line.y1).toBeCloseTo(8, 0);
      expect(body.geometry.line.x2).toBe(30);
      expect(body.geometry.line.y2).toBe(32);
    });

    const annotationList = screen.getByTestId('annotation-list');
    const boxEntry = within(annotationList)
      .getByRole('button', { name: 'Edit annotation Axial persisted box' })
      .closest('li');
    fireEvent.click(boxEntry);
    const cornerHandle = await screen.findByLabelText('Resize bottomRight corner for Axial persisted box');
    fireCoordinatePointerEvent(cornerHandle, 'pointerdown', { ...sourcePoint(60, 45), button: 0 });
    fireCoordinatePointerEvent(cornerHandle, 'pointermove', { ...sourcePoint(70, 55), buttons: 1 });
    fireCoordinatePointerEvent(cornerHandle, 'pointerup', { ...sourcePoint(70, 55), button: 0 });

    const boxUrl = '/api/projects/proj-1/parts/part-adv-1/annotations/persisted-mpr-box';
    await waitFor(() => {
      const calls = global.fetch.mock.calls.filter(([url, options]) => url === boxUrl && options?.method === 'PATCH');
      expect(calls).toHaveLength(1);
      const body = JSON.parse(calls[0][1].body);
      expect(body.image_id).toBe('pt3-z-032');
      expect(body.geometry.box.x).toBe(40);
      expect(body.geometry.box.y).toBe(20);
      expect(body.geometry.box.x + body.geometry.box.width).toBeCloseTo(70, 0);
      expect(body.geometry.box.y + body.geometry.box.height).toBeCloseTo(55, 0);
      expect(body.geometry.box.width).toBeGreaterThan(20);
      expect(body.geometry.box.height).toBeGreaterThan(25);
    });

    const annotationPosts = global.fetch.mock.calls.filter(([url, options]) => (
      String(url).includes('/annotations') && options?.method === 'POST'
    ));
    expect(annotationPosts).toHaveLength(0);
  });

  test('keeps PT3 bounding-box annotations editable without offering the 2D crop action', async () => {
    const annotation = {
      id: 'pt3-box-without-crop',
      image_id: 'pt3-z-000',
      defect_class: 'Porosity',
      modality: 'volume',
      comment: 'PT3 bounding box',
      bbox: { x: 10, y: 12, width: 24, height: 28 },
      geometry: {
        imageWidth: 80,
        imageHeight: 96,
        box: { x: 10, y: 12, width: 24, height: 28, imageWidth: 80, imageHeight: 96 },
      },
      hidden: false,
      created_by: 'inspector@example.com',
      created_at: '2026-04-01T09:15:00Z',
    };
    mockWorkbenchFetch(makePt3ScenarioWithMetadata({ annotations: [annotation] }));
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    const annotationList = await screen.findByTestId('annotation-list');
    expect(await within(annotationList).findByText('PT3 bounding box')).toBeInTheDocument();
    expect(within(annotationList).getByRole('button', { name: 'Edit annotation PT3 bounding box' })).toBeInTheDocument();
    expect(within(annotationList).queryByRole('button', { name: 'Crop annotation PT3 bounding box' })).not.toBeInTheDocument();
  });

  test('PT3 annotation consolidation: combines VISTA segments and assigned overlays with resource-specific visibility PATCHes', async () => {
    const segment = makeVistaSegmentAnnotation();
    const assignedOverlay = {
      filename: 'assigned-pore-volume.npy',
      image_id: 'assigned-pore-overlay',
      label: 'Assigned pore volume',
      modality: 'segmentation',
      overlay: true,
      hidden: false,
    };
    const baseSourceImages = scenarioByUser[2].parts[0].metadata.source_images;
    mockWorkbenchFetch(makePt3ScenarioWithMetadata({
      annotations: [segment],
      source_images: [...baseSourceImages, assignedOverlay],
    }));
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    const annotationList = await screen.findByTestId('annotation-list');
    expect(await within(annotationList).findByText('Internal pore')).toBeInTheDocument();
    expect(within(annotationList).getByText('External: Assigned pore volume')).toBeInTheDocument();

    const annotationUrl = '/api/projects/proj-1/parts/part-adv-1/annotations/vista-segment-1';
    fireEvent.click(within(annotationList).getByRole('button', { name: 'Hide vista segment Internal pore' }));
    await waitFor(() => expect(within(annotationList).getByRole('button', { name: 'Show vista segment Internal pore' })).toBeInTheDocument());
    fireEvent.click(within(annotationList).getByRole('button', { name: 'Show vista segment Internal pore' }));
    await waitFor(() => {
      const calls = global.fetch.mock.calls.filter(([url, options]) => url === annotationUrl && options?.method === 'PATCH');
      expect(calls).toHaveLength(2);
      expect(JSON.parse(calls[0][1].body)).toEqual(expect.objectContaining({
        annotation_kind: 'vista_segment',
        defect_class: 'Internal pore',
        hidden: true,
      }));
      expect(JSON.parse(calls[1][1].body)).toEqual(expect.objectContaining({
        annotation_kind: 'vista_segment',
        defect_class: 'Internal pore',
        hidden: false,
      }));
    });

    const overlayUrl = '/api/projects/proj-1/parts/part-adv-1/source-images/assigned-pore-overlay';
    fireEvent.click(within(annotationList).getByRole('button', { name: 'Hide external overlay Assigned pore volume' }));
    await waitFor(() => expect(within(annotationList).getByRole('button', { name: 'Show external overlay Assigned pore volume' })).toBeInTheDocument());
    fireEvent.click(within(annotationList).getByRole('button', { name: 'Show external overlay Assigned pore volume' }));
    await waitFor(() => {
      const calls = global.fetch.mock.calls.filter(([url, options]) => url === overlayUrl && options?.method === 'PATCH');
      expect(calls).toHaveLength(2);
      expect(JSON.parse(calls[0][1].body)).toEqual({ hidden: true });
      expect(JSON.parse(calls[1][1].body)).toEqual({ hidden: false });
    });

    fireEvent.click(screen.getByTestId('mpr-pane-axial'));
    const fullscreenAnnotationList = await screen.findByTestId('fullscreen-annotation-list');
    expect(within(fullscreenAnnotationList).getByText('Internal pore')).toBeInTheDocument();
    expect(within(fullscreenAnnotationList).getByText('External: Assigned pore volume')).toBeInTheDocument();
    expect(within(fullscreenAnnotationList).getByRole('button', { name: 'Hide fullscreen annotation Internal pore' })).toBeInTheDocument();
    expect(within(fullscreenAnnotationList).getByRole('button', { name: 'Hide fullscreen annotation External: Assigned pore volume' })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Close fullscreen image'));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Open 3D part view fullscreen' }), { key: 'Enter' });
    const fullscreen3dAnnotationList = screen.getByLabelText('3D annotations');
    expect(within(fullscreen3dAnnotationList).getByText('Internal pore')).toBeInTheDocument();
    expect(within(fullscreen3dAnnotationList).getByText('External: Assigned pore volume')).toBeInTheDocument();
    expect(within(fullscreen3dAnnotationList).getByRole('button', { name: 'Hide 3D annotation Internal pore' })).toBeInTheDocument();
    expect(within(fullscreen3dAnnotationList).getByRole('button', { name: 'Hide 3D annotation External: Assigned pore volume' })).toBeInTheDocument();
  });

  test('PT3 annotation consolidation: shares MPR names with fullscreen 3D and renders every supported spatial annotation', async () => {
    const [lineAnnotation, boxAnnotation] = makePersistedMprGeometryAnnotations();
    const cubeAnnotation = {
      id: 'persisted-mpr-cube',
      annotation_kind: 'annotation',
      defect_class: '3D Box',
      modality: 'volume',
      comment: 'Persisted cube',
      disposition: 'open',
      hidden: false,
      geometry: {
        cube: {
          axis: 'coronal',
          startSlice: 3,
          endSlice: 7,
          x: 4,
          y: 5,
          width: 8,
          height: 6,
          imageWidth: 80,
          imageHeight: 128,
        },
      },
      measurements: { width_px: 8, height_px: 6, depth_slices: 4 },
      metadata: { annotation_color: '#f97316', annotation_fill_opacity: 0.2 },
    };
    const segmentAnnotation = makeVistaSegmentAnnotation();
    const nonspatialAnnotation = {
      id: 'nonspatial-note',
      annotation_kind: 'annotation',
      defect_class: 'Review note',
      modality: 'volume',
      comment: 'No spatial geometry',
      disposition: 'open',
      hidden: false,
    };
    const renderSpy = jest.spyOn(pt3VectorAnnotations, 'renderPt3VectorAnnotations');

    try {
      mockWorkbenchFetch(makePt3ScenarioWithMetadata({
        annotations: [
          lineAnnotation,
          boxAnnotation,
          cubeAnnotation,
          segmentAnnotation,
          nonspatialAnnotation,
        ],
      }));
      render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

      const expectedRows = [
        ['Measurement', '1.41 mm'],
        ['Bounding Box', '20.0 x 25.0 px'],
        ['3D Box', '8.0 x 6.0 px'],
        ['VISTA segment', 'Internal pore'],
        ['Review note', 'No spatial geometry'],
      ];
      const annotationList = await screen.findByTestId('annotation-list');
      await within(annotationList).findByText('1.41 mm');
      expectedRows.forEach(([typeLabel, displayName]) => {
        expect(within(annotationList).getByText(typeLabel)).toBeInTheDocument();
        expect(within(annotationList).getByText(displayName)).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText('3D view'), {
        target: { value: 'ray-march:composite' },
      });
      await waitFor(() => {
        const spatialCall = renderSpy.mock.calls.find(([, options]) => {
          const ids = (options?.vectorAnnotations || []).map((annotation) => annotation.id);
          return [
            'persisted-mpr-line',
            'persisted-mpr-box',
            'persisted-mpr-cube',
            'vista-segment-1',
          ].every((id) => ids.includes(id));
        });
        expect(spatialCall).toBeDefined();
        const renderedAnnotations = spatialCall[1].vectorAnnotations;
        expect(renderedAnnotations.map((annotation) => annotation.id)).not.toContain('nonspatial-note');
        expect(renderedAnnotations.find((annotation) => annotation.id === 'persisted-mpr-line'))
          .toEqual(expect.objectContaining({ minSlice: 11, maxSlice: 11 }));
        expect(renderedAnnotations.find((annotation) => annotation.id === 'persisted-mpr-box'))
          .toEqual(expect.objectContaining({ minSlice: 11, maxSlice: 11 }));
      });

      fireEvent.keyDown(screen.getByRole('button', { name: 'Open 3D part view fullscreen' }), {
        key: 'Enter',
      });
      const fullscreenList = screen.getByLabelText('3D annotations');
      expectedRows.forEach(([typeLabel, displayName]) => {
        expect(within(fullscreenList).getByText(typeLabel)).toBeInTheDocument();
        expect(within(fullscreenList).getByText(displayName)).toBeInTheDocument();
      });
      expect(within(fullscreenList).getByRole('button', {
        name: 'Hide 3D annotation No spatial geometry',
      })).toBeInTheDocument();
    } finally {
      renderSpy.mockRestore();
    }
  });

  test('segmentation helper opens, switches tools, brush size, operation and ML family, and closes', async () => {
    const segment = makeVistaSegmentAnnotation();
    mockWorkbenchFetch(makePt3ScenarioWithMetadata({ annotations: [segment] }));
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    const annotationList = await screen.findByTestId('annotation-list');
    await waitFor(() => expect(within(annotationList).getByText('Internal pore')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Segmentation Helpers' }));
    const dialog = screen.getByRole('dialog', { name: 'Segmentation Helpers' });
    await waitFor(() => expect(within(dialog).getByTestId('segmentation-segment-list')).toHaveTextContent('Internal pore'));
    expect(within(dialog).getByRole('tab', { name: /^Z/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByRole('button', { name: /^Brush:/ })).toHaveClass('active');
    expect(within(dialog).getByRole('group', { name: 'Brush dimensional mode' })).toBeInTheDocument();

    const polygon = within(dialog).getByRole('button', { name: /^Polygon:/ });
    fireEvent.click(polygon);
    expect(polygon).toHaveClass('active');
    expect(within(dialog).queryByRole('group', { name: 'Brush dimensional mode' })).not.toBeInTheDocument();
    expect(within(dialog).getByText('Defined points are shown as dots on the slice. Double-click closes polygon selections.')).toBeInTheDocument();

    const brushSize = within(dialog).getByLabelText(/Brush size/);
    expect(within(dialog).getByText('18px')).toBeInTheDocument();
    fireEvent.change(brushSize, { target: { value: '40' } });
    expect(within(dialog).getByText('40px')).toBeInTheDocument();
    const sensitivity = within(dialog).getByLabelText(/Sensitivity/);
    fireEvent.change(sensitivity, { target: { value: '50' } });
    expect(sensitivity).toHaveValue('50');

    const subtract = within(dialog).getByRole('button', { name: 'Subtract' });
    fireEvent.click(subtract);
    expect(subtract).toHaveClass('active');
    expect(within(dialog).getByRole('button', { name: 'Add' })).not.toHaveClass('active');
    expect(within(dialog).getByRole('button', { name: 'Add selection' })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('button', { name: /^ML Helper:/ }));
    const methodFamily = within(dialog).getByLabelText(/Method family/);
    expect(methodFamily).toHaveValue('opencv');
    fireEvent.change(methodFamily, { target: { value: 'sam' } });
    expect(within(dialog).getByLabelText(/Segment function/)).toHaveValue('segmentation.sam.placeholder');

    fireEvent.click(within(dialog).getByRole('tab', { name: /^MPR/ }));
    expect(within(dialog).getByTestId('segmentation-helper-mpr')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByTestId('segmentation-helper-mpr-coronal'));
    expect(within(dialog).getByRole('tab', { name: /^Y/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByTestId('segmentation-helper-stage')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Segmentation Helpers' }));
    expect(screen.queryByRole('dialog', { name: 'Segmentation Helpers' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Segmentation Helpers' }));
    const reopened = screen.getByRole('dialog', { name: 'Segmentation Helpers' });
    expect(within(reopened).getByText('40px')).toBeInTheDocument();
    expect(within(reopened).getByRole('button', { name: /^ML Helper:/ })).toHaveClass('active');
    expect(within(reopened).getByRole('button', { name: 'Subtract' })).toHaveClass('active');
  });

  test('PT3 annotation consolidation: brush drawing survives throwing pointer-capture methods and persists geometry', async () => {
    const segment = makeVistaSegmentAnnotation();
    mockWorkbenchFetch(makePt3ScenarioWithMetadata({ annotations: [segment] }));
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    const annotationList = await screen.findByTestId('annotation-list');
    await waitFor(() => expect(within(annotationList).getByText('Internal pore')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Segmentation Helpers' }));
    const stage = screen.getByTestId('segmentation-helper-stage');
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 });
    stage.setPointerCapture = jest.fn(() => {
      throw new DOMException('No active pointer', 'NotFoundError');
    });
    stage.releasePointerCapture = jest.fn(() => {
      throw new DOMException('No active pointer', 'NotFoundError');
    });

    expect(() => {
      fireCoordinatePointerEvent(stage, 'pointerdown', { clientX: 120, clientY: 90, button: 0, pointerId: 7 });
      fireCoordinatePointerEvent(stage, 'pointermove', { clientX: 155, clientY: 115, buttons: 1, pointerId: 7 });
      fireCoordinatePointerEvent(stage, 'pointerup', { clientX: 180, clientY: 130, button: 0, pointerId: 7 });
    }).not.toThrow();

    const annotationUrl = '/api/projects/proj-1/parts/part-adv-1/annotations/vista-segment-1';
    await waitFor(() => {
      const geometryCall = global.fetch.mock.calls.find(([url, options]) => {
        if (url !== annotationUrl || options?.method !== 'PATCH') return false;
        return JSON.parse(options.body).geometry?.segment?.areas?.some((area) => area.tool === 'brush');
      });
      expect(geometryCall).toBeDefined();
      const payload = JSON.parse(geometryCall[1].body);
      expect(payload.geometry.segment.areas).toEqual(expect.arrayContaining([
        expect.objectContaining({
          tool: 'brush',
          operation: 'add',
          points: expect.arrayContaining([
            expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
          ]),
        }),
      ]));
    });

    const persistedBrushCalls = global.fetch.mock.calls.filter(([url, options]) => (
      url === annotationUrl
      && options?.method === 'PATCH'
      && JSON.parse(options.body).geometry?.segment?.areas?.some((area) => area.tool === 'brush')
    )).length;
    fireCoordinatePointerEvent(stage, 'pointerdown', { clientX: 130, clientY: 95, button: 0, pointerId: 8 });
    fireEvent.pointerLeave(stage, { clientX: 420, clientY: 95, buttons: 1, pointerId: 8 });
    fireCoordinatePointerEvent(stage, 'pointermove', { clientX: 160, clientY: 120, buttons: 1, pointerId: 8 });
    fireCoordinatePointerEvent(stage, 'pointerup', { clientX: 180, clientY: 130, button: 0, pointerId: 8 });
    expect(global.fetch.mock.calls.filter(([url, options]) => (
      url === annotationUrl
      && options?.method === 'PATCH'
      && JSON.parse(options.body).geometry?.segment?.areas?.some((area) => area.tool === 'brush')
    ))).toHaveLength(persistedBrushCalls);

    stage.setPointerCapture = jest.fn();
    stage.releasePointerCapture = jest.fn();
    fireCoordinatePointerEvent(stage, 'pointerdown', { clientX: 100, clientY: 80, button: 0, pointerId: 9 });
    fireCoordinatePointerEvent(stage, 'pointermove', { clientX: 120, clientY: 95, buttons: 1, pointerId: 9 });
    fireCoordinatePointerEvent(stage, 'pointerdown', { clientX: 320, clientY: 240, button: 0, pointerId: 10 });
    fireCoordinatePointerEvent(stage, 'pointermove', { clientX: 340, clientY: 260, buttons: 1, pointerId: 10 });
    fireCoordinatePointerEvent(stage, 'pointerup', { clientX: 340, clientY: 260, button: 0, pointerId: 10 });
    fireCoordinatePointerEvent(stage, 'pointercancel', { clientX: 340, clientY: 260, pointerId: 10 });
    fireCoordinatePointerEvent(stage, 'pointermove', { clientX: 145, clientY: 110, buttons: 1, pointerId: 9 });
    fireCoordinatePointerEvent(stage, 'pointerup', { clientX: 145, clientY: 110, button: 0, pointerId: 9 });

    await waitFor(() => {
      const brushCalls = global.fetch.mock.calls.filter(([url, options]) => (
        url === annotationUrl
        && options?.method === 'PATCH'
        && JSON.parse(options.body).geometry?.segment?.areas?.some((area) => area.tool === 'brush')
      ));
      expect(brushCalls).toHaveLength(persistedBrushCalls + 1);
      const areas = JSON.parse(brushCalls[brushCalls.length - 1][1].body).geometry.segment.areas;
      const latestBrush = areas.filter((area) => area.tool === 'brush').at(-1);
      expect(latestBrush.points).toHaveLength(3);
    });
    expect(stage.releasePointerCapture).toHaveBeenCalledWith(9);
    expect(stage.releasePointerCapture).not.toHaveBeenCalledWith(10);
  });

  test('segmentation helper keeps Tab and Shift+Tab focus inside the dialog', async () => {
    mockWorkbenchFetch(makePt3ScenarioWithMetadata({ annotations: [makeVistaSegmentAnnotation()] }));
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);
    await screen.findByTestId('mpr-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Segmentation Helpers' }));
    const dialog = await screen.findByRole('dialog', { name: 'Segmentation Helpers' });
    const focusable = Array.from(dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getAttribute('aria-hidden') !== 'true' && element.tabIndex >= 0);
    expect(focusable.length).toBeGreaterThan(2);
    focusable.at(-1).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(focusable[0]).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(focusable.at(-1)).toHaveFocus();
    focusable[0].focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(focusable[1]).toHaveFocus();
  });

  test('discards a segment save that resolves after the user switches to another part', async () => {
    mockWorkbenchFetch(makePt3ScenarioWithMetadata({ annotations: [] }));
    const baseFetch = global.fetch;
    const annotationCollectionUrl = '/api/projects/proj-1/parts/part-adv-1/annotations';
    const postRequests = [];
    global.fetch = jest.fn((url, options = {}) => {
      if (url === annotationCollectionUrl && options.method === 'POST') {
        return new Promise((resolve) => {
          postRequests.push({ options, resolve });
        });
      }
      return baseFetch(url, options);
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);
    await screen.findByTestId('mpr-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Segmentation Helpers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add new segment' }));
    await waitFor(() => expect(postRequests).toHaveLength(1));
    const postPayload = JSON.parse(postRequests[0].options.body);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Segmentation Helpers' })).not.toBeInTheDocument());

    fireEvent.change(screen.getByTestId('mpr-part-selector'), { target: { value: 'part-adv-2' } });
    await waitFor(() => expect(screen.getByTestId('mpr-part-selector')).toHaveValue('part-adv-2'));
    const annotationList = await screen.findByTestId('annotation-list');
    const staleJson = jest.fn(async () => ({ id: 'stale-segment-id', ...postPayload }));
    postRequests[0].resolve({ ok: true, status: 201, json: staleJson });
    await waitFor(() => expect(staleJson).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(within(annotationList).queryByText(postPayload.defect_class)).not.toBeInTheDocument();
    expect(screen.getByTestId('mpr-part-selector')).toHaveValue('part-adv-2');
  });

  test('serializes rapid edits to a new VISTA segment behind one POST and applies only the latest PATCH state', async () => {
    mockWorkbenchFetch(makePt3ScenarioWithMetadata({ annotations: [] }));
    const baseFetch = global.fetch;
    const annotationCollectionUrl = '/api/projects/proj-1/parts/part-adv-1/annotations';
    const postRequests = [];
    const patchRequests = [];
    global.fetch = jest.fn((url, options = {}) => {
      if (url === annotationCollectionUrl && options.method === 'POST') {
        return new Promise((resolve) => {
          postRequests.push({ options, resolve });
        });
      }
      if (url === `${annotationCollectionUrl}/rapid-segment-id` && options.method === 'PATCH') {
        return new Promise((resolve) => {
          patchRequests.push({ options, resolve });
        });
      }
      return baseFetch(url, options);
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);
    await screen.findByTestId('mpr-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Segmentation Helpers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add new segment' }));

    await waitFor(() => expect(postRequests).toHaveLength(1));
    expect(patchRequests).toHaveLength(0);

    const stage = screen.getByTestId('segmentation-helper-stage');
    stage.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 300,
      right: 400,
      bottom: 300,
    });
    fireCoordinatePointerEvent(stage, 'pointerdown', { clientX: 120, clientY: 90, button: 0, pointerId: 17 });
    fireCoordinatePointerEvent(stage, 'pointermove', { clientX: 150, clientY: 115, buttons: 1, pointerId: 17 });
    fireCoordinatePointerEvent(stage, 'pointerup', { clientX: 175, clientY: 130, button: 0, pointerId: 17 });
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#e11d48' } });
    fireEvent.change(screen.getByLabelText('Min slice'), { target: { value: '4' } });
    fireEvent.blur(screen.getByLabelText('Min slice'));
    fireEvent.change(screen.getByLabelText('Max slice'), { target: { value: '15' } });
    fireEvent.blur(screen.getByLabelText('Max slice'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rapid final segment' } });
    fireEvent.blur(screen.getByLabelText('Name'));

    // All rapid edits remain queued until the create response establishes the id.
    expect(postRequests).toHaveLength(1);
    expect(patchRequests).toHaveLength(0);

    const postPayload = JSON.parse(postRequests[0].options.body);
    postRequests[0].resolve({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'rapid-segment-id',
        ...postPayload,
        created_at: '2026-04-01T10:00:00Z',
        created_by: 'segmenter@example.com',
      }),
    });

    let finalPatchPayload = null;
    for (let index = 0; index < 8 && !finalPatchPayload; index += 1) {
      await waitFor(() => expect(patchRequests.length).toBeGreaterThan(index));
      const request = patchRequests[index];
      const payload = JSON.parse(request.options.body);
      const areas = payload.geometry?.segment?.areas || [];
      const isLatest = payload.defect_class === 'Rapid final segment'
        && payload.geometry?.segment?.min_slice === 4
        && payload.geometry?.segment?.max_slice === 15
        && areas.some((area) => area.tool === 'brush');
      request.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'rapid-segment-id',
          ...payload,
          updated_at: `2026-04-01T10:00:0${index}Z`,
          updated_by: 'segmenter@example.com',
        }),
      });
      if (isLatest) finalPatchPayload = payload;
    }

    expect(finalPatchPayload).not.toBeNull();
    expect(global.fetch.mock.calls.filter(([url, options]) => (
      url === annotationCollectionUrl && options?.method === 'POST'
    ))).toHaveLength(1);
    const segmentPatchCalls = global.fetch.mock.calls.filter(([url, options]) => (
      String(url).startsWith(`${annotationCollectionUrl}/`)
      && options?.method === 'PATCH'
      && options?.body
    ));
    expect(segmentPatchCalls.length).toBeGreaterThan(0);
    expect(segmentPatchCalls.every(([url]) => url === `${annotationCollectionUrl}/rapid-segment-id`)).toBe(true);
    expect(finalPatchPayload).toEqual(expect.objectContaining({
      defect_class: 'Rapid final segment',
      metadata: expect.objectContaining({ annotation_color: '#e11d48' }),
      geometry: expect.objectContaining({
        segment: expect.objectContaining({ min_slice: 4, max_slice: 15 }),
      }),
    }));

    const annotationList = screen.getByTestId('annotation-list');
    await waitFor(() => expect(within(annotationList).getAllByText('Rapid final segment')).toHaveLength(1));
    expect(within(screen.getByTestId('segmentation-segment-list')).getAllByText('Rapid final segment')).toHaveLength(1);
  });

  test('serializes VISTA segment visibility behind in-flight helper edits without reverting geometry or hidden state', async () => {
    const segment = makeVistaSegmentAnnotation();
    mockWorkbenchFetch(makePt3ScenarioWithMetadata({ annotations: [segment] }));
    const baseFetch = global.fetch;
    const annotationUrl = '/api/projects/proj-1/parts/part-adv-1/annotations/vista-segment-1';
    const patchRequests = [];
    global.fetch = jest.fn((url, options = {}) => {
      if (url === annotationUrl && options.method === 'PATCH') {
        return new Promise((resolve) => patchRequests.push({ options, resolve }));
      }
      return baseFetch(url, options);
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);
    const annotationList = await screen.findByTestId('annotation-list');
    fireEvent.click(screen.getByRole('button', { name: 'Segmentation Helpers' }));
    await waitFor(() => expect(screen.getByTestId('segmentation-segment-list')).toHaveTextContent('Internal pore'));
    fireEvent.click(within(screen.getByTestId('segmentation-segment-list')).getByRole('button', { name: 'Edit Internal pore' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Race-safe pore' } });
    fireEvent.blur(screen.getByLabelText('Name'));
    await waitFor(() => expect(patchRequests).toHaveLength(1));

    fireEvent.click(within(annotationList).getByRole('button', { name: 'Hide vista segment Internal pore' }));
    expect(patchRequests).toHaveLength(1);

    const editPayload = JSON.parse(patchRequests[0].options.body);
    expect(editPayload).toEqual(expect.objectContaining({ defect_class: 'Race-safe pore', hidden: false }));
    patchRequests[0].resolve({
      ok: true,
      status: 200,
      json: async () => ({ id: 'vista-segment-1', ...editPayload }),
    });

    await waitFor(() => expect(patchRequests).toHaveLength(2));
    const visibilityPayload = JSON.parse(patchRequests[1].options.body);
    expect(visibilityPayload).toEqual(expect.objectContaining({ defect_class: 'Race-safe pore', hidden: true }));
    expect(visibilityPayload.geometry).toEqual(editPayload.geometry);
    patchRequests[1].resolve({
      ok: true,
      status: 200,
      json: async () => ({ id: 'vista-segment-1', ...editPayload, hidden: false }),
    });

    await waitFor(() => {
      expect(within(annotationList).getByRole('button', { name: 'Show vista segment Race-safe pore' })).toBeInTheDocument();
    });
  });

  test('serializes VISTA segment deletion after an in-flight helper PATCH and prevents resurrection', async () => {
    const segment = makeVistaSegmentAnnotation();
    mockWorkbenchFetch(makePt3ScenarioWithMetadata({ annotations: [segment] }));
    const baseFetch = global.fetch;
    const annotationUrl = '/api/projects/proj-1/parts/part-adv-1/annotations/vista-segment-1';
    const patchRequests = [];
    const deleteRequests = [];
    global.fetch = jest.fn((url, options = {}) => {
      if (url === annotationUrl && options.method === 'PATCH') {
        return new Promise((resolve) => patchRequests.push({ options, resolve }));
      }
      if (url === annotationUrl && options.method === 'DELETE') {
        return new Promise((resolve) => deleteRequests.push({ options, resolve }));
      }
      return baseFetch(url, options);
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);
    const annotationList = await screen.findByTestId('annotation-list');
    await waitFor(() => expect(within(annotationList).getByText('Internal pore')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Segmentation Helpers' }));
    await waitFor(() => expect(screen.getByTestId('segmentation-segment-list')).toHaveTextContent('Internal pore'));
    fireEvent.click(within(screen.getByTestId('segmentation-segment-list')).getByRole('button', { name: 'Edit Internal pore' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Soon deleted pore' } });
    fireEvent.blur(screen.getByLabelText('Name'));
    await waitFor(() => expect(patchRequests).toHaveLength(1));

    fireEvent.click(within(annotationList).getByRole('button', { name: 'Delete annotation Persisted helper segment' }));
    expect(deleteRequests).toHaveLength(0);

    const patchPayload = JSON.parse(patchRequests[0].options.body);
    patchRequests[0].resolve({
      ok: true,
      status: 200,
      json: async () => ({ id: 'vista-segment-1', ...patchPayload }),
    });
    await waitFor(() => expect(deleteRequests).toHaveLength(1));
    expect(patchRequests).toHaveLength(1);

    deleteRequests[0].resolve({ ok: true, status: 204 });
    await waitFor(() => {
      expect(within(annotationList).queryByText('Internal pore')).not.toBeInTheDocument();
      expect(within(annotationList).queryByText('Soon deleted pore')).not.toBeInTheDocument();
    });
    expect(patchRequests).toHaveLength(1);
  });

  test('PT3 annotation consolidation: segment edit keeps its creation axis read-only and PATCHes a normalized slice range', async () => {
    const segment = makeVistaSegmentAnnotation({
      geometry: {
        segment: {
          version: 1,
          axis: 'coronal',
          min_slice: 3,
          max_slice: 9,
          image_width: 80,
          image_height: 128,
          areas: [],
        },
      },
    });
    mockWorkbenchFetch(makePt3ScenarioWithMetadata({ annotations: [segment] }));
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    const annotationList = await screen.findByTestId('annotation-list');
    fireEvent.click(screen.getByRole('button', { name: 'Segmentation Helpers' }));
    expect(screen.getByRole('dialog', { name: 'Segmentation Helpers' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('segmentation-segment-list')).getByRole('button', { name: 'Edit Internal pore' }));
    expect(screen.getByLabelText('Creation axis')).toHaveValue('XZ');
    expect(screen.getByLabelText('Creation axis')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Min slice')).toHaveValue(3);
    expect(screen.getByLabelText('Max slice')).toHaveValue(9);

    fireEvent.change(screen.getByLabelText('Min slice'), { target: { value: '12' } });
    fireEvent.blur(screen.getByLabelText('Min slice'));

    const annotationUrl = '/api/projects/proj-1/parts/part-adv-1/annotations/vista-segment-1';
    await waitFor(() => {
      const rangeCall = global.fetch.mock.calls.find(([url, options]) => {
        if (url !== annotationUrl || options?.method !== 'PATCH') return false;
        const geometry = JSON.parse(options.body).geometry?.segment;
        return geometry?.min_slice === 12 && geometry?.max_slice === 12;
      });
      expect(rangeCall).toBeDefined();
      expect(JSON.parse(rangeCall[1].body).geometry.segment).toEqual(expect.objectContaining({
        axis: 'coronal',
        min_slice: 12,
        max_slice: 12,
      }));
    });
  });

  test('opens PT3 segmentation helpers with editable segments and slice drawing tools', async () => {
    mockWorkbenchFetch(scenarioByUser[2]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await waitFor(() => expect(screen.getByTestId('mpr-panel')).toBeInTheDocument());

    const segmentationHelperButton = screen.getByRole('button', { name: 'Segmentation Helpers' });
    fireEvent.click(segmentationHelperButton);
    expect(screen.getByRole('dialog', { name: 'Segmentation Helpers' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close Segmentation Helpers' })).toHaveFocus());
    expect(screen.getByTestId('segmentation-segment-list')).toHaveTextContent('Segment A');
    const viewTabs = screen.getByRole('tablist', { name: 'Segmentation workspace views' });
    expect(within(viewTabs).getByRole('tab', { name: 'X YZ' })).toBeInTheDocument();
    expect(within(viewTabs).getByRole('tab', { name: 'Y XZ' })).toBeInTheDocument();
    expect(within(viewTabs).getByRole('tab', { name: 'Z XY' })).toHaveAttribute('aria-selected', 'true');
    expect(within(viewTabs).getByRole('tab', { name: 'MPR' })).toBeInTheDocument();
    expect(within(viewTabs).getByRole('tab', { name: '3D' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Brush dimensional mode' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Brush 2D mode' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Slice navigation')).toHaveTextContent('Z');
    expect(screen.getByRole('button', { name: /^Connected:/i })).toHaveAttribute('data-tooltip', expect.stringContaining('Connected'));
    expect(screen.getByRole('button', { name: /Level Trace: Trace an equal-intensity contour/i })).toHaveAttribute('data-tooltip', expect.stringContaining('Level Trace'));
    expect(screen.getByRole('button', { name: /Scissors: Mark cut paths/i })).toHaveAttribute('data-tooltip', expect.stringContaining('Scissors'));

    fireEvent.click(screen.getByRole('button', { name: /Edit Segment A/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Void core' } });
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#e11d48' } });
    expect(screen.getByTestId('segmentation-segment-list')).toHaveTextContent('Void core');

    fireEvent.click(screen.getByRole('button', { name: 'Add new segment' }));
    expect(screen.getByTestId('segmentation-segment-list')).toHaveTextContent('Segment B');

    fireEvent.click(within(viewTabs).getByRole('tab', { name: 'Y XZ' }));
    fireEvent.change(screen.getByLabelText('Y'), { target: { value: '12' } });
    expect(screen.getAllByText('Y 12 / 95').length).toBeGreaterThan(0);

    const stage = screen.getByTestId('segmentation-helper-stage');
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 });
    fireEvent.wheel(stage, { deltaY: 80 });
    expect(screen.getAllByText('Y 13 / 95').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Brush size'), { target: { value: '32' } });
    fireCoordinatePointerEvent(stage, 'pointermove', { clientX: 200, clientY: 120 });
    expect(stage).toHaveClass('show-brush-pointer');
    expect(stage.style.getPropertyValue('--brush-pointer-size')).toBe('32px');

    fireEvent.click(screen.getByRole('button', { name: /^Connected:/i }));
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
    fireCoordinatePointerEvent(stage, 'pointerdown', { clientX: 120, clientY: 90, button: 0 });
    expect(stage.querySelector('.segmentation-helper-point')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Segmentation helper overlay').querySelector('ellipse')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add selection' }));
    expect(screen.getByTestId('segmentation-segment-list')).toHaveTextContent('1 areas');

    fireEvent.click(screen.getByRole('button', { name: /Polygon/i }));
    fireCoordinatePointerEvent(stage, 'pointerdown', { clientX: 120, clientY: 70, button: 0 });
    fireCoordinatePointerEvent(stage, 'pointerdown', { clientX: 180, clientY: 80, button: 0 });
    fireCoordinatePointerEvent(stage, 'pointerdown', { clientX: 140, clientY: 160, button: 0 });
    expect(stage.querySelectorAll('.segmentation-helper-point').length).toBeGreaterThanOrEqual(3);
    fireEvent.doubleClick(stage, { clientX: 140, clientY: 160, button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Subtract selection' }));
    expect(screen.getByTestId('segmentation-segment-list')).toHaveTextContent('2 areas');

    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = jest.fn(() => 'data:image/png;base64,c2xpY2U=');
    fireEvent.click(screen.getByRole('button', { name: /ML Helper/i }));
    expect(screen.getByLabelText('ML helper options')).toHaveTextContent('OpenCV');
    fireEvent.change(screen.getByLabelText('Method family'), { target: { value: 'yolo' } });
    expect(screen.getByLabelText('Segment function')).toHaveDisplayValue('YOLO');
    expect(screen.queryByText('YOLO (placeholder)')).not.toBeInTheDocument();
    fireCoordinatePointerEvent(stage, 'pointerdown', { clientX: 220, clientY: 110, button: 0 });
    await waitFor(() => expect(screen.getByText(/Selected ML region 2/i)).toBeInTheDocument());
    const yoloPayload = JSON.parse(global.fetch.mock.calls.find((call) => call[0].includes('/slice-segmentation'))[1].body);
    expect(yoloPayload.method_id).toBe('segmentation.yolo.placeholder');
    expect(yoloPayload.parameters.options).toEqual({ model: 'yolo11n-seg.pt', confidence: 0.25, iou: 0.7 });

    fireEvent.change(screen.getByLabelText('Method family'), { target: { value: 'sam' } });
    expect(screen.getByLabelText('Segment function')).toHaveValue('segmentation.sam.placeholder');
    fireEvent.change(screen.getByLabelText('Local/Remote'), { target: { value: 'local' } });
    const beforeMlCalls = global.fetch.mock.calls.filter((call) => call[0].includes('/slice-segmentation')).length;
    fireCoordinatePointerEvent(stage, 'pointerdown', { clientX: 220, clientY: 110, button: 0 });
    await waitFor(() => expect(screen.getByText(/Selected ML region 2/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Add selection' }));
    expect(screen.getByTestId('segmentation-segment-list')).toHaveTextContent('3 areas');
    const afterFirstMlCalls = global.fetch.mock.calls.filter((call) => call[0].includes('/slice-segmentation')).length;
    expect(afterFirstMlCalls).toBe(beforeMlCalls + 1);
    const mlPayload = JSON.parse(global.fetch.mock.calls.filter((call) => call[0].includes('/slice-segmentation')).at(-1)[1].body);
    expect(mlPayload.method_id).toBe('segmentation.sam.placeholder');
    expect(mlPayload.parameters.integration_mode).toBe('local');

    fireCoordinatePointerEvent(stage, 'pointerdown', { clientX: 221, clientY: 111, button: 0 });
    expect(global.fetch.mock.calls.filter((call) => call[0].includes('/slice-segmentation')).length).toBe(afterFirstMlCalls);
    HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Segmentation Helpers' })).not.toBeInTheDocument());
    await waitFor(() => expect(segmentationHelperButton).toHaveFocus());
  });

  test('uses canonical cache dimensions for ML helper pointer coordinates and persisted geometry', async () => {
    const uiDimensions = { axial: 12, coronal: 14, sagittal: 16 };
    const cacheDimensions = { axial: 6, coronal: 7, sagittal: 8 };
    const volumeSource = {
      filename: 'canonical-cache-volume.npy',
      image_id: 'canonical-cache-volume',
      metadata: {
        load_mode: 'volume',
        volume_shape: cacheDimensions,
        channel_count: 1,
        color_mode: 'scalar',
      },
    };
    const segment = makeVistaSegmentAnnotation();
    const scenario = makePt3ScenarioWithMetadata({
      volume_shape: uiDimensions,
      source_images: [volumeSource],
      annotations: [segment],
    });
    mockWorkbenchFetch({
      ...scenario,
      projectImages: [{
        id: volumeSource.image_id,
        filename: volumeSource.filename,
        metadata: volumeSource.metadata,
      }],
    });
    const baseFetch = global.fetch;
    global.fetch = jest.fn((url, options = {}) => {
      if (url.includes('/slice-segmentation') && options.method === 'POST') {
        const payload = JSON.parse(options.body);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            axis: payload.axis,
            slice_index: payload.slice_index,
            method_id: payload.method_id,
            regions: [{
              label: 7,
              area_px: 56,
              bbox: [0, 0, cacheDimensions.sagittal, cacheDimensions.coronal],
              centroid: [cacheDimensions.sagittal / 2, cacheDimensions.coronal / 2],
            }],
          }),
        });
      }
      return baseFetch(url, options);
    });
    const dataUrlSpy = jest.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,Y2Fub25pY2Fs');

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);
    await screen.findByTestId('mpr-panel');
    await within(screen.getByTestId('annotation-list')).findByText('Internal pore');
    fireEvent.click(screen.getByRole('button', { name: 'Segmentation Helpers' }));
    await waitFor(() => expect(screen.getByTestId('segmentation-segment-list')).toHaveTextContent('Internal pore'));
    fireEvent.click(screen.getByRole('button', { name: /ML Helper/i }));

    const stage = screen.getByTestId('segmentation-helper-stage');
    stage.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 350,
      right: 400,
      bottom: 350,
    });
    fireCoordinatePointerEvent(stage, 'pointerdown', {
      clientX: 200,
      clientY: 175,
      button: 0,
      pointerId: 61,
    });

    await waitFor(() => expect(screen.getByText(/Selected ML region 7/i)).toBeInTheDocument());
    const mlCall = global.fetch.mock.calls.find(([url]) => url.includes('/slice-segmentation'));
    expect(mlCall).toBeDefined();
    const mlPayload = JSON.parse(mlCall[1].body);
    expect(mlPayload.click_x).toBeCloseTo(4, 6);
    expect(mlPayload.click_y).toBeCloseTo(3.5, 6);

    fireEvent.click(screen.getByRole('button', { name: 'Add selection' }));
    const annotationUrl = '/api/projects/proj-1/parts/part-adv-1/annotations/vista-segment-1';
    await waitFor(() => {
      const mutationUrls = global.fetch.mock.calls
        .filter(([, options]) => ['PATCH', 'POST'].includes(options?.method))
        .map(([url]) => url);
      expect(mutationUrls).toContain(annotationUrl);
      const saveCall = global.fetch.mock.calls.find(([url, options]) => (
        url === annotationUrl && options?.method === 'PATCH'
      ));
      expect(saveCall).toBeDefined();
      const saved = JSON.parse(saveCall[1].body).geometry.segment;
      expect(saved.areas).toEqual(expect.arrayContaining([expect.objectContaining({
        tool: 'ml-helper',
        imageWidth: 8,
        imageHeight: 7,
        sliceIndex: 5,
      })]));
    });

    const viewTabs = screen.getByRole('tablist', { name: 'Segmentation workspace views' });
    fireEvent.click(within(viewTabs).getByRole('tab', { name: '3D' }));
    const helper3dStage = screen.getByTestId('segmentation-helper-3d-stage');
    const helperViewer = within(helper3dStage).getByTestId('pt3-gaussian-splat-viewer');
    expect(helperViewer).toBeInTheDocument();
    const helperCanvas = within(helper3dStage).getByLabelText('Mechanical 3DGS preview');
    expect(document.getElementById(helperCanvas.getAttribute('aria-describedby'))).toHaveTextContent(
      'Active plane XY • Z 5 / 5. X 3 / 7; Y 4 / 6; Z 5 / 5.',
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Segmentation Helpers' })).not.toBeInTheDocument());
    dataUrlSpy.mockRestore();
  });

  test('keeps per-tool 3D mode across views and persists brush strokes as sphere voxels', async () => {
    const segment = makeVistaSegmentAnnotation();
    mockWorkbenchFetch(makePt3ScenarioWithMetadata({ annotations: [segment] }));
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    const annotationList = await screen.findByTestId('annotation-list');
    await within(annotationList).findByText('Internal pore');
    fireEvent.click(screen.getByRole('button', { name: 'Segmentation Helpers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Brush 3D mode' }));
    expect(screen.getByRole('button', { name: 'Brush 3D mode' })).toHaveAttribute('aria-pressed', 'true');

    const viewTabs = screen.getByRole('tablist', { name: 'Segmentation workspace views' });
    fireEvent.click(within(viewTabs).getByRole('tab', { name: 'Y XZ' }));
    expect(screen.getByRole('button', { name: 'Brush 3D mode' })).toHaveAttribute('aria-pressed', 'true');

    const stage = screen.getByTestId('segmentation-helper-stage');
    stage.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 300,
      right: 400,
      bottom: 300,
    });
    fireCoordinatePointerEvent(stage, 'pointerdown', {
      clientX: 190,
      clientY: 145,
      button: 0,
      pointerId: 31,
    });
    fireCoordinatePointerEvent(stage, 'pointermove', {
      clientX: 210,
      clientY: 150,
      buttons: 1,
      pointerId: 31,
    });
    fireCoordinatePointerEvent(stage, 'pointerup', {
      clientX: 210,
      clientY: 150,
      button: 0,
      pointerId: 31,
    });

    const annotationUrl = '/api/projects/proj-1/parts/part-adv-1/annotations/vista-segment-1';
    await waitFor(() => {
      const volumeCall = global.fetch.mock.calls.find(([url, options]) => {
        if (url !== annotationUrl || options?.method !== 'PATCH') return false;
        const savedSegment = JSON.parse(options.body).geometry?.segment;
        return savedSegment?.version === 2
          && savedSegment.areas?.some((area) => area.mode === '3d' && area.tool === 'volume-mask');
      });
      expect(volumeCall).toBeDefined();
      const savedSegment = JSON.parse(volumeCall[1].body).geometry.segment;
      expect(savedSegment.volume_dimensions).toEqual([80, 96, 128]);
      expect(savedSegment.areas.at(-1)).toEqual(expect.objectContaining({
        mode: '3d',
        tool: 'volume-mask',
        operation: 'add',
        spacing: [0.08, 0.08, 0.12],
        voxelCount: expect.any(Number),
        volumeRuns: expect.arrayContaining([
          expect.arrayContaining([
            expect.any(Number),
            expect.any(Number),
            expect.any(Number),
            expect.any(Number),
          ]),
        ]),
      }));
    });

    fireEvent.click(within(viewTabs).getByRole('tab', { name: 'MPR' }));
    expect(screen.getByTestId('segmentation-helper-mpr')).toBeInTheDocument();
    expect(screen.getByTestId('segmentation-helper-mpr-axial')).toBeInTheDocument();
    expect(screen.getByTestId('segmentation-helper-mpr-coronal')).toBeInTheDocument();
    expect(screen.getByTestId('segmentation-helper-mpr-sagittal')).toBeInTheDocument();

    fireEvent.click(within(viewTabs).getByRole('tab', { name: '3D' }));
    expect(screen.getByTestId('segmentation-helper-3d-stage')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Polygon:/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Brush 3D mode' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => {
      const viewer = within(screen.getByTestId('segmentation-helper-3d-stage'))
        .getByTestId('pt3-gaussian-splat-viewer');
      expect(viewer).not.toHaveAttribute('data-renderer-type', 'pending');
      expect(viewer).toHaveTextContent(/Ray march (?:ready|fallback)/i);
    });
  });

  test('compacts a schema-maximum legacy segment before applying the newest 3D gesture', async () => {
    const legacyAreas = Array.from({ length: 64 }, (_, index) => ({
      id: `legacy-${index}`,
      tool: 'rectangle',
      mode: '2d',
      operation: 'add',
      axis: 'axial',
      sliceIndex: 3,
      imageWidth: 80,
      imageHeight: 96,
      start: { x: index % 8, y: Math.floor(index / 8) },
      end: { x: (index % 8) + 1, y: Math.floor(index / 8) + 1 },
    }));
    const segment = makeVistaSegmentAnnotation({
      geometry: {
        segment: {
          version: 1,
          axis: 'axial',
          min_slice: 3,
          max_slice: 9,
          image_width: 80,
          image_height: 96,
          areas: legacyAreas,
        },
      },
    });
    mockWorkbenchFetch(makePt3ScenarioWithMetadata({ annotations: [segment] }));
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await within(await screen.findByTestId('annotation-list')).findByText('Internal pore');
    fireEvent.click(screen.getByRole('button', { name: 'Segmentation Helpers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Brush 3D mode' }));
    const stage = screen.getByTestId('segmentation-helper-stage');
    stage.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 300,
      right: 400,
      bottom: 300,
    });
    fireCoordinatePointerEvent(stage, 'pointerdown', {
      clientX: 250,
      clientY: 180,
      button: 0,
      pointerId: 55,
    });
    fireCoordinatePointerEvent(stage, 'pointerup', {
      clientX: 250,
      clientY: 180,
      button: 0,
      pointerId: 55,
    });

    const annotationUrl = '/api/projects/proj-1/parts/part-adv-1/annotations/vista-segment-1';
    await waitFor(() => {
      const saveCall = global.fetch.mock.calls.find(([url, options]) => {
        if (url !== annotationUrl || options?.method !== 'PATCH') return false;
        const saved = JSON.parse(options.body).geometry?.segment;
        return saved?.version === 2 && saved.areas?.[0]?.tool === 'volume-mask';
      });
      expect(saveCall).toBeDefined();
      const saved = JSON.parse(saveCall[1].body).geometry.segment;
      expect(saved.areas).toHaveLength(1);
      expect(saved.areas[0].truncated).toBe(false);
      expect(saved.areas[0].volumeRuns.some((run) => run[0] !== 3)).toBe(true);
    });
  });

  test('previews server-backed 3D connected growth before applying it to the segment', async () => {
    const segment = makeVistaSegmentAnnotation({
      geometry: {
        segment: {
          version: 1,
          axis: 'axial',
          min_slice: 0,
          max_slice: 5,
          image_width: 8,
          image_height: 7,
          areas: [],
        },
      },
    });
    const fillerSegments = Array.from({ length: 63 }, (_, index) => (
      makeVistaSegmentAnnotation({
        id: `volume-filler-${index}`,
        defect_class: `Volume filler ${index}`,
        ...(index === 0 ? {
          geometry: {
            segment: {
              version: 2,
              axis: 'axial',
              min_slice: 0,
              max_slice: 5,
              image_width: 8,
              image_height: 7,
              volume_dimensions: [8, 7, 6],
              areas: [{
                id: 'filler-volume-mask',
                tool: 'volume-mask',
                mode: '3d',
                operation: 'add',
                volumeRuns: [[0, 0, 0, 8]],
              }],
            },
          },
        } : {}),
      })
    ));
    const scenario = {
      user: 'connected-volume',
      batches: [{ id: 'batch-volume', name: 'Batch volume' }],
      workspaceState: { selected_batch_id: 'batch-volume', selected_part_id: 'part-volume' },
      parts: [{
        id: 'part-volume',
        batch_id: 'batch-volume',
        serial_number: 'VOLUME-1',
        display_name: 'Connected volume',
        review_state: 'unreviewed',
        metadata: {
          annotations: [segment, ...fillerSegments],
          source_images: [{
            filename: 'connected.npy',
            image_id: 'volume-image-id',
            metadata: {
              load_mode: 'volume',
              volume_shape: { sagittal: 8, coronal: 7, axial: 6 },
            },
          }],
        },
      }],
      projectImages: [{
        id: 'volume-image-id',
        filename: 'connected.npy',
        metadata: {
          load_mode: 'volume',
          volume_shape: { sagittal: 8, coronal: 7, axial: 6 },
        },
      }],
    };
    mockWorkbenchFetch(scenario);
    const vectorRenderSpy = jest.spyOn(pt3VectorAnnotations, 'renderPt3VectorAnnotations');
    const baseFetch = global.fetch;
    global.fetch = jest.fn((url, options = {}) => {
      if (url === '/api/images/volume-image-id/volume-connected-selection' && options.method === 'POST') {
        const payload = JSON.parse(options.body);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            dimensions: [8, 7, 6],
            seed: payload.seed,
            volume_runs: [
              [1, 2, 2, 5],
              [2, 2, 2, 5],
              [3, 2, 2, 5],
            ],
            voxel_count: 9,
            examined: 21,
            bounds: { min: [2, 2, 1], max: [4, 2, 3] },
            truncated: false,
            truncation_reason: '',
            connectivity: 6,
          }),
        });
      }
      return baseFetch(url, options);
    });

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);
    const annotationList = await screen.findByTestId('annotation-list');
    await within(annotationList).findByText('Internal pore');
    fireEvent.click(screen.getByRole('button', { name: 'Segmentation Helpers' }));
    fireEvent.click(screen.getByRole('button', { name: /^Connected:/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Connected 3D mode' }));
    fireEvent.click(within(screen.getByLabelText('Selection operation')).getByRole('button', { name: 'Subtract' }));

    const stage = screen.getByTestId('segmentation-helper-stage');
    stage.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 350,
      right: 400,
      bottom: 350,
    });
    fireCoordinatePointerEvent(stage, 'pointerdown', {
      clientX: 200,
      clientY: 175,
      button: 0,
      pointerId: 41,
    });

    await waitFor(() => expect(screen.getByText(/3D preview: 9 voxels, 6-neighbor connectivity/i)).toBeInTheDocument());
    expect(screen.getByLabelText('Segmentation helper overlay').querySelector('.volumetric-segment-mask')).toBeInTheDocument();
    const endpointCall = global.fetch.mock.calls.find(([url]) => (
      url === '/api/images/volume-image-id/volume-connected-selection'
    ));
    expect(endpointCall).toBeDefined();
    expect(JSON.parse(endpointCall[1].body)).toEqual(expect.objectContaining({
      seed: expect.arrayContaining([expect.any(Number), expect.any(Number), expect.any(Number)]),
      sensitivity: 28,
    }));
    const annotationUrl = '/api/projects/proj-1/parts/part-volume/annotations/vista-segment-1';
    expect(global.fetch.mock.calls.some(([url, options]) => (
      url === annotationUrl && options?.method === 'PATCH'
    ))).toBe(false);

    const viewTabs = screen.getByRole('tablist', { name: 'Segmentation workspace views' });
    fireEvent.click(within(viewTabs).getByRole('tab', { name: 'MPR' }));
    expect(screen.getByText(/3D preview: 9 voxels, 6-neighbor connectivity/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add selection' })).toBeEnabled();
    fireEvent.click(within(viewTabs).getByRole('tab', { name: '3D' }));
    expect(screen.getByText(/3D preview: 9 voxels, 6-neighbor connectivity/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add selection' })).toBeEnabled();
    await waitFor(() => {
      const helperRender = vectorRenderSpy.mock.calls.find(([, options]) => (
        options?.vectorAnnotations?.length === 65
        && options.vectorAnnotations[0]?.id === 'pending-volume-selection'
      ));
      expect(helperRender).toBeDefined();
      const firstRendererPage = helperRender[1].vectorAnnotations.slice(0, 64);
      expect(firstRendererPage[0]).toEqual(expect.objectContaining({
        id: 'pending-volume-selection',
      }));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add selection' }));
    await waitFor(() => {
      const saveCall = global.fetch.mock.calls.find(([url, options]) => {
        if (url !== annotationUrl || options?.method !== 'PATCH') return false;
        const savedSegment = JSON.parse(options.body).geometry?.segment;
        return savedSegment?.version === 2
          && savedSegment.areas?.some((area) => (
            area.tool === 'volume-mask'
            && area.mode === '3d'
            && area.volumeRuns?.length > 0
          ));
      });
      expect(saveCall).toBeDefined();
    });

    vectorRenderSpy.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Volume filler 0' }));
    await waitFor(() => expect(vectorRenderSpy.mock.calls.some(([, options]) => (
      options?.vectorAnnotations?.[0]?.id === 'volume-filler-0'
      && options.vectorAnnotations[1]?.id === 'vista-segment-1'
    ))).toBe(true));
    vectorRenderSpy.mockRestore();
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

    const assertConnectedShape = async (shape, expectedAreaCount) => {
      installSlicePixels(shape);
      fireEvent.click(screen.getByRole('button', { name: /^Connected:/i }));
      fireCoordinatePointerEvent(stage, 'pointerdown', {
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
      await waitFor(() => {
        expect(screen.getByTestId('segmentation-segment-list')).toHaveTextContent(
          `${expectedAreaCount} areas`,
        );
      });
    };

    await assertConnectedShape({
      background: 255,
      shape: { x: 18, y: 24, width: 20, height: 16, value: 0 },
    }, 1);
    await screen.findByRole('button', { name: /Hide vista segment Segment A/i });

    await assertConnectedShape({
      background: 0,
      shape: { x: 42, y: 50, width: 14, height: 18, value: 255 },
    }, 2);
    await waitFor(() => {
      expect(global.fetch.mock.calls.some(([url, options]) => (
        url.includes('/annotations/annotation-1') && options?.method === 'PATCH'
      ))).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close Segmentation Helpers' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Segmentation Helpers' })).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Segmentation Helpers' }));
    await waitFor(() => {
      expect(screen.getByTestId('segmentation-segment-list')).toHaveTextContent('2 areas');
    });
  });

  test('renders projection fallbacks for 2D panes and opens fullscreen images', async () => {
    mockWorkbenchFetch(scenarioByUser[0]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);

    await waitFor(() => {
      expect(screen.getByTestId('mpr-panel')).toBeInTheDocument();
    });

    expect(screen.queryByRole('img', { name: /Volume reconstruction slice/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /fallback projection from front view/i }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('mpr-pane-coronal'));
    expect(screen.getByAltText('XZ slice 8 fullscreen')).toHaveAttribute(
      'src',
      '/api/images/part-basic-1-image-1/content',
    );
    expect(screen.queryByTestId('fullscreen-mpr-slice')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close fullscreen image'));
  });

  test('renders center pane tile fallbacks, and crop subtitles', async () => {
    const tileScenario = {
      user: 'tile-fallbacks',
      hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
      workspaceState: { selected_part_id: 'part-tiles-1' },
      batches: [],
      parts: [{
        id: 'part-tiles-1',
        batch_id: null,
        serial_number: 'SN-TILES-1',
        display_name: 'Tile Part',
        review_state: 'unreviewed',
        metadata: {
          configured_views: ['front', 'back'],
          modalities: ['visual'],
          view_images: { front: 'tile-front.png' },
          source_images: [
            { filename: 'tile-crop.png', image_id: 'tile-crop-id', modality: 'visual', overlay: false, crop_child_image: true, crop_subtitle: 'Feature 1' },
          ],
          annotations: [],
        },
      }],
      projectImages: [
        { id: 'tile-front-id', filename: 'tile-front.png', metadata: {} },
        { id: 'tile-crop-id', filename: 'tile-crop.png', metadata: { crop_child_image: true } },
      ],
    };
    mockWorkbenchFetch(tileScenario);
    const { unmount } = render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" />);
    await waitFor(() => expect(screen.getByAltText('front view')).toBeInTheDocument());
    const subtitle = screen.getByDisplayValue('Feature 1');
    expect(subtitle).toHaveClass('view-cell-subtitle-input');
    expect(subtitle).not.toBeDisabled();
    fireEvent.change(subtitle, { target: { value: 'Feature 2' } });
    expect(screen.getByDisplayValue('Feature 2')).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/proj-1/parts/part-tiles-1/source-images/tile-crop-id',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ crop_subtitle: 'Feature 2' }) }),
    ));
    expect(screen.getByLabelText('Filename tile-crop.png').closest('.view-cell')).toHaveAttribute('role', 'button');
    unmount();

    mockWorkbenchFetch(tileScenario);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT1" readOnly />);
    await waitFor(() => expect(screen.getByAltText('front view')).toBeInTheDocument());
    expect(screen.getByDisplayValue('Feature 1')).toBeDisabled();
  });

  test('shows hidden image placeholders when the saved inspector disables images', async () => {
    mockWorkbenchFetch(scenarioByUser[1]);
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT2" />);
    await waitFor(() => expect(screen.getAllByText('Image hidden').length).toBeGreaterThan(0));
    expect(document.querySelector('.view-board img.inspection-view-image')).toBeNull();
  });

});
