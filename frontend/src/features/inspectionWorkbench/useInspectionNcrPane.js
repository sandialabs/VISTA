import { useMemo, useState } from 'react';
import { isUiSectionEnabled } from '../../utils/uiSections';
import { getConfiguredNcrCodes } from '../projectConfiguration/ncrConfiguration';
import useInspectionNcrs from './useInspectionNcrs';

/**
 * Wires the Inspection "NCR" tab: visibility (ui_sections `inspection.ncrs`),
 * configured code lists, NCR state for the selected part, and the selected
 * right-column tab so rebuilt layout models keep the NCR tab open.
 */
export default function useInspectionNcrPane({
  projectId,
  projectConfiguration,
  selectedPart,
  readOnly,
}) {
  const [activeRightTab, setActiveRightTab] = useState(null);
  const showNcrTab = isUiSectionEnabled(projectConfiguration || {}, 'inspection.ncrs');
  const failureCodes = useMemo(
    () => getConfiguredNcrCodes(projectConfiguration, 'failure_codes'),
    [projectConfiguration],
  );
  const dispositionCodes = useMemo(
    () => getConfiguredNcrCodes(projectConfiguration, 'disposition_codes'),
    [projectConfiguration],
  );
  const ncrState = useInspectionNcrs({
    projectId,
    selectedPartId: showNcrTab ? selectedPart?.id || '' : '',
    readOnly,
  });

  return {
    showNcrTab,
    activeRightTab,
    setActiveRightTab,
    ncrPaneProps: showNcrTab
      ? { selectedPart, readOnly, failureCodes, dispositionCodes, ncrState }
      : null,
  };
}
