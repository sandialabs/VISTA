import { FilterImagesPane } from './FilterImagesPane';
import { PartSummaryPane } from './PartSummaryPane';
import { AnnotationsPane } from './AnnotationsPane';
import { WorkbenchCenterPane } from './WorkbenchCenterPane';
import { INSPECTION_FILTER_IMAGES_COLUMN } from './inspectionConstants';

// Creates the flexlayout-react factory that maps each inspection tab node to
// its pane: filter images, part summary (left), annotations (right), or a
// center tab.
export const createInspectionFlexLayoutFactory = ({
  annotationsPaneProps,
  centerPaneProps,
  inspectionHierarchy,
  partPaneProps,
}) => (node) => {
  const component = node.getComponent();
  if (component === INSPECTION_FILTER_IMAGES_COLUMN) return <FilterImagesPane {...partPaneProps} />;
  if (component === inspectionHierarchy.leftColumn) return <PartSummaryPane {...partPaneProps} />;
  if (component === inspectionHierarchy.rightColumn) return <AnnotationsPane {...annotationsPaneProps} />;
  if (inspectionHierarchy.centerTabs.includes(component)) return <WorkbenchCenterPane tabKey={component} {...centerPaneProps} />;
  return null;
};
