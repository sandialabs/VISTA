"""merge heads 0006 and 0005

Revision ID: b480c819cda0
Revises: 20260328_0006, 20260331_0005
Create Date: 2026-04-14 14:56:20.891036

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "b480c819cda0"
down_revision: str | Sequence[str] | None = ("20260328_0006", "20260331_0005")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
