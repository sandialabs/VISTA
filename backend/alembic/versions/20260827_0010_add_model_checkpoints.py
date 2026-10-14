"""add model checkpoints

Revision ID: 20260827_0010
Revises: 20260723_0009
Create Date: 2026-08-27
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260827_0010"
down_revision = "20260723_0009"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "model_checkpoints",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("meta_group_id", sa.String(length=255), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("object_storage_key", sa.String(length=1024), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("model_family", sa.String(length=32), nullable=False),
        sa.Column("model_version", sa.String(length=100), nullable=True),
        sa.Column("parameter_count", sa.BigInteger(), nullable=True),
        sa.Column("diagnostics", sa.JSON(), nullable=False),
        sa.Column("uploaded_by_user_id", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "object_storage_key", name="uq_model_checkpoints_object_storage_key"
        ),
    )
    op.create_index(
        "ix_model_checkpoints_project_id", "model_checkpoints", ["project_id"]
    )
    op.create_index(
        "ix_model_checkpoints_meta_group_id", "model_checkpoints", ["meta_group_id"]
    )
    op.create_index("ix_model_checkpoints_sha256", "model_checkpoints", ["sha256"])
    op.create_index(
        "ix_model_checkpoints_model_family", "model_checkpoints", ["model_family"]
    )


def downgrade():
    op.drop_index("ix_model_checkpoints_model_family", table_name="model_checkpoints")
    op.drop_index("ix_model_checkpoints_sha256", table_name="model_checkpoints")
    op.drop_index("ix_model_checkpoints_meta_group_id", table_name="model_checkpoints")
    op.drop_index("ix_model_checkpoints_project_id", table_name="model_checkpoints")
    op.drop_table("model_checkpoints")
