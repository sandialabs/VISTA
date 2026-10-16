import { useEffect, useState } from 'react';

import { fetchOptionalCurrentUser } from '../../api/users';

function isAbortError(error) {
  return error?.name === 'AbortError';
}

export default function useOptionalCurrentUser() {
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetchOptionalCurrentUser({ signal: controller.signal })
      .then((userData) => {
        if (active && userData) {
          setCurrentUser(userData);
        }
      })
      .catch((error) => {
        if (!active || isAbortError(error)) return;
        console.error('Failed to fetch current user:', error);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return currentUser;
}
