"""Add dashboard folders, project folder placement and last-activity time.

Also merges the two existing heads (``20261113_0013`` and the empty merge
revision ``ec53621e84ff``) so the history has a single head again.

Revision ID: 20261116_0014
Revises: 20261113_0013, ec53621e84ff
Create Date: 2026-11-16
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "20261116_0014"
down_revision = ("20261113_0013", "ec53621e84ff")
branch_labels = None
depends_on = None


def upgrade():
    """Create dashboard_folders and add projects.folder_id / last_activity_at."""
    op.create_table(
        "dashboard_folders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("meta_group_id", sa.String(length=255), nullable=False),
        sa.Column(
            "parent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("dashboard_folders.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("name_key", sa.String(length=1024), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "last_activity_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.Column(
            "is_archived",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_by", sa.String(length=255), nullable=True),
    )
    op.create_index(
        "ix_dashboard_folders_meta_group_id", "dashboard_folders", ["meta_group_id"]
    )
    op.create_index(
        "ix_dashboard_folders_parent_id", "dashboard_folders", ["parent_id"]
    )
    op.create_index(
        "ix_dashboard_folders_last_activity_at",
        "dashboard_folders",
        ["last_activity_at"],
    )
    op.create_index(
        "uix_dashboard_folders_sibling_name",
        "dashboard_folders",
        ["meta_group_id", "parent_id", "name_key"],
        unique=True,
        postgresql_where=sa.text("parent_id IS NOT NULL"),
        sqlite_where=sa.text("parent_id IS NOT NULL"),
    )
    op.create_index(
        "uix_dashboard_folders_root_name",
        "dashboard_folders",
        ["meta_group_id", "name_key"],
        unique=True,
        postgresql_where=sa.text("parent_id IS NULL"),
        sqlite_where=sa.text("parent_id IS NULL"),
    )

    with op.batch_alter_table("projects") as batch:
        batch.add_column(
            sa.Column("folder_id", postgresql.UUID(as_uuid=True), nullable=True)
        )
        batch.add_column(
            sa.Column(
                "last_activity_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=True,
            )
        )
        batch.add_column(sa.Column("search_text", sa.Text(), nullable=True))
        batch.create_foreign_key(
            "fk_projects_folder_id_dashboard_folders",
            "dashboard_folders",
            ["folder_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch.create_index("ix_projects_folder_id", ["folder_id"])
        batch.create_index("ix_projects_last_activity_at", ["last_activity_at"])

    # Backfill: the best existing signal of the last change.
    op.execute(
        "UPDATE projects SET last_activity_at = COALESCE(updated_at, created_at)"
    )
    _backfill_search_text()


def _backfill_search_text():
    import unicodedata

    bind = op.get_bind()
    projects = sa.table(
        "projects",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("name", sa.String()),
        sa.column("description", sa.Text()),
        sa.column("search_text", sa.Text()),
    )
    rows = bind.execute(
        sa.select(projects.c.id, projects.c.name, projects.c.description)
    ).all()
    for row in rows:
        text = "\n".join(p for p in (row.name, row.description) if p)
        bind.execute(
            projects.update()
            .where(projects.c.id == row.id)
            .values(search_text=unicodedata.normalize("NFKC", text).casefold())
        )


def downgrade():
    """Drop the folder placement, last-activity column and folders table."""
    with op.batch_alter_table("projects") as batch:
        batch.drop_index("ix_projects_last_activity_at")
        batch.drop_index("ix_projects_folder_id")
        batch.drop_constraint(
            "fk_projects_folder_id_dashboard_folders", type_="foreignkey"
        )
        batch.drop_column("search_text")
        batch.drop_column("last_activity_at")
        batch.drop_column("folder_id")
    op.drop_index("uix_dashboard_folders_root_name", table_name="dashboard_folders")
    op.drop_index("uix_dashboard_folders_sibling_name", table_name="dashboard_folders")
    op.drop_index(
        "ix_dashboard_folders_last_activity_at", table_name="dashboard_folders"
    )
    op.drop_index("ix_dashboard_folders_parent_id", table_name="dashboard_folders")
    op.drop_index("ix_dashboard_folders_meta_group_id", table_name="dashboard_folders")
    op.drop_table("dashboard_folders")
