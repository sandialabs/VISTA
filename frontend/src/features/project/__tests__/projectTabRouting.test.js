import { DEFAULT_INTERFACE_HIERARCHY } from '../../../utils/interfaceHierarchy';
import {
  buildInspectionShareSearch,
  buildProjectTabSearch,
  normalizeInterfaceHierarchy,
  parseProjectTabQuery,
  selectMainTab,
} from '../projectTabRouting';

describe('parseProjectTabQuery', () => {
  test('accepts allowlisted tabs and rejects unknown ones', () => {
    expect(parseProjectTabQuery('?tab=project_data&dataTab=overlays')).toEqual({
      validQueryMainTab: 'project_data',
      validQueryProjectDataTab: 'overlays',
      queryInspectionLaunchFilters: null,
    });
    expect(parseProjectTabQuery('?tab=nope&dataTab=toString')).toEqual({
      validQueryMainTab: null,
      validQueryProjectDataTab: null,
      queryInspectionLaunchFilters: null,
    });
  });

  test('parses inspection launch filters only for the inspection tab', () => {
    expect(parseProjectTabQuery('?tab=inspection&batch=b1&review=pass&overlays=a,%20b,,').queryInspectionLaunchFilters)
      .toEqual({ selected_batch_id: 'b1', review_filter: 'pass', active_overlay_ids: ['a', 'b'] });
    expect(parseProjectTabQuery('?tab=inspection').queryInspectionLaunchFilters).toBeNull();
    expect(parseProjectTabQuery('?tab=analyze&batch=b1').queryInspectionLaunchFilters).toBeNull();
  });
});

describe('normalizeInterfaceHierarchy and selectMainTab', () => {
  test('drops unknown main tabs and falls back to the default hierarchy', () => {
    expect(normalizeInterfaceHierarchy({ mainTabs: ['bogus'] })).toBe(DEFAULT_INTERFACE_HIERARCHY);
    expect(normalizeInterfaceHierarchy({ mainTabs: ['bogus', 'analyze'], inspection: { a: 1 } }))
      .toEqual({ mainTabs: ['analyze'], inspection: { a: 1 } });
  });

  test('prefers a visible query tab, then the previous tab, then the first tab', () => {
    expect(selectMainTab(['a', 'b'], 'b', 'a')).toBe('b');
    expect(selectMainTab(['a', 'b'], 'c', 'b')).toBe('b');
    expect(selectMainTab(['a', 'b'], null, 'c')).toBe('a');
  });
});

describe('project tab search builders', () => {
  test('sets the data tab only for project data and preserves unrelated params', () => {
    expect(buildProjectTabSearch('?keep=1&dataTab=overlays', 'analyze')).toBe('keep=1&tab=analyze');
    expect(buildProjectTabSearch('?keep=1', 'project_data', 'metadata')).toBe('keep=1&tab=project_data&dataTab=metadata');
  });

  test('replaces inspection share params and reports unchanged state as null', () => {
    const share = new URLSearchParams({ part: 'p2' });
    expect(buildInspectionShareSearch('?tab=inspection&batch=b1&keep=1', share)).toBe('tab=inspection&keep=1&part=p2');
    expect(buildInspectionShareSearch('?tab=inspection&part=p2', share)).toBeNull();
  });
});
