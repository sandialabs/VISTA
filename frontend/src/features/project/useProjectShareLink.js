import { useCallback, useEffect, useState } from 'react';

import { copyCurrentShareUrl } from '../../utils/shareLink';

// Copies the current browser URL and reports the result for the project
// route that requested it.
export default function useProjectShareLink({ routeOwnership }) {
  const { isCurrent, routeOwner } = routeOwnership;
  const [shareLinkMessage, setShareLinkMessage] = useState(null);

  useEffect(() => {
    setShareLinkMessage(null);
  }, [routeOwner]);

  const handleCopySessionLink = useCallback(async () => {
    const owner = routeOwner;
    if (!isCurrent(owner)) return;
    try {
      await copyCurrentShareUrl();
      if (!isCurrent(owner)) return;
      setShareLinkMessage({ type: 'success', text: 'Session link copied to clipboard.' });
    } catch (err) {
      if (!isCurrent(owner)) return;
      setShareLinkMessage({
        type: 'error',
        text: err?.message || 'Unable to copy session link. Please copy the browser URL manually.',
      });
    }
  }, [isCurrent, routeOwner]);

  return { handleCopySessionLink, shareLinkMessage };
}
