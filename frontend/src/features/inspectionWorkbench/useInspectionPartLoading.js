import { useCallback, useEffect, useState } from 'react';
import { fetchProjectBatches } from '../../api/batches';
import { fallbackOnHttpError } from '../../api/client';
import { fetchProjectParts } from '../../api/parts';
import { fetchProjectConfiguration, fetchProjectMetadataDictionary, fetchProjectWorkspaceState } from '../../api/projects';
import { fetchProjectImagePages } from '../../utils/projectImages';
import { normalizeInspectionColumnWidths, normalizePanelLayout } from './flexLayout';
import { buildProjectImageLookup } from './imageLookup';
import {
  DEFAULT_INSPECTION_COLUMN_WIDTHS,
  DEFAULT_INSPECTOR_HOTKEYS,
  DEFAULT_PANEL_LAYOUT,
  INSPECTION_VIEW_ALL_IMAGES_TAB,
} from './inspectionConstants';
import { normalizeInspectorHotkeys } from './inspectionUtils';
import { ALL_PARTS_ID } from './useInspectionPartSelection';

const SAVED_REVIEW_FILTERS = ['all', 'pass', 'reject_pending', 'reject_confirmed', 'none', 'manual'];
const SAVED_SORT_MODES = ['part_asc', 'batch_asc', 'status_asc', 'defect_desc'];

async function fetchWorkbenchData(projectId, signal) {
  const [batchData, partData, workspaceData, configData, metadataData, imagePageData] = await Promise.all([
    fetchProjectBatches(projectId, { signal, errorLabel: 'Failed to load batches' }),
    fetchProjectParts(projectId, { signal, errorLabel: 'Failed to load parts' }),
    fallbackOnHttpError(fetchProjectWorkspaceState(projectId, { signal }), { state: {} }),
    fallbackOnHttpError(fetchProjectConfiguration(projectId, { signal }), {}),
    fallbackOnHttpError(fetchProjectMetadataDictionary(projectId, { signal }), {}),
    fetchProjectImagePages(projectId, { includeDeleted: true, signal }),
  ]);
  return {
    batches: Array.isArray(batchData) ? batchData : [],
    config: configData?.config && typeof configData.config === 'object' ? configData.config : {},
    imageData: Array.isArray(imagePageData?.items) ? imagePageData.items : [],
    metadata: metadataData && typeof metadataData === 'object' ? metadataData : {},
    parts: Array.isArray(partData) ? partData : [],
    savedState: workspaceData?.state && typeof workspaceData.state === 'object' ? workspaceData.state : {},
  };
}

/**
 * Resolves the saved workspace selection against the loaded batches and parts.
 * `partId` is null when no part should be selected.
 */
export function resolveSavedWorkbenchSelection(savedState, batches, parts) {
  const savedPartId = String(savedState.selected_part_id || '');
  const selectedFromSaved = parts.find((part) => String(part.id) === savedPartId);
  const savedBatchId = String(savedState.selected_batch_id || '');
  const savedBatchExists = savedBatchId
    ? batches.some((batch) => String(batch.id) === savedBatchId)
    : true;
  const selectedPartStillInSavedBatch = selectedFromSaved && savedBatchId
    ? String(selectedFromSaved.batch_id || '') === savedBatchId
    : true;
  const savedReviewFilter = String(savedState.review_filter || 'all');
  const savedSortMode = String(savedState.sort_mode || 'part_asc');
  const showAllParts = savedPartId === ALL_PARTS_ID && parts.length > 0;
  let partId = null;
  if (showAllParts) partId = ALL_PARTS_ID;
  else if (selectedFromSaved) partId = selectedFromSaved.id;
  else if (parts.length > 0) partId = parts[0].id;
  return {
    batchId: savedBatchExists && selectedPartStillInSavedBatch ? savedBatchId : '',
    partFilter: String(savedState.part_filter || ''),
    partId,
    reviewFilter: SAVED_REVIEW_FILTERS.includes(savedReviewFilter) ? savedReviewFilter : 'all',
    showAllParts,
    sortMode: SAVED_SORT_MODES.includes(savedSortMode) ? savedSortMode : 'part_asc',
  };
}

