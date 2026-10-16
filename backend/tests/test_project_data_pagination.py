import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import event, insert

from core import models
from tests.conftest import TestingSessionLocal, engine


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _create_project(client, name="Large image project") -> str:
    response = client.post(
        "/api/projects/",
        json={"name": name, "description": None, "meta_group_id": "g"},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _test_uuid(prefix: str, index: int) -> uuid.UUID:
    """Keep at least one hex letter so SQLite does not apply numeric affinity."""
    return uuid.UUID(f"{prefix * 20}{index:012x}")


async def _insert_images(rows):
    async with TestingSessionLocal() as db:
        await db.execute(insert(models.DataInstance), rows)
        await db.commit()


async def _insert_group_and_images(project_id: uuid.UUID, rows):
    group_id = uuid.uuid4()
    async with TestingSessionLocal() as db:
        await db.execute(
            insert(models.ImageGroup),
            [{"id": group_id, "project_id": project_id, "identifier": "group-a"}],
        )
        await db.execute(insert(models.DataInstance), rows(group_id))
        await db.commit()
    return group_id


def _image_row(
    *,
    project_id: uuid.UUID,
    image_id: uuid.UUID,
    filename: str,
    created_at: datetime,
    deleted_at=None,
    group_id=None,
    size_bytes=1,
    metadata=None,
):
    return {
        "id": image_id,
        "project_id": project_id,
        "group_id": group_id,
        "filename": filename,
        "object_storage_key": f"pagination/{project_id}/{image_id}/{filename}",
        "content_type": "image/png",
        "size_bytes": size_bytes,
        "metadata_json": metadata or {},
        "uploaded_by_user_id": "test@example.com",
        "created_at": created_at,
        "deleted_at": deleted_at,
        "storage_deleted": False,
    }


def test_images_page_walks_2501_equal_timestamp_images_exactly_once(client):
    project_id = uuid.UUID(_create_project(client))
    base_time = datetime(2026, 1, 1, tzinfo=UTC)
    active_ids = [_test_uuid("a", index + 1) for index in range(2501)]
    deleted_ids = [_test_uuid("b", index + 1) for index in range(4)]
    rows = [
        _image_row(
            project_id=project_id,
            image_id=image_id,
            filename=f"active-{index:04d}.png",
            # Hundreds of equal timestamps exercise the UUID tie breaker.
            created_at=base_time + timedelta(seconds=index // 700),
            metadata={"index": index},
        )
        for index, image_id in enumerate(active_ids)
    ]
    rows.extend(
        _image_row(
            project_id=project_id,
            image_id=image_id,
            filename=f"deleted-{index}.png",
            created_at=base_time,
            deleted_at=base_time + timedelta(days=1),
        )
        for index, image_id in enumerate(deleted_ids)
    )
    _run(_insert_images(rows))

    seen = []
    cursor = None
    for _page_number in range(10):
        params = {"limit": 500}
        if cursor:
            params["cursor"] = cursor
        response = client.get(f"/api/projects/{project_id}/images-page", params=params)
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["total"] == 2501
        seen.extend(item["id"] for item in payload["items"])
        if not payload["has_more"]:
            assert payload["next_cursor"] is None
            break
        cursor = payload["next_cursor"]
        assert cursor
    else:
        raise AssertionError(
            "pagination did not terminate within the expected page bound"
        )

    assert len(seen) == 2501
    assert len(set(seen)) == 2501
    assert set(seen) == {str(image_id) for image_id in active_ids}

    include_deleted = client.get(
        f"/api/projects/{project_id}/images-page",
        params={"limit": 1, "include_deleted": "true"},
    )
    assert include_deleted.status_code == 200
    assert include_deleted.json()["total"] == 2505

    deleted_only = client.get(
        f"/api/projects/{project_id}/images-page",
        params={"limit": 10, "deleted_only": "true"},
    )
    assert deleted_only.status_code == 200
    assert deleted_only.json()["total"] == 4
    assert {item["id"] for item in deleted_only.json()["items"]} == {
        str(image_id) for image_id in deleted_ids
    }


def test_images_page_validates_cursor_access_and_sql_filters(client, monkeypatch):
    project_id = uuid.UUID(_create_project(client, "Filtered project"))
    base_time = datetime(2026, 2, 1, tzinfo=UTC)

    def rows(group_id):
        return [
            _image_row(
                project_id=project_id,
                image_id=_test_uuid("c", 1),
                filename="needle-group.png",
                created_at=base_time,
                group_id=group_id,
                metadata={"camera": "left", "needle": "yes"},
            ),
            _image_row(
                project_id=project_id,
                image_id=_test_uuid("c", 2),
                filename="other-group.png",
                created_at=base_time,
                group_id=group_id,
                metadata={"camera": "right"},
            ),
            _image_row(
                project_id=project_id,
                image_id=_test_uuid("c", 3),
                filename="needle-ungrouped.png",
                created_at=base_time,
                metadata={"camera": "left"},
            ),
            _image_row(
                project_id=project_id,
                image_id=_test_uuid("c", 4),
                filename="needle-deleted.png",
                created_at=base_time,
                deleted_at=base_time + timedelta(days=1),
                metadata={"camera": "left"},
            ),
        ]

    group_id = _run(_insert_group_and_images(project_id, rows))

    invalid = client.get(f"/api/projects/{project_id}/images-page?cursor=not-base64!")
    assert invalid.status_code == 400
    assert "cursor" in invalid.json()["detail"].lower()

    too_large_page = client.get(f"/api/projects/{project_id}/images-page?limit=501")
    assert too_large_page.status_code == 422

    grouped = client.get(
        f"/api/projects/{project_id}/images-page",
        params={
            "group_id": str(group_id),
            "search_field": "filename",
            "search_value": "needle",
        },
    )
    assert grouped.status_code == 200
    assert grouped.json()["total"] == 1
    assert grouped.json()["items"][0]["filename"] == "needle-group.png"

    metadata_search = client.get(
        f"/api/projects/{project_id}/images-page",
        params={"search_field": "camera", "search_value": "left"},
    )
    assert metadata_search.status_code == 200, metadata_search.text
    assert metadata_search.json()["total"] == 2

    ungrouped = client.get(
        f"/api/projects/{project_id}/images-page",
        params={"ungrouped": "true"},
    )
    assert ungrouped.status_code == 200
    assert ungrouped.json()["total"] == 1
    assert ungrouped.json()["items"][0]["filename"] == "needle-ungrouped.png"

    invalid_combination = client.get(
        f"/api/projects/{project_id}/images-page",
        params={"deleted_only": "true", "group_id": str(group_id)},
    )
    assert invalid_combination.status_code == 400

    monkeypatch.setattr("utils.dependencies.is_user_in_group", lambda *_args: False)
    forbidden = client.get(f"/api/projects/{project_id}/images-page")
    assert forbidden.status_code == 403


def test_legacy_images_filters_deleted_before_limit_and_orders_stably(client):
    project_id = uuid.UUID(_create_project(client, "Legacy pagination project"))
    base_time = datetime(2026, 3, 1, tzinfo=UTC)
    rows = [
        _image_row(
            project_id=project_id,
            image_id=_test_uuid("d", index + 1),
            filename=f"deleted-{index:03d}.png",
            created_at=base_time,
            deleted_at=base_time + timedelta(days=1, seconds=index),
        )
        for index in range(120)
    ]
    active_ids = [_test_uuid("e", 2), _test_uuid("e", 1), _test_uuid("e", 3)]
    rows.extend(
        _image_row(
            project_id=project_id,
            image_id=image_id,
            filename=f"active-{image_id.int}.png",
            created_at=base_time,
        )
        for image_id in active_ids
    )
    _run(_insert_images(rows))

    response = client.get(f"/api/projects/{project_id}/images", params={"limit": 2})
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [
        str(_test_uuid("e", 1)),
        str(_test_uuid("e", 2)),
    ]

    deleted_response = client.get(
        f"/api/projects/{project_id}/images",
        params={"limit": 2, "deleted_only": "true"},
    )
    assert deleted_response.status_code == 200
    assert [item["id"] for item in deleted_response.json()] == [
        str(_test_uuid("d", 120)),
        str(_test_uuid("d", 119)),
    ]


def test_project_data_summary_is_exact_and_uses_fixed_aggregate_queries(
    client, monkeypatch
):
    project_id = uuid.UUID(_create_project(client, "Summary project"))
    base_time = datetime(2026, 4, 1, tzinfo=UTC)
    image_rows = [
        _image_row(
            project_id=project_id,
            image_id=_test_uuid("f", 1),
            filename="one.png",
            created_at=base_time,
            size_bytes=10,
            metadata={"a": 1, "b": 2},
        ),
        _image_row(
            project_id=project_id,
            image_id=_test_uuid("f", 2),
            filename="two.png",
            created_at=base_time,
            size_bytes=20,
            metadata={"a": 1, "b": 2, "c": 3},
        ),
        _image_row(
            project_id=project_id,
            image_id=_test_uuid("f", 3),
            filename="deleted.png",
            created_at=base_time,
            deleted_at=base_time + timedelta(days=1),
            size_bytes=999,
            metadata={"excluded": True},
        ),
    ]

    async def seed_summary():
        async with TestingSessionLocal() as db:
            await db.execute(insert(models.DataInstance), image_rows)
            await db.execute(
                insert(models.InspectionPart),
                [
                    {
                        "id": uuid.uuid4(),
                        "project_id": project_id,
                        "serial_number": "part-1",
                        "metadata_json": {
                            "annotations": [{"id": "a"}, {"id": "b"}, "ignored", 7],
                            "overlay_layers": [{"id": "mask"}, "ignored"],
                        },
                    },
                    {
                        "id": uuid.uuid4(),
                        "project_id": project_id,
                        "serial_number": "part-2",
                        "metadata_json": {
                            "annotations": [{"id": "c"}],
                            "overlay_layers": [{"id": "heat"}, {"id": "depth"}],
                        },
                    },
                    {
                        "id": uuid.uuid4(),
                        "project_id": project_id,
                        "serial_number": "part-3",
                        "metadata_json": None,
                    },
                ],
            )
            await db.commit()

    _run(seed_summary())

    statements = []

    def record_statement(
        _conn, _cursor, statement, _parameters, _context, _executemany
    ):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", record_statement)
    try:
        response = client.get(f"/api/projects/{project_id}/data-summary")
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", record_statement)

    assert response.status_code == 200, response.text
    assert response.json() == {
        "project_id": str(project_id),
        "active_image_count": 2,
        "deleted_image_count": 1,
        "total_image_bytes": 30,
        "part_count": 3,
        "image_metadata_fields": 5,
        "annotation_count": 3,
        "overlay_layer_count": 3,
    }
    # One auth-user lookup, one project access query, and two aggregate-only queries.
    assert len(statements) == 4
    image_statements = [
        statement for statement in statements if "FROM data_instances" in statement
    ]
    part_statements = [
        statement for statement in statements if "FROM inspection_parts" in statement
    ]
    assert len(image_statements) == 1
    assert len(part_statements) == 1
    assert "object_storage_key" not in image_statements[0]
    assert "serial_number" not in part_statements[0]

    monkeypatch.setattr("utils.dependencies.is_user_in_group", lambda *_args: False)
    forbidden = client.get(f"/api/projects/{project_id}/data-summary")
    assert forbidden.status_code == 403
