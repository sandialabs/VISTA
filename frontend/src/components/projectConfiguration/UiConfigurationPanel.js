import React from 'react';
import { UI_SECTION_GROUPS } from '../../utils/uiSections';
import ConfigurableUiSectionGroup from './ConfigurableUiSectionGroup';
import {
  PT3_GUIDE_FIELDS,
  Pt3GuidePreview,
  Pt3GuideRangeControl,
} from './Pt3GuideControls';

export default function UiConfigurationPanel({
  projectTypeUiSections,
  isPt3Project,
  uiSearchQuery,
  setUiSearchQuery,
  uiSectionSearchResults,
  uiSearchIndex,
  setUiSearchIndex,
  config,
  setConfig,
  expandedUiGroups,
  toggleUiGroup,
  selectedUiSectionSearchResult,
  hiddenUiSectionKeys,
  pt3GuideSettings,
  pt3GuideSettingsAreDefault,
  resetPt3GuideSettings,
  updatePt3GuideSetting,
}) {
  return (
    <div
      id="configuration-ui-panel"
      className="configuration-sections-grid configuration-ui-panel"
      role="tabpanel"
      aria-label="UI Configuration"
    >
      {projectTypeUiSections['project_configuration.available_ui_sections'] !== false && (
        <section className="part-detail-panel configurable-ui-sections-panel" aria-label="Configurable UI sections">
          <div className="configurable-ui-sections-header">
            <div>
              <h3>Available UI Sections</h3>
              <p>Search, expand, and select the Vista interface elements that should be visible for this project.</p>
            </div>
          </div>
          <div className="configurable-ui-search-row">
            <input
              type="search"
              aria-label="Search UI configuration tree"
              placeholder="Search UI elements…"
              value={uiSearchQuery}
              onChange={(event) => setUiSearchQuery(event.target.value)}
            />
            <span className="configurable-ui-search-count" aria-live="polite">
              {uiSectionSearchResults.length > 0 ? `${uiSearchIndex + 1} of ${uiSectionSearchResults.length}` : 'No results'}
            </span>
            <button type="button" className="btn btn-secondary btn-sm" aria-label="Previous UI search result" disabled={uiSectionSearchResults.length === 0} onClick={() => setUiSearchIndex((previous) => (previous - 1 + uiSectionSearchResults.length) % uiSectionSearchResults.length)}>⌃</button>
            <button type="button" className="btn btn-secondary btn-sm" aria-label="Next UI search result" disabled={uiSectionSearchResults.length === 0} onClick={() => setUiSearchIndex((previous) => (previous + 1) % uiSectionSearchResults.length)}>⌄</button>
          </div>
          <div id="advanced-ui-section-controls" className="configurable-ui-section-groups">
            {UI_SECTION_GROUPS.map((group) => (
              <ConfigurableUiSectionGroup
                key={group.id}
                group={group}
                config={config}
                setConfig={setConfig}
                expandedGroups={expandedUiGroups}
                toggleGroup={toggleUiGroup}
                highlightedKey={selectedUiSectionSearchResult?.key || ''}
                hiddenSectionKeys={hiddenUiSectionKeys}
              />
            ))}
          </div>
        </section>
      )}
      {projectTypeUiSections['project_configuration.available_ui_sections'] === false && !isPt3Project && (
        <section className="part-detail-panel" aria-live="polite">
          <p className="muted">No UI Configuration sections are enabled.</p>
        </section>
      )}
      {isPt3Project && (
        <section
          className="part-detail-panel pt3-guide-configuration-card"
          aria-label="3D view guides"
          data-testid="pt3-guide-configuration-card"
        >
          <div className="pt3-guide-card-header">
            <div>
              <span className="pt3-guide-eyebrow">PT3 · 3D VIEW</span>
              <h3>3D View Guides</h3>
              <p>
                Tune the crosshair and slice-plane outlines used to locate X, Y, and Z positions in 3D.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              aria-label="Reset 3D view guides to defaults"
              disabled={pt3GuideSettingsAreDefault}
              onClick={resetPt3GuideSettings}
            >
              Reset
            </button>
          </div>
          <div className="pt3-guide-card-body">
            <div className="pt3-guide-controls" role="group" aria-label="3D view guide appearance">
              {Object.keys(PT3_GUIDE_FIELDS).map((field) => (
                <Pt3GuideRangeControl
                  key={field}
                  field={field}
                  value={pt3GuideSettings[field]}
                  onChange={updatePt3GuideSetting}
                />
              ))}
            </div>
            <Pt3GuidePreview settings={pt3GuideSettings} />
          </div>
        </section>
      )}
    </div>
  );
}
