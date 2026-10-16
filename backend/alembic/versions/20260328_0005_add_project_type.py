"""add project_type to projects

Revision ID: 20260328_0005
Revises: 20260306_0004
Create Date: 2026-03-28
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260328_0005"
down_revision = "20260306_0004"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "projects",
        sa.Column(
            "project_type", sa.String(length=16), nullable=False, server_default="PT1"
        ),
    )
    op.create_index("ix_projects_project_type", "projects", ["project_type"])


def downgrade():
    op.drop_index("ix_projects_project_type", table_name="projects")
    op.drop_column("projects", "project_type")