function useWorkbenchLoadEffect({
  applyLoadedData, projectId, setError, setLoading, setWorkspaceStateLoaded,
}) {
  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const loadWorkbenchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchWorkbenchData(projectId, controller.signal);
        if (!active) return;
        applyLoadedData(data);
      } catch (err) {
        if (!active || err?.name === 'AbortError') return;
        setError(err.message || 'Failed to load inspection workbench data');
      } finally {
        if (active) {
          setWorkspaceStateLoaded(true);
          setLoading(false);
        }
      }
    };

    loadWorkbenchData();
    return () => {
      active = false;
      controller.abort();
    };
  }, [applyLoadedData, projectId, setError, setLoading, setWorkspaceStateLoaded]);
}

/**
 * Owns the inspection workbench data loaded per project (batches, parts, workspace state,
 * configuration, metadata, and project images) and restores the saved selection.
 */
export default function useInspectionPartLoading({ projectId, setActiveInspectionViewTab }) {
  const [batches, setBatches] = useState([]);
  const [parts, setParts] = useState([]);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [selectedPartId, setSelectedPartId] = useState('');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [partFilter, setPartFilter] = useState('');
  const [sortMode, setSortMode] = useState('part_asc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [workspaceStateLoaded, setWorkspaceStateLoaded] = useState(false);
  const [workspaceHydration, setWorkspaceHydration] = useState({});
  const [inspectorHotkeys, setInspectorHotkeys] = useState(DEFAULT_INSPECTOR_HOTKEYS);
  const [projectConfiguration, setProjectConfiguration] = useState(null);
  const [projectMetadata, setProjectMetadata] = useState({});
  const [inspectionColumnWidths, setInspectionColumnWidths] = useState(DEFAULT_INSPECTION_COLUMN_WIDTHS);
  const [panelLayout, setPanelLayout] = useState(DEFAULT_PANEL_LAYOUT);
  const [projectImageLookup, setProjectImageLookup] = useState({});

  const applyLoadedData = useCallback(({
    batches: loadedBatches, config, imageData, metadata, parts: loadedParts, savedState,
  }) => {
    setPanelLayout(normalizePanelLayout(savedState.panel_layout));
    setProjectConfiguration(config);
    setProjectMetadata(metadata);
    setInspectionColumnWidths(normalizeInspectionColumnWidths(config?.inspection_layout?.column_widths));
    setInspectorHotkeys(normalizeInspectorHotkeys(config?.process_settings?.configurable_hotkeys));
    setWorkspaceHydration(savedState);
    setBatches(loadedBatches);
    setParts(loadedParts);
    setProjectImageLookup(buildProjectImageLookup(imageData));
    const selection = resolveSavedWorkbenchSelection(savedState, loadedBatches, loadedParts);
    setSelectedBatchId(selection.batchId);
    setReviewFilter(selection.reviewFilter);
    setPartFilter(selection.partFilter);
    setSortMode(selection.sortMode);
    if (selection.showAllParts) setActiveInspectionViewTab(INSPECTION_VIEW_ALL_IMAGES_TAB);
    if (selection.partId !== null) setSelectedPartId(selection.partId);
  }, [setActiveInspectionViewTab]);

  useWorkbenchLoadEffect({
    applyLoadedData, projectId, setError, setLoading, setWorkspaceStateLoaded,
  });

  return {
    batches, error, inspectionColumnWidths, inspectorHotkeys, loading, panelLayout, partFilter,
    parts, projectConfiguration, projectImageLookup, projectMetadata, reviewFilter, selectedBatchId,
    selectedPartId, setError, setPartFilter, setParts, setProjectConfiguration, setProjectImageLookup,
    setProjectMetadata, setReviewFilter, setSelectedBatchId, setSelectedPartId, setSortMode, sortMode,
    workspaceHydration, workspaceStateLoaded,
  };
}
