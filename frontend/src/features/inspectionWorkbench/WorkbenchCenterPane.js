import { MprViewport } from './MprViewport';
import { InspectionViewBoard } from './InspectionViewBoard';
import { InspectionViewBoardControls } from './InspectionViewBoardControls';

export function WorkbenchCenterPane({ tabKey, readOnly, mprViewportProps, selection, tileColumns, imageSort, tileView, handlers }) {
  const {
    isAllImagesSelection,
    selectedPart,
    selectedPartImageRefs,
  } = selection;
  return (
    <section
      className="workbench-tabbed-panel"
      data-layout-region="center"
    >
      <div className="workspace-panel-layout" data-testid={tabKey === 'mpr' ? 'mpr-center-panel' : 'selected-image-panel'}>
        {tabKey === 'mpr' ? (
          <MprViewport {...mprViewportProps} />
        ) : (
          !isAllImagesSelection && !selectedPart ? (
            <p className="muted">No part selected. Select a part to inspect mapped images.</p>
          ) : selectedPartImageRefs.length === 0 ? (
            <p className="muted">
              {isAllImagesSelection ? 'No mapped images for this selection.' : 'No mapped images for this part.'}
            </p>
          ) : (
            <>
            <InspectionViewBoardControls readOnly={readOnly} tileColumns={tileColumns} imageSort={imageSort} />
            <InspectionViewBoard
              tabKey={tabKey}
              readOnly={readOnly}
              selection={selection}
              tileColumns={tileColumns}
              tileView={tileView}
              handlers={handlers}
            />
            </>
          )
        )}
      </div>
    </section>
  );
}
