const DEFAULT_INTERFACE_HIERARCHY = {
  mainTabs: ['project_configuration', 'project_data', 'analyze', 'inspection', 'report'],
  inspection: {
    leftColumn: 'part_summary',
    centerTabs: ['view_parts', 'image_metadata'],
    rightColumn: 'annotations',
    layout: {
      gridTemplateColumns: '320px minmax(560px, 1fr) 360px',
      gapPx: 12,
      minHeightPx: 640,
      collapseBreakpointPx: 900,
    },
    regions: {
      part_summary: {
        slot: 'left',
        label: 'Part Summary',
        order: 1,
        isOpen: true,
        widthPx: 320,
        minWidthPx: 280,
        maxWidthPx: 420,
        minHeightPx: 420,
      },
      inspector: {
        slot: 'center',
        label: 'Inspection',
        tabGroup: 'center',
        order: 1,
        isOpen: true,
        minWidthPx: 520,
        minHeightPx: 420,
      },
      view_all_images: {
        slot: 'center',
        label: 'View All Images',
        tabGroup: 'center',
        order: 1,
        isOpen: true,
        minWidthPx: 520,
        minHeightPx: 420,
      },
      view_parts: {
        slot: 'center',
        label: 'View Parts',
        tabGroup: 'center',
        order: 2,
        isOpen: true,
        minWidthPx: 520,
        minHeightPx: 420,
      },
      filter_images: {
        slot: 'left',
        label: 'Filter Images',
        order: 1,
        isOpen: true,
        widthPx: 320,
        minWidthPx: 280,
        maxWidthPx: 420,
        minHeightPx: 420,
      },
      mpr: {
        slot: 'center',
        label: 'MPR',
        tabGroup: 'center',
        order: 0,
        isOpen: true,
        minWidthPx: 560,
        minHeightPx: 420,
      },
      image_metadata: {
        slot: 'center',
        label: 'Image Metadata',
        tabGroup: 'center',
        order: 2,
        isOpen: true,
        minWidthPx: 520,
        minHeightPx: 420,
      },
      annotations: {
        slot: 'right',
        label: 'Annotations',
        order: 1,
        isOpen: true,
        widthPx: 360,
        minWidthPx: 280,
        maxWidthPx: 460,
        minHeightPx: 420,
      },
      visual_workspace: {
        slot: 'bottom',
        label: 'Visual Workspace',
        order: 1,
        isOpen: true,
        minHeightPx: 360,
      },
    },
  },
};

const INSPECTION_LAYOUT_KEY_MAP = {
  grid_template_columns: 'gridTemplateColumns',
  gap_px: 'gapPx',
  min_height_px: 'minHeightPx',
  collapse_breakpoint_px: 'collapseBreakpointPx',
};

const INSPECTION_REGION_KEY_MAP = {
  is_open: 'isOpen',
  width_px: 'widthPx',
  min_width_px: 'minWidthPx',
  max_width_px: 'maxWidthPx',
  height_px: 'heightPx',
  min_height_px: 'minHeightPx',
  max_height_px: 'maxHeightPx',
  tab_group: 'tabGroup',
};

function cloneDefaultHierarchy() {
  return {
    mainTabs: [...DEFAULT_INTERFACE_HIERARCHY.mainTabs],
    inspection: {
      ...DEFAULT_INTERFACE_HIERARCHY.inspection,
      centerTabs: [...DEFAULT_INTERFACE_HIERARCHY.inspection.centerTabs],
      layout: { ...DEFAULT_INTERFACE_HIERARCHY.inspection.layout },
      regions: Object.entries(DEFAULT_INTERFACE_HIERARCHY.inspection.regions).reduce((acc, [regionKey, region]) => {
        acc[regionKey] = { ...region };
        return acc;
      }, {}),
    },
  };
}

function stripInlineComment(rawValue) {
  let inString = false;
  let quote = '';
  for (let index = 0; index < rawValue.length; index += 1) {
    const char = rawValue[index];
    const previous = rawValue[index - 1];
    if ((char === '"' || char === "'") && previous !== '\\') {
      if (!inString) {
        inString = true;
        quote = char;
      } else if (quote === char) {
        inString = false;
        quote = '';
      }
    }
    if (char === '#' && !inString) {
      return rawValue.slice(0, index).trim();
    }
  }
  return rawValue.trim();
}

