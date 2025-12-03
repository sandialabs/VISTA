"""initial schema

Revision ID: 20250930_0001_initial
Revises: 
Create Date: 2025-09-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid

# revision identifiers, used by Alembic.
revision = '20250930_0001_initial'
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    # users
    op.create_table('users',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('username', sa.String(length=255), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_users_email', 'users', ['email'], unique=True)

    # projects
    op.create_table('projects',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('meta_group_id', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_projects_name', 'projects', ['name'])
    op.create_index('ix_projects_meta_group_id', 'projects', ['meta_group_id'])

    # data_instances
    op.create_table('data_instances',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('object_storage_key', sa.String(length=1024), nullable=False),
        sa.Column('content_type', sa.String(length=100), nullable=True),
        sa.Column('size_bytes', sa.BigInteger(), nullable=True),
        sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('uploaded_by_user_id', sa.String(length=255), nullable=False),
        sa.Column('uploader_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_by_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('deletion_reason', sa.Text(), nullable=True),
        sa.Column('pending_hard_delete_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('hard_deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('hard_deleted_by_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('storage_deleted', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.create_index('ix_data_instances_project_id', 'data_instances', ['project_id'])
    op.create_index('ix_data_instances_deleted_at', 'data_instances', ['deleted_at'])
    op.create_unique_constraint('uq_data_instances_object_storage_key', 'data_instances', ['object_storage_key'])

    # image_deletion_events
    op.create_table('image_deletion_events',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('image_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('data_instances.id'), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('projects.id'), nullable=False),
        sa.Column('actor_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('action', sa.String(length=32), nullable=False),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('storage_deleted', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('previous_state', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
    )
    op.create_index('ix_image_deletion_events_image_id', 'image_deletion_events', ['image_id'])
    op.create_index('ix_image_deletion_events_project_id', 'image_deletion_events', ['project_id'])
    op.create_index('ix_image_deletion_events_at', 'image_deletion_events', ['at'])

    # image_classes
    op.create_table('image_classes',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('projects.id'), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_image_classes_project_id', 'image_classes', ['project_id'])

    # image_classifications
    op.create_table('image_classifications',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('image_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('data_instances.id'), nullable=False),
        sa.Column('class_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('image_classes.id'), nullable=False),
        sa.Column('created_by_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_image_classifications_image_id', 'image_classifications', ['image_id'])

    # image_comments
    op.create_table('image_comments',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('image_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('data_instances.id'), nullable=False),
        sa.Column('author_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_image_comments_image_id', 'image_comments', ['image_id'])

    # project_metadata
    op.create_table('project_metadata',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('projects.id'), nullable=False),
        sa.Column('key', sa.String(length=255), nullable=False),
        sa.Column('value', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_unique_constraint('uix_project_metadata_project_id_key', 'project_metadata', ['project_id','key'])

    # api_keys
    op.create_table('api_keys',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('key_hash', sa.String(length=255), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_api_keys_key_hash', 'api_keys', ['key_hash'])

    # ml_analyses
    op.create_table('ml_analyses',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('image_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('data_instances.id', ondelete='CASCADE'), nullable=False),
        sa.Column('model_name', sa.String(length=255), nullable=False),
        sa.Column('model_version', sa.String(length=100), nullable=False),
        sa.Column('status', sa.String(length=40), nullable=False, server_default='queued'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('parameters', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('provenance', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('requested_by_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('external_job_id', sa.String(length=255), nullable=True),
        sa.Column('priority', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_ml_analyses_image_id', 'ml_analyses', ['image_id'])
    op.create_index('ix_ml_analyses_status', 'ml_analyses', ['status'])
    op.create_index('ix_ml_analyses_model_name', 'ml_analyses', ['model_name'])
    op.create_unique_constraint('uq_ml_analyses_external_job_id', 'ml_analyses', ['external_job_id'])

    # ml_annotations
    op.create_table('ml_annotations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('analysis_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('ml_analyses.id', ondelete='CASCADE'), nullable=False),
        sa.Column('annotation_type', sa.String(length=50), nullable=False),
        sa.Column('class_name', sa.String(length=255), nullable=True),
        sa.Column('confidence', sa.Numeric(5,4), nullable=True),
        sa.Column('data', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('storage_path', sa.String(length=1024), nullable=True),
        sa.Column('ordering', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
    )
    op.create_index('ix_ml_annotations_analysis_id', 'ml_annotations', ['analysis_id'])
    op.create_index('ix_ml_annotations_annotation_type', 'ml_annotations', ['annotation_type'])

def downgrade():
    op.drop_table('ml_annotations')
    op.drop_table('ml_analyses')
    op.drop_table('api_keys')
    op.drop_table('project_metadata')
    op.drop_table('image_comments')
    op.drop_table('image_classifications')
    op.drop_table('image_classes')
    op.drop_table('image_deletion_events')
    op.drop_table('data_instances')
    op.drop_table('projects')
    op.drop_table('users')
