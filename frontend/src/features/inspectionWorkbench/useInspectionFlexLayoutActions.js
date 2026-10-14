import { useCallback } from 'react';
import { Actions } from 'flexlayout-react';
import {
  INSPECTION_FLEX_TABSET_IDS,
  INSPECTION_VIEW_ALL_IMAGES_TAB,
  RESIZE_HANDLE_WIDTH_PX,
} from './inspectionConstants';
import { ALL_PARTS_ID } from './useInspectionPartSelection';

/** Column widths implied by a flex layout model's tabset weights, or null. */
export const getFlexLayoutColumnWidths = (json, availableLayoutWidth) => {
  const children = json?.layout?.children || [];
  const left = children.find((child) => child.id === INSPECTION_FLEX_TABSET_IDS.left);
  const right = children.find((child) => child.id === INSPECTION_FLEX_TABSET_IDS.right);
  const totalWeight = children.reduce((sum, child) => sum + Number(child.weight || 0), 0);
  if (!left || !right || totalWeight <= 0) return null;
  const availableWidth = Math.max(0, availableLayoutWidth - (children.length - 1) * RESIZE_HANDLE_WIDTH_PX);
  return {
    leftPx: Math.round((Number(left.weight || 0) / totalWeight) * availableWidth),
    rightPx: Math.round((Number(right.weight || 0) / totalWeight) * availableWidth),
  };
};

/**
 * Flex layout tab selection, the layout action filter, and debounced column
 * width saves after weight adjustments.
 */
export function useInspectionFlexLayoutActions({
  inspectionHierarchy,
  setActiveInspectionViewTab,
  selectedPartId,
  setSelectedPartId,
  filteredParts,
  availableLayoutWidth,
  inspectionResizeSaveTimerRef,
  saveInspectionColumnWidths,
}) {
  const handleInspectionViewTabSelection = useCallback((tabId) => {
    const tabKey = String(tabId || '').replace(/^inspection-tab-/, '');
    if (!inspectionHierarchy.centerTabs.includes(tabKey)) return;
    setActiveInspectionViewTab(tabKey);
    if (tabKey === INSPECTION_VIEW_ALL_IMAGES_TAB) {
      setSelectedPartId(ALL_PARTS_ID);
    } else if (selectedPartId === ALL_PARTS_ID) {
      setSelectedPartId(filteredParts[0]?.id || '');
    }
  }, [filteredParts, inspectionHierarchy.centerTabs, selectedPartId, setActiveInspectionViewTab, setSelectedPartId]);

  const handleInspectionFlexLayoutAction = useCallback((action) => {
    if (action?.type === Actions.SELECT_TAB) {
      handleInspectionViewTabSelection(action.data?.tabNode);
    }
    return action;
  }, [handleInspectionViewTabSelection]);

  const handleInspectionFlexLayoutChange = (model, action) => {
    if (action?.type === Actions.SELECT_TAB) {
      handleInspectionViewTabSelection(action.data?.tabNode);
      return;
    }
    if (action?.type !== Actions.ADJUST_WEIGHTS || availableLayoutWidth <= 0) return;
    const nextWidths = getFlexLayoutColumnWidths(model.toJson(), availableLayoutWidth);
    if (!nextWidths) return;
    if (inspectionResizeSaveTimerRef.current) {
      window.clearTimeout(inspectionResizeSaveTimerRef.current);
    }
    inspectionResizeSaveTimerRef.current = window.setTimeout(() => {
      saveInspectionColumnWidths(nextWidths);
    }, 250);
  };

  return {
    handleInspectionFlexLayoutAction,
    handleInspectionFlexLayoutChange,
  };
}
