import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCurrentUser, fetchCurrentUserGroups } from '../../api/users';

const DASHBOARD_DEBUG_MODE_STORAGE_KEY = 'vista.dashboard.debugMode';
const SHOW_ARCHIVED_STORAGE_KEY = 'vista.dashboard.showArchived';

function readStored(key) {
  try {
    return typeof window !== 'undefined' ? window.localStorage?.getItem(key) : null;
  } catch (_) {
    return null;
  }
}

function writeStored(key, value) {
  try {
    if (typeof window !== 'undefined') window.localStorage?.setItem(key, value);
  } catch (_) {
    // Best effort.
  }
}

export function isDashboardDebugModeStored() {
  return readStored(DASHBOARD_DEBUG_MODE_STORAGE_KEY) === 'true';
}

/** Current user, their access groups, and dashboard-wide toggles. */
export default function useDashboardData(showToast) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const [currentUserGroups, setCurrentUserGroups] = useState([]);
  const [showArchived, setShowArchivedState] = useState(() => readStored(SHOW_ARCHIVED_STORAGE_KEY) === 'true');
  const [dashboardDebugMode, setDashboardDebugMode] = useState(() => isDashboardDebugModeStored());
  const showToastRef = useRef(showToast);

  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  const setShowArchived = useCallback((value) => {
    setShowArchivedState(Boolean(value));
    writeStored(SHOW_ARCHIVED_STORAGE_KEY, value ? 'true' : 'false');
  }, []);

  const handleDashboardDebugModeChange = useCallback((enabled) => {
    setDashboardDebugMode(enabled);
    writeStored(DASHBOARD_DEBUG_MODE_STORAGE_KEY, enabled ? 'true' : 'false');
    showToastRef.current?.(`Dashboard debug mode ${enabled ? 'enabled' : 'disabled'}.`, 'info');
  }, []);

  useEffect(() => {
    let isCurrent = true;
    fetchCurrentUser()
      .then((userData) => {
        if (!isCurrent) return;
        if (userData) setCurrentUser(userData);
      })
      .catch(() => {})
      .finally(() => {
        if (isCurrent) setUserLoaded(true);
      });

    fetchCurrentUserGroups()
      .then((groupData) => {
        if (isCurrent && Array.isArray(groupData)) setCurrentUserGroups(groupData);
      })
      .catch(() => {});
    return () => {
      isCurrent = false;
    };
  }, []);

  return {
    currentUser,
    userLoaded,
    currentUserGroups,
    showArchived,
    setShowArchived,
    dashboardDebugMode,
    handleDashboardDebugModeChange,
  };
}
