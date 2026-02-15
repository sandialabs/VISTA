"""add key_prefix column to api_keys for fast lookup

Revision ID: 20260214_0003
Revises: 20251005_0002
Create Date: 2026-02-14
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_0003'
down_revision = '20251005_0002'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('api_keys', sa.Column('key_prefix', sa.String(16), nullable=True))
    op.create_index('ix_api_keys_key_prefix', 'api_keys', ['key_prefix'])


def downgrade():
    op.drop_index('ix_api_keys_key_prefix', table_name='api_keys')
    op.drop_column('api_keys', 'key_prefix')
