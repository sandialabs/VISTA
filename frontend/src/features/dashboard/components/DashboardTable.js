import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getProjectTypeLabel } from '../../../projectTypes';
import { formatDateTime } from '../dashboardUtils';
import { CHILD_PAGE_SIZE } from '../useExpandedFolders';

export const itemKey = (type, id) => `${type}:${id}`;

const SORTABLE = [
  { key: 'created', label: 'Created' },
  { key: 'last_activity', label: 'Last change' },
  { key: 'archived', label: 'Archived' },
];

function RowMenu({ label, actions }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const buttonRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const items = () => Array.from(ref.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') || []);
    items()[0]?.focus();
    const onDoc = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const list = items();
        if (!list.length) return;
        event.preventDefault();
        const at = list.indexOf(document.activeElement);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        list[(at + step + list.length) % list.length].focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="dash-row-menu" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className="dash-row-menu-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        …
      </button>
      {open && (
        <div className="dash-row-menu-dropdown" role="menu">
          {actions.filter(Boolean).map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              className={`dash-row-menu-item${action.danger ? ' is-danger' : ''}`}
              disabled={action.disabled}
              title={action.title || ''}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                buttonRef.current?.focus();
                action.onClick();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SortHeader({ field, label, sort, order, onSort }) {
  const active = sort === field;
  const ariaSort = active ? (order === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th scope="col" aria-sort={ariaSort} className="dash-col-date">
      <button type="button" className={`dash-sort-button${active ? ' is-active' : ''}`} onClick={() => onSort(field)}>
        {label}
        <span className="dash-sort-indicator" aria-hidden="true">
          {active ? (order === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}

function PathCell({ path }) {
  if (!path || path.length === 0) return <span className="dash-path">/</span>;
  return (
    <span className="dash-path" title={path.map((p) => p.name).join(' / ')}>
      {path.map((p) => p.name).join(' / ')}
    </span>
  );
}

/**
 * Flatten the visible tree into rows in screen order.
 *
 * Top-level folders and projects come from the listing; an open folder's
 * subfolders (then projects) follow it, one indent level deeper, plus a
 * status row (loading / error / empty / "show more") where needed.
 */
export function buildRows({ folders, projects, tree }) {
  const rows = [];
  const seen = new Set();
  const addFolder = (folder, depth, parentKey) => {
    if (seen.has(folder.id)) return; // Guard against cycles in stale data.
    seen.add(folder.id);
    const open = Boolean(tree?.expanded.has(folder.id));
    rows.push({ type: 'folder', id: folder.id, item: folder, depth, parentKey, open });
    if (!open) return;
    const key = itemKey('folder', folder.id);
    const entry = tree.entries[folder.id];
    if (!entry || entry.status === 'loading' || entry.status === 'idle') {
      rows.push({ type: 'status', status: 'loading', id: `loading-${folder.id}`, depth: depth + 1, folder });
      return;
    }
    if (entry.status === 'error') {
      rows.push({ type: 'status', status: 'error', id: `error-${folder.id}`, depth: depth + 1, folder, error: entry.error });
      return;
    }
    entry.folders.forEach((child) => addFolder(child, depth + 1, key));
    entry.projects.forEach((project) => {
      rows.push({ type: 'project', id: project.id, item: project, depth: depth + 1, parentKey: key });
    });
    if (entry.folders.length === 0 && entry.projects.length === 0) {
      rows.push({ type: 'status', status: 'empty', id: `empty-${folder.id}`, depth: depth + 1, folder });
    } else if (entry.projects.length < entry.total) {
      rows.push({
        type: 'status',
        status: entry.status === 'loading-more' ? 'loading-more' : 'more',
        id: `more-${folder.id}`,
        depth: depth + 1,
        folder,
        shown: entry.projects.length,
        total: entry.total,
      });
    }
  };
  folders.forEach((f) => addFolder(f, 0, null));
  projects.forEach((p) => rows.push({ type: 'project', id: p.id, item: p, depth: 0, parentKey: null }));
  return rows;
}

const INDENT_PX = 18;

/**
 * Compact tree table: folders (newest edit first), then projects. A folder's
 * arrow opens it in place; its name opens it as the current location.
 *
 * Selection: click a checkbox to toggle; Shift-click selects a range in
 * screen order; Ctrl/Cmd-click a row toggles it.
 */
export default function DashboardTable({
  folders,
  projects,
  showPaths,
  sort,
  order,
  onSort,
  selected,
  onSelectionChange,
  onOpenFolder,
  folderActions,
  projectActions,
  pinnedIds,
  onTogglePin,
  tree = null,
}) {
  const navigate = useNavigate();
  const rows = buildRows({ folders, projects, tree });
  const itemRows = rows.filter((r) => r.type !== 'status');
  const anchorRef = useRef(null);
  const allKeys = itemRows.map((r) => itemKey(r.type, r.id));
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));

  // The anchor is an item key, so ranges stay correct after paging/refresh.
  const toggle = (key, { range = false } = {}) => {
    const index = allKeys.indexOf(key);
    const next = new Set(selected);
    const anchorIndex = anchorRef.current ? allKeys.indexOf(anchorRef.current) : -1;
    if (range && anchorIndex >= 0 && index >= 0) {
      const [a, b] = [anchorIndex, index].sort((x, y) => x - y);
      for (let i = a; i <= b; i += 1) next.add(allKeys[i]);
    } else if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    anchorRef.current = key;
    onSelectionChange(next);
  };

  // Folder and project rows behave the same: a plain click anywhere on the
  // row opens the item; Shift/Ctrl/Cmd-click selects. Clicks on the row's own
  // controls (checkbox, arrow, pin, name link, menu) keep their behavior.
  const onRowClick = (event, row) => {
    if (event.target.closest('button, a, input, label')) return;
    const key = itemKey(row.type, row.id);
    if (event.shiftKey) {
      event.preventDefault();
      toggle(key, { range: true });
    } else if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      toggle(key);
    } else if (row.type === 'folder') {
      onOpenFolder(row.id);
    } else {
      navigate(`/project/${row.id}`);
    }
  };

  // Middle-click on a project row opens it in a new tab, like its name link.
  const onRowAuxClick = (event, row) => {
    if (event.button !== 1 || row.type !== 'project') return;
    if (event.target.closest('button, a, input, label')) return;
    event.preventDefault();
    window.open(`/project/${row.id}`, '_blank', 'noopener');
  };

  const colCount = 10 + (showPaths ? 1 : 0);
  const indent = (depth) => ({ paddingLeft: `${8 + depth * INDENT_PX}px` });

  const checkbox = (row, label) => {
    const key = itemKey(row.type, row.id);
    return (
      <input
        type="checkbox"
        aria-label={label}
        checked={selected.has(key)}
        onClick={(event) => {
          event.stopPropagation();
          toggle(key, { range: event.shiftKey });
        }}
        onChange={() => {}}
      />
    );
  };

  return (
    <div className="dash-table-wrap">
      <table className="dash-table" aria-label="Folders and projects">
        <thead>
          <tr>
            <th scope="col" className="dash-col-check">
              <input
                type="checkbox"
                aria-label="Select all"
                checked={allSelected}
                onChange={() => onSelectionChange(allSelected ? new Set() : new Set(allKeys))}
              />
            </th>
            <th scope="col" className="dash-col-name">Name</th>
            {showPaths && <th scope="col" className="dash-col-path">Location</th>}
            <th scope="col" className="dash-col-type">Type</th>
            <th scope="col" className="dash-col-num">Images</th>
            <th scope="col" className="dash-col-num">Parts</th>
            {SORTABLE.map((col) => (
              <SortHeader key={col.key} field={col.key} label={col.label} sort={sort} order={order} onSort={onSort} />
            ))}
            <th scope="col" className="dash-col-menu"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.type === 'status') {
              return (
                <tr key={row.id} className={`dash-row dash-row-status is-${row.status}`} data-testid={row.id}>
                  <td className="dash-col-check" />
                  <td className="dash-col-name dash-status-cell" colSpan={colCount - 1} style={indent(row.depth)}>
                    <span className="dash-toggle-spacer" aria-hidden="true" />
                    {row.status === 'loading' && <span className="muted">Loading...</span>}
                    {row.status === 'empty' && <span className="muted">Empty folder</span>}
                    {row.status === 'error' && (
                      <span role="alert" className="dash-status-error">
                        Could not load "{row.folder.name}": {row.error}{' '}
                        <button type="button" className="btn-link" onClick={() => tree.retry(row.folder.id)}>Retry</button>
                      </span>
                    )}
                    {(row.status === 'more' || row.status === 'loading-more') && (
                      <button
                        type="button"
                        className="btn-link dash-show-more"
                        disabled={row.status === 'loading-more'}
                        onClick={() => tree.showMore(row.folder.id)}
                      >
                        {row.status === 'loading-more'
                          ? 'Loading...'
                          : `Show ${Math.min(CHILD_PAGE_SIZE, row.total - row.shown)} more (of ${row.total})`}
                      </button>
                    )}
                  </td>
                </tr>
              );
            }
            const key = itemKey(row.type, row.id);
            const isSelected = selected.has(key);
            const { item } = row;
            const locked = Boolean(item.effective_archived);
            const nested = row.depth > 0;
            if (row.type === 'folder') {
              return (
                <tr
                  key={key}
                  className={`dash-row dash-row-folder${isSelected ? ' is-selected' : ''}${locked ? ' is-locked' : ''}${nested ? ' is-nested' : ''}`}
                  onClick={(event) => onRowClick(event, row)}
                  data-testid={`folder-row-${item.id}`}
                  aria-level={row.depth + 1}
                >
                  <td className="dash-col-check">{checkbox(row, `Select folder ${item.name}`)}</td>
                  <td className="dash-col-name" style={indent(row.depth)}>
                    {tree ? (
                      <button
                        type="button"
                        className="dash-toggle"
                        aria-expanded={row.open}
                        aria-label={`${row.open ? 'Collapse' : 'Expand'} ${item.name}`}
                        onClick={() => tree.toggle(item.id)}
                      >
                        <span className={`dash-chevron${row.open ? ' is-open' : ''}`} aria-hidden="true" />
                      </button>
                    ) : (
                      <span className="dash-toggle-spacer" aria-hidden="true" />
                    )}
                    <button type="button" className="dash-name-button" onClick={() => onOpenFolder(item.id)} title={item.description || item.name}>
                      <span className={`folder-icon${locked ? ' folder-icon-locked' : ''}`} aria-hidden="true" />
                      <span className="dash-name-text">{item.name}</span>
                    </button>
                    {item.is_archived && <span className="archived-badge">Archived</span>}
                    {!item.is_archived && locked && <span className="archived-badge is-inherited">Locked</span>}
                    <span className="dash-folder-counts">
                      {item.folder_count > 0 && `${item.folder_count} folder${item.folder_count === 1 ? '' : 's'} · `}
                      {item.total_project_count} project{item.total_project_count === 1 ? '' : 's'}
                    </span>
                  </td>
                  {showPaths && <td className="dash-col-path"><PathCell path={(item.path || []).slice(0, -1)} /></td>}
                  <td className="dash-col-type">Folder</td>
                  <td className="dash-col-num">—</td>
                  <td className="dash-col-num">—</td>
                  <td className="dash-col-date">{formatDateTime(item.created_at)}</td>
                  <td className="dash-col-date" title="Newest change to the folder or anything inside it">
                    {formatDateTime(item.last_edited_at)}
                  </td>
                  <td className="dash-col-date">{formatDateTime(item.archived_at)}</td>
                  <td className="dash-col-menu">
                    <RowMenu label={`Folder options for ${item.name}`} actions={folderActions(item)} />
                  </td>
                </tr>
              );
            }
            const pinned = pinnedIds.includes(String(item.id));
            return (
              <tr
                key={key}
                className={`dash-row dash-row-project${isSelected ? ' is-selected' : ''}${locked ? ' is-locked' : ''}${nested ? ' is-nested' : ''}`}
                onClick={(event) => onRowClick(event, row)}
                onAuxClick={(event) => onRowAuxClick(event, row)}
                data-testid={`project-row-${item.id}`}
                aria-level={row.depth + 1}
              >
                <td className="dash-col-check">{checkbox(row, `Select project ${item.name}`)}</td>
                <td className="dash-col-name" style={indent(row.depth)}>
                  {tree && <span className="dash-toggle-spacer" aria-hidden="true" />}
                  <button
                    type="button"
                    className={`dash-pin${pinned ? ' is-pinned' : ''}`}
                    aria-label={`${pinned ? 'Unpin' : 'Pin'} ${item.name}`}
                    aria-pressed={pinned}
                    onClick={() => onTogglePin(item.id)}
                    title={pinned ? 'Unpin' : 'Pin to top'}
                  >
                    {pinned ? '★' : '☆'}
                  </button>
                  <Link to={`/project/${item.id}`} className="dash-name-link" title={item.description || item.name}>
                    <span className="dash-name-text">{item.name}</span>
                  </Link>
                  {item.is_archived && <span className="archived-badge">Archived</span>}
                  {!item.is_archived && locked && <span className="archived-badge is-inherited">Locked</span>}
                </td>
                {showPaths && <td className="dash-col-path"><PathCell path={item.folder_path} /></td>}
                <td className="dash-col-type">{getProjectTypeLabel(item.project_type, { short: true })}</td>
                <td className="dash-col-num">{item.image_count ?? 0}</td>
                <td className="dash-col-num">{item.part_count ?? 0}</td>
                <td className="dash-col-date">{formatDateTime(item.created_at)}</td>
                <td className="dash-col-date">{formatDateTime(item.last_activity_at)}</td>
                <td className="dash-col-date">{formatDateTime(item.archived_at)}</td>
                <td className="dash-col-menu">
                  <RowMenu label={`Project options for ${item.name}`} actions={projectActions(item)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
