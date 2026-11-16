"""PostgreSQL contracts for inspection NCRs that SQLite cannot validate."""

from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy import inspect, select

from core import models
from schemas import inspection_ncrs as ncr_schemas
from services.inspection import ncrs as ncr_service

pytestmark = [pytest.mark.postgres]

NCR_CONFIG = {
    "failure_codes": [{"code": "FC-01", "description": "Porosity"}],
    "disposition_codes": [{"code": "RWK", "description": "Rework"}],
}


@pytest.mark.asyncio
async def test_alembic_head_creates_ncr_tables(postgres_engine):
    async with postgres_engine.connect() as connection:
        schema = await connection.run_sync(
            lambda sync: {
                "tables": set(inspect(sync).get_table_names()),
                "ncr_columns": {
                    c["name"] for c in inspect(sync).get_columns("inspection_ncrs")
                },
                "ncr_uniques": {
                    u["name"]
                    for u in inspect(sync).get_unique_constraints("inspection_ncrs")
                },
                "ncr_fks": {
                    (
                        tuple(fk["constrained_columns"]),
                        fk["referred_table"],
                        fk["options"].get("ondelete"),
                    )
                    for fk in inspect(sync).get_foreign_keys("inspection_ncrs")
                },
                "history_uniques": {
                    u["name"]
                    for u in inspect(sync).get_unique_constraints(
                        "inspection_ncr_history"
                    )
                },
            }
        )
    assert {"inspection_ncrs", "inspection_ncr_history"} <= schema["tables"]
    assert {
        "ncr_number",
        "part_serial_number",
        "failure_code_description",
        "disposition_code_description",
        "approved_by",
        "deleted_at",
        "version",
    } <= schema["ncr_columns"]
    assert "uix_inspection_ncrs_project_number" in schema["ncr_uniques"]
    assert "uix_inspection_ncr_history_ncr_version" in schema["history_uniques"]
    assert schema["ncr_fks"] == {
        (("project_id",), "projects", "CASCADE"),
        (("part_id",), "inspection_parts", "SET NULL"),
    }


def _setup_project(client):
    headers = {"X-User-Email": "pg-ncr@example.com", "X-User-Groups": '["pg-ncr"]'}
    project_id = client.post(
        "/api/projects/",
        json={
            "name": "PG NCR",
            "description": "x",
            "meta_group_id": "pg-ncr",
            "project_type": "PT2",
        },
        headers=headers,
    ).json()["id"]
    config = client.get(
        f"/api/projects/{project_id}/configuration", headers=headers
    ).json()["config"]
    config["ncr_configuration"] = NCR_CONFIG
    resp = client.put(
        f"/api/projects/{project_id}/configuration",
        json={"config": config},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    part_id = client.post(
        f"/api/projects/{project_id}/parts",
        json={"serial_number": "PG-SN-1"},
        headers=headers,
    ).json()["id"]
    return headers, uuid.UUID(project_id), uuid.UUID(part_id)


@pytest.mark.asyncio
async def test_concurrent_creates_get_distinct_sequential_numbers(
    postgres_client, postgres_session_factory
):
    _, project_id, part_id = _setup_project(postgres_client)
    payload = ncr_schemas.InspectionNcrCreate(
        comment="c",
        failure_code="FC-01",
        disposition_code="RWK",
        disposition_instructions="i",
    )

    async def create_one(index: int):
        async with postgres_session_factory() as session:
            project = await session.get(models.Project, project_id)
            result = await ncr_service.create_ncr(
                db=session,
                project=project,
                part_id=part_id,
                payload=payload,
                user_email=f"user{index}@example.com",
            )
            return result["ncr_number"]

    numbers = await asyncio.gather(*(create_one(i) for i in range(8)))
    assert sorted(numbers) == list(range(1, 9))


@pytest.mark.asyncio
async def test_deleting_part_keeps_ncr_and_history(
    postgres_client, postgres_session_factory
):
    headers, project_id, part_id = _setup_project(postgres_client)
    created = postgres_client.post(
        f"/api/projects/{project_id}/parts/{part_id}/ncrs",
        json={
            "comment": "c",
            "failure_code": "FC-01",
            "disposition_code": "RWK",
            "disposition_instructions": "i",
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    deleted = postgres_client.delete(
        f"/api/projects/{project_id}/parts/{part_id}", headers=headers
    )
    assert deleted.status_code == 204, deleted.text

    async with postgres_session_factory() as session:
        ncr = await session.scalar(select(models.InspectionNcr))
        assert ncr is not None
        assert ncr.part_id is None
        assert ncr.part_serial_number == "PG-SN-1"
        assert ncr.created_at.tzinfo is not None
        history = (await session.scalars(select(models.InspectionNcrHistory))).all()
        assert [entry.action for entry in history] == ["created"]
    listed = postgres_client.get(f"/api/projects/{project_id}/ncrs", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["ncrs"][0]["part_id"] is None


@pytest.mark.asyncio
async def test_raw_stored_codes_with_nul_or_oversize_never_reach_postgres(
    postgres_client,
):
    """The generic metadata API can store unvalidated config; NCR creation must
    reject such codes with 422 instead of failing inside PostgreSQL.

    (PostgreSQL itself refuses NUL in JSON, so only oversize/control-char
    entries can actually be stored that way.)"""
    headers, project_id, part_id = _setup_project(postgres_client)
    raw_config = postgres_client.get(
        f"/api/projects/{project_id}/configuration", headers=headers
    ).json()["config"]
    raw_config["ncr_configuration"] = {
        "failure_codes": [
            {"code": "ESC", "description": "bad\u001bdesc"},
            {"code": "LONG", "description": "d" * 400},
        ],
        "disposition_codes": [{"code": "RWK", "description": "Rework"}],
    }
    stored = postgres_client.put(
        f"/api/projects/{project_id}/metadata/inspection_workbench.project_configuration",
        json={"key": "inspection_workbench.project_configuration", "value": raw_config},
        headers=headers,
    )
    assert stored.status_code < 300, stored.text
    for code in ("ESC", "LONG"):
        resp = postgres_client.post(
            f"/api/projects/{project_id}/parts/{part_id}/ncrs",
            json={
                "comment": "c",
                "failure_code": code,
                "disposition_code": "RWK",
                "disposition_instructions": "i",
            },
            headers=headers,
        )
        assert resp.status_code == 422, (code, resp.status_code, resp.text)
