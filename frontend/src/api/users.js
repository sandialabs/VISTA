import { apiJson } from './client';

export function fetchCurrentUser(options = {}) {
  return apiJson('/api/users/me', options);
}

export async function fetchOptionalCurrentUser(options = {}) {
  try {
    return await apiJson('/api/users/me', {
      errorLabel: 'Failed to load current user',
      ...options,
    });
  } catch (error) {
    if (error?.status === 401) return null;
    throw error;
  }
}

export function fetchCurrentUserGroups(options = {}) {
  return apiJson('/api/users/me/groups', options);
}
