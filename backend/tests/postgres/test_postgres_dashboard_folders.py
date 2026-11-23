"""PostgreSQL contracts for dashboard folders that SQLite cannot validate.

Partial unique indexes, FK actions, and the migration backfill.
"""

from __future__ import annotations

import pytest
from sqlalchemy import inspect

pytestmark = [pytest.mark.postgres]


@pytest.mark.asyncio
async def test_alembic_head_creates_dashboard_folder_schema(postgres_engine):
    async with postgres_engine.connect() as connection:
        schema = await connection.run_sync(
            lambda sync: {
                "tables": set(inspect(sync).get_table_names()),
                "project_cols": {
                    c["name"] for c in inspect(sync).get_columns("projects")
                },
                "folder_indexes": {
                    i["name"]: i for i in inspect(sync).get_indexes("dashboard_folders")
                },
                "project_fks": {
                    (
                        tuple(fk["constrained_columns"]),
                        fk["referred_table"],
                        fk["options"].get("ondelete"),
                    )
                    for fk in inspect(sync).get_foreign_keys("projects")
                },
                "folder_fks": {
                    (
                        tuple(fk["constrained_columns"]),
                        fk["referred_table"],
                        fk["options"].get("ondelete"),
                    )
                    for fk in inspect(sync).get_foreign_keys("dashboard_folders")
                },
            }
        )
    assert "dashboard_folders" in schema["tables"]
    assert {"folder_id", "last_activity_at"} <= schema["project_cols"]
    assert schema["folder_indexes"]["uix_dashboard_folders_root_name"]["unique"]
    assert schema["folder_indexes"]["uix_dashboard_folders_sibling_name"]["unique"]
    assert (("folder_id",), "dashboard_folders", "RESTRICT") in schema["project_fks"]
    assert (("parent_id",), "dashboard_folders", "CASCADE") in schema["folder_fks"]


def test_postgres_folder_flow(postgres_client):
    c = postgres_client
    group = "data-scientists"
    top = c.post("/api/folders", json={"name": "Top", "meta_group_id": group})
    assert top.status_code == 201, top.text
    top = top.json()
    # Root-level sibling uniqueness via the partial index (NULL parent).
    dup = c.post("/api/folders", json={"name": "TOP", "meta_group_id": group})
    assert dup.status_code == 409
    sub = c.post(
        "/api/folders",
        json={"name": "Sub", "meta_group_id": group, "parent_id": top["id"]},
    ).json()
    p = c.post(
        "/api/projects/",
        json={"name": "P", "meta_group_id": group, "folder_id": sub["id"]},
    ).json()

    items = c.get("/api/dashboard/items", params={"meta_group_id": group, "q": "p"})
    assert items.status_code == 200, items.text
    assert [x["id"] for x in items.json()["projects"]] == [p["id"]]

    assert c.post(f"/api/folders/{top['id']}/archive").status_code == 200
    r = c.put(f"/api/projects/{p['id']}", json={"name": "x"})
    assert r.status_code == 403

    assert c.post(f"/api/folders/{top['id']}/unarchive").status_code == 200
    preview = c.get(f"/api/folders/{top['id']}/delete-preview").json()
    assert preview["projects"] == 1
    r = c.request(
        "DELETE",
        f"/api/folders/{top['id']}",
        json={"confirmation_phrase": "DELETE Top"},
    )
    assert r.status_code == 200, r.text
    assert c.get(f"/api/projects/{p['id']}").status_code == 404


def test_postgres_last_activity_bumps_in_transaction(postgres_client):
    import time

    c = postgres_client
    p = c.post(
        "/api/projects/", json={"name": "Act", "meta_group_id": "data-scientists"}
    ).json()
    t0 = c.get(f"/api/projects/{p['id']}").json()["last_activity_at"]
    time.sleep(0.02)
    r = c.post(
        f"/api/projects/{p['id']}/classes",
        json={"name": "c", "project_id": p["id"]},
    )
    assert r.status_code in (200, 201), r.text
    t1 = c.get(f"/api/projects/{p['id']}").json()["last_activity_at"]
    assert t1 > t0


@pytest.mark.asyncio
async def test_concurrent_opposite_moves_cannot_form_a_cycle(postgres_session_factory):
    """A under B and B under A at the same time: the per-group advisory lock
    serializes them, so exactly one succeeds and no detached cycle forms."""
    import asyncio

    from core import models
    from services import dashboard as svc
    from services.errors import ServiceError

    group = "data-scientists"
    async with postgres_session_factory() as s:
        a = models.DashboardFolder(meta_group_id=group, name="A", name_key="a")
        b = models.DashboardFolder(meta_group_id=group, name="B", name_key="b")
        s.add_all([a, b])
        await s.commit()
        a_id, b_id = a.id, b.id

    start = asyncio.Event()

    async def move(child_id, parent_id):
        async with postgres_session_factory() as s:
            await start.wait()
            await svc.lock_folder_tree(s, group)
            folder = await s.get(models.DashboardFolder, child_id, populate_existing=True)
            await asyncio.sleep(0.05)
            try:
                await svc.move_folder(
                    s, folder, parent_id, user_email="t@example.com", accessible_groups=[group]
                )
                return True
            except ServiceError:
                await s.rollback()
                return False

    tasks = [asyncio.create_task(move(a_id, b_id)), asyncio.create_task(move(b_id, a_id))]
    start.set()
    results = await asyncio.gather(*tasks)
    assert sorted(results) == [False, True]
    async with postgres_session_factory() as s:
        parents = {
            f.id: f.parent_id
            for f in (await s.execute(__import__("sqlalchemy").select(models.DashboardFolder))).scalars()
        }
    assert parents[a_id] is None or parents[b_id] is None
