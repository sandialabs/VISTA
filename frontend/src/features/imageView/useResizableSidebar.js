import { useCallback, useEffect, useState } from 'react';

export default function useResizableSidebar({
  initialWidth = 350,
  maxWidthRatio = 0.6,
  minWidth = 250,
} = {}) {
  const [sidebarWidth, setSidebarWidth] = useState(initialWidth);
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = useCallback(() => {
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback((event) => {
    if (!isResizing) return;

    const newWidth = event.clientX;
    const maxWidth = window.innerWidth * maxWidthRatio;

    if (newWidth >= minWidth && newWidth <= maxWidth) {
      setSidebarWidth(newWidth);
    }
  }, [isResizing, maxWidthRatio, minWidth]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (!isResizing) return undefined;

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [handleMouseMove, handleMouseUp, isResizing]);

  return {
    handleMouseDown,
    isResizing,
    sidebarWidth,
  };
}
