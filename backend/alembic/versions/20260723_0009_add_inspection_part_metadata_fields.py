"""add queryable inspection part metadata fields

Revision ID: 20260723_0009
Revises: 20260428_0008
Create Date: 2026-07-23
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260723_0009"
down_revision = "20260428_0008"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "inspection_part_metadata_fields",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("part_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_ref", sa.String(length=255), nullable=False),
        sa.Column("source_filename", sa.String(length=1024), nullable=True),
        sa.Column("field_path", sa.Text(), nullable=False),
        sa.Column("field_path_hash", sa.String(length=64), nullable=False),
        sa.Column("field_name", sa.Text(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("value_type", sa.String(length=16), nullable=False),
        sa.Column("value_json", sa.JSON(), nullable=True),
        sa.Column("value_text", sa.Text(), nullable=True),
        sa.Column("value_text_hash", sa.String(length=64), nullable=True),
        sa.Column("value_number", sa.Numeric(), nullable=True),
        sa.Column("value_boolean", sa.Boolean(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "value_type IN ('string', 'integer', 'number', 'boolean', 'null', 'object', 'array')",
            name="ck_inspection_part_metadata_fields_value_type",
        ),
        sa.ForeignKeyConstraint(
            ["part_id"],
            ["inspection_parts.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "part_id",
            "source_ref",
            "field_path_hash",
            name="uix_inspection_part_metadata_fields_part_source_path_hash",
        ),
    )
    op.create_index(
        "ix_inspection_part_metadata_fields_project_path_text",
        "inspection_part_metadata_fields",
        ["project_id", "field_path_hash", "value_text_hash"],
    )
    op.create_index(
        "ix_inspection_part_metadata_fields_project_path_number",
        "inspection_part_metadata_fields",
        ["project_id", "field_path_hash", "value_number"],
    )
    op.create_index(
        "ix_inspection_part_metadata_fields_project_path_boolean",
        "inspection_part_metadata_fields",
        ["project_id", "field_path_hash", "value_boolean"],
    )
    op.create_index(
        "ix_inspection_part_metadata_fields_part_source",
        "inspection_part_metadata_fields",
        ["part_id", "source_ref"],
    )


def downgrade():
    op.drop_index(
        "ix_inspection_part_metadata_fields_part_source",
        table_name="inspection_part_metadata_fields",
    )
    op.drop_index(
        "ix_inspection_part_metadata_fields_project_path_boolean",
        table_name="inspection_part_metadata_fields",
    )
    op.drop_index(
        "ix_inspection_part_metadata_fields_project_path_number",
        table_name="inspection_part_metadata_fields",
    )
    op.drop_index(
        "ix_inspection_part_metadata_fields_project_path_text",
        table_name="inspection_part_metadata_fields",
    )
    op.drop_table("inspection_part_metadata_fields")
