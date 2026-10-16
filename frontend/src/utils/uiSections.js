export const UI_SECTION_GROUPS = [
  {
    id: 'main',
    label: 'Vista workspace',
    description: 'Show or hide top-level Vista workspace tabs in the order they appear across the project header.',
    sections: [],
    children: [
      {
        id: 'project_configuration',
        label: 'Project Configuration',
        primarySectionKey: 'main.project_configuration',
        description: 'Configure the project settings editor sections.',
        sections: [
          { key: 'project_configuration.general', label: 'General subtab' },
          { key: 'project_configuration.filename_convention', label: 'Filename Convention subtab' },
          { key: 'project_configuration.hotkeys', label: 'Hotkeys subtab' },
          { key: 'project_configuration.ui_configuration', label: 'UI Configuration subtab' },
          { key: 'project_configuration.owner_section', label: 'Project Owner section' },
          { key: 'project_configuration.user_section', label: 'Current User section' },
          { key: 'project_configuration.calibration', label: 'Project Calibration section' },
          { key: 'project_configuration.process_settings', label: 'Process Settings section' },
          { key: 'project_configuration.serial_scheme', label: 'Serial Number Scheme section' },
          { key: 'project_configuration.project_phase_settings', label: 'Project Phase Settings section' },
          { key: 'project_configuration.available_ui_sections', label: 'Available UI Sections section' },
          { key: 'project_configuration.defect_types', label: 'Defect Types section' },
          { key: 'project_configuration.view_options', label: 'Sides section' },
          { key: 'project_configuration.display_options', label: 'Display Settings section' },
          { key: 'project_configuration.copy_configuration', label: 'Copy Configuration section' },
        ],
      },
      {
        id: 'project_data',
        label: 'Project Data',
        primarySectionKey: 'main.project_data',
        description: 'Expose data-management subtabs and panels in the order they appear in Project Data.',
        sections: [
          { key: 'project_data.summary', label: 'Project Data Summary panel' },
          { key: 'project_data.load_images', label: 'Load Images subtab' },
          { key: 'project_data.images_to_parts', label: 'Images to Parts subtab' },
          { key: 'project_data.overlays', label: 'Overlays subtab' },
          { key: 'project_data.metadata', label: 'Metadata subtab' },
          { key: 'project_data.batches', label: 'Batches subtab' },
          { key: 'project_data.unload_parts', label: 'Unload Parts subtab' },
          { key: 'project_data.remove_images', label: 'Unload Images subtab' },
          { key: 'project_data.recently_deleted', label: 'Recently Deleted subtab' },
          { key: 'project_data.data_validation', label: 'Data Validation panel' },
        ],
      },
      {
        id: 'analyze',
        label: 'Analyze',
        primarySectionKey: 'main.analyze',
        description: 'Control the main Analyze workspace regions.',
        sections: [
          { key: 'analyze.toolbox', label: 'Analyze Toolbox panel' },
          { key: 'analyze.canvas', label: 'Analyze Canvas panel' },
          { key: 'analyze.inspector', label: 'Workflow Block Settings panel' },
        ],
      },
      {
        id: 'inspection',
        label: 'Inspection',
        primarySectionKey: 'main.inspection',
        description: 'Control the inspection workspace panes and tabs.',
        sections: [
          { key: 'inspection.part_summary', label: 'Part Summary pane' },
          { key: 'inspection.part_summary.views_row', label: 'Part Summary Views row' },
          { key: 'inspection.part_summary.modalities_row', label: 'Part Summary Modalities row' },
          { key: 'inspection.part_summary.layers_row', label: 'Part Summary Layers row' },
          { key: 'inspection.mpr', label: 'MPR tab' },
          { key: 'inspection.inspector', label: 'Inspection tab' },
          { key: 'inspection.image_metadata', label: 'Image Metadata tab' },
          { key: 'inspection.annotations', label: 'Annotations pane' },
          { key: 'inspection.visual_workspace', label: 'Visual Workspace pane' },
        ],
      },
      {
        id: 'report',
        label: 'Report',
        primarySectionKey: 'main.report',
        description: 'Control reporting workspace sections.',
        sections: [
          { key: 'report.project_report', label: 'Project Report tab' },
        ],
      },
    ],
  },
];

function flattenUiSections(groups = UI_SECTION_GROUPS) {
  return groups.flatMap((group) => [
    ...(group.primarySectionKey ? [{ key: group.primarySectionKey, label: `${group.label} tab` }] : []),
    ...(group.sections || []),
    ...flattenUiSections(group.children || []),
  ]);
}

export const UI_SECTION_DEFAULTS = flattenUiSections()
  .reduce((acc, section) => ({ ...acc, [section.key]: true }), {});

export function normalizeUiSections(config = {}) {
  const source = config?.ui_sections && typeof config.ui_sections === 'object' ? config.ui_sections : {};
  return Object.entries(UI_SECTION_DEFAULTS).reduce((acc, [key, defaultValue]) => {
    acc[key] = source[key] === undefined ? defaultValue : source[key] !== false;
    return acc;
  }, {});
}

export function isUiSectionEnabled(config = {}, key) {
  return normalizeUiSections(config)[key] !== false;
}
