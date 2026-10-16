import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildInspectionShareParams } from '../../components/InspectionWorkbenchPanel';
import { DEFAULT_INTERFACE_HIERARCHY } from '../../utils/interfaceHierarchy';
import { isUiSectionEnabled } from '../../utils/uiSections';
import { PROJECT_DATA_TABS } from './projectTabs';
import {
  buildInspectionShareSearch,
  buildProjectTabSearch,
  parseProjectTabQuery,
} from './projectTabRouting';
import useInterfaceHierarchy from './useInterfaceHierarchy';

function useVisibleTabs(interfaceHierarchy, projectConfiguration) {
  const visibleMainTabs = useMemo(() => (interfaceHierarchy.mainTabs || []).filter((tabKey) => (
    isUiSectionEnabled(projectConfiguration, `main.${tabKey}`)
  )), [interfaceHierarchy.mainTabs, projectConfiguration]);
  const visibleProjectDataTabs = useMemo(() => Object.entries(PROJECT_DATA_TABS).filter(([tabKey]) => (
    isUiSectionEnabled(projectConfiguration, `project_data.${tabKey}`)
  )), [projectConfiguration]);
  const visibleProjectDataTabKeys = useMemo(
    () => visibleProjectDataTabs.map(([tabKey]) => tabKey),
    [visibleProjectDataTabs],
  );
  return { visibleMainTabs, visibleProjectDataTabs, visibleProjectDataTabKeys };
}

// Keeps the active main tab, Project Data subtab, and Inspection launch
// filters in sync with the URL query, the interface hierarchy, and the
// configured UI sections.
function useQueryTabSync({
  activeMainTab,
  activeProjectDataTab,
  query,
  setActiveMainTab,
  setActiveProjectDataTab,
  setInspectionLaunchFilters,
  visibleTabs,
}) {
  const { validQueryMainTab, validQueryProjectDataTab, queryInspectionLaunchFilters } = query;
  const { visibleMainTabs, visibleProjectDataTabKeys } = visibleTabs;

  useEffect(() => {
    if (validQueryMainTab && visibleMainTabs.includes(validQueryMainTab)) {
      setActiveMainTab(validQueryMainTab);
      return;
    }
    if (!visibleMainTabs.includes(activeMainTab)) {
      setActiveMainTab(visibleMainTabs[0] || 'project_configuration');
    }
  }, [activeMainTab, setActiveMainTab, validQueryMainTab, visibleMainTabs]);

  useEffect(() => {
    if (validQueryProjectDataTab && visibleProjectDataTabKeys.includes(validQueryProjectDataTab)) {
      setActiveProjectDataTab(validQueryProjectDataTab);
      return;
    }
    if (!visibleProjectDataTabKeys.includes(activeProjectDataTab)) {
      setActiveProjectDataTab(visibleProjectDataTabKeys[0] || 'load_images');
    }
  }, [activeProjectDataTab, setActiveProjectDataTab, validQueryProjectDataTab, visibleProjectDataTabKeys]);

  useEffect(() => {
    if (validQueryMainTab === 'inspection') {
      setInspectionLaunchFilters(queryInspectionLaunchFilters);
    }
  }, [queryInspectionLaunchFilters, setInspectionLaunchFilters, validQueryMainTab]);
}

