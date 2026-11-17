import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import App from '../../../App';
import { createDashboardBackend } from '../__fixtures__/dashboardBackend';
import { lastAccessGroupKey } from '../dashboardPrefs';

jest.setTimeout(30000);

let currentLocation = null;
function LocationProbe() {
  currentLocation = useLocation();
  return null;
}

function renderDashboard(backend, initialEntry = '/') {
  global.fetch = backend.fetch;
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route path="/*" element={<App />} />
      </Routes>
    </MemoryRouter>,
  );
}

const table = () => screen.getByRole('table', { name: 'Folders and projects' });
const rowNames = () => within(table()).getAllByRole('row').slice(1).map((r) => (
  r.querySelector('.dash-name-text')?.textContent
));

beforeEach(() => {
  window.localStorage.clear();
  window.confirm = jest.fn(() => true);
});

function seed(overrides = {}) {
  return createDashboardBackend({
    email: 'tester@example.com',
    groups: ['group-a', 'group-b'],
    folders: [
      { id: 'f-line', meta_group_id: 'group-a', name: 'Line 1', last_activity_at: '2026-03-02T00:00:00Z' },
      { id: 'f-week', meta_group_id: 'group-a', name: 'Week 3', parent_id: 'f-line', last_activity_at: '2026-03-01T00:00:00Z' },
      { id: 'f-old', meta_group_id: 'group-a', name: 'Older', last_activity_at: '2026-01-05T00:00:00Z' },
      { id: 'f-b', meta_group_id: 'group-b', name: 'B Folder' },
    ],
    projects: [
      { id: 'p-root', meta_group_id: 'group-a', name: 'Root Project', created_at: '2026-01-02T00:00:00Z', last_activity_at: '2026-02-01T00:00:00Z' },
      { id: 'p-root2', meta_group_id: 'group-a', name: 'Another Root', created_at: '2026-01-03T00:00:00Z', last_activity_at: '2026-01-10T00:00:00Z' },
      { id: 'p-scan', meta_group_id: 'group-a', name: 'Blade Scan', folder_id: 'f-week', image_count: 4 },
      { id: 'p-b', meta_group_id: 'group-b', name: 'Group B Project' },
    ],
    ...overrides,
  });
}

test('lists access groups in a dropdown and remembers the selection across reloads', async () => {
  const backend = seed();
  const user = userEvent.setup();
  const { unmount } = renderDashboard(backend);

  const select = await screen.findByRole('combobox', { name: 'Access group' });
  await waitFor(() => expect(select).toHaveValue('group-a'));
  expect(within(select).getAllByRole('option').map((o) => o.value)).toEqual(['group-a', 'group-b']);
  expect(await screen.findByText('Root Project')).toBeInTheDocument();

  await user.selectOptions(select, 'group-b');
  expect(await screen.findByText('Group B Project')).toBeInTheDocument();
  expect(screen.queryByText('Root Project')).not.toBeInTheDocument();
  expect(JSON.parse(window.localStorage.getItem(lastAccessGroupKey('tester@example.com')))).toBe('group-b');

  unmount();
  renderDashboard(backend);
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Access group' })).toHaveValue('group-b'));
  expect(await screen.findByText('Group B Project')).toBeInTheDocument();
});

test('falls back to an allowed group when the remembered one is no longer accessible', async () => {
  window.localStorage.setItem(lastAccessGroupKey('tester@example.com'), JSON.stringify('revoked-group'));
  renderDashboard(seed());
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Access group' })).toHaveValue('group-a'));
});

test('ignores an inaccessible group in the URL', async () => {
  renderDashboard(seed(), '/?ag=not-mine&folder=f-b');
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Access group' })).toHaveValue('group-a'));
  await waitFor(() => expect(currentLocation.search).toBe('?ag=group-a'));
});

test('shows folders first (newest edit first), then projects, in a dense table with counts', async () => {
  renderDashboard(seed());
  await screen.findByText('Root Project');
  expect(rowNames()).toEqual(['Line 1', 'Older', 'Root Project', 'Another Root']);
  const lineRow = screen.getByTestId('folder-row-f-line');
  expect(within(lineRow).getByText(/1 folder · 1 project/)).toBeInTheDocument();
  // No sidebar / "All projects": the table is the only folder browser.
  expect(screen.queryByRole('tree')).not.toBeInTheDocument();
  expect(screen.queryByText('All projects')).not.toBeInTheDocument();
  expect(within(lineRow).getByRole('button', { name: 'Expand Line 1' })).toHaveAttribute('aria-expanded', 'false');
});

