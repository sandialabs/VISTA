"""add user group snapshots

The groups the authenticating proxy last asserted for each user, kept by
core.group_snapshot for VISTA_AUTH_BACKEND=custom.

Revision ID: 20261109_0011
Revises: 20260827_0010
Create Date: 2026-11-09
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20261109_0011"
down_revision = "20260827_0010"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "user_group_snapshots",
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("group_id", sa.String(length=255), nullable=False),
        sa.Column("asserted_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("email", "group_id"),
    )
    op.create_index(
        op.f("ix_user_group_snapshots_asserted_at"),
        "user_group_snapshots",
        ["asserted_at"],
        unique=False,
    )


def downgrade():
    op.drop_index(
        op.f("ix_user_group_snapshots_asserted_at"), table_name="user_group_snapshots"
    )
    op.drop_table("user_group_snapshots")
