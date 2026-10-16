"""add inspection batch owner and status columns

Revision ID: 20260428_0008
Revises: 20260424_0007
Create Date: 2026-04-28
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260428_0008"
down_revision = "20260424_0007"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "inspection_batches", sa.Column("owner", sa.String(length=255), nullable=True)
    )
    op.add_column(
        "inspection_batches",
        sa.Column(
            "status", sa.String(length=32), nullable=False, server_default="not_started"
        ),
    )
    op.create_index("ix_inspection_batches_status", "inspection_batches", ["status"])


def downgrade():
    op.drop_index("ix_inspection_batches_status", table_name="inspection_batches")
    op.drop_column("inspection_batches", "status")
    op.drop_column("inspection_batches", "owner")
