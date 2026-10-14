import hashlib
from decimal import Decimal
from pathlib import Path

import pytest
from backend.metadata.nsipro_fields import (
    NsiproFieldLimitError,
    NsiproFieldLimits,
    NsiproFieldValueError,
    collect_indexable_nsipro_sources,
    flatten_nsipro_metadata,
)
from backend.metadata.nsipro_parsers import parse_nsipro_text
from sqlalchemy import func, select

from core.models import (
    InspectionPart,
    InspectionPartMetadataField,
    Project,
)
from repositories.inspection import delete_all_inspection_parts


def _by_path(metadata):
    return {field.field_path: field for field in flatten_nsipro_metadata(metadata)}


def test_flatten_nsipro_metadata_preserves_types_order_and_empty_containers():
    metadata = {
        "name": "scan-a",
        "enabled": True,
        "count": 7,
        "exposure": 12.5,
        "missing": None,
        "channels": [
            {"name": "brightfield"},
            {},
            [],
        ],
    }

    fields = flatten_nsipro_metadata(metadata)

    assert [field.field_path for field in fields] == [
        "/name",
        "/enabled",
        "/count",
        "/exposure",
        "/missing",
        "/channels/0/name",
        "/channels/1",
        "/channels/2",
    ]
    assert [field.ordinal for field in fields] == list(range(8))
    rows = {field.field_path: field for field in fields}
    assert rows["/name"].value_type == "string"
    assert rows["/name"].value_text == "scan-a"
    assert rows["/name"].value_text_hash == hashlib.sha256(b"scan-a").hexdigest()
    assert rows["/enabled"].value_type == "boolean"
    assert rows["/enabled"].value_boolean is True
    assert rows["/enabled"].value_number is None
    assert rows["/count"].value_type == "integer"
    assert rows["/count"].value_number == Decimal("7")
    assert rows["/exposure"].value_type == "number"
    assert rows["/exposure"].value_number == Decimal("12.5")
    assert rows["/missing"].value_type == "null"
    assert rows["/channels/1"].value_type == "object"
    assert rows["/channels/1"].value_json == {}
    assert rows["/channels/2"].value_type == "array"
    assert rows["/channels/2"].value_json == []


def test_flatten_nsipro_metadata_uses_unambiguous_rfc6901_paths():
    rows = _by_path({"a/b": {"til~de": "value"}})
    row = rows["/a~1b/til~0de"]

    assert row.field_name == "til~de"
    assert row.field_path_hash == hashlib.sha256(b"/a~1b/til~0de").hexdigest()


def test_flatten_nsipro_metadata_retains_xml_attributes_text_and_repeated_elements():
    parsed = parse_nsipro_text(
        """
        <NSIProMetadata schema="pt3">
          <Channel index="1"><Name>Brightfield</Name></Channel>
          <Channel index="2"><Name>DAPI</Name></Channel>
          <Exposure unit="ms">12.5</Exposure>
        </NSIProMetadata>
        """,
        "scan.nsipro",
    )
    rows = _by_path(parsed["metadata"])

    assert rows["/NSIProMetadata/@attributes/schema"].value_text == "pt3"
    assert rows["/NSIProMetadata/Channel/0/@attributes/index"].value_number == 1
    assert rows["/NSIProMetadata/Channel/1/Name"].value_text == "DAPI"
    assert rows["/NSIProMetadata/Exposure/#text"].value_number == Decimal("12.5")


@pytest.mark.parametrize(
    ("fixture_name", "expected_count"),
    [
        ("test/data/3D/geometric/PT3_GEOMETRIC_DUAL_LABEL.nsipro", 30),
        ("test/data/nsipro/Plastic Part 6-5-2024.nsipro", 416),
    ],
)
def test_flatten_nsipro_metadata_materializes_every_fixture_leaf(
    fixture_name, expected_count
):
    fixture = Path(__file__).resolve().parents[2] / fixture_name
    parsed = parse_nsipro_text(fixture.read_text(encoding="utf-8"), fixture.name)

    assert len(flatten_nsipro_metadata(parsed["metadata"])) == expected_count


