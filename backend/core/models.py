import uuid
from sqlalchemy import Column, String, Text, ForeignKey, DateTime, JSON, BigInteger, Boolean, UniqueConstraint, Numeric, Integer, Float
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base

class User(Base):
    __tablename__ = "users"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    username = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    uploaded_images = relationship("DataInstance", back_populates="uploader", foreign_keys="DataInstance.uploader_id")
    comments = relationship("ImageComment", back_populates="author")
    classifications = relationship("ImageClassification", back_populates="created_by")
    api_keys = relationship("ApiKey", back_populates="user")

class Project(Base):
    __tablename__ = "projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    meta_group_id = Column(String(255), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    images = relationship("DataInstance", back_populates="project", cascade="all, delete-orphan")
    image_classes = relationship("ImageClass", back_populates="project", cascade="all, delete-orphan")
    project_metadata = relationship("ProjectMetadata", back_populates="project", cascade="all, delete-orphan")

class DataInstance(Base):
    __tablename__ = "data_instances"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    filename = Column(String(255), nullable=False)
    object_storage_key = Column(String(1024), nullable=False, unique=True)
    content_type = Column(String(100), nullable=True)
    size_bytes = Column(BigInteger, nullable=True)
    metadata_json = Column("metadata", JSON, nullable=True)  # Clear naming to avoid confusion
    # Keep the original column for backward compatibility, but add a new foreign key
    uploaded_by_user_id = Column(String(255), nullable=False)
    uploader_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Deletion / retention fields
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    deleted_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    deletion_reason = Column(Text, nullable=True)
    pending_hard_delete_at = Column(DateTime(timezone=True), nullable=True, index=True)
    hard_deleted_at = Column(DateTime(timezone=True), nullable=True)
    hard_deleted_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    storage_deleted = Column(Boolean, nullable=False, server_default='false')

    # Relationships
    project = relationship("Project", back_populates="images")
    uploader = relationship("User", back_populates="uploaded_images", foreign_keys=[uploader_id])
    comments = relationship("ImageComment", back_populates="image", cascade="all, delete-orphan")
    classifications = relationship("ImageClassification", back_populates="image", cascade="all, delete-orphan")
    ml_analyses = relationship("MLAnalysis", back_populates="image", cascade="all, delete-orphan")


class ImageDeletionEvent(Base):
    __tablename__ = "image_deletion_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    image_id = Column(UUID(as_uuid=True), ForeignKey("data_instances.id"), nullable=False, index=True)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True)
    actor_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    action = Column(String(32), nullable=False)  # soft_delete, force_delete, restore, hard_delete_job
    reason = Column(Text, nullable=True)
    storage_deleted = Column(Boolean, nullable=False, server_default='false')
    previous_state = Column(JSON, nullable=True)
    at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    # Relationships (optional, not eagerly loaded to avoid overhead)
    # image = relationship("DataInstance")
    # project = relationship("Project")
    # actor = relationship("User")

class ImageClass(Base):
    __tablename__ = "image_classes"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    project = relationship("Project", back_populates="image_classes")
    classifications = relationship("ImageClassification", back_populates="image_class", cascade="all, delete-orphan")

class ImageClassification(Base):
    __tablename__ = "image_classifications"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    image_id = Column(UUID(as_uuid=True), ForeignKey("data_instances.id"), nullable=False)
    class_id = Column(UUID(as_uuid=True), ForeignKey("image_classes.id"), nullable=False)
    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    image = relationship("DataInstance", back_populates="classifications")
    image_class = relationship("ImageClass", back_populates="classifications")
    created_by = relationship("User", back_populates="classifications")

class ImageComment(Base):
    __tablename__ = "image_comments"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    image_id = Column(UUID(as_uuid=True), ForeignKey("data_instances.id"), nullable=False)
    author_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    image = relationship("DataInstance", back_populates="comments")
    author = relationship("User", back_populates="comments")

class ProjectMetadata(Base):
    __tablename__ = "project_metadata"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    key = Column(String(255), nullable=False)
    value = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    project = relationship("Project", back_populates="project_metadata")
    
    # Add a unique constraint for project_id and key
    __table_args__ = (
        # Create a unique constraint on project_id and key
        # This ensures each project can only have one entry for each metadata key
        UniqueConstraint('project_id', 'key', name='uix_project_metadata_project_id_key'),
    )

class ApiKey(Base):
    __tablename__ = "api_keys"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    key_hash = Column(String(255), nullable=False, unique=True, index=True)
    name = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="api_keys")


class MLAnalysis(Base):
    """Represents one ML analysis job for a given image and model."""
    __tablename__ = "ml_analyses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    image_id = Column(UUID(as_uuid=True), ForeignKey("data_instances.id", ondelete="CASCADE"), nullable=False, index=True)
    model_name = Column(String(255), nullable=False, index=True)
    model_version = Column(String(100), nullable=False)
    status = Column(String(40), nullable=False, index=True, default="queued")  # queued, processing, completed, failed
    error_message = Column(Text, nullable=True)
    parameters = Column(JSON, nullable=True)
    provenance = Column(JSON, nullable=True)
    requested_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    external_job_id = Column(String(255), nullable=True, unique=True)
    priority = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    image = relationship("DataInstance", back_populates="ml_analyses")
    requested_by = relationship("User")
    annotations = relationship("MLAnnotation", back_populates="analysis", cascade="all, delete-orphan")


class MLAnnotation(Base):
    """Individual annotation output for an analysis (box, classification, heatmap ref, etc.)."""
    __tablename__ = "ml_annotations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    analysis_id = Column(UUID(as_uuid=True), ForeignKey("ml_analyses.id", ondelete="CASCADE"), nullable=False, index=True)
    annotation_type = Column(String(50), nullable=False, index=True)  # classification, bounding_box, heatmap, segmentation
    class_name = Column(String(255), nullable=True)
    confidence = Column(Float, nullable=True)  # Confidence score 0.0-1.0
    data = Column(JSON, nullable=False)  # dynamic payload: coordinates, arrays, etc.
    storage_path = Column(String(1024), nullable=True)  # pointer to artifact in object storage
    ordering = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    analysis = relationship("MLAnalysis", back_populates="annotations")


