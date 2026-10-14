import { DEFAULT_INTERFACE_HIERARCHY } from '../../utils/interfaceHierarchy';
import {
  ALLOWED_PROJECT_QUERY_TABS,
  MAIN_TAB_DEFINITIONS,
  PROJECT_DATA_TABS,
} from './projectTabs';

const INSPECTION_FILTER_PARAMS = Object.freeze({
  batch: 'selected_batch_id',
  part: 'selected_part_id',
  review: 'review_filter',
  image: 'selected_image_ref',
  metadataTab: 'active_metadata_tab',
  mprPane: 'active_mpr_pane',
});

const INSPECTION_SHARE_PARAM_KEYS = ['batch', 'part', 'image', 'review', 'metadataTab', 'mprPane', 'overlays'];

function parseInspectionLaunchFilters(params) {
  const filters = Object.entries(INSPECTION_FILTER_PARAMS).reduce((acc, [queryKey, filterKey]) => {
    const value = params.get(queryKey);
    if (value) acc[filterKey] = value;
    return acc;
  }, {});
  const overlayParam = params.get('overlays');
  if (overlayParam) {
    filters.active_overlay_ids = overlayParam.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return Object.keys(filters).length > 0 ? filters : null;
}

export function parseProjectTabQuery(search) {
  const params = new URLSearchParams(search);
  const queryMainTab = params.get('tab');
  const queryProjectDataTab = params.get('dataTab');
  const validQueryMainTab = ALLOWED_PROJECT_QUERY_TABS.has(queryMainTab) ? queryMainTab : null;
  const validQueryProjectDataTab = Object.prototype.hasOwnProperty.call(PROJECT_DATA_TABS, queryProjectDataTab)
    ? queryProjectDataTab
    : null;
  return {
    validQueryMainTab,
    validQueryProjectDataTab,
    queryInspectionLaunchFilters: validQueryMainTab === 'inspection'
      ? parseInspectionLaunchFilters(params)
      : null,
  };
}

export function normalizeInterfaceHierarchy(hierarchy) {
  const validTabs = (hierarchy?.mainTabs || []).filter((tabKey) => MAIN_TAB_DEFINITIONS[tabKey]);
  return validTabs.length === 0
    ? DEFAULT_INTERFACE_HIERARCHY
    : { ...hierarchy, mainTabs: validTabs };
}

export function selectMainTab(tabs, queryTab, previousTab) {
  if (queryTab && tabs.includes(queryTab)) return queryTab;
  return tabs.includes(previousTab) ? previousTab : tabs[0];
}

export function buildProjectTabSearch(search, nextMainTab, nextDataTab = null) {
  const params = new URLSearchParams(search);
  params.set('tab', nextMainTab);
  if (nextMainTab === 'project_data') {
    if (nextDataTab) params.set('dataTab', nextDataTab);
  } else {
    params.delete('dataTab');
  }
  return params.toString();
}

// Returns the next search string, or null when the share state is already in the URL.
export function buildInspectionShareSearch(search, shareParams) {
  const params = new URLSearchParams(search);
  params.set('tab', 'inspection');
  INSPECTION_SHARE_PARAM_KEYS.forEach((key) => params.delete(key));
  shareParams.forEach((value, key) => params.set(key, value));
  const nextSearch = params.toString();
  return nextSearch === new URLSearchParams(search).toString() ? null : nextSearch;
}
