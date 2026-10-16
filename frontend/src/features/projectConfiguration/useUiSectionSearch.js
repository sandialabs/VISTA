import { useCallback, useEffect, useMemo, useState } from 'react';
import { UI_SECTION_GROUPS } from '../../utils/uiSections';
import { collectUiSectionMatches } from '../../components/projectConfiguration/ConfigurableUiSectionGroup';

// Owns the UI Configuration search/jump state (query, result index, and the
// accordion's expanded groups) together with the effects and handlers that
// keep them in sync: resetting the result index when the query changes,
// expanding the path to a selected search result, and toggling a group.
export function useUiSectionSearch(hiddenUiSectionKeys) {
  const [uiSearchQuery, setUiSearchQuery] = useState('');
  const [uiSearchIndex, setUiSearchIndex] = useState(0);
  const [expandedUiGroups, setExpandedUiGroups] = useState(['main']);

  const uiSectionSearchResults = useMemo(
    () => collectUiSectionMatches(UI_SECTION_GROUPS, uiSearchQuery, hiddenUiSectionKeys),
    [hiddenUiSectionKeys, uiSearchQuery],
  );
  const selectedUiSectionSearchResult = uiSectionSearchResults[uiSearchIndex] || null;

  useEffect(() => {
    setUiSearchIndex(0);
  }, [uiSearchQuery]);

  useEffect(() => {
    if (selectedUiSectionSearchResult) {
      setExpandedUiGroups(selectedUiSectionSearchResult.path);
    } else if (!uiSearchQuery.trim()) {
      setExpandedUiGroups((previous) => (previous.length > 0 ? previous : ['main']));
    }
  }, [selectedUiSectionSearchResult, uiSearchQuery]);

  const toggleUiGroup = useCallback((groupId) => {
    setExpandedUiGroups((previous) => (previous.includes(groupId)
      ? previous.filter((id) => id !== groupId)
      : [...previous, groupId]));
  }, []);

  return {
    uiSearchQuery,
    setUiSearchQuery,
    uiSearchIndex,
    setUiSearchIndex,
    expandedUiGroups,
    toggleUiGroup,
    uiSectionSearchResults,
    selectedUiSectionSearchResult,
  };
}
