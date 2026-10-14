import json

import pytest
from sqlalchemy import func, select

from core import models
from repositories import inspection as inspection_repository
from routers import inspection_workbench
from schemas.inspection_parts import (
    InspectionPartCreate,
    InspectionPartMetadataSourcesUpdateRequest,
)
from schemas.users import User


def test_part_metadata_sources_association_combines_nsipro_metadata(client):
    headers = {
        "X-User-Id": "metadata-sources@example.com",
        "X-User-Groups": '["metadata-sources-group"]',
    }
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "Metadata sources project",
            "description": "Regression coverage for project-level metadata association",
            "meta_group_id": "metadata-sources-group",
            "project_type": "PT3",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    part_resp = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "SN-PT3-001",
            "display_name": "PT3 assigned part",
            "metadata": {
                "source_images": [
                    {
                        "filename": "slice-001.png",
                        "image_id": None,
                        "side": "axial",
                        "modality": "ct",
                        "overlay": False,
                    }
                ]
            },
        },
        headers=headers,
    )
    assert part_resp.status_code == 201, part_resp.text
    part_id = part_resp.json()["id"]

    metadata_resp = client.post(
        f"/api/projects/{project_id}/metadata",
        json={
            "key": "associated_upload_metadata:sample.nsipro",
            "value": {
                "filename": "sample.nsipro",
                "file_type": "nsipro",
                "parser": "nsipro-key-value",
                "parser_id": "default",
                "metadata": {
                    "capture": {
                        "operator": "alice",
                        "scanner": "CT-9",
                    }
                },
            },
        },
        headers=headers,
    )
    assert metadata_resp.status_code == 201, metadata_resp.text

    update_resp = client.put(
        f"/api/projects/{project_id}/parts/{part_id}/metadata-sources",
        json={"metadata_source_keys": ["associated_upload_metadata:sample.nsipro"]},
        headers=headers,
    )
    assert update_resp.status_code == 200, update_resp.text
    metadata = update_resp.json()["metadata"]
    assert metadata["associated_metadata_refs"] == [
        "associated_upload_metadata:sample.nsipro"
    ]
    assert metadata["nsipro_metadata"]["capture"]["operator"] == "alice"
    assert metadata["nsipro_metadata"]["capture"]["scanner"] == "CT-9"
    assert metadata["project_metadata_combined"]["capture"]["scanner"] == "CT-9"
    assert (
        metadata["project_metadata_source_values"][0]["key"]
        == "associated_upload_metadata:sample.nsipro"
    )
    assert (
        metadata["nsipro_metadata_sources"][0]["key"]
        == "associated_upload_metadata:sample.nsipro"
    )


@pytest.mark.asyncio
async def test_part_metadata_source_association_adds_and_clears_query_fields(
    db_session,
):
    user = User(
        email="metadata-sources@example.com",
        username="metadata-sources",
    )
    project = models.Project(
        name="Queryable metadata association",
        description="manual association field-table coverage",
        meta_group_id="metadata-sources-group",
        created_by=user.email,
        project_type="PT3",
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)
    part = await inspection_repository.create_inspection_part(
        db=db_session,
        project_id=project.id,
        part=InspectionPartCreate(
            serial_number="SN-MANUAL-NSIPRO",
            metadata={"source_images": [{"filename": "slice.png"}]},
        ),
    )
    metadata_key = "associated_upload_metadata:manual.nsipro"
    db_session.add(
        models.ProjectMetadata(
            project_id=project.id,
            key=metadata_key,
            value={
                "filename": "manual.nsipro",
                "file_type": "nsipro",
                "parser": "nsipro-key-value",
                "parser_id": "default",
                "metadata": {
                    "capture": {
                        "operator": "alice",
                        "exposure_ms": 8.75,
                    }
                },
            },
        )
    )
    await db_session.commit()

    updated = await inspection_workbench.update_inspection_part_metadata_sources(
        project_id=project.id,
        project=project,
        part_id=part.id,
        payload=InspectionPartMetadataSourcesUpdateRequest(
            metadata_source_keys=[metadata_key]
        ),
        db=db_session,
        current_user=user,
    )

    fields = (
        (
            await db_session.execute(
                select(models.InspectionPartMetadataField)
                .where(models.InspectionPartMetadataField.part_id == part.id)
                .order_by(models.InspectionPartMetadataField.ordinal)
            )
        )
        .scalars()
        .all()
    )
    assert updated["metadata"]["nsipro_metadata"]["capture"]["operator"] == "alice"
    assert [
        (field.field_path, field.value_type, field.value_text, field.value_number)
        for field in fields
    ] == [
        ("/capture/operator", "string", "alice", None),
        ("/capture/exposure_ms", "number", None, 8.75),
    ]

    cleared = await inspection_workbench.update_inspection_part_metadata_sources(
        project_id=project.id,
        project=project,
        part_id=part.id,
        payload=InspectionPartMetadataSourcesUpdateRequest(
            metadata_source_keys=[]
        ),
        db=db_session,
        current_user=user,
    )

    field_count = (
        await db_session.execute(
            select(func.count())
            .select_from(models.InspectionPartMetadataField)
            .where(models.InspectionPartMetadataField.part_id == part.id)
        )
    ).scalar_one()
    assert field_count == 0
    assert cleared["metadata"]["associated_metadata_refs"] == []
    assert cleared["metadata"]["nsipro_metadata"] == {}


