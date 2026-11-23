/* global jest */
/**
 * In-memory fake of the dashboard API for Jest.
 *
 * Mirrors the backend contract closely enough to exercise the dashboard UI:
 * access groups, folders (tree, move, archive with inherited lock, delete),
 * projects (create/edit/archive/delete/move), listing/search/sort/paging, and
 * bulk actions. Unknown routes fall through to ``fallback``.
 */

let nextId = 1;
const newId = (prefix) => `${prefix}-${nextId++}`;

function jsonResponse(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 400 ? 'Error' : 'OK',
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    clone() { return this; },
    text: async () => JSON.stringify(body),
  });
}

const errorResponse = (status, detail) => jsonResponse({ detail }, status);

export function createDashboardBackend({
  email = 'tester@example.com',
  groups = ['group-a'],
  folders = [],
  projects = [],
  fallback = null,
} = {}) {
  const state = {
    email,
    groups: [...groups],
    folders: folders.map((f) => ({
      parent_id: null,
      description: null,
      is_archived: false,
      archived_at: null,
      created_at: '2026-01-01T00:00:00Z',
      last_activity_at: '2026-01-01T00:00:00Z',
      created_by: email,
      ...f,
    })),
    projects: projects.map((p) => ({
      description: '',
      project_type: 'PT1',
      folder_id: null,
      is_archived: false,
      archived_at: null,
      image_count: 0,
      part_count: 0,
      created_by: email,
      created_at: '2026-01-01T00:00:00Z',
      last_activity_at: '2026-01-01T00:00:00Z',
      ...p,
    })),
    calls: [],
  };

  const folder = (id) => state.folders.find((f) => f.id === id);
  const ancestors = (id) => {
    const out = [];
    let cur = id ? folder(id) : null;
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      out.push(cur);
      cur = cur.parent_id ? folder(cur.parent_id) : null;
    }
    return out;
  };
  const lockedBy = (folderId) => ancestors(folderId).find((f) => f.is_archived) || null;
  const descendants = (id) => {
    const out = new Set([id]);
    const stack = [id];
    while (stack.length) {
      const parent = stack.pop();
      state.folders.forEach((f) => {
        if (f.parent_id === parent && !out.has(f.id)) {
          out.add(f.id);
          stack.push(f.id);
        }
      });
    }
    return out;
  };
  const path = (id) => ancestors(id).reverse().map((f) => ({ id: f.id, name: f.name }));
  const folderLocked = (f) => Boolean(lockedBy(f.id));
  const projectLocked = (p) => p.is_archived || Boolean(lockedBy(p.folder_id));

  const decorateProject = (p) => ({
    ...p,
    folder_path: path(p.folder_id),
    effective_archived: projectLocked(p),
    locked_by_folder_id: lockedBy(p.folder_id)?.id || null,
  });

  const decorateFolder = (f, includeArchived) => {
    const sub = descendants(f.id);
    const visible = (p) => includeArchived || !projectLocked(p);
    const projectsBelow = state.projects.filter((p) => p.meta_group_id === f.meta_group_id && sub.has(p.folder_id));
    const parentLock = f.parent_id ? lockedBy(f.parent_id) : null;
    return {
      ...f,
      effective_archived: folderLocked(f),
      locked_by_folder_id: parentLock?.id || null,
      last_edited_at: [f.last_activity_at, ...projectsBelow.map((p) => p.last_activity_at)].sort().pop(),
      project_count: state.projects.filter((p) => p.folder_id === f.id && visible(p)).length,
      total_project_count: projectsBelow.filter(visible).length,
      folder_count: state.folders.filter((c) => c.parent_id === f.id && (includeArchived || !folderLocked(c))).length,
      path: path(f.id),
    };
  };

  const sortFolders = (list) => [...list].sort((a, b) => (
    (b.last_edited_at || '').localeCompare(a.last_edited_at || '') || a.name.localeCompare(b.name)
  ));

  const assertGroup = (g) => state.groups.includes(g);

  function listItems(params) {
    const group = params.get('meta_group_id');
    if (!assertGroup(group)) return errorResponse(403, `User '${email}' does not have access to group '${group}'.`);
    const folderId = params.get('folder_id') || null;
    if (folderId && !folder(folderId)) return errorResponse(404, 'Folder not found');
    const q = (params.get('q') || '').trim().toLowerCase();
    const includeArchived = params.get('include_archived') === 'true';
    const ids = params.getAll('ids');
    const sort = params.get('sort') || 'last_activity';
    const order = params.get('order') || 'desc';
    const offset = Number(params.get('offset') || 0);
    const limit = Number(params.get('limit') || 100);
    const projectType = (params.get('project_type') || '').toUpperCase();
    const createdBy = (params.get('created_by') || '').toLowerCase();
    const recursive = Boolean(q) || params.get('recursive') === 'true';
    const scope = folderId ? descendants(folderId) : null;

    let fl = state.folders.filter((f) => f.meta_group_id === group);
    if (ids.length) fl = [];
    else if (recursive) fl = fl.filter((f) => (scope ? scope.has(f.id) && f.id !== folderId : true));
    else fl = fl.filter((f) => (f.parent_id || null) === folderId);
    if (!includeArchived) fl = fl.filter((f) => !folderLocked(f));
    if (q) fl = fl.filter((f) => f.name.toLowerCase().includes(q) || (f.description || '').toLowerCase().includes(q));

    let pl = state.projects.filter((p) => p.meta_group_id === group);
    if (ids.length) pl = pl.filter((p) => ids.includes(p.id));
    else if (recursive) pl = pl.filter((p) => (scope ? scope.has(p.folder_id) : true));
    else pl = pl.filter((p) => (p.folder_id || null) === folderId);
    if (!includeArchived) pl = pl.filter((p) => !projectLocked(p));
    if (q) pl = pl.filter((p) => p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
    if (projectType) pl = pl.filter((p) => p.project_type === projectType);
    if (createdBy) pl = pl.filter((p) => (p.created_by || '').toLowerCase() === createdBy);
    const key = { created: 'created_at', last_activity: 'last_activity_at', archived: 'archived_at', name: 'name' }[sort];
    pl = [...pl].sort((a, b) => {
      const av = a[key] || '';
      const bv = b[key] || '';
      const cmp = String(av).localeCompare(String(bv));
      return order === 'asc' ? cmp : -cmp;
    });
    const total = pl.length;
    return jsonResponse({
      meta_group_id: group,
      folder_id: folderId,
      current_folder: folderId ? decorateFolder(folder(folderId), true) : null,
      query: q || null,
      recursive,
      folders: sortFolders(fl.map((f) => decorateFolder(f, includeArchived))),
      projects: pl.slice(offset, offset + limit).map(decorateProject),
      total_folders: fl.length,
      total_projects: total,
      offset,
      limit,
    });
  }

  function moveCheck(target, group) {
    if (target === null) return null;
    const t = folder(target);
    if (!t) return [404, 'Folder not found'];
    if (t.meta_group_id !== group) return [403, 'Items cannot be moved between access groups.'];
    if (folderLocked(t)) return [403, `The folder '${t.name}' is archived (or inside an archived folder) and is locked. Unarchive it first.`];
    return null;
  }

  function moveFolderImpl(f, target) {
    if (folderLocked(f)) return [403, `The folder '${f.name}' is archived (or inside an archived folder) and is locked. Unarchive it first.`];
    if (target && descendants(f.id).has(target)) return [400, 'A folder cannot be moved into itself or one of its subfolders.'];
    const bad = moveCheck(target, f.meta_group_id);
    if (bad) return bad;
    const clash = state.folders.find((o) => o.id !== f.id && o.meta_group_id === f.meta_group_id
      && (o.parent_id || null) === target && o.name.toLowerCase() === f.name.toLowerCase());
    if (clash) return [409, 'A folder with this name already exists here.'];
    f.parent_id = target;
    return null;
  }

  function moveProjectImpl(p, target) {
    if (p.is_archived) return [403, 'This project is archived and read-only. Unarchive it to move it.'];
    if (lockedBy(p.folder_id)) return [403, 'The folder is locked.'];
    const bad = moveCheck(target, p.meta_group_id);
    if (bad) return bad;
    p.folder_id = target;
    return null;
  }

  async function handle(input, init = {}) {
    const raw = typeof input === 'string' ? input : input.url;
    const url = new URL(raw, 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : {};
    const p = url.pathname;
    state.calls.push({ method, path: p, search: url.search, body });

    if (p === '/api/users/me') return jsonResponse({ email: state.email });
    if (p === '/api/users/me/groups' || p === '/api/users/me/access-groups') return jsonResponse(state.groups);

    if (p === '/api/folders/tree') {
      const group = url.searchParams.get('meta_group_id');
      if (!assertGroup(group)) return errorResponse(403, 'No access');
      const includeArchived = url.searchParams.get('include_archived') === 'true';
      const list = state.folders
        .filter((f) => f.meta_group_id === group)
        .filter((f) => includeArchived || !folderLocked(f))
        .map((f) => decorateFolder(f, includeArchived));
      const visible = state.projects.filter((pr) => pr.meta_group_id === group && (includeArchived || !projectLocked(pr)));
      return jsonResponse({
        meta_group_id: group,
        folders: sortFolders(list),
        root_project_count: visible.filter((pr) => !pr.folder_id).length,
        total_project_count: visible.length,
      });
    }
    if (p === '/api/dashboard/items') return listItems(url.searchParams);

    if (p === '/api/folders' && method === 'POST') {
      const name = String(body.name || '').trim();
      if (!name) return errorResponse(422, [{ msg: 'Value error, Folder name is required.' }]);
      if (!assertGroup(body.meta_group_id)) return errorResponse(403, 'No access');
      const parent = body.parent_id || null;
      const bad = moveCheck(parent, body.meta_group_id);
      if (bad) return errorResponse(...bad);
      if (state.folders.some((f) => f.meta_group_id === body.meta_group_id && (f.parent_id || null) === parent
        && f.name.toLowerCase() === name.toLowerCase())) {
        return errorResponse(409, 'A folder with this name already exists here.');
      }
      const now = new Date(Date.now() + nextId * 1000).toISOString();
      const created = {
        id: newId('folder'),
        meta_group_id: body.meta_group_id,
        parent_id: parent,
        name,
        description: body.description || null,
        is_archived: false,
        archived_at: null,
        created_by: state.email,
        created_at: now,
        last_activity_at: now,
      };
      state.folders.push(created);
      return jsonResponse(decorateFolder(created, false), 201);
    }

    let m = p.match(/^\/api\/folders\/([^/]+)(?:\/(move|archive|unarchive|delete-preview))?$/);
    if (m) {
      const f = folder(m[1]);
      if (!f) return errorResponse(404, 'Folder not found');
      const action = m[2];
      if (!action && method === 'PATCH') {
        if (folderLocked(f)) return errorResponse(403, `The folder '${f.name}' is archived (or inside an archived folder) and is locked. Unarchive it first.`);
        if (body.name !== undefined) {
          if (!String(body.name).trim()) return errorResponse(422, [{ msg: 'Value error, Folder name is required.' }]);
          f.name = String(body.name).trim();
        }
        if (body.description !== undefined) f.description = body.description;
        return jsonResponse(decorateFolder(f, false));
      }
      if (action === 'move') {
        const bad = moveFolderImpl(f, body.parent_id || null);
        return bad ? errorResponse(...bad) : jsonResponse(decorateFolder(f, false));
      }
      if (action === 'archive' || action === 'unarchive') {
        const archived = action === 'archive';
        if (!archived && f.parent_id && lockedBy(f.parent_id)) {
          return errorResponse(403, 'This folder is inside an archived folder. Unarchive the parent folder first.');
        }
        f.is_archived = archived;
        f.archived_at = archived ? '2026-02-01T00:00:00Z' : null;
        return jsonResponse(decorateFolder(f, true));
      }
      if (action === 'delete-preview') {
        const sub = descendants(f.id);
        const inside = state.projects.filter((pr) => sub.has(pr.folder_id));
        return jsonResponse({
          folder_id: f.id,
          name: f.name,
          folders: sub.size,
          projects: inside.length,
          images: inside.reduce((n, pr) => n + (pr.image_count || 0), 0),
          confirmation_phrase: `DELETE ${f.name}`,
        });
      }
      if (!action && method === 'DELETE') {
        if (body.confirmation_phrase !== `DELETE ${f.name}`) {
          return errorResponse(400, `Confirmation phrase mismatch. Expected 'DELETE ${f.name}'.`);
        }
        const sub = descendants(f.id);
        const before = state.projects.length;
        state.projects = state.projects.filter((pr) => !sub.has(pr.folder_id));
        state.folders = state.folders.filter((x) => !sub.has(x.id));
        return jsonResponse({
          folder_id: f.id, deleted: true, folders_deleted: sub.size, projects_deleted: before - state.projects.length,
        });
      }
      if (!action) return jsonResponse(decorateFolder(f, true));
    }

    if (p === '/api/dashboard/bulk/move') {
      const snapshot = JSON.stringify([state.folders, state.projects]);
      const results = [];
      let failed = false;
      body.items.forEach((item) => {
        const obj = item.type === 'folder' ? folder(item.id) : state.projects.find((x) => x.id === item.id);
        if (!obj) { failed = true; results.push({ ...item, ok: false, detail: 'Not found' }); return; }
        const prev = item.type === 'folder' ? obj.parent_id : obj.folder_id;
        const bad = item.type === 'folder' ? moveFolderImpl(obj, body.target_folder_id || null) : moveProjectImpl(obj, body.target_folder_id || null);
        if (bad) { failed = true; results.push({ ...item, ok: false, detail: bad[1] }); } else {
          results.push({ ...item, ok: true, previous_folder_id: prev || null });
        }
      });
      if (failed) {
        [state.folders, state.projects] = JSON.parse(snapshot);
        return jsonResponse({
          ok: false,
          results: results.map((r) => (r.ok ? { ...r, ok: false, detail: 'Not moved: another item in this request failed.' } : r)),
        });
      }
      return jsonResponse({ ok: true, results });
    }
    if (p === '/api/dashboard/bulk/archive') {
      body.items.forEach((item) => {
        const obj = item.type === 'folder' ? folder(item.id) : state.projects.find((x) => x.id === item.id);
        if (obj) {
          obj.is_archived = body.archived;
          obj.archived_at = body.archived ? '2026-02-01T00:00:00Z' : null;
        }
      });
      return jsonResponse({ ok: true, results: body.items.map((i) => ({ ...i, ok: true })) });
    }

    if (p === '/api/projects/' && method === 'POST') {
      if (!assertGroup(body.meta_group_id)) return errorResponse(403, 'No access');
      if (body.folder_id) {
        const bad = moveCheck(body.folder_id, body.meta_group_id);
        if (bad) return errorResponse(...bad);
      }
      const created = {
        id: newId('project'),
        description: '',
        folder_id: null,
        is_archived: false,
        archived_at: null,
        image_count: 0,
        part_count: 0,
        created_by: state.email,
        created_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        ...body,
      };
      state.projects.push(created);
      return jsonResponse(decorateProject(created), 201);
    }
    if (p === '/api/projects/' && method === 'GET') {
      return jsonResponse(state.projects.filter((pr) => !projectLocked(pr)).map(decorateProject));
    }
    m = p.match(/^\/api\/projects\/([^/]+)(?:\/(move|archive|unarchive))?$/);
    if (m) {
      const pr = state.projects.find((x) => x.id === m[1]);
      if (!pr) return errorResponse(404, 'Project not found');
      const action = m[2];
      if (action === 'move') {
        const bad = moveProjectImpl(pr, body.folder_id || null);
        return bad ? errorResponse(...bad) : jsonResponse(decorateProject(pr));
      }
      if (action === 'archive' || action === 'unarchive') {
        pr.is_archived = action === 'archive';
        pr.archived_at = pr.is_archived ? '2026-02-01T00:00:00Z' : null;
        return jsonResponse(decorateProject(pr));
      }
      if (method === 'PUT') {
        if (projectLocked(pr)) return errorResponse(403, 'This project is archived and read-only.');
        Object.assign(pr, body);
        return jsonResponse(decorateProject(pr));
      }
      if (method === 'DELETE') {
        if (body.confirmation_phrase !== `DELETE ${pr.name}`) return errorResponse(400, 'Confirmation phrase mismatch.');
        state.projects = state.projects.filter((x) => x !== pr);
        return jsonResponse({ project_id: pr.id, deleted: true, deleted_by: state.email });
      }
      return jsonResponse(decorateProject(pr));
    }

    if (fallback) {
      const out = fallback(raw, init, state);
      if (out) return out;
    }
    return jsonResponse({});
  }

  return {
    state,
    fetch: jest.fn(handle),
    callsTo: (method, pathPrefix) => state.calls.filter((c) => c.method === method && c.path.startsWith(pathPrefix)),
  };
}
