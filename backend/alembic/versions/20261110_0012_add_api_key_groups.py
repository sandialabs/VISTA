"""add api key groups

The groups an API key grants: its creator's groups as the authenticating proxy
asserted them when the key was made (VISTA_AUTH_BACKEND=custom).

Revision ID: 20261110_0012
Revises: 20261109_0011
Create Date: 2026-11-10
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20261110_0012"
down_revision = "20261109_0011"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("api_keys", sa.Column("groups", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("api_keys", "groups")
