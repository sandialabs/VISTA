"""add archive fields to projects

Revision ID: 20260331_0005
Revises: 20260306_0004
Create Date: 2026-03-31
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260331_0005'
down_revision = '20260306_0004'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('projects', sa.Column('created_by', sa.String(255), nullable=True))
    op.add_column('projects', sa.Column('is_archived', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('projects', sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index('ix_projects_is_archived', 'projects', ['is_archived'])


def downgrade():
    op.drop_index('ix_projects_is_archived', table_name='projects')
    op.drop_column('projects', 'archived_at')
    op.drop_column('projects', 'is_archived')
    op.drop_column('projects', 'created_by')
