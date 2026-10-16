"""merge heads 0006 and 0005

Revision ID: ec53621e84ff
Revises: 20260428_0008, b480c819cda0
Create Date: 2026-04-30 12:00:49.006729

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "ec53621e84ff"
down_revision: str | Sequence[str] | None = ("20260428_0008", "b480c819cda0")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
