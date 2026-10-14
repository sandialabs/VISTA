"""add inspection batch and part tables

Revision ID: 20260328_0006
Revises: 20260328_0005
Create Date: 2026-03-28
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260328_0006"
down_revision = "20260328_0005"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "inspection_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id", "name", name="uix_inspection_batches_project_name"
        ),
    )
    op.create_index(
        "ix_inspection_batches_project_id", "inspection_batches", ["project_id"]
    )

    op.create_table(
        "inspection_parts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("serial_number", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column(
            "review_state",
            sa.String(length=50),
            nullable=False,
            server_default="unreviewed",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["batch_id"], ["inspection_batches.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id",
            "serial_number",
            name="uix_inspection_parts_project_serial_number",
        ),
    )
    op.create_index(
        "ix_inspection_parts_project_id", "inspection_parts", ["project_id"]
    )
    op.create_index("ix_inspection_parts_batch_id", "inspection_parts", ["batch_id"])
    op.create_index(
        "ix_inspection_parts_review_state", "inspection_parts", ["review_state"]
    )


def downgrade():
    op.drop_index("ix_inspection_parts_review_state", table_name="inspection_parts")
    op.drop_index("ix_inspection_parts_batch_id", table_name="inspection_parts")
    op.drop_index("ix_inspection_parts_project_id", table_name="inspection_parts")
    op.drop_table("inspection_parts")

    op.drop_index("ix_inspection_batches_project_id", table_name="inspection_batches")
    op.drop_table("inspection_batches")
