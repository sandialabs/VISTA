import React from 'react';

export default function ProjectOwnerUserSection({
  config,
  setConfig,
  showOwnerSection,
  showUserSection,
}) {
  return (
    <>
      {showOwnerSection && (
        <section className="part-detail-panel" aria-label="Project owner">
          <h3>Project Owner</h3>
          <div className="workbench-controls-row">
            <label htmlFor="project-owner-name">Owner Name</label>
            <input id="project-owner-name" className="form-control" value={config.project_owner?.name || ''} onChange={(event) => setConfig((previous) => ({ ...previous, project_owner: { ...(previous.project_owner || {}), name: event.target.value } }))} />
            <label htmlFor="project-owner-email">Owner Email</label>
            <input id="project-owner-email" className="form-control" value={config.project_owner?.email || ''} onChange={(event) => setConfig((previous) => ({ ...previous, project_owner: { ...(previous.project_owner || {}), email: event.target.value } }))} />
          </div>
        </section>
      )}

      {showUserSection && (
        <section className="part-detail-panel" aria-label="Current user">
          <h3>Current User</h3>
          <div className="workbench-controls-row">
            <label htmlFor="current-user-name">Active Username</label>
            <input id="current-user-name" className="form-control" value={config.current_user?.username || ''} onChange={(event) => setConfig((previous) => ({ ...previous, current_user: { ...(previous.current_user || {}), username: event.target.value, sso_authenticated: false } }))} />
            <p className="muted">
              Status: {config.current_user?.sso_authenticated ? 'Authenticated via SSO' : 'Manual (manual)'}
            </p>
          </div>
        </section>
      )}
    </>
  );
}