def test_flatten_nsipro_metadata_emits_an_empty_root_container():
    [field] = flatten_nsipro_metadata({})

    assert field.field_path == ""
    assert field.field_name == ""
    assert field.value_type == "object"


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_flatten_nsipro_metadata_rejects_non_finite_numbers(value):
    with pytest.raises(NsiproFieldValueError, match="finite"):
        flatten_nsipro_metadata({"value": value})


@pytest.mark.parametrize(
    ("metadata", "limits", "message"),
    [
        (
            {"a": {"b": {"c": 1}}},
            NsiproFieldLimits(max_depth=2),
            "maximum depth",
        ),
        (
            {"a": 1, "b": 2},
            NsiproFieldLimits(max_items=1),
            "maximum item count",
        ),
        (
            {"oversized": 1},
            NsiproFieldLimits(max_key_bytes=4),
            "field name",
        ),
        (
            {"long": {"path": 1}},
            NsiproFieldLimits(max_path_bytes=6),
            "field path",
        ),
        (
            {"value": "oversized"},
            NsiproFieldLimits(max_string_bytes=4),
            "string value",
        ),
        (
            {"first": "1234", "second": "5678"},
            NsiproFieldLimits(max_total_string_bytes=7),
            "aggregate string-value",
        ),
        (
            {"first": {"value": 1}, "second": {"value": 2}},
            NsiproFieldLimits(max_total_path_bytes=20),
            "aggregate field-path",
        ),
        (
            {"value": 10**10},
            NsiproFieldLimits(max_numeric_digits=10),
            "numeric value",
        ),
    ],
)
def test_flatten_nsipro_metadata_enforces_resource_limits(metadata, limits, message):
    with pytest.raises(NsiproFieldLimitError, match=message):
        flatten_nsipro_metadata(metadata, limits=limits)


def test_flatten_nsipro_metadata_rejects_non_json_scalar_types():
    with pytest.raises(NsiproFieldValueError, match="bytes"):
        flatten_nsipro_metadata({"payload": b"not-json"})


def test_collect_indexable_nsipro_sources_uses_only_active_authoritative_refs():
    primary_ref = "associated_upload_metadata:primary.nsipro"
    active_ref = "associated_upload_metadata:active.nsipro"
    stale_ref = "associated_upload_metadata:stale.nsipro"
    sources = collect_indexable_nsipro_sources(
        {
            "nsipro_payload_ref": primary_ref,
            "nsipro_payload": {
                "source_filename": "primary.nsipro",
                "metadata": {"operator": "primary"},
            },
            "nsipro_payloads_by_ref": {
                active_ref: {
                    "source_filename": "active.nsipro",
                    "metadata": {"operator": "active"},
                },
                stale_ref: {
                    "source_filename": "stale.nsipro",
                    "metadata": {"operator": "stale"},
                },
            },
            "source_images": [
                {
                    "filename": "active.png",
                    "nsipro_payload_ref": active_ref,
                }
            ],
        }
    )

    assert [
        (source.source_ref, source.source_filename, source.metadata)
        for source in sources
    ] == [
        (primary_ref, "primary.nsipro", {"operator": "primary"}),
        (active_ref, "active.nsipro", {"operator": "active"}),
    ]


def test_collect_indexable_nsipro_sources_ignores_unreferenced_inline_payloads():
    assert (
        collect_indexable_nsipro_sources(
            {
                "nsipro_payload": {"metadata": {"operator": "legacy"}},
                "source_images": [
                    {
                        "filename": "legacy.png",
                        "nsipro_payload": {"metadata": {"operator": "legacy"}},
                    }
                ],
            }
        )
        == []
    )


