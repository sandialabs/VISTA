/**
 * A project is read-only when it is archived itself or sits inside an archived
 * dashboard folder (`effective_archived` from the API). Older payloads without
 * `effective_archived` fall back to `is_archived`.
 */
export function isProjectReadOnly(project) {
  if (!project) return false;
  return project.effective_archived === true || project.is_archived === true;
}

export function projectLockMessage(project) {
  if (!project) return '';
  if (project.is_archived) return 'This project is archived and read-only.';
  if (project.effective_archived) {
    return 'This project is inside an archived folder and is read-only. Unarchive the folder to make changes.';
  }
  return '';
}
