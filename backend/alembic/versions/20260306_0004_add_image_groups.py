"""add image_groups table and group_id to data_instances

Revision ID: 20260306_0004
Revises: 20260220_0003
Create Date: 2026-03-06
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260306_0004"
down_revision = "20260220_0003"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "image_groups",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("identifier", sa.String(255), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_image_groups_project_id", "image_groups", ["project_id"])
    op.create_unique_constraint(
        "uix_image_groups_project_identifier",
        "image_groups",
        ["project_id", "identifier"],
    )

    op.add_column(
        "data_instances",
        sa.Column(
            "group_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("image_groups.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_data_instances_group_id", "data_instances", ["group_id"])


def downgrade():
    op.drop_index("ix_data_instances_group_id", table_name="data_instances")
    op.drop_column("data_instances", "group_id")
    op.drop_constraint(
        "uix_image_groups_project_identifier", "image_groups", type_="unique"
    )
    op.drop_index("ix_image_groups_project_id", table_name="image_groups")
    op.drop_table("image_groups")
