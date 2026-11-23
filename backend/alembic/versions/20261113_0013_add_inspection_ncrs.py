"""Add inspection nonconformance reports.

Nonconformance reports (NCRs) raised against inspection parts, and their
append-only change history.

Revision ID: 20261113_0013
Revises: 20261110_0012
Create Date: 2026-11-13
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "20261113_0013"
down_revision = "20261110_0012"
branch_labels = None
depends_on = None


def upgrade():
    """Create the NCR and NCR history tables."""
    op.create_table(
        "inspection_ncrs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("part_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("part_serial_number", sa.String(length=255), nullable=False),
        sa.Column("ncr_number", sa.Integer(), nullable=False),
        sa.Column(
            "status", sa.String(length=16), server_default="open", nullable=False
        ),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("failure_code", sa.String(length=64), nullable=False),
        sa.Column(
            "failure_code_description",
            sa.String(length=255),
            server_default="",
            nullable=False,
        ),
        sa.Column("disposition_code", sa.String(length=64), nullable=False),
        sa.Column(
            "disposition_code_description",
            sa.String(length=255),
            server_default="",
            nullable=False,
        ),
        sa.Column("disposition_instructions", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.Column("created_by", sa.String(length=255), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.Column("updated_by", sa.String(length=255), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", sa.String(length=255), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.String(length=255), nullable=True),
        sa.CheckConstraint(
            "status IN ('open', 'approved')", name="ck_inspection_ncrs_status"
        ),
        sa.ForeignKeyConstraint(
            ["part_id"], ["inspection_parts.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id", "ncr_number", name="uix_inspection_ncrs_project_number"
        ),
    )
    op.create_index(
        op.f("ix_inspection_ncrs_project_id"),
        "inspection_ncrs",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_inspection_ncrs_part_id"),
        "inspection_ncrs",
        ["part_id"],
        unique=False,
    )

    op.create_table(
        "inspection_ncr_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("ncr_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("actor", sa.String(length=255), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("changes", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["ncr_id"], ["inspection_ncrs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "ncr_id", "version", name="uix_inspection_ncr_history_ncr_version"
        ),
    )
    op.create_index(
        op.f("ix_inspection_ncr_history_ncr_id"),
        "inspection_ncr_history",
        ["ncr_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_inspection_ncr_history_project_id"),
        "inspection_ncr_history",
        ["project_id"],
        unique=False,
    )


def downgrade():
    """Drop the NCR and NCR history tables."""
    op.drop_index(
        op.f("ix_inspection_ncr_history_project_id"),
        table_name="inspection_ncr_history",
    )
    op.drop_index(
        op.f("ix_inspection_ncr_history_ncr_id"), table_name="inspection_ncr_history"
    )
    op.drop_table("inspection_ncr_history")
    op.drop_index(op.f("ix_inspection_ncrs_part_id"), table_name="inspection_ncrs")
    op.drop_index(op.f("ix_inspection_ncrs_project_id"), table_name="inspection_ncrs")
    op.drop_table("inspection_ncrs")