def test_collect_indexable_nsipro_sources_keeps_canonical_payload_precedence():
    source_ref = "associated_upload_metadata:canonical.nsipro"

    [source] = collect_indexable_nsipro_sources(
        {
            "nsipro_payload_ref": source_ref,
            "nsipro_payload": {
                "source_filename": "canonical.nsipro",
                "metadata": {"capture": {"operator": "trusted"}},
            },
            "nsipro_metadata_sources": [
                {
                    "key": source_ref,
                    "source_filename": "caller-controlled.nsipro",
                    "metadata": {"capture": {"operator": "attacker"}},
                }
            ],
        }
    )

    assert source.source_filename == "canonical.nsipro"
    assert source.metadata == {"capture": {"operator": "trusted"}}


def test_collect_indexable_nsipro_sources_can_require_authoritative_payloads():
    source_ref = "associated_upload_metadata:canonical.nsipro"
    sources = collect_indexable_nsipro_sources(
        {
            "associated_metadata_refs": [source_ref, "caller-only"],
            "nsipro_metadata_sources": [
                {
                    "key": source_ref,
                    "metadata": {"capture": {"operator": "attacker"}},
                },
                {
                    "key": "caller-only",
                    "metadata": {"capture": {"operator": "caller"}},
                },
            ],
        },
        authoritative_payloads_by_ref={
            source_ref: {
                "source_filename": "canonical.nsipro",
                "metadata": {"capture": {"operator": "trusted"}},
            }
        },
    )

    assert [
        (source.source_ref, source.source_filename, source.metadata)
        for source in sources
    ] == [
        (
            source_ref,
            "canonical.nsipro",
            {"capture": {"operator": "trusted"}},
        )
    ]


def test_inspection_part_metadata_field_schema_supports_bounded_typed_queries():
    table = InspectionPartMetadataField.__table__

    assert {column.name: column.nullable for column in table.columns} == {
        "id": False,
        "project_id": False,
        "part_id": False,
        "source_ref": False,
        "source_filename": True,
        "field_path": False,
        "field_path_hash": False,
        "field_name": False,
        "ordinal": False,
        "value_type": False,
        "value_json": True,
        "value_text": True,
        "value_text_hash": True,
        "value_number": True,
        "value_boolean": True,
        "created_at": False,
    }
    assert table.c.source_ref.type.length == 255
    assert table.c.source_filename.type.length == 1024
    assert table.c.field_path_hash.type.length == 64
    assert table.c.value_type.type.length == 16
    assert table.c.value_text_hash.type.length == 64
    assert str(table.c.created_at.server_default.arg).lower() == "now()"

    foreign_keys = {
        foreign_key.parent.name: foreign_key for foreign_key in table.foreign_keys
    }
    assert foreign_keys["project_id"].target_fullname == "projects.id"
    assert foreign_keys["project_id"].ondelete == "CASCADE"
    assert foreign_keys["part_id"].target_fullname == "inspection_parts.id"
    assert foreign_keys["part_id"].ondelete == "CASCADE"

    unique_constraint = next(
        constraint
        for constraint in table.constraints
        if constraint.name
        == "uix_inspection_part_metadata_fields_part_source_path_hash"
    )
    assert tuple(column.name for column in unique_constraint.columns) == (
        "part_id",
        "source_ref",
        "field_path_hash",
    )

    value_type_constraint = next(
        constraint
        for constraint in table.constraints
        if constraint.name == "ck_inspection_part_metadata_fields_value_type"
    )
    constraint_sql = str(value_type_constraint.sqltext)
    for value_type in (
        "string",
        "integer",
        "number",
        "boolean",
        "null",
        "object",
        "array",
    ):
        assert f"'{value_type}'" in constraint_sql

    assert {
        index.name: tuple(column.name for column in index.columns)
        for index in table.indexes
    } == {
        "ix_inspection_part_metadata_fields_project_path_text": (
            "project_id",
            "field_path_hash",
            "value_text_hash",
        ),
        "ix_inspection_part_metadata_fields_project_path_number": (
            "project_id",
            "field_path_hash",
            "value_number",
        ),
        "ix_inspection_part_metadata_fields_project_path_boolean": (
            "project_id",
            "field_path_hash",
            "value_boolean",
        ),
        "ix_inspection_part_metadata_fields_part_source": (
            "part_id",
            "source_ref",
        ),
    }


