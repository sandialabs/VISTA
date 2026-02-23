"""add collections annotations and reviews

Revision ID: 20260222_0003
Revises: 20251005_0002
Create Date: 2026-02-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "20260222_0003"
down_revision = "20251005_0002"
branch_labels = None
depends_on = None


def upgrade():
    # -- audit_events --
    op.create_table(
        "audit_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("entity_type", sa.String(50), nullable=False),
        sa.Column("entity_id", UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("actor_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("details", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_audit_entity", "audit_events", ["entity_type", "entity_id"])
    op.create_index("ix_audit_project", "audit_events", ["project_id"])
    op.create_index("ix_audit_created", "audit_events", ["created_at"])

    # -- image_collections --
    op.create_table(
        "image_collections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("purpose", sa.String(20), nullable=False, server_default="labeling"),
        sa.Column("phase", sa.String(20), nullable=False, server_default="draft", index=True),
        sa.Column("source_collection_id", UUID(as_uuid=True), sa.ForeignKey("image_collections.id"), nullable=True),
        sa.Column("ml_model_name", sa.String(255), nullable=True),
        sa.Column("ml_model_version", sa.String(100), nullable=True),
        sa.Column("certified_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("certified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("certification_notes", sa.Text, nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("project_id", "name", name="uq_collection_project_name"),
    )

    # -- collection_memberships --
    op.create_table(
        "collection_memberships",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("collection_id", UUID(as_uuid=True), sa.ForeignKey("image_collections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("image_id", UUID(as_uuid=True), sa.ForeignKey("data_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("added_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("collection_id", "image_id", name="uq_collection_image"),
    )

    # -- bounding_box_classes --
    op.create_table(
        "bounding_box_classes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("collection_id", UUID(as_uuid=True), sa.ForeignKey("image_collections.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("color", sa.String(7), nullable=False, server_default="#FF0000"),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("collection_id", "name", name="uq_bbox_class_collection_name"),
    )

    # -- user_annotations --
    op.create_table(
        "user_annotations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("image_id", UUID(as_uuid=True), sa.ForeignKey("data_instances.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id"), nullable=False, index=True),
        sa.Column("collection_id", UUID(as_uuid=True), sa.ForeignKey("image_collections.id"), nullable=True),
        sa.Column("bbox_class_id", UUID(as_uuid=True), sa.ForeignKey("bounding_box_classes.id"), nullable=False),
        sa.Column("created_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("x_min", sa.Float, nullable=False),
        sa.Column("y_min", sa.Float, nullable=False),
        sa.Column("x_max", sa.Float, nullable=False),
        sa.Column("y_max", sa.Float, nullable=False),
        sa.Column("image_width", sa.Integer, nullable=False),
        sa.Column("image_height", sa.Integer, nullable=False),
        sa.Column("review_status", sa.String(20), nullable=False, server_default="pending", index=True),
        sa.Column("reviewed_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_comment", sa.Text, nullable=True),
        sa.Column("origin", sa.String(20), nullable=False, server_default="manual"),
        sa.Column("original_annotation_id", UUID(as_uuid=True), sa.ForeignKey("user_annotations.id"), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    # -- image_reviews --
    op.create_table(
        "image_reviews",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("collection_id", UUID(as_uuid=True), sa.ForeignKey("image_collections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("image_id", UUID(as_uuid=True), sa.ForeignKey("data_instances.id"), nullable=False),
        sa.Column("reviewer_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("collection_id", "image_id", name="uq_image_review_collection_image"),
    )

    # -- add collection_id to image_classes --
    op.add_column(
        "image_classes",
        sa.Column("collection_id", UUID(as_uuid=True), sa.ForeignKey("image_collections.id"), nullable=True),
    )


def downgrade():
    op.drop_column("image_classes", "collection_id")
    op.drop_table("image_reviews")
    op.drop_table("user_annotations")
    op.drop_table("bounding_box_classes")
    op.drop_table("collection_memberships")
    op.drop_table("image_collections")
    op.drop_index("ix_audit_created", table_name="audit_events")
    op.drop_index("ix_audit_project", table_name="audit_events")
    op.drop_index("ix_audit_entity", table_name="audit_events")
    op.drop_table("audit_events")
