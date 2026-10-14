import { useEffect, useState } from 'react';

export default function useInspectionViewTab({
  allImagesTab,
  centerTabs = [],
  defaultTab,
}) {
  const [activeInspectionViewTab, setActiveInspectionViewTab] = useState(defaultTab);

  useEffect(() => {
    if (!Array.isArray(centerTabs) || centerTabs.includes(activeInspectionViewTab)) return;
    setActiveInspectionViewTab(centerTabs[0] || allImagesTab);
  }, [activeInspectionViewTab, allImagesTab, centerTabs]);

  return {
    activeInspectionViewTab,
    setActiveInspectionViewTab,
  };
}