@pytest.mark.asyncio
async def test_manual_metadata_source_update_preserves_bulk_nsipro_fields(
    db_session,
):
    user = User(
        email="metadata-sources@example.com",
        username="metadata-sources",
    )
    project = models.Project(
        name="Mixed metadata association",
        description="bulk and manual source field-table coverage",
        meta_group_id="metadata-sources-group",
        created_by=user.email,
        project_type="PT3",
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)

    bulk_key = "associated_upload_metadata:bulk.nsipro"
    manual_key = "associated_upload_metadata:manual.nsipro"
    bulk_metadata = {"capture": {"operator": "bulk"}}
    manual_metadata = {"capture": {"scanner": "manual"}}
    db_session.add_all(
        [
            models.ProjectMetadata(
                project_id=project.id,
                key=bulk_key,
                value={
                    "filename": "bulk.nsipro",
                    "file_type": "nsipro",
                    "parser_id": "default",
                    "metadata": bulk_metadata,
                },
            ),
            models.ProjectMetadata(
                project_id=project.id,
                key=manual_key,
                value={
                    "filename": "manual.nsipro",
                    "file_type": "nsipro",
                    "parser_id": "default",
                    "metadata": manual_metadata,
                },
            ),
        ]
    )
    await db_session.commit()
    part = await inspection_repository.create_inspection_part(
        db=db_session,
        project_id=project.id,
        part=InspectionPartCreate(
            serial_number="SN-MIXED-NSIPRO",
            metadata={
                "nsipro_payload_ref": bulk_key,
                "nsipro_payload": {
                    "source_filename": "bulk.nsipro",
                    "metadata": bulk_metadata,
                },
                "nsipro_metadata": bulk_metadata,
                "nsipro_payloads_by_ref": {
                    manual_key: {
                        "source_filename": "manual.nsipro",
                        "metadata": manual_metadata,
                    }
                },
            },
        ),
    )

    updated = await inspection_workbench.update_inspection_part_metadata_sources(
        project_id=project.id,
        project=project,
        part_id=part.id,
        payload=InspectionPartMetadataSourcesUpdateRequest(
            metadata_source_keys=[manual_key]
        ),
        db=db_session,
        current_user=user,
    )

    fields = (
        (
            await db_session.execute(
                select(models.InspectionPartMetadataField)
                .where(models.InspectionPartMetadataField.part_id == part.id)
                .order_by(
                    models.InspectionPartMetadataField.source_ref,
                    models.InspectionPartMetadataField.field_path,
                )
            )
        )
        .scalars()
        .all()
    )
    assert {
        (field.source_ref, field.field_path, field.value_text) for field in fields
    } == {
        (bulk_key, "/capture/operator", "bulk"),
        (manual_key, "/capture/scanner", "manual"),
    }
    assert updated["metadata"]["nsipro_payload"]["metadata"] == bulk_metadata
    assert manual_key not in updated["metadata"].get("nsipro_payloads_by_ref", {})

    cleared = await inspection_workbench.update_inspection_part_metadata_sources(
        project_id=project.id,
        project=project,
        part_id=part.id,
        payload=InspectionPartMetadataSourcesUpdateRequest(
            metadata_source_keys=[]
        ),
        db=db_session,
        current_user=user,
    )

    remaining_fields = (
        (
            await db_session.execute(
                select(models.InspectionPartMetadataField).where(
                    models.InspectionPartMetadataField.part_id == part.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert [
        (field.source_ref, field.field_path, field.value_text)
        for field in remaining_fields
    ] == [(bulk_key, "/capture/operator", "bulk")]
    assert cleared["metadata"]["associated_metadata_refs"] == []
    assert cleared["metadata"]["nsipro_metadata"] == bulk_metadata
    assert manual_key not in cleared["metadata"].get("nsipro_payloads_by_ref", {})
    assert '"scanner"' not in json.dumps(cleared["metadata"])
