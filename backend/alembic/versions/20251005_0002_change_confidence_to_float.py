"""change confidence column to float

Revision ID: 20251005_0002
Revises: 20250930_0001_initial
Create Date: 2025-10-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20251005_0002'
down_revision = '20250930_0001_initial'
branch_labels = None
depends_on = None


def upgrade():
    # Change confidence column from Numeric(5, 4) to Float
    # Numeric(5, 4) only allows max 9.9999, not 1.0
    op.alter_column('ml_annotations', 'confidence',
                    existing_type=sa.Numeric(precision=5, scale=4),
                    type_=sa.Float(),
                    existing_nullable=True)


def downgrade():
    # Revert confidence column back to Numeric(5, 4)
    op.alter_column('ml_annotations', 'confidence',
                    existing_type=sa.Float(),
                    type_=sa.Numeric(precision=5, scale=4),
                    existing_nullable=True)
