import { useMemo } from 'react';
import { updateProjectConfiguration } from '../../api/projects';
import { createInspectionFlexLayoutModel, normalizeLayoutNumber } from './flexLayout';
import { INSPECTION_FILTER_IMAGES_COLUMN, INSPECTION_VIEW_PARTS_TAB } from './inspectionConstants';

/**
 * Inspection FlexLayout model, grid style, and column-width persistence derived from the hierarchy and viewport.
 */
export default function useInspectionLayoutModel({
  activeInspectionViewTab,
  inspectionColumnWidths,
  inspectionHierarchy,
  isAllImagesSelection,
  projectConfiguration,
  projectId,
  projectType,
  readOnly,
  setProjectConfiguration,
  viewportWidth,
  workbenchWidth,
}) {
  const isViewAllImagesTabActive = isAllImagesSelection;
  const leftRegion = inspectionHierarchy.regions[inspectionHierarchy.leftColumn];
  const filterImagesRegion = inspectionHierarchy.regions[INSPECTION_FILTER_IMAGES_COLUMN];
  const rightRegion = inspectionHierarchy.regions[inspectionHierarchy.rightColumn];
  const inspectorRegion = inspectionHierarchy.regions[activeInspectionViewTab]
    || inspectionHierarchy.regions[INSPECTION_VIEW_PARTS_TAB]
    || inspectionHierarchy.regions.inspector;
  const activeLeftComponent = isViewAllImagesTabActive
    ? INSPECTION_FILTER_IMAGES_COLUMN
    : inspectionHierarchy.leftColumn;
  const activeLeftRegion = isViewAllImagesTabActive ? filterImagesRegion : leftRegion;
  const activeLeftFallbackLabel = isViewAllImagesTabActive ? 'Filter Images' : 'Part Summary';
  const availableLayoutWidth = workbenchWidth > 0 ? workbenchWidth : viewportWidth;
  const inspectionLayoutCollapsed = projectType !== 'PT3'
    && availableLayoutWidth <= inspectionHierarchy.layout.collapseBreakpointPx;
  const minSideColumnWidthPx = Math.max(120, Math.round(availableLayoutWidth * 0.05));
  const defaultLeftColumnWidthPx = Math.max(220, Math.round(normalizeLayoutNumber(leftRegion?.widthPx ?? leftRegion?.minWidthPx, 220) * 0.5));
  const defaultRightColumnWidthPx = Math.max(220, Math.round(normalizeLayoutNumber(rightRegion?.widthPx ?? rightRegion?.minWidthPx, 220) * 0.5));
  const configuredLeftColumnWidthPx = inspectionColumnWidths.leftPx ?? defaultLeftColumnWidthPx;
  const configuredRightColumnWidthPx = inspectionColumnWidths.rightPx ?? defaultRightColumnWidthPx;
  const inspectionFlexLayoutModel = useMemo(() => createInspectionFlexLayoutModel({
    inspectionHierarchy: {
      ...inspectionHierarchy,
      regions: {
        ...inspectionHierarchy.regions,
        [inspectionHierarchy.leftColumn]: {
          ...leftRegion,
          widthPx: configuredLeftColumnWidthPx,
          minWidthPx: minSideColumnWidthPx,
        },
        [INSPECTION_FILTER_IMAGES_COLUMN]: {
          ...filterImagesRegion,
          widthPx: configuredLeftColumnWidthPx,
          minWidthPx: minSideColumnWidthPx,
        },
        [inspectionHierarchy.rightColumn]: {
          ...rightRegion,
          widthPx: configuredRightColumnWidthPx,
          minWidthPx: minSideColumnWidthPx,
        },
      },
    },
    leftComponent: activeLeftComponent,
    leftRegion: {
      ...activeLeftRegion,
      widthPx: configuredLeftColumnWidthPx,
      minWidthPx: minSideColumnWidthPx,
    },
    leftFallbackLabel: activeLeftFallbackLabel,
    inspectorRegion,
    rightRegion: {
      ...rightRegion,
      widthPx: configuredRightColumnWidthPx,
      minWidthPx: minSideColumnWidthPx,
    },
    inspectionLayoutCollapsed,
    centerSelectedIndex: Math.max(0, inspectionHierarchy.centerTabs.indexOf(activeInspectionViewTab)),
  }), [
    activeInspectionViewTab,
    activeLeftComponent,
    activeLeftFallbackLabel,
    activeLeftRegion,
    configuredLeftColumnWidthPx,
    configuredRightColumnWidthPx,
    filterImagesRegion,
    inspectionHierarchy,
    inspectionLayoutCollapsed,
    inspectorRegion,
    leftRegion,
    minSideColumnWidthPx,
    rightRegion,
  ]);
  const workbenchFlexLayoutStyle = {
    '--inspection-grid-template-columns': inspectionLayoutCollapsed
      ? '1fr'
      : `${configuredLeftColumnWidthPx}px minmax(0, 1fr) ${configuredRightColumnWidthPx}px`,
    '--inspection-layout-gap': `${inspectionHierarchy.layout.gapPx}px`,
    '--inspection-layout-min-height': inspectionLayoutCollapsed ? '520px' : `${inspectionHierarchy.layout.minHeightPx}px`,
  };

  async function saveInspectionColumnWidths(columnWidths) {
    if (readOnly) return;
    const nextConfig = {
      ...(projectConfiguration && typeof projectConfiguration === 'object' ? projectConfiguration : {}),
      inspection_layout: {
        ...((projectConfiguration && projectConfiguration.inspection_layout) || {}),
        column_widths: {
          left_px: Number.isFinite(columnWidths.leftPx) ? Math.round(columnWidths.leftPx) : null,
          right_px: Number.isFinite(columnWidths.rightPx) ? Math.round(columnWidths.rightPx) : null,
        },
      },
    };

    try {
      const payload = await updateProjectConfiguration(projectId, nextConfig, {
        readOnly,
        errorLabel: 'Failed to save inspection column widths',
      });
      const persistedConfig = payload?.config && typeof payload.config === 'object' ? payload.config : nextConfig;
      setProjectConfiguration(persistedConfig);
    } catch (_) {
      // Best-effort persistence: keep interactive resize fluid even if save fails.
    }
  }
  return {
    availableLayoutWidth,
    inspectionFlexLayoutModel,
    saveInspectionColumnWidths,
    workbenchFlexLayoutStyle,
  };
}
