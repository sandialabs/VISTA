"""
CRUD operations package.

All functions are re-exported here for backward compatibility so existing code
using ``import utils.crud as crud`` continues to work unchanged.
"""

from ._common import _sanitize_log_value, log_db_operation, logger  # noqa: F401

from .ml import (  # noqa: F401
    create_ml_analysis,
    get_ml_analysis,
    get_ml_analysis_for_update,
    list_ml_analyses_for_image,
    count_ml_analyses_for_image,
    create_ml_annotation,
    list_ml_annotations,
    count_ml_annotations,
    bulk_insert_ml_annotations,
)

from .images import (  # noqa: F401
    get_data_instance,
    get_data_instance_for_update,
    get_image,
    get_data_instances_for_project,
    get_deleted_images_for_project,
    count_deleted_images_for_project,
    create_image_deletion_event,
    list_image_deletion_events,
    count_image_deletion_events,
    soft_delete_image,
    restore_image,
    mark_image_storage_deleted,
    create_data_instance,
)

from .reviews import (  # noqa: F401
    create_image_review,
    get_image_review,
    get_reviews_for_image,
    get_latest_review_for_image,
    delete_image_review,
    get_review_status_for_project,
    get_review_status_for_images,
)

from .projects import (  # noqa: F401
    get_user_by_email,
    get_user_by_id,
    create_user,
    update_user,
    get_project,
    get_projects_by_group_ids,
    get_all_projects,
    create_project,
    get_image_class,
    get_image_classes_for_project,
    create_image_class,
    update_image_class,
    delete_image_class,
    get_image_classification,
    get_classifications_for_image,
    create_image_classification,
    delete_image_classification,
    get_comment,
    get_comments_for_image,
    create_comment,
    update_comment,
    delete_comment,
    get_project_metadata,
    get_project_metadata_by_key,
    get_all_project_metadata,
    create_or_update_project_metadata,
    delete_project_metadata,
    delete_project_metadata_by_key,
    get_api_key_by_hash,
    get_api_keys_for_user,
    get_all_active_api_keys,
    create_api_key,
    update_api_key_last_used,
    deactivate_api_key,
)
