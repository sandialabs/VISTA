import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Toast from '../../../components/Toast';
import { PROJECT_TYPE_OPTIONS } from '../../../projectTypes';
import useDashboardActions from '../useDashboardActions';
import useDashboardNavigator from '../useDashboardNavigator';
import useExpandedFolders from '../useExpandedFolders';
import CreateProjectModal from './CreateProjectModal';
import DashboardSettingsModal from './DashboardSettingsModal';
import DashboardTable, { buildRows, itemKey } from './DashboardTable';
import DeleteFolderModal from './DeleteFolderModal';
import DeleteProjectModal from './DeleteProjectModal';
import EditProjectModal from './EditProjectModal';
import FolderModal from './FolderModal';
import MoveDialog from './MoveDialog';
import UndoToast from './UndoToast';
import AccountMenu from './AccountMenu';

function PinnedRecentStrip({ title, projects, emptyText }) {
  // Always rendered at a fixed height so the page never jumps.
  return (
    <section className="dash-strip" aria-label={title}>
      <h3 className="dash-strip-title">{title}</h3>
      {projects.length === 0 ? (
        <p className="dash-strip-empty">{emptyText}</p>
      ) : (
        <ul className="dash-strip-list">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                to={`/project/${project.id}`}
                className={`dash-chip${project.effective_archived ? ' is-locked' : ''}`}
                title={(project.folder_path || []).map((p) => p.name).concat(project.name).join(' / ')}
              >
                {project.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Breadcrumb({ accessGroups, accessGroup, onSelectGroup, currentFolder, onOpen }) {
  const path = currentFolder?.path || [];
  const groups = accessGroups || [];
  return (
    <nav className="nav-breadcrumb dash-breadcrumb" aria-label="Breadcrumb">
      <ol className="breadcrumb">
        <li className="breadcrumb-item">
          <select
            aria-label="Access group"
            className="form-control access-group-select"
            value={accessGroup || ''}
            disabled={groups.length <= 1}
            title={groups.length <= 1 ? 'You belong to one access group' : 'Switch access group'}
            onChange={(event) => onSelectGroup(event.target.value)}
          >
            {groups.map((group) => (
              <option key={group} value={group}>{group}</option>
            ))}
          </select>
        </li>
        <li className="breadcrumb-separator" aria-hidden="true">/</li>
        <li className="breadcrumb-item">
          {path.length === 0 ? (
            <span aria-current="page">Top</span>
          ) : (
            <button type="button" className="breadcrumb-link" onClick={() => onOpen(null)}>Top</button>
          )}
        </li>
        {path.map((entry, index) => (
          <React.Fragment key={entry.id}>
            <li className="breadcrumb-separator" aria-hidden="true">/</li>
            <li className="breadcrumb-item">
              {index === path.length - 1 ? (
                <span aria-current="page">{entry.name}</span>
              ) : (
                <button type="button" className="breadcrumb-link" onClick={() => onOpen(entry.id)}>
                  {entry.name}
                </button>
              )}
            </li>
          </React.Fragment>
        ))}
      </ol>
    </nav>
  );
}

export default function DashboardHome({
  currentUser,
  userLoaded = true,
  currentUserGroups,
  dashboardDebugMode,
  handleDashboardDebugModeChange,
  hideToast,
  showArchived,
  setShowArchived,
  showDashboardSettings,
  setShowDashboardSettings,
  showToast,
  toast,
}) {
  const nav = useDashboardNavigator({
    currentUser, userLoaded, showArchived, showToast, debugMode: dashboardDebugMode,
  });
  const actions = useDashboardActions({
    accessGroup: nav.accessGroup,
    currentFolder: nav.currentFolder,
    refresh: nav.refresh,
    showToast,
    currentUser,
  });
  const [selected, setSelected] = useState(() => new Set());

  // Clear the selection whenever the visible location changes.
  const locationKey = [
    nav.accessGroup, nav.folderId, nav.query, showArchived,
    nav.filters.projectType, nav.filters.createdBy, nav.filters.archived,
    nav.viewPrefs.sort, nav.viewPrefs.order,
  ].join('|');
  const [lastLocation, setLastLocation] = useState(locationKey);
  if (lastLocation !== locationKey) {
    setLastLocation(locationKey);
    setSelected(new Set());
  }

  const { folders, projects } = nav.items;
  const searching = Boolean(nav.query);
  const tree = useExpandedFolders({
    accessGroup: nav.accessGroup,
    expandedIds: nav.viewPrefs.expanded,
    setExpanded: nav.toggleExpanded,
    baseParams: nav.childParams,
    refreshToken: nav.refreshToken,
    // Search shows a flat result list; open folders return when it clears.
    enabled: Boolean(nav.accessGroup) && !searching,
  });

  // Selected items in screen order. "Parent wins": an item inside a selected
  // folder moves/archives with that folder, so it is left out of the request.
  const { selectedItems, coveredCount } = useMemo(() => {
    const rows = buildRows({ folders, projects, tree: searching ? null : tree });
    const byKey = new Map(rows.filter((r) => r.type !== 'status').map((r) => [itemKey(r.type, r.id), r]));
    const isCovered = (row) => {
      let parent = row.parentKey;
      while (parent) {
        if (selected.has(parent)) return true;
        parent = byKey.get(parent)?.parentKey || null;
      }
      return false;
    };
    const out = [];
    let covered = 0;
    rows.forEach((row) => {
      if (row.type === 'status') return;
      if (!selected.has(itemKey(row.type, row.id))) return;
      if (isCovered(row)) {
        covered += 1;
        return;
      }
      out.push({ ...row.item, type: row.type });
    });
    return { selectedItems: out, coveredCount: covered };
  }, [selected, folders, projects, tree, searching]);

  const currentLocked = Boolean(nav.currentFolder?.effective_archived);
  const hasSelection = selectedItems.length > 0;
  const canArchiveSelection = selectedItems.some((i) => !i.is_archived);
  const canUnarchiveSelection = selectedItems.some((i) => i.is_archived);

  const folderActions = (folder) => {
    const locked = folder.effective_archived;
    const inheritedLock = locked && !folder.is_archived;
    return [
      { label: 'Open', onClick: () => nav.openFolder(folder.id) },
      {
        label: 'Rename / Edit',
        disabled: locked,
        title: locked ? 'Archived folders cannot be renamed. Unarchive first.' : '',
        onClick: () => actions.openEditFolder(folder),
      },
      {
        label: 'Move to...',
        disabled: locked,
        title: locked ? 'Archived folders cannot be moved.' : '',
        onClick: () => actions.openMove([{ ...folder, type: 'folder' }]),
      },
      {
        label: folder.is_archived ? 'Unarchive' : 'Archive',
        disabled: inheritedLock,
        title: inheritedLock ? 'Inside an archived folder. Unarchive the parent first.' : '',
        onClick: () => actions.setFolderArchived(folder, !folder.is_archived),
      },
      { label: 'Delete...', danger: true, onClick: () => actions.openDeleteFolder(folder) },
    ];
  };

  const projectActions = (project) => {
    const locked = project.effective_archived;
    const inheritedLock = locked && !project.is_archived;
    const canArchive = actions.canArchiveProject(project);
    const canDelete = currentUserGroups.includes(project.meta_group_id);
    return [
      {
        label: 'Edit',
        disabled: locked,
        title: locked ? 'Read-only while archived.' : '',
        onClick: () => actions.openEditProject(project),
      },
      {
        label: 'Move to...',
        disabled: locked,
        title: locked ? 'Archived projects cannot be moved.' : '',
        onClick: () => actions.openMove([{ ...project, type: 'project' }]),
      },
      {
        label: project.is_archived ? 'Unarchive' : 'Archive',
        disabled: !canArchive || inheritedLock,
        title: !canArchive
          ? 'Only the project creator can archive/unarchive.'
          : (inheritedLock ? 'Inside an archived folder. Unarchive the folder first.' : ''),
        onClick: () => actions.setProjectArchived(project, !project.is_archived),
      },
      {
        label: 'Delete',
        danger: true,
        disabled: !canDelete,
        title: canDelete ? '' : 'You do not have access to delete this project.',
        onClick: () => actions.openDeleteProject(project),
      },
    ];
  };

  const noGroups = Array.isArray(nav.accessGroups) && nav.accessGroups.length === 0;
  const loadingGroups = nav.accessGroups === null;
  const emptyLocation = nav.itemsReady && !nav.loadingItems && folders.length === 0 && projects.length === 0;
  const isRootEmpty = emptyLocation && !nav.folderId && !searching && nav.tree.folders.length === 0;

  const { dialog } = actions;

  return (
    <div className="App">
      <header className="dashboard-header">
        <h1 className="dashboard-header-title">VISTA an Image Management System</h1>
        <AccountMenu
          email={currentUser?.email}
          onOpenSettings={() => setShowDashboardSettings(true)}
        />
      </header>

      <div className="container dashboard-container">
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={hideToast}
            duration={toast.persist ? null : 5000}
          />
        )}
        {actions.undo && (
          <UndoToast message={actions.undo.message} onUndo={actions.undoMove} onDismiss={actions.dismissUndo} />
        )}

        {loadingGroups && (
          <div className="loading-container">
            <div className="spinner"></div>
            <div className="loading-text">Loading your projects...</div>
          </div>
        )}

        {noGroups && (
          <div className="card text-center">
            <div className="card-content">
              <h3>No access groups</h3>
              <p className="muted">You are not a member of any access group yet. Contact an administrator for access.</p>
            </div>
          </div>
        )}

        {nav.accessGroup && (
          <div className="dashboard-layout">
            <main className="dashboard-main">
              <Breadcrumb
                accessGroups={nav.accessGroups}
                accessGroup={nav.accessGroup}
                onSelectGroup={nav.selectAccessGroup}
                currentFolder={nav.currentFolder}
                onOpen={nav.openFolder}
              />

              <div className="dash-strips">
                <PinnedRecentStrip title="Pinned" projects={nav.pinnedProjects} emptyText="No pinned projects" />
                <PinnedRecentStrip title="Recent" projects={nav.recentProjects} emptyText="No recent projects" />
              </div>

              {currentLocked && (
                <div className="alert alert-warning" role="note">
                  This folder is archived{nav.currentFolder?.is_archived ? '' : ' (inside an archived folder)'}.
                  {' '}Everything inside is read-only.
                </div>
              )}

              <div className="dash-toolbar" role="toolbar" aria-label="Dashboard tools">
                <input
                  type="search"
                  className="form-control dash-search"
                  aria-label={nav.currentFolder ? `Search in ${nav.currentFolder.name}` : `Search in ${nav.accessGroup}`}
                  placeholder={nav.currentFolder ? `Search in ${nav.currentFolder.name}...` : `Search ${nav.accessGroup}...`}
                  value={nav.searchText}
                  maxLength={255}
                  onChange={(event) => nav.setSearchText(event.target.value)}
                />
                <select
                  aria-label="Filter by project type"
                  className="form-control dash-filter"
                  value={nav.filters.projectType}
                  onChange={(event) => nav.setFilters((f) => ({ ...f, projectType: event.target.value }))}
                >
                  <option value="">All types</option>
                  {PROJECT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.value}</option>
                  ))}
                </select>
                <select
                  aria-label="Filter by creator"
                  className="form-control dash-filter"
                  value={nav.filters.createdBy}
                  onChange={(event) => nav.setFilters((f) => ({ ...f, createdBy: event.target.value }))}
                >
                  <option value="">Anyone</option>
                  {currentUser?.email && <option value={currentUser.email}>Created by me</option>}
                </select>
                {showArchived && (
                  <select
                    aria-label="Filter by archive status"
                    className="form-control dash-filter"
                    value={nav.filters.archived}
                    onChange={(event) => nav.setFilters((f) => ({ ...f, archived: event.target.value }))}
                  >
                    <option value="any">Active and archived</option>
                    <option value="active">Active only</option>
                    <option value="archived">Archived only</option>
                  </select>
                )}
                <label className="archive-toggle-label">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                    className="archive-toggle-input"
                  />
                  <span className="archive-toggle-track">
                    <span className="archive-toggle-thumb"></span>
                  </span>
                  <span className="archive-toggle-text">Show archived</span>
                </label>
                <span className="dash-toolbar-spacer" />
                {/* Always rendered (disabled while searching) so the toolbar never reflows. */}
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => tree.expandAll(folders)}
                  disabled={searching || folders.length === 0}
                  title={searching ? 'Not available in search results' : 'Open folders up to 3 levels deep'}
                >
                  Expand all
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={tree.collapseAll}
                  disabled={searching || tree.expanded.size === 0}
                >
                  Collapse all
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={actions.openNewFolder}
                  disabled={currentLocked}
                  title={currentLocked ? 'This folder is archived and locked.' : ''}
                >
                  New Folder
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={actions.openNewProject}
                  disabled={currentLocked}
                  title={currentLocked ? 'This folder is archived and locked.' : ''}
                >
                  New Project
                </button>
              </div>

              <div className="dash-bulkbar" role="region" aria-label="Selection actions">
                <span className="dash-bulkbar-count" aria-live="polite">{selectedItems.length} selected</span>
                <button
                  type="button"
                  className="btn btn-small btn-secondary"
                  disabled={!hasSelection}
                  onClick={() => actions.openMove(selectedItems)}
                >
                  Move to...
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-secondary"
                  disabled={!canArchiveSelection}
                  onClick={async () => {
                    const r = await actions.bulkSetArchived(selectedItems.filter((i) => !i.is_archived), true);
                    if (r && !r.error) setSelected(new Set());
                  }}
                >
                  Archive
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-secondary"
                  disabled={!canUnarchiveSelection}
                  onClick={async () => {
                    const r = await actions.bulkSetArchived(selectedItems.filter((i) => i.is_archived), false);
                    if (r && !r.error) setSelected(new Set());
                  }}
                >
                  Unarchive
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-link"
                  disabled={!hasSelection}
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </button>
                <span className="dash-bulkbar-note">
                  {coveredCount === 1 && '1 item inside a selected folder is included with it.'}
                  {coveredCount > 1 && `${coveredCount} items inside selected folders are included with them.`}
                </span>
              </div>

              <div className="dash-summary" aria-live="polite">
                {searching
                  ? `Search results for "${nav.query}": ${folders.length} folder${folders.length === 1 ? '' : 's'}, ${nav.items.total_projects} project${nav.items.total_projects === 1 ? '' : 's'}`
                  : `${folders.length} folder${folders.length === 1 ? '' : 's'}, ${nav.items.total_projects} ${nav.items.total_projects === 1 ? 'project' : 'projects'} total`}
              </div>

              {!nav.itemsReady && !nav.itemsError && folders.length === 0 && projects.length === 0 && (
                <div className="loading-container">
                  <div className="spinner"></div>
                  <div className="loading-text">Loading your projects...</div>
                </div>
              )}

              {isRootEmpty && !nav.itemsError && (
                <div className="card text-center">
                  <div className="card-content">
                    <h3 style={{ marginBottom: 'var(--space-4)', color: 'var(--gray-600)' }}>No projects yet</h3>
                    <p style={{ color: 'var(--gray-500)', marginBottom: 'var(--space-6)' }}>
                      Get started by creating your first image management project
                    </p>
                    <button className="btn btn-primary btn-large" onClick={actions.openNewProject}>
                      Create Your First Project
                    </button>
                  </div>
                </div>
              )}

              {emptyLocation && !isRootEmpty && (
                <p className="dash-empty">
                  {searching ? 'No folders or projects match your search.' : 'This folder is empty.'}
                </p>
              )}

              {(folders.length > 0 || projects.length > 0) && (
                <DashboardTable
                  folders={folders}
                  projects={projects}
                  showPaths={searching}
                  sort={nav.viewPrefs.sort}
                  order={nav.viewPrefs.order}
                  onSort={nav.setSort}
                  selected={selected}
                  onSelectionChange={setSelected}
                  onOpenFolder={nav.openFolder}
                  folderActions={folderActions}
                  projectActions={projectActions}
                  pinnedIds={nav.pinnedIds}
                  onTogglePin={nav.togglePin}
                  tree={searching ? null : tree}
                />
              )}

              {nav.hasMore && (
                <div className="dash-load-more">
                  <button type="button" className="btn btn-secondary" onClick={nav.loadMore} disabled={nav.loadingMore}>
                    {nav.loadingMore ? 'Loading...' : `Load more (${projects.length} of ${nav.items.total_projects})`}
                  </button>
                </div>
              )}
            </main>
          </div>
        )}
      </div>

      {dialog?.kind === 'new-project' && (
        <CreateProjectModal
          onClose={actions.close}
          onSubmit={actions.submitNewProject}
          accessGroups={nav.accessGroups || []}
          accessGroup={nav.accessGroup}
          folder={nav.currentFolder}
        />
      )}
      {dialog?.kind === 'edit-project' && (
        <EditProjectModal
          project={dialog.project}
          onClose={actions.close}
          onSubmit={(values) => actions.submitEditProject(dialog.project, values)}
        />
      )}
      {dialog?.kind === 'delete-project' && (
        <DeleteProjectModal
          project={dialog.project}
          onClose={actions.close}
          onConfirm={actions.submitDeleteProject}
          canDelete={currentUserGroups.includes(dialog.project.meta_group_id)}
        />
      )}
      {dialog?.kind === 'new-folder' && (
        <FolderModal
          mode="create"
          parentName={(nav.currentFolder?.path || []).map((p) => p.name).join(' / ')}
          busy={actions.busy}
          onClose={actions.close}
          onSubmit={actions.submitNewFolder}
        />
      )}
      {dialog?.kind === 'edit-folder' && (
        <FolderModal
          mode="edit"
          folder={dialog.folder}
          busy={actions.busy}
          onClose={actions.close}
          onSubmit={(values) => actions.submitEditFolder(dialog.folder, values)}
        />
      )}
      {dialog?.kind === 'delete-folder' && (
        <DeleteFolderModal
          folder={dialog.folder}
          busy={actions.busy}
          onClose={actions.close}
          onConfirm={async (phrase) => {
            const result = await actions.submitDeleteFolder(dialog.folder, phrase);
            if (!result?.error && nav.folderId) {
              // The current folder may have been inside the deleted one.
              const deletedPath = new Set([dialog.folder.id]);
              if ((nav.currentFolder?.path || []).some((p) => deletedPath.has(p.id))) nav.openFolder(dialog.folder.parent_id || null);
            }
            return result;
          }}
        />
      )}
      {dialog?.kind === 'move' && (
        <MoveDialog
          items={dialog.items}
          folders={nav.tree.folders}
          accessGroup={nav.accessGroup}
          busy={actions.busy}
          onClose={actions.close}
          onSubmit={async (target) => {
            const result = await actions.submitMove(dialog.items, target);
            if (!result?.error) setSelected(new Set());
            return result;
          }}
        />
      )}
      {showDashboardSettings && (
        <DashboardSettingsModal
          onClose={() => setShowDashboardSettings(false)}
          showToast={showToast}
          onImportComplete={() => nav.reloadAll().catch(() => {})}
          onDatabaseAccepted={nav.reloadAll}
          debugMode={dashboardDebugMode}
          onDebugModeChange={handleDashboardDebugModeChange}
        />
      )}
    </div>
  );
}
