import React, { useId } from 'react';

/**
 * Read-only display of the project's access group.
 *
 * Projects never move between access groups: the group is fixed when the
 * project is created, and the server refuses changes. To reorganize projects
 * inside an access group, use dashboard folders.
 */
export default function ProjectAccessGroupControl({ project }) {
  const idPrefix = useId();
  const accessGroup = typeof project?.meta_group_id === 'string' ? project.meta_group_id : '';
  const headingId = `${idPrefix}-project-access-group-heading`;
  const valueId = `${idPrefix}-project-access-group`;
  const noteId = `${idPrefix}-project-access-group-note`;

  return (
    <section className="part-detail-panel" aria-labelledby={headingId}>
      <h3 id={headingId}>Access Group</h3>
      <label htmlFor={valueId}>Access Group</label>
      <input
        id={valueId}
        className="form-control"
        type="text"
        value={accessGroup}
        readOnly
        aria-describedby={noteId}
      />
      <p id={noteId} className="muted">
        The access group is fixed when the project is created. Projects cannot move
        between access groups; use dashboard folders to organize projects within a group.
      </p>
    </section>
  );
}
