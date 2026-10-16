import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchProjectsResponse } from '../../api/projects';
import { fetchCurrentUser, fetchCurrentUserGroups } from '../../api/users';

const DEFAULT_DASHBOARD_FETCH_TIMEOUT_MS = 10000;
const DASHBOARD_DEBUG_MODE_STORAGE_KEY = 'vista.dashboard.debugMode';

function isDashboardDebugModeStored() {
  if (typeof window === 'undefined') return false;
  return window.localStorage?.getItem(DASHBOARD_DEBUG_MODE_STORAGE_KEY) === 'true';
}

function setDashboardDebugModeStored(enabled) {
  if (typeof window === 'undefined') return;
  window.localStorage?.setItem(DASHBOARD_DEBUG_MODE_STORAGE_KEY, enabled ? 'true' : 'false');
}

async function buildDetailedErrorMessage(response, context = {}) {
  const { method = 'GET', url = '' } = context;
  const contentType = response.headers?.get?.('content-type') || '';
  const base = `${method} ${url || response.url || 'request'} failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  let payloadText = '';
  let detail = '';

  try {
    if (contentType.includes('application/json')) {
      const payload = await response.json();
      if (typeof payload?.detail === 'string') {
        detail = payload.detail;
      } else if (payload?.detail) {
        detail = JSON.stringify(payload.detail);
      } else if (payload?.message) {
        detail = String(payload.message);
      }
      payloadText = JSON.stringify(payload);
    } else {
      payloadText = await response.text();
      detail = payloadText;
    }
  } catch (error) {
    payloadText = `Unable to parse error response: ${error.message}`;
  }

  const parts = [detail || base];
  parts.push(`Debug details: ${base}`);
  if (payloadText) parts.push(`Response body: ${payloadText.slice(0, 2000)}`);
  return parts.join('\n');
}

export default function useDashboardData(showToast) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentUserGroups, setCurrentUserGroups] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [dashboardDebugMode, setDashboardDebugMode] = useState(() => isDashboardDebugModeStored());
  const projectsRef = useRef(projects);
  const currentUserGroupsRef = useRef(currentUserGroups);
  const dashboardDebugModeRef = useRef(isDashboardDebugModeStored());
  const showToastRef = useRef(showToast);

  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  const handleDashboardDebugModeChange = useCallback((enabled) => {
    setDashboardDebugMode(enabled);
    dashboardDebugModeRef.current = enabled;
    setDashboardDebugModeStored(enabled);
    showToastRef.current?.(`Dashboard debug mode ${enabled ? 'enabled' : 'disabled'}.`, 'info');
  }, []);

  const loadProjects = useCallback((includeArchived = showArchived, isCurrent = () => true) => {
    const url = includeArchived ? '/api/projects/?include_archived=true' : '/api/projects/';
    return fetchProjectsResponse({ includeArchived }, { timeoutMs: DEFAULT_DASHBOARD_FETCH_TIMEOUT_MS })
      .then(async response => {
        if (!response.ok) {
          if (isDashboardDebugModeStored()) {
            throw new Error(await buildDetailedErrorMessage(response, { method: 'GET', url }));
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        if (isCurrent() && JSON.stringify(projectsRef.current) !== JSON.stringify(data)) {
          projectsRef.current = data;
          setProjects(data);
        }
      });
  }, [showArchived]);

  useEffect(() => {
    let isCurrent = true;
    // Fetch the current user
    fetchCurrentUser()
      .then(userData => {
        if (isCurrent && userData) {
          setCurrentUser(userData);
          if (
            Array.isArray(userData.groups) &&
            JSON.stringify(currentUserGroupsRef.current) !== JSON.stringify(userData.groups)
          ) {
            currentUserGroupsRef.current = userData.groups;
            setCurrentUserGroups(userData.groups);
          }
        }
      })
      .catch(err => {
      });

    fetchCurrentUserGroups()
      .then(groupData => {
        if (
          isCurrent &&
          Array.isArray(groupData) &&
          JSON.stringify(currentUserGroupsRef.current) !== JSON.stringify(groupData)
        ) {
          currentUserGroupsRef.current = groupData;
          setCurrentUserGroups(groupData);
        }
      })
      .catch(err => {
      });

    // Fetch projects from the API
    loadProjects(showArchived, () => isCurrent)
      .then(() => {
        if (isCurrent) {
          setLoading(false);
        }
      })
      .catch(err => {
        if (isCurrent) {
          showToastRef.current?.(`Failed to fetch projects: ${err.message}`, 'error', { persist: dashboardDebugModeRef.current });
          setLoading(false);
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [loadProjects, showArchived]); // Refresh when archived toggle changes.

  return {
    projects,
    setProjects,
    loading,
    setLoading,
    currentUser,
    currentUserGroups,
    showArchived,
    setShowArchived,
    dashboardDebugMode,
    handleDashboardDebugModeChange,
    loadProjects,
  };
}
