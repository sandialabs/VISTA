import { DEFAULT_INTERFACE_HIERARCHY, parseInterfaceHierarchyToml } from '../interfaceHierarchy';

describe('parseInterfaceHierarchyToml', () => {
  test('default main tabs include Analyze between Project Data and Inspection', () => {
    expect(DEFAULT_INTERFACE_HIERARCHY.mainTabs).toEqual([
      'project_configuration',
      'project_data',
      'analyze',
      'inspection',
      'report',
    ]);
  });

  test('parses detailed inspection placement and dimensions', () => {
    const parsed = parseInterfaceHierarchyToml(`
main_tabs = ["project_configuration", "inspection", "report"]

[inspection_layout]
left_column = "part_summary"
center_tabs = ["image_metadata", "inspector"]
right_column = "annotations"
grid_template_columns = "300px minmax(620px, 1fr) 380px"
gap_px = 18
min_height_px = 680
collapse_breakpoint_px = 840

[inspection_layout.regions.part_summary]
slot = "left"
label = "Configured Navigator"
order = 1
is_open = true
width_px = 300
min_width_px = 260
max_width_px = 360
min_height_px = 500

[inspection_layout.regions.image_metadata]
slot = "center"
label = "Configured Metadata"
tab_group = "center"
order = 1
is_open = true
min_width_px = 540

[inspection_layout.regions.inspector]
slot = "center"
label = "Configured Inspector"
tab_group = "center"
order = 2
is_open = true
min_width_px = 620

[inspection_layout.regions.annotations]
slot = "right"
label = "Configured Findings"
order = 1
width_px = 380
min_width_px = 300
max_width_px = 460
`);

    expect(parsed.mainTabs).toEqual(['project_configuration', 'inspection', 'report']);
    expect(parsed.inspection.centerTabs).toEqual(['image_metadata', 'inspector']);
    expect(parsed.inspection.layout).toEqual(expect.objectContaining({
      gridTemplateColumns: '300px minmax(620px, 1fr) 380px',
      gapPx: 18,
      minHeightPx: 680,
      collapseBreakpointPx: 840,
    }));
    expect(parsed.inspection.regions.part_summary).toEqual(expect.objectContaining({
      slot: 'left',
      label: 'Configured Navigator',
      widthPx: 300,
      minWidthPx: 260,
      maxWidthPx: 360,
      minHeightPx: 500,
      isOpen: true,
    }));
    expect(parsed.inspection.regions.image_metadata).toEqual(expect.objectContaining({
      label: 'Configured Metadata',
      tabGroup: 'center',
      order: 1,
    }));
    expect(parsed.inspection.regions.annotations).toEqual(expect.objectContaining({
      label: 'Configured Findings',
      widthPx: 380,
    }));
  });

  test('keeps the legacy three-key inspection layout contract working', () => {
    const parsed = parseInterfaceHierarchyToml(`
main_tabs = ["project_configuration", "project_data", "analyze", "inspection", "report"]

[inspection_layout]
left_column = "part_summary"
center_tabs = ["inspector", "image_metadata"]
right_column = "annotations"
`);

    expect(parsed.mainTabs).toEqual(['project_configuration', 'project_data', 'analyze', 'inspection', 'report']);
    expect(parsed.inspection.leftColumn).toBe('part_summary');
    expect(parsed.inspection.centerTabs).toEqual(['inspector', 'image_metadata']);
    expect(parsed.inspection.rightColumn).toBe('annotations');
    expect(parsed.inspection.layout).toEqual(DEFAULT_INTERFACE_HIERARCHY.inspection.layout);
    expect(parsed.inspection.regions.annotations.label).toBe('Annotations');
  });
});