test('navigates into folders, updates breadcrumb and URL, and Back returns', async () => {
  const user = userEvent.setup();
  renderDashboard(seed());
  await screen.findByText('Root Project');

  await user.click(within(table()).getByRole('button', { name: 'Line 1' }));
  await waitFor(() => expect(rowNames()).toEqual(['Week 3']));
  expect(currentLocation.search).toContain('folder=f-line');
  await user.click(within(table()).getByRole('button', { name: 'Week 3' }));
  expect(await screen.findByText('Blade Scan')).toBeInTheDocument();

  const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
  expect(within(crumbs).getByText('Week 3')).toHaveAttribute('aria-current', 'page');
  await user.click(within(crumbs).getByRole('button', { name: 'Line 1' }));
  await waitFor(() => expect(rowNames()).toEqual(['Week 3']));
  await user.click(within(crumbs).getByRole('button', { name: 'Top' }));
  expect(await screen.findByText('Root Project')).toBeInTheDocument();
});

test('creates a folder (name required) and subfolder inside the current folder', async () => {
  const backend = seed();
  const user = userEvent.setup();
  renderDashboard(backend, '/?ag=group-a&folder=f-line');
  await screen.findByText('Week 3');

  await user.click(screen.getByRole('button', { name: 'New Folder' }));
  const dialog = screen.getByRole('dialog', { name: 'New Folder' });
  expect(within(dialog).getByText(/Location: Line 1/)).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Create Folder' }));
  expect(within(dialog).getByRole('alert')).toHaveTextContent('Folder name is required.');

  await user.type(within(dialog).getByLabelText('Folder Name *'), 'Week 4');
  await user.click(within(dialog).getByRole('button', { name: 'Create Folder' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New Folder' })).not.toBeInTheDocument());
  expect(await within(table()).findByText('Week 4')).toBeInTheDocument();
  const created = backend.callsTo('POST', '/api/folders').at(-1);
  expect(created.body).toEqual({ name: 'Week 4', description: null, meta_group_id: 'group-a', parent_id: 'f-line' });
});

test('duplicate folder names show the server error inline and keep the dialog open', async () => {
  const user = userEvent.setup();
  renderDashboard(seed());
  await screen.findByText('Root Project');
  await user.click(screen.getByRole('button', { name: 'New Folder' }));
  const dialog = screen.getByRole('dialog', { name: 'New Folder' });
  await user.type(within(dialog).getByLabelText('Folder Name *'), 'line 1');
  await user.click(within(dialog).getByRole('button', { name: 'Create Folder' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('A folder with this name already exists here.');
});

test('renames and edits a folder description', async () => {
  const backend = seed();
  const user = userEvent.setup();
  renderDashboard(backend);
  await screen.findByText('Root Project');
  await user.click(screen.getByRole('button', { name: 'Folder options for Older' }));
  await user.click(screen.getByRole('menuitem', { name: 'Rename / Edit' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit Folder' });
  const name = within(dialog).getByLabelText('Folder Name *');
  await user.clear(name);
  await user.type(name, 'Archive 2025');
  await user.type(within(dialog).getByLabelText('Description'), 'old runs');
  await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
  expect(await within(table()).findByText('Archive 2025')).toBeInTheDocument();
  expect(backend.state.folders.find((f) => f.id === 'f-old').description).toBe('old runs');
});

test('moves a project with the move dialog and undoes the move', async () => {
  const backend = seed();
  const user = userEvent.setup();
  renderDashboard(backend);
  await screen.findByText('Root Project');

  await user.click(screen.getByRole('button', { name: 'Project options for Root Project' }));
  await user.click(screen.getByRole('menuitem', { name: 'Move to...' }));
  const dialog = screen.getByRole('dialog', { name: 'Move "Root Project"' });
  expect(within(dialog).getByRole('radio', { name: /Top level/ })).toBeDisabled();
  await user.click(within(dialog).getByRole('radio', { name: 'Week 3' }));
  await user.click(within(dialog).getByRole('button', { name: 'Move' }));

  await waitFor(() => expect(backend.state.projects.find((p) => p.id === 'p-root').folder_id).toBe('f-week'));
  await waitFor(() => expect(screen.queryByText('Root Project')).not.toBeInTheDocument());
  const undo = await screen.findByRole('status');
  expect(undo).toHaveTextContent('Moved 1 item.');
  await user.click(within(undo).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(backend.state.projects.find((p) => p.id === 'p-root').folder_id).toBe(null));
  expect(await screen.findByText('Root Project')).toBeInTheDocument();
});

test('move dialog disables the folder itself and its descendants', async () => {
  const user = userEvent.setup();
  renderDashboard(seed());
  await screen.findByText('Root Project');
  await user.click(screen.getByRole('button', { name: 'Folder options for Line 1' }));
  await user.click(screen.getByRole('menuitem', { name: 'Move to...' }));
  const dialog = screen.getByRole('dialog', { name: 'Move "Line 1"' });
  expect(within(dialog).getByRole('radio', { name: /Line 1 \(being moved\)/ })).toBeDisabled();
  expect(within(dialog).getByRole('radio', { name: /Week 3 \(being moved\)/ })).toBeDisabled();
  expect(within(dialog).getByRole('radio', { name: 'Older' })).toBeEnabled();
  expect(within(dialog).queryByText('B Folder')).not.toBeInTheDocument();
});

test('multi-selects with shift-click and bulk-moves all-or-nothing, reporting failures', async () => {
  const backend = seed();
  backend.state.projects.find((p) => p.id === 'p-root2').is_archived = true;
  const user = userEvent.setup();
  renderDashboard(backend);
  await user.click(await screen.findByText('Show archived'));
  await screen.findByText('Another Root');

  await user.click(screen.getByRole('checkbox', { name: 'Select folder Older' }));
  await user.keyboard('{Shift>}');
  await user.click(screen.getByRole('checkbox', { name: 'Select project Another Root' }));
  await user.keyboard('{/Shift}');
  const bar = screen.getByRole('region', { name: 'Selection actions' });
  expect(bar).toHaveTextContent('3 selected');

  await user.click(within(bar).getByRole('button', { name: 'Move to...' }));
  const dialog = screen.getByRole('dialog', { name: 'Move 3 items' });
  await user.click(within(dialog).getByRole('radio', { name: 'Line 1' }));
  await user.click(within(dialog).getByRole('button', { name: 'Move' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(/"Another Root": .*archived.*Nothing was moved/);
  expect(backend.state.projects.find((p) => p.id === 'p-root').folder_id).toBe(null);
});

test('search spans subfolders, shows locations, and is kept in the URL', async () => {
  const user = userEvent.setup();
  renderDashboard(seed());
  await screen.findByText('Root Project');
  await user.type(screen.getByRole('searchbox', { name: 'Search in group-a' }), 'blade');
  expect(await screen.findByText('Blade Scan')).toBeInTheDocument();
  await waitFor(() => expect(currentLocation.search).toContain('q=blade'));
  const row = screen.getByTestId('project-row-p-scan');
  expect(within(row).getByText('Line 1 / Week 3')).toBeInTheDocument();
  expect(screen.getByText(/Search results for "blade"/)).toBeInTheDocument();
});

test('sorts projects by column headers ascending/descending and remembers it', async () => {
  const backend = seed();
  const user = userEvent.setup();
  const { unmount } = renderDashboard(backend);
  await screen.findByText('Root Project');
  expect(rowNames().slice(2)).toEqual(['Root Project', 'Another Root']);

  await user.click(screen.getByRole('button', { name: /Created/ }));
  await waitFor(() => expect(rowNames().slice(2)).toEqual(['Another Root', 'Root Project']));
  expect(screen.getByRole('columnheader', { name: /Created/ })).toHaveAttribute('aria-sort', 'descending');
  await user.click(screen.getByRole('button', { name: /Created/ }));
  await waitFor(() => expect(rowNames().slice(2)).toEqual(['Root Project', 'Another Root']));
  expect(screen.getByRole('columnheader', { name: /Created/ })).toHaveAttribute('aria-sort', 'ascending');

  unmount();
  renderDashboard(backend);
  await screen.findByText('Root Project');
  expect(screen.getByRole('columnheader', { name: /Created/ })).toHaveAttribute('aria-sort', 'ascending');
  expect(backend.callsTo('GET', '/api/dashboard/items').at(-1).search).toContain('sort=created&order=asc');
});

test('archiving a folder hides it, and Show archived reveals it as locked', async () => {
  const backend = seed();
  const user = userEvent.setup();
  renderDashboard(backend);
  await screen.findByText('Root Project');
  await user.click(screen.getByRole('button', { name: 'Folder options for Line 1' }));
  await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
  await waitFor(() => expect(within(table()).queryByText('Line 1')).not.toBeInTheDocument());

  await user.click(screen.getByText('Show archived'));
  const row = await screen.findByTestId('folder-row-f-line');
  expect(within(row).getByText('Archived')).toBeInTheDocument();
  await user.click(within(row).getByRole('button', { name: 'Line 1' }));
  expect(await screen.findByRole('note')).toHaveTextContent('This folder is archived');
  expect(screen.getByRole('button', { name: 'New Folder' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'New Project' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Folder options for Week 3' }));
  expect(screen.getByRole('menuitem', { name: 'Rename / Edit' })).toBeDisabled();
  expect(screen.getByRole('menuitem', { name: 'Move to...' })).toBeDisabled();
  // Week 3 is locked by its parent, not archived itself: its own toggle is
  // "Archive" and disabled until the parent is unarchived.
  expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeDisabled();
});

test('deleting a folder requires typing the confirmation phrase and reports counts', async () => {
  const backend = seed();
  const user = userEvent.setup();
  renderDashboard(backend);
  await screen.findByText('Root Project');
  await user.click(screen.getByRole('button', { name: 'Folder options for Line 1' }));
  await user.click(screen.getByRole('menuitem', { name: 'Delete...' }));
  const dialog = screen.getByRole('dialog', { name: 'Delete Folder' });
  const list = await within(dialog).findByRole('list', { name: 'Items that will be deleted' });
  expect(list).toHaveTextContent('2 folders');
  expect(list).toHaveTextContent('1 project');
  expect(list).toHaveTextContent('4 images');
  const confirm = within(dialog).getByRole('button', { name: 'Delete Folder' });
  expect(confirm).toBeDisabled();
  await user.type(within(dialog).getByLabelText(/Type .* to confirm/), 'delete line 1');
  expect(confirm).toBeDisabled();
  await user.clear(within(dialog).getByLabelText(/Type .* to confirm/));
  await user.type(within(dialog).getByLabelText(/Type .* to confirm/), 'DELETE Line 1');
  expect(confirm).toBeEnabled();
  await user.click(confirm);
  await waitFor(() => expect(backend.state.folders.find((f) => f.id === 'f-line')).toBeUndefined());
  expect(backend.state.projects.find((p) => p.id === 'p-scan')).toBeUndefined();
});

test('pins projects and shows recently opened projects for the group', async () => {
  window.localStorage.setItem('vista.dashboard.recents.tester@example.com.group-a', JSON.stringify(['p-scan', 'gone']));
  const user = userEvent.setup();
  renderDashboard(seed());
  await screen.findByText('Root Project');
  const recent = await screen.findByRole('region', { name: 'Recent' });
  expect(within(recent).getByText('Blade Scan')).toBeInTheDocument();
  await waitFor(() => expect(JSON.parse(window.localStorage.getItem('vista.dashboard.recents.tester@example.com.group-a'))).toEqual(['p-scan']));

  await user.click(screen.getByRole('button', { name: 'Pin Root Project' }));
  const pinned = await screen.findByRole('region', { name: 'Pinned' });
  expect(within(pinned).getByText('Root Project')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Unpin Root Project' })).toHaveAttribute('aria-pressed', 'true');
});

test('creates a project in the current folder with the access group from a dropdown', async () => {
  const backend = seed();
  const user = userEvent.setup();
  renderDashboard(backend, '/?ag=group-a&folder=f-week');
  await screen.findByText('Blade Scan');
  await user.click(screen.getByRole('button', { name: 'New Project' }));
  const dialog = screen.getByRole('dialog', { name: 'Create New Project' });
  expect(within(dialog).getByLabelText('Access Group *').tagName).toBe('SELECT');
  expect(within(dialog).getByLabelText('Access Group *')).toHaveValue('group-a');
  expect(within(dialog).getByTestId('create-project-folder')).toHaveTextContent('Line 1 / Week 3');
  await user.type(within(dialog).getByLabelText('Project Name *'), 'New Scan');
  await user.click(within(dialog).getByRole('button', { name: 'Create Project' }));
  expect(await screen.findByText('New Scan')).toBeInTheDocument();
  expect(backend.callsTo('POST', '/api/projects/').at(-1).body).toMatchObject({
    name: 'New Scan', meta_group_id: 'group-a', folder_id: 'f-week',
  });
});

test('pages large folders with Load more', async () => {
  const projects = Array.from({ length: 130 }, (_, i) => ({
    id: `bulk-${i}`,
    meta_group_id: 'group-a',
    name: `Bulk ${String(i).padStart(3, '0')}`,
    last_activity_at: `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
  }));
  const backend = createDashboardBackend({ groups: ['group-a'], projects });
  const user = userEvent.setup();
  renderDashboard(backend);
  await screen.findByText('Bulk 129');
  expect(rowNames()).toHaveLength(100);
  await user.click(screen.getByRole('button', { name: 'Load more (100 of 130)' }));
  await waitFor(() => expect(rowNames()).toHaveLength(130));
  expect(screen.queryByRole('button', { name: /Load more/ })).not.toBeInTheDocument();
});

test('shows a clear message when the user has no access groups', async () => {
  renderDashboard(createDashboardBackend({ groups: [] }));
  expect(await screen.findByText('No access groups')).toBeInTheDocument();
  // No group to create a project in: the toolbar (and New Project) is absent.
  expect(screen.queryByRole('button', { name: 'New Project' })).not.toBeInTheDocument();
});

test('a deleted folder in the URL falls back to the group root', async () => {
  renderDashboard(seed(), '/?ag=group-a&folder=missing-folder');
  expect(await screen.findByText('Root Project')).toBeInTheDocument();
  await waitFor(() => expect(currentLocation.search).not.toContain('folder='));
});

test('search input is length-limited and treats wildcard characters literally', async () => {
  const backend = seed();
  const user = userEvent.setup();
  renderDashboard(backend);
  await screen.findByText('Root Project');
  const box = screen.getByRole('searchbox', { name: 'Search in group-a' });
  expect(box).toHaveAttribute('maxLength', '255');
  await act(async () => {
    await user.type(box, '%_');
  });
  await waitFor(() => expect(screen.getByText(/No folders or projects match your search/)).toBeInTheDocument());
});

test('opening an archived folder directly (Show archived off) still shows the lock banner and disables actions', async () => {
  const backend = seed();
  backend.state.folders.find((f) => f.id === 'f-line').is_archived = true;
  renderDashboard(backend, '/?ag=group-a&folder=f-week');
  // Contents of a locked folder are hidden until "Show archived" is on.
  expect(await screen.findByText('This folder is empty.')).toBeInTheDocument();
  expect(screen.getByRole('note')).toHaveTextContent('inside an archived folder');
  expect(screen.getByRole('button', { name: 'New Folder' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'New Project' })).toBeDisabled();
  const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
  expect(within(crumbs).getByText('Week 3')).toHaveAttribute('aria-current', 'page');
});

test('search keeps a trailing space while typing', async () => {
  const user = userEvent.setup();
  renderDashboard(seed());
  await screen.findByText('Root Project');
  const box = screen.getByRole('searchbox', { name: 'Search in group-a' });
  await user.type(box, 'blade ');
  await waitFor(() => expect(currentLocation.search).toContain('q=blade'));
  await new Promise((r) => setTimeout(r, 400));
  expect(box).toHaveValue('blade ');
  await user.type(box, 'scan');
  expect(box).toHaveValue('blade scan');
});

test('undo of a bulk move restores items atomically per origin and reports partial failures', async () => {
  const backend = seed();
  const user = userEvent.setup();
  renderDashboard(backend);
  await screen.findByText('Root Project');
  await user.click(screen.getByRole('checkbox', { name: 'Select project Root Project' }));
  await user.click(screen.getByRole('checkbox', { name: 'Select project Another Root' }));
  await user.click(within(screen.getByRole('region', { name: 'Selection actions' })).getByRole('button', { name: 'Move to...' }));
  const dialog = screen.getByRole('dialog', { name: 'Move 2 items' });
  await user.click(within(dialog).getByRole('radio', { name: 'Older' }));
  await user.click(within(dialog).getByRole('button', { name: 'Move' }));
  const undo = await screen.findByText('Moved 2 items.');
  // Lock the destination before undoing so moving out fails.
  backend.state.folders.find((f) => f.id === 'f-old').is_archived = true;
  await user.click(within(undo.closest('.undo-toast')).getByRole('button', { name: 'Undo' }));
  expect(await screen.findByText(/Undo restored 0 of 2 item\(s\)/)).toBeInTheDocument();
  expect(backend.state.projects.filter((p) => p.folder_id === 'f-old')).toHaveLength(2);
});


describe('expanding folders in place', () => {
  const expandBtn = (name) => screen.getByRole('button', { name: `Expand ${name}` });
  const collapseBtn = (name) => screen.getByRole('button', { name: `Collapse ${name}` });

  test('arrow shows subfolders and their projects in place; name still opens the folder', async () => {
    const user = userEvent.setup();
    renderDashboard(seed());
    await screen.findByText('Root Project');

    await user.click(expandBtn('Line 1'));
    expect(await screen.findByTestId('folder-row-f-week')).toBeInTheDocument();
    expect(screen.getByTestId('folder-row-f-week')).toHaveAttribute('aria-level', '2');
    expect(currentLocation.search).not.toContain('folder=');
    expect(rowNames()).toEqual(['Line 1', 'Week 3', 'Older', 'Root Project', 'Another Root']);

    await user.click(expandBtn('Week 3'));
    const scan = await screen.findByTestId('project-row-p-scan');
    expect(scan).toHaveAttribute('aria-level', '3');
    expect(rowNames()).toEqual(['Line 1', 'Week 3', 'Blade Scan', 'Older', 'Root Project', 'Another Root']);

    await user.click(collapseBtn('Line 1'));
    await waitFor(() => expect(screen.queryByTestId('project-row-p-scan')).not.toBeInTheDocument());
    expect(screen.queryByTestId('folder-row-f-week')).not.toBeInTheDocument();

    await user.click(within(table()).getByRole('button', { name: 'Line 1' }));
    await waitFor(() => expect(currentLocation.search).toContain('folder=f-line'));
  });

  test('empty folders say so', async () => {
    const user = userEvent.setup();
    renderDashboard(seed());
    await screen.findByText('Root Project');
    await user.click(expandBtn('Older'));
    expect(await screen.findByText('Empty folder')).toBeInTheDocument();
  });

  test('large folders show 50 projects then "Show more"', async () => {
    const projects = Array.from({ length: 120 }, (_, i) => ({
      id: `big-${i}`, meta_group_id: 'group-a', name: `Big ${String(i).padStart(3, '0')}`, folder_id: 'f-big',
    }));
    const backend = createDashboardBackend({
      groups: ['group-a'],
      folders: [{ id: 'f-big', meta_group_id: 'group-a', name: 'Big Folder' }],
      projects,
    });
    const user = userEvent.setup();
    renderDashboard(backend);
    await screen.findByTestId('folder-row-f-big');
    await user.click(expandBtn('Big Folder'));
    await user.click(await screen.findByRole('button', { name: 'Show 50 more (of 120)' }));
    await user.click(await screen.findByRole('button', { name: 'Show 20 more (of 120)' }));
    await waitFor(() => expect(rowNames()).toHaveLength(121));
    expect(screen.queryByRole('button', { name: /Show \d+ more/ })).not.toBeInTheDocument();
  });

  test('open folders are remembered per access group across reloads', async () => {
    const backend = seed();
    const user = userEvent.setup();
    const { unmount } = renderDashboard(backend);
    await screen.findByText('Root Project');
    await user.click(expandBtn('Line 1'));
    await screen.findByTestId('folder-row-f-week');
    unmount();
    renderDashboard(backend);
    expect(await screen.findByTestId('folder-row-f-week')).toBeInTheDocument();
    expect(collapseBtn('Line 1')).toHaveAttribute('aria-expanded', 'true');
  });

  test('Expand all opens up to 3 levels; Collapse all closes everything', async () => {
    const backend = createDashboardBackend({
      groups: ['group-a'],
      folders: [
        { id: 'l1', meta_group_id: 'group-a', name: 'L1' },
        { id: 'l2', meta_group_id: 'group-a', name: 'L2', parent_id: 'l1' },
        { id: 'l3', meta_group_id: 'group-a', name: 'L3', parent_id: 'l2' },
        { id: 'l4', meta_group_id: 'group-a', name: 'L4', parent_id: 'l3' },
        { id: 'l5', meta_group_id: 'group-a', name: 'L5', parent_id: 'l4' },
      ],
      projects: [{ id: 'deep', meta_group_id: 'group-a', name: 'Deep project', folder_id: 'l5' }],
    });
    const user = userEvent.setup();
    renderDashboard(backend);
    await screen.findByTestId('folder-row-l1');
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(await screen.findByTestId('folder-row-l4')).toBeInTheDocument();
    // Levels 1-3 are open; level 4 is listed but closed.
    expect(collapseBtn('L3')).toBeInTheDocument();
    expect(expandBtn('L4')).toBeInTheDocument();
    expect(screen.queryByTestId('folder-row-l5')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    await waitFor(() => expect(screen.queryByTestId('folder-row-l2')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Collapse all' })).toBeDisabled();
  });

  test('selecting a folder and something inside it moves only the folder', async () => {
    const backend = seed();
    const user = userEvent.setup();
    renderDashboard(backend);
    await screen.findByText('Root Project');
    await user.click(expandBtn('Line 1'));
    await user.click(await screen.findByRole('button', { name: 'Expand Week 3' }));
    await screen.findByTestId('project-row-p-scan');
    await user.click(screen.getByRole('checkbox', { name: 'Select folder Line 1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select project Blade Scan' }));
    const bar = screen.getByRole('region', { name: 'Selection actions' });
    expect(bar).toHaveTextContent('1 selected');
    expect(bar).toHaveTextContent('1 item inside a selected folder is included with it.');
    await user.click(within(bar).getByRole('button', { name: 'Move to...' }));
    const dialog = screen.getByRole('dialog', { name: 'Move "Line 1"' });
    await user.click(within(dialog).getByRole('radio', { name: 'Older' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(backend.state.folders.find((f) => f.id === 'f-line').parent_id).toBe('f-old'));
    // The nested project kept its folder (it moved with Line 1).
    expect(backend.state.projects.find((p) => p.id === 'p-scan').folder_id).toBe('f-week');
  });

  test('nested rows can be selected alone and bulk-moved', async () => {
    const backend = seed();
    const user = userEvent.setup();
    renderDashboard(backend);
    await screen.findByText('Root Project');
    await user.click(expandBtn('Line 1'));
    await user.click(await screen.findByRole('button', { name: 'Expand Week 3' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Select project Blade Scan' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select project Root Project' }));
    await user.click(within(screen.getByRole('region', { name: 'Selection actions' })).getByRole('button', { name: 'Move to...' }));
    const dialog = screen.getByRole('dialog', { name: 'Move 2 items' });
    await user.click(within(dialog).getByRole('radio', { name: 'Older' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(backend.state.projects.find((p) => p.id === 'p-scan').folder_id).toBe('f-old'));
    // Open folders refresh after the move: Week 3 is now empty.
    expect(await screen.findByText('Empty folder')).toBeInTheDocument();
  });

  test('search shows flat results and clearing it restores open folders', async () => {
    const user = userEvent.setup();
    renderDashboard(seed());
    await screen.findByText('Root Project');
    await user.click(expandBtn('Line 1'));
    await screen.findByTestId('folder-row-f-week');
    const box = screen.getByRole('searchbox', { name: 'Search in group-a' });
    await user.type(box, 'blade');
    await screen.findByText('Blade Scan');
    expect(within(table()).queryByRole('button', { name: /^(Expand|Collapse) / })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Collapse all' })).toBeDisabled();
    await user.clear(box);
    expect(await screen.findByTestId('folder-row-f-week')).toBeInTheDocument();
    expect(collapseBtn('Line 1')).toBeInTheDocument();
  });

  test('type filter keeps folders and filters the projects inside them', async () => {
    const backend = seed();
    backend.state.projects.push({
      id: 'p-pt2', meta_group_id: 'group-a', name: 'PT2 inside', folder_id: 'f-week', project_type: 'PT2',
      description: '', is_archived: false, created_at: '2026-01-01T00:00:00Z', last_activity_at: '2026-01-01T00:00:00Z',
    });
    const user = userEvent.setup();
    renderDashboard(backend);
    await screen.findByText('Root Project');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by project type' }), 'PT2');
    await waitFor(() => expect(screen.queryByText('Root Project')).not.toBeInTheDocument());
    await user.click(expandBtn('Line 1'));
    await user.click(await screen.findByRole('button', { name: 'Expand Week 3' }));
    expect(await screen.findByText('PT2 inside')).toBeInTheDocument();
    expect(screen.queryByText('Blade Scan')).not.toBeInTheDocument();
  });

  test('a failed folder load shows Retry', async () => {
    const backend = seed();
    const original = backend.fetch.getMockImplementation();
    let fail = true;
    backend.fetch.mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (fail && url.includes('/api/dashboard/items') && url.includes('folder_id=f-line')) {
        return Promise.resolve({
          ok: false, status: 500, statusText: 'Error',
          headers: { get: () => 'application/json' },
          json: async () => ({ detail: 'boom' }),
          clone() { return this; },
          text: async () => '{"detail":"boom"}',
        });
      }
      return original(input, init);
    });
    const user = userEvent.setup();
    renderDashboard(backend);
    await screen.findByText('Root Project');
    await user.click(expandBtn('Line 1'));
    const alert = await screen.findByText(/Could not load "Line 1": boom/);
    fail = false;
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('folder-row-f-week')).toBeInTheDocument();
  });
});


describe('stable layout', () => {
  test('header holds only the title and the account menu with Settings and API Keys', async () => {
    const user = userEvent.setup();
    renderDashboard(seed());
    await screen.findByText('Root Project');
    const header = screen.getByRole('banner');
    expect(within(header).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(header).queryByRole('button', { name: 'New Project' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Welcome back/)).not.toBeInTheDocument();
    await user.click(within(header).getByRole('button', { name: 'Account menu' }));
    const menu = screen.getByRole('menu', { name: 'Account' });
    expect(menu).toHaveTextContent('Signed in as tester@example.com');
    expect(within(menu).getByRole('menuitem', { name: 'Open dashboard settings' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'API Keys' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Account' })).not.toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Account menu' })).toHaveFocus();
    await user.click(within(header).getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'API Keys' }));
    await waitFor(() => expect(currentLocation.pathname).toBe('/api-keys'));
  });

  test('access group dropdown is the first breadcrumb item and switches groups', async () => {
    const user = userEvent.setup();
    renderDashboard(seed(), '/?ag=group-a&folder=f-line');
    await screen.findByText('Week 3');
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const items = within(crumbs).getAllByRole('listitem');
    expect(within(items[0]).getByRole('combobox', { name: 'Access group' })).toHaveValue('group-a');
    expect(crumbs).toHaveTextContent(/Top.*Line 1/);
    await user.selectOptions(within(crumbs).getByRole('combobox', { name: 'Access group' }), 'group-b');
    expect(await screen.findByText('Group B Project')).toBeInTheDocument();
    expect(currentLocation.search).not.toContain('folder=');
  });

  test('access group dropdown is disabled with a single group', async () => {
    renderDashboard(createDashboardBackend({ groups: ['only'], projects: [{ id: 'x', meta_group_id: 'only', name: 'X' }] }));
    await screen.findByText('X');
    expect(screen.getByRole('combobox', { name: 'Access group' })).toBeDisabled();
  });

  test('New Project sits next to New Folder in the toolbar', async () => {
    renderDashboard(seed());
    await screen.findByText('Root Project');
    const toolbar = screen.getByRole('toolbar', { name: 'Dashboard tools' });
    const buttons = within(toolbar).getAllByRole('button').map((b) => b.textContent);
    expect(buttons.slice(-2)).toEqual(['New Folder', 'New Project']);
  });

  test('selection actions are always present and disabled until something is checked', async () => {
    const backend = seed();
    backend.state.projects.find((p) => p.id === 'p-root2').is_archived = true;
    const user = userEvent.setup();
    renderDashboard(backend);
    await screen.findByText('Root Project');
    const bar = screen.getByRole('region', { name: 'Selection actions' });
    const btn = (name) => within(bar).getByRole('button', { name });
    expect(bar).toHaveTextContent('0 selected');
    ['Move to...', 'Archive', 'Unarchive', 'Clear'].forEach((name) => expect(btn(name)).toBeDisabled());

    // The table does not move: the bar is the same element before and after.
    const tableEl = table();
    const before = tableEl.previousSibling;
    await user.click(screen.getByRole('checkbox', { name: 'Select project Root Project' }));
    expect(screen.getByRole('region', { name: 'Selection actions' })).toBe(bar);
    expect(table()).toBe(tableEl);
    expect(table().previousSibling).toBe(before);
    expect(bar).toHaveTextContent('1 selected');
    expect(btn('Move to...')).toBeEnabled();
    expect(btn('Archive')).toBeEnabled();
    expect(btn('Unarchive')).toBeDisabled();
    expect(btn('Clear')).toBeEnabled();

    await user.click(screen.getByText('Show archived'));
    await user.click(await screen.findByRole('checkbox', { name: 'Select project Another Root' }));
    expect(btn('Unarchive')).toBeEnabled();
    await user.click(btn('Clear'));
    expect(bar).toHaveTextContent('0 selected');
    expect(btn('Move to...')).toBeDisabled();
  });

  test('archive/unarchive in a mixed selection only send the items they change', async () => {
    const backend = seed();
    backend.state.projects.find((p) => p.id === 'p-root2').is_archived = true;
    const user = userEvent.setup();
    renderDashboard(backend);
    await user.click(await screen.findByText('Show archived'));
    await user.click(await screen.findByRole('checkbox', { name: 'Select project Root Project' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select project Another Root' }));
    await user.click(within(screen.getByRole('region', { name: 'Selection actions' })).getByRole('button', { name: 'Unarchive' }));
    await waitFor(() => expect(backend.state.projects.find((p) => p.id === 'p-root2').is_archived).toBe(false));
    const call = backend.callsTo('POST', '/api/dashboard/bulk/archive').at(-1);
    expect(call.body.items).toEqual([{ type: 'project', id: 'p-root2' }]);
  });

  test('Pinned and Recent stay visible inside folders and during search', async () => {
    window.localStorage.setItem('vista.dashboard.recents.tester@example.com.group-a', JSON.stringify(['p-scan']));
    const user = userEvent.setup();
    renderDashboard(seed(), '/?ag=group-a&folder=f-line');
    await screen.findByText('Week 3');
    const recent = await screen.findByRole('region', { name: 'Recent' });
    expect(await within(recent).findByText('Blade Scan')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Pinned' })).getByText('No pinned projects')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search in Line 1' }), 'week');
    await waitFor(() => expect(currentLocation.search).toContain('q=week'));
    expect(screen.getByRole('region', { name: 'Recent' })).toBe(recent);
    expect(within(recent).getByText('Blade Scan')).toBeInTheDocument();
  });

  test('empty Recent shows a placeholder instead of collapsing', async () => {
    renderDashboard(seed());
    await screen.findByText('Root Project');
    expect(within(screen.getByRole('region', { name: 'Recent' })).getByText('No recent projects')).toBeInTheDocument();
  });
});

describe('row click behaves the same for folders and projects', () => {
  test('clicking anywhere on a project row opens the project', async () => {
    const user = userEvent.setup();
    renderDashboard(seed());
    const row = await screen.findByTestId('project-row-p-root');
    // Click a non-interactive cell (the Type column).
    await user.click(within(row).getAllByRole('cell').find((c) => c.classList.contains('dash-col-type')));
    await waitFor(() => expect(currentLocation.pathname).toBe('/project/p-root'));
  });

  test('clicking anywhere on a folder row still opens the folder', async () => {
    const user = userEvent.setup();
    renderDashboard(seed());
    const row = await screen.findByTestId('folder-row-f-line');
    await user.click(within(row).getAllByRole('cell').find((c) => c.classList.contains('dash-col-type')));
    await waitFor(() => expect(currentLocation.search).toContain('folder=f-line'));
  });

  test('nested project rows open the project too', async () => {
    const user = userEvent.setup();
    renderDashboard(seed());
    await screen.findByText('Root Project');
    await user.click(screen.getByRole('button', { name: 'Expand Line 1' }));
    await user.click(await screen.findByRole('button', { name: 'Expand Week 3' }));
    const row = await screen.findByTestId('project-row-p-scan');
    await user.click(within(row).getAllByRole('cell').find((c) => c.classList.contains('dash-col-date')));
    await waitFor(() => expect(currentLocation.pathname).toBe('/project/p-scan'));
  });

  test('row controls keep their own behavior and do not open the project', async () => {
    const user = userEvent.setup();
    renderDashboard(seed());
    const row = await screen.findByTestId('project-row-p-root');
    await user.click(within(row).getByRole('checkbox', { name: 'Select project Root Project' }));
    await user.click(within(row).getByRole('button', { name: 'Pin Root Project' }));
    await user.click(within(row).getByRole('button', { name: 'Project options for Root Project' }));
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(currentLocation.pathname).toBe('/');
    expect(screen.getByRole('region', { name: 'Selection actions' })).toHaveTextContent('1 selected');
  });

  test('Ctrl-click and Shift-click on a project row select instead of opening', async () => {
    const user = userEvent.setup();
    renderDashboard(seed());
    const row = await screen.findByTestId('project-row-p-root');
    const cell = within(row).getAllByRole('cell').find((c) => c.classList.contains('dash-col-type'));
    await user.keyboard('{Control>}');
    await user.click(cell);
    await user.keyboard('{/Control}');
    expect(currentLocation.pathname).toBe('/');
    expect(screen.getByRole('region', { name: 'Selection actions' })).toHaveTextContent('1 selected');
  });
});