// Main tab changes wait for a pending Project Configuration autosave; the
// flush result is discarded if the project route changed meanwhile.
function useMainTabChange({
  activeMainTab,
  activeProjectDataTab,
  projectConfigurationPanelRef,
  routeOwnership,
  setActiveMainTab,
  updateProjectTabRoute,
}) {
  const { isCurrent, routeOwner } = routeOwnership;
  const [autosaveTabDelayMessage, setAutosaveTabDelayMessage] = useState('');

  useEffect(() => {
    setAutosaveTabDelayMessage('');
  }, [routeOwner]);

  const handleMainTabChange = useCallback(async (nextTabKey) => {
    const owner = routeOwner;
    if (!isCurrent(owner)) return;
    if (nextTabKey === activeMainTab) return;

    if (activeMainTab === 'project_configuration' && projectConfigurationPanelRef.current?.hasPendingAutosave()) {
      setAutosaveTabDelayMessage('Autosaving project configuration before changing tabs…');
      const saved = await projectConfigurationPanelRef.current.flushPendingAutosave('Configuration autosaved.');
      if (!isCurrent(owner)) return;
      setAutosaveTabDelayMessage('');
      if (!saved) return;
    }

    setActiveMainTab(nextTabKey);
    updateProjectTabRoute(nextTabKey, nextTabKey === 'project_data' ? activeProjectDataTab : null);
  }, [
    activeMainTab,
    activeProjectDataTab,
    isCurrent,
    projectConfigurationPanelRef,
    routeOwner,
    setActiveMainTab,
    updateProjectTabRoute,
  ]);

  return { autosaveTabDelayMessage, handleMainTabChange };
}

export default function useProjectTabNavigation({
  location,
  navigate,
  projectConfiguration,
  routeOwnership,
}) {
  const { isCurrent, routeOwner } = routeOwnership;
  const [activeMainTab, setActiveMainTab] = useState(DEFAULT_INTERFACE_HIERARCHY.mainTabs[0]);
  const [activeProjectDataTab, setActiveProjectDataTab] = useState('load_images');
  const [inspectionLaunchFilters, setInspectionLaunchFilters] = useState(null);
  const projectConfigurationPanelRef = useRef(null);
  const query = useMemo(() => parseProjectTabQuery(location.search), [location.search]);
  const interfaceHierarchy = useInterfaceHierarchy({
    setActiveMainTab,
    validQueryMainTab: query.validQueryMainTab,
  });
  const visibleTabs = useVisibleTabs(interfaceHierarchy, projectConfiguration);
  useQueryTabSync({
    activeMainTab,
    activeProjectDataTab,
    query,
    setActiveMainTab,
    setActiveProjectDataTab,
    setInspectionLaunchFilters,
    visibleTabs,
  });

  const updateProjectTabRoute = useCallback((nextMainTab, nextDataTab = null) => {
    const search = buildProjectTabSearch(location.search, nextMainTab, nextDataTab);
    navigate({ pathname: location.pathname, search }, { replace: false });
  }, [location.pathname, location.search, navigate]);

  const handleInspectionShareStateChange = useCallback((shareState, options = {}) => {
    if (!isCurrent(routeOwner)) return;
    const nextSearch = buildInspectionShareSearch(location.search, buildInspectionShareParams(shareState));
    if (nextSearch === null) return;
    navigate(
      { pathname: location.pathname, search: nextSearch },
      { replace: options.replace !== false },
    );
  }, [isCurrent, location.pathname, location.search, navigate, routeOwner]);

  const { autosaveTabDelayMessage, handleMainTabChange } = useMainTabChange({
    activeMainTab,
    activeProjectDataTab,
    projectConfigurationPanelRef,
    routeOwnership,
    setActiveMainTab,
    updateProjectTabRoute,
  });

  const handleProjectDataTabChange = useCallback((nextTabKey) => {
    setActiveMainTab('project_data');
    setActiveProjectDataTab(nextTabKey);
    updateProjectTabRoute('project_data', nextTabKey);
  }, [updateProjectTabRoute]);

  const handleInspectBatch = useCallback((batch) => {
    setInspectionLaunchFilters({
      selected_batch_id: batch.id,
      review_filter: 'manual',
      source: 'batches_tab_inspect',
      source_batch_name: batch.name,
      at: Date.now(),
    });
    setActiveMainTab('inspection');
  }, []);

  return {
    activeMainTab,
    activeProjectDataTab,
    autosaveTabDelayMessage,
    handleInspectBatch,
    handleInspectionShareStateChange,
    handleMainTabChange,
    handleProjectDataTabChange,
    inspectionLaunchFilters,
    interfaceHierarchy,
    projectConfigurationPanelRef,
    visibleMainTabs: visibleTabs.visibleMainTabs,
    visibleProjectDataTabs: visibleTabs.visibleProjectDataTabs,
  };
}
