"""add bbox_classes, user_annotations, collections, collection_images, annotation_reviews, audit_events tables

Revision ID: 20260315_0004
Revises: 20260220_0003
Create Date: 2026-03-15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20260315_0004'
down_revision = '20260220_0003'
branch_labels = None
depends_on = None


def upgrade():
    # -- bbox_classes --
    op.create_table(
        'bbox_classes',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('project_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('projects.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('color', sa.String(7), nullable=False,
                  server_default='#FF9800'),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('project_id', 'name',
                            name='uix_bbox_class_project_name'),
    )
    op.create_index('ix_bbox_classes_project_id', 'bbox_classes',
                    ['project_id'])

    # -- user_annotations --
    op.create_table(
        'user_annotations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('image_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('data_instances.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('projects.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('bbox_class_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('bbox_classes.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('bbox_x_min', sa.Float(), nullable=False),
        sa.Column('bbox_y_min', sa.Float(), nullable=False),
        sa.Column('bbox_x_max', sa.Float(), nullable=False),
        sa.Column('bbox_y_max', sa.Float(), nullable=False),
        sa.Column('image_width', sa.Integer(), nullable=False),
        sa.Column('image_height', sa.Integer(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by_user_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id'),
                  nullable=False),
        sa.Column('updated_by_user_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id'),
                  nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_user_annotations_image_id', 'user_annotations',
                    ['image_id'])
    op.create_index('ix_user_annotations_project_id', 'user_annotations',
                    ['project_id'])
    op.create_index('ix_user_annotations_bbox_class_id', 'user_annotations',
                    ['bbox_class_id'])

    # -- collections --
    op.create_table(
        'collections',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('project_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('projects.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('is_locked', sa.Boolean(), nullable=False,
                  server_default=sa.text('false')),
        sa.Column('locked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('locked_by_user_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id'),
                  nullable=True),
        sa.Column('lock_reason', sa.Text(), nullable=True),
        sa.Column('review_required', sa.Boolean(), nullable=False,
                  server_default=sa.text('false')),
        sa.Column('created_by_user_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id'),
                  nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('project_id', 'name',
                            name='uix_collection_project_name'),
    )
    op.create_index('ix_collections_project_id', 'collections',
                    ['project_id'])

    # -- collection_images --
    op.create_table(
        'collection_images',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('collection_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('collections.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('image_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('data_instances.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('added_by_user_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id'),
                  nullable=False),
        sa.Column('added_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()')),
        sa.UniqueConstraint('collection_id', 'image_id',
                            name='uix_collection_image'),
    )
    op.create_index('ix_collection_images_collection_id', 'collection_images',
                    ['collection_id'])
    op.create_index('ix_collection_images_image_id', 'collection_images',
                    ['image_id'])

    # -- annotation_reviews --
    op.create_table(
        'annotation_reviews',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('annotation_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('user_annotations.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('annotation_type', sa.String(20), nullable=False),
        sa.Column('reviewer_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id'),
                  nullable=False),
        sa.Column('action', sa.String(50), nullable=False),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('edits_made', postgresql.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()')),
    )
    op.create_index('ix_annotation_reviews_annotation_id',
                    'annotation_reviews', ['annotation_id'])
    op.create_index('ix_annotation_reviews_action',
                    'annotation_reviews', ['action'])

    # -- audit_events --
    op.create_table(
        'audit_events',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('entity_type', sa.String(50), nullable=False),
        sa.Column('entity_id', postgresql.UUID(as_uuid=True),
                  nullable=False),
        sa.Column('action', sa.String(50), nullable=False),
        sa.Column('actor_user_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id'),
                  nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('projects.id'),
                  nullable=True),
        sa.Column('details', postgresql.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()')),
    )
    op.create_index('ix_audit_events_entity_type', 'audit_events',
                    ['entity_type'])
    op.create_index('ix_audit_events_entity_id', 'audit_events',
                    ['entity_id'])
    op.create_index('ix_audit_events_action', 'audit_events',
                    ['action'])
    op.create_index('ix_audit_events_project_id', 'audit_events',
                    ['project_id'])


def downgrade():
    # -- audit_events --
    op.drop_index('ix_audit_events_project_id', table_name='audit_events')
    op.drop_index('ix_audit_events_action', table_name='audit_events')
    op.drop_index('ix_audit_events_entity_id', table_name='audit_events')
    op.drop_index('ix_audit_events_entity_type', table_name='audit_events')
    op.drop_table('audit_events')

    # -- annotation_reviews --
    op.drop_index('ix_annotation_reviews_action',
                  table_name='annotation_reviews')
    op.drop_index('ix_annotation_reviews_annotation_id',
                  table_name='annotation_reviews')
    op.drop_table('annotation_reviews')

    # -- collection_images --
    op.drop_index('ix_collection_images_image_id',
                  table_name='collection_images')
    op.drop_index('ix_collection_images_collection_id',
                  table_name='collection_images')
    op.drop_table('collection_images')

    # -- collections --
    op.drop_index('ix_collections_project_id', table_name='collections')
    op.drop_table('collections')

    # -- user_annotations --
    op.drop_index('ix_user_annotations_bbox_class_id',
                  table_name='user_annotations')
    op.drop_index('ix_user_annotations_project_id',
                  table_name='user_annotations')
    op.drop_index('ix_user_annotations_image_id',
                  table_name='user_annotations')
    op.drop_table('user_annotations')

    # -- bbox_classes --
    op.drop_index('ix_bbox_classes_project_id', table_name='bbox_classes')
    op.drop_table('bbox_classes')