def test_inspection_part_owns_metadata_field_rows():
    relationship = InspectionPart.__mapper__.relationships["metadata_fields"]

    assert relationship.mapper.class_ is InspectionPartMetadataField
    assert relationship.back_populates == "part"
    assert "delete" in relationship.cascade
    assert "delete-orphan" in relationship.cascade


def _stored_field(project_id, part_id):
    path = "/capture/operator"
    value = "alice"
    return InspectionPartMetadataField(
        project_id=project_id,
        part_id=part_id,
        source_ref="associated_upload_metadata:sample.nsipro",
        source_filename="sample.nsipro",
        field_path=path,
        field_path_hash=hashlib.sha256(path.encode("utf-8")).hexdigest(),
        field_name="operator",
        ordinal=0,
        value_type="string",
        value_json=value,
        value_text=value,
        value_text_hash=hashlib.sha256(value.encode("utf-8")).hexdigest(),
    )


@pytest.mark.asyncio
async def test_inspection_part_delete_cascades_metadata_field_rows(db_session):
    project = Project(
        name="field cascade part",
        meta_group_id="field-cascade",
        project_type="PT3",
    )
    db_session.add(project)
    await db_session.flush()
    part = InspectionPart(
        project_id=project.id,
        serial_number="SN-FIELD-CASCADE-PART",
    )
    db_session.add(part)
    await db_session.flush()
    field = _stored_field(project.id, part.id)
    field.part = part
    db_session.add(field)
    await db_session.commit()

    await db_session.delete(part)
    await db_session.commit()

    count = (
        await db_session.execute(
            select(func.count()).select_from(InspectionPartMetadataField)
        )
    ).scalar_one()
    assert count == 0


@pytest.mark.asyncio
async def test_bulk_part_delete_removes_only_the_project_metadata_field_rows(
    db_session,
):
    project = Project(
        name="bulk field cleanup project",
        meta_group_id="field-cascade",
        project_type="PT3",
    )
    other_project = Project(
        name="bulk field cleanup isolation project",
        meta_group_id="field-cascade",
        project_type="PT3",
    )
    db_session.add_all([project, other_project])
    await db_session.flush()

    part = InspectionPart(
        project_id=project.id,
        serial_number="SN-BULK-FIELD-CLEANUP",
    )
    other_part = InspectionPart(
        project_id=other_project.id,
        serial_number="SN-BULK-FIELD-KEEP",
    )
    db_session.add_all([part, other_part])
    await db_session.flush()
    db_session.add_all(
        [
            _stored_field(project.id, part.id),
            _stored_field(other_project.id, other_part.id),
        ]
    )
    await db_session.commit()

    deleted_count = await delete_all_inspection_parts(
        db=db_session,
        project_id=project.id,
        deleted_by="bulk-cleanup@example.com",
    )

    assert deleted_count == 1
    remaining_part_project_ids = (
        (await db_session.execute(select(InspectionPart.project_id))).scalars().all()
    )
    remaining_field_project_ids = (
        (await db_session.execute(select(InspectionPartMetadataField.project_id)))
        .scalars()
        .all()
    )
    assert remaining_part_project_ids == [other_project.id]
    assert remaining_field_project_ids == [other_project.id]


@pytest.mark.asyncio
async def test_project_delete_cascades_metadata_field_rows(db_session):
    project = Project(
        name="field cascade project",
        meta_group_id="field-cascade",
        project_type="PT3",
    )
    part = InspectionPart(
        serial_number="SN-FIELD-CASCADE-PROJECT",
    )
    project.inspection_parts.append(part)
    db_session.add(project)
    await db_session.flush()
    field = _stored_field(project.id, part.id)
    field.part = part
    db_session.add(field)
    await db_session.commit()

    await db_session.delete(project)
    await db_session.commit()

    count = (
        await db_session.execute(
            select(func.count()).select_from(InspectionPartMetadataField)
        )
    ).scalar_one()
    assert count == 0
