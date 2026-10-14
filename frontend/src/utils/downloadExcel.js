import { fetchProjectExcelExportResponse } from '../api/exports';

/**
 * Download an Excel export for a project.
 *
 * @param {string} projectId  - UUID of the project to export
 * @param {string} projectName - Display name used as the fallback filename
 * @returns {Promise<void>}
 */
export async function downloadExcel(projectId, projectName) {
  const response = await fetchProjectExcelExportResponse(projectId);
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.detail || `Export failed (${response.status})`);
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;

  // Extract filename from Content-Disposition header or use fallback
  const disposition = response.headers.get('Content-Disposition');
  let filename = `${projectName || 'project'}_export.xlsx`;
  if (disposition) {
    const match = disposition.match(/filename="?([^"]+)"?/);
    if (match) filename = match[1];
  }

  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