function unquoteString(rawValue) {
  const value = String(rawValue || '').trim();
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return value;
}

function parseStringArray(rawValue) {
  const match = stripInlineComment(rawValue).match(/^\[(.*)\]$/);
  if (!match) return [];
  const values = [];
  let current = '';
  let inString = false;
  let quote = '';
  match[1].split('').forEach((char, index, chars) => {
    const previous = chars[index - 1];
    if ((char === '"' || char === "'") && previous !== '\\') {
      if (!inString) {
        inString = true;
        quote = char;
      } else if (quote === char) {
        inString = false;
        quote = '';
      }
    }
    if (char === ',' && !inString) {
      values.push(current);
      current = '';
      return;
    }
    current += char;
  });
  values.push(current);
  return values
    .map((item) => unquoteString(item.trim()))
    .filter(Boolean);
}

function parseTomlValue(rawValue) {
  const value = stripInlineComment(rawValue);
  if (!value) return '';
  if (value.startsWith('[')) return parseStringArray(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return unquoteString(value);
}

function assignInspectionLayoutValue(parsed, key, value) {
  if (key === 'left_column') {
    parsed.inspection.leftColumn = String(value || '').trim() || parsed.inspection.leftColumn;
    return;
  }
  if (key === 'center_tabs') {
    if (Array.isArray(value) && value.length > 0) parsed.inspection.centerTabs = value.map(String);
    return;
  }
  if (key === 'right_column') {
    parsed.inspection.rightColumn = String(value || '').trim() || parsed.inspection.rightColumn;
    return;
  }

  const mappedKey = INSPECTION_LAYOUT_KEY_MAP[key] || key;
  parsed.inspection.layout[mappedKey] = value;
}

function assignInspectionRegionValue(parsed, regionKey, key, value) {
  if (!regionKey) return;
  const existingRegion = parsed.inspection.regions[regionKey] || {};
  const mappedKey = INSPECTION_REGION_KEY_MAP[key] || key;
  parsed.inspection.regions[regionKey] = {
    ...existingRegion,
    [mappedKey]: value,
  };
}

export function parseInterfaceHierarchyToml(tomlText) {
  if (typeof tomlText !== 'string' || !tomlText.trim()) {
    return DEFAULT_INTERFACE_HIERARCHY;
  }

  const parsed = cloneDefaultHierarchy();

  let currentSection = '';
  tomlText.split('\n').forEach((lineRaw) => {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#')) return;

    const sectionMatch = line.match(/^\[(.+)]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      return;
    }

    const keyValue = line.match(/^([a-zA-Z0-9_]+)\s*=\s*(.+)$/);
    if (!keyValue) return;

    const [, key, value] = keyValue;
    const parsedValue = parseTomlValue(value);
    if (currentSection === '' && key === 'main_tabs') {
      const parsedTabs = Array.isArray(parsedValue) ? parsedValue : parseStringArray(value);
      if (parsedTabs.length > 0) parsed.mainTabs = parsedTabs;
      return;
    }

    if (currentSection === 'inspection_layout') {
      assignInspectionLayoutValue(parsed, key, parsedValue);
      return;
    }

    const regionMatch = currentSection.match(/^inspection_layout\.regions\.([a-zA-Z0-9_-]+)$/);
    if (regionMatch) {
      assignInspectionRegionValue(parsed, regionMatch[1], key, parsedValue);
    }
  });

  return parsed;
}

export async function loadInterfaceHierarchy(options = {}) {
  try {
    const suffix = options.cacheBust ? `?v=${Date.now()}` : '';
    const response = await fetch(`/interface-hierarchy.toml${suffix}`, { cache: 'no-store' });
    if (!response.ok) {
      return DEFAULT_INTERFACE_HIERARCHY;
    }
    const tomlText = await response.text();
    return parseInterfaceHierarchyToml(tomlText);
  } catch (_error) {
    return DEFAULT_INTERFACE_HIERARCHY;
  }
}

export { DEFAULT_INTERFACE_HIERARCHY };
