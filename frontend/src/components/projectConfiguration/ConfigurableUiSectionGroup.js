import React, { useEffect, useRef } from 'react';
import { UI_SECTION_GROUPS, normalizeUiSections } from '../../utils/uiSections';

export function collectUiSectionMatches(groups = UI_SECTION_GROUPS, query = '', hiddenSectionKeys = new Set()) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];
  const matches = [];
  const visit = (group, path = []) => {
    const nextPath = [...path, group.id];
    const groupSectionKeys = collectUiSectionKeys(group, hiddenSectionKeys);
    if (groupSectionKeys.length === 0) return;
    if (group.label.toLowerCase().includes(normalizedQuery)) {
      matches.push({ type: 'group', key: group.id, label: group.label, path: nextPath });
    }
    (group.sections || [])
      .filter((section) => !hiddenSectionKeys.has(section.key))
      .forEach((section) => {
        if (section.label.toLowerCase().includes(normalizedQuery) || section.key.toLowerCase().includes(normalizedQuery)) {
          matches.push({ type: 'section', key: section.key, label: section.label, path: nextPath });
        }
      });
    (group.children || []).forEach((child) => visit(child, nextPath));
  };
  groups.forEach((group) => visit(group));
  return matches;
}

function collectUiSectionKeys(group, hiddenSectionKeys = new Set()) {
  return [
    ...(group.primarySectionKey && !hiddenSectionKeys.has(group.primarySectionKey) ? [group.primarySectionKey] : []),
    ...(group.sections || [])
      .map((section) => section.key)
      .filter((key) => !hiddenSectionKeys.has(key)),
    ...(group.children || []).flatMap((childGroup) => collectUiSectionKeys(childGroup, hiddenSectionKeys)),
  ];
}

export default function ConfigurableUiSectionGroup({ group, config, setConfig, expandedGroups, toggleGroup, highlightedKey, hiddenSectionKeys = new Set(), level = 0 }) {
  const isExpanded = expandedGroups.includes(group.id);
  const normalizedSections = normalizeUiSections(config);
  const visibleSections = (group.sections || []).filter((section) => !hiddenSectionKeys.has(section.key));
  const visibleChildren = (group.children || []).filter((childGroup) => collectUiSectionKeys(childGroup, hiddenSectionKeys).length > 0);
  const groupSectionKeys = collectUiSectionKeys(group, hiddenSectionKeys);
  const enabledSectionCount = groupSectionKeys.filter((key) => normalizedSections[key] !== false).length;
  const allGroupSectionsEnabled = groupSectionKeys.length === 0 || enabledSectionCount === groupSectionKeys.length;
  const someGroupSectionsEnabled = enabledSectionCount > 0 && enabledSectionCount < groupSectionKeys.length;
  const groupCheckboxRef = useRef(null);

  useEffect(() => {
    if (groupCheckboxRef.current) {
      groupCheckboxRef.current.indeterminate = someGroupSectionsEnabled;
    }
  }, [someGroupSectionsEnabled]);

  if (groupSectionKeys.length === 0) return null;

  const setGroupEnabled = (checked) => {
    setConfig((previous) => {
      const nextUiSections = { ...normalizeUiSections(previous) };
      groupSectionKeys.forEach((sectionKey) => {
        nextUiSections[sectionKey] = checked;
      });
      return {
        ...previous,
        ui_sections: nextUiSections,
      };
    });
  };

  return (
    <div className="configurable-ui-section-group" data-depth={level}>
      <div className={`configurable-ui-section-summary ${highlightedKey === group.id ? 'search-highlight' : ''}`}>
        <button
          type="button"
          className="configurable-ui-section-expander"
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${group.label}`}
          aria-expanded={isExpanded}
          onClick={() => toggleGroup(group.id)}
        >
          {isExpanded ? '-' : '+'}
        </button>
        <label className="configurable-ui-section-check-label">
          <input
            ref={groupCheckboxRef}
            type="checkbox"
            checked={allGroupSectionsEnabled}
            onChange={(event) => setGroupEnabled(event.target.checked)}
          />
          <span>{group.label}</span>
        </label>
        {visibleSections.length > 0 && (
          <span className="configurable-ui-section-count">{visibleSections.length} section{visibleSections.length === 1 ? '' : 's'}</span>
        )}
      </div>
      {isExpanded && (
        <div className="configurable-ui-section-body">
          {group.description && <p className="muted">{group.description}</p>}
          {visibleSections.length > 0 && (
            <div className="configurable-ui-section-options">
              {visibleSections.map((section) => (
                <label key={section.key} className={`configurable-ui-section-leaf ${highlightedKey === section.key ? 'search-highlight' : ''}`}>
                  <span className="configurable-ui-section-expander-spacer" aria-hidden="true" />
                  <input
                    type="checkbox"
                    checked={normalizedSections[section.key] !== false}
                    onChange={(event) => {
                      setConfig((previous) => ({
                        ...previous,
                        ui_sections: {
                          ...normalizeUiSections(previous),
                          [section.key]: event.target.checked,
                        },
                      }));
                    }}
                  />
                  <span>{section.label}</span>
                </label>
              ))}
            </div>
          )}
          {visibleChildren.length > 0 && (
            <div className="configurable-ui-section-children">
              {visibleChildren.map((childGroup) => (
                <ConfigurableUiSectionGroup
                  key={childGroup.id}
                  group={childGroup}
                  config={config}
                  setConfig={setConfig}
                  expandedGroups={expandedGroups}
                  toggleGroup={toggleGroup}
                  highlightedKey={highlightedKey}
                  hiddenSectionKeys={hiddenSectionKeys}
                  level={level + 1}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
