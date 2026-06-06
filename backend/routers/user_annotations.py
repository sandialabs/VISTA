import uuid
import io
import zipfile
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

from core import schemas
from core.database import get_db
from utils.dependencies import (
    get_current_user, get_user_context, UserContext,
    get_image_or_403, get_project_or_403,
)
from utils.crud.user_annotations import (
    create_user_annotation, get_user_annotation, list_annotations_for_image,
    list_annotations_for_project, update_user_annotation, delete_user_annotation,
)
from utils.crud.bbox_classes import get_bbox_class

router = APIRouter(tags=["User Annotations"])


@router.post(
    "/images/{image_id}/user-annotations",
    response_model=schemas.UserAnnotation,
    status_code=status.HTTP_201_CREATED,
)
async def create_annotation(
    image_id: uuid.UUID,
    annotation: schemas.UserAnnotationCreate,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    db_image = await get_image_or_403(image_id, db, user_context.user)
    # Validate bbox class belongs to the same project
    db_class = await get_bbox_class(db, annotation.bbox_class_id)
    if not db_class or db_class.project_id != db_image.project_id:
        raise HTTPException(
            status_code=400,
            detail="BBox class not found or does not belong to this project",
        )
    return await create_user_annotation(
        db=db, image_id=image_id, project_id=db_image.project_id,
        annotation_data=annotation, user_id=user_context.id,
        created_by=user_context.email,
    )


@router.get(
    "/images/{image_id}/user-annotations",
    response_model=List[schemas.UserAnnotationWithDetails],
)
async def list_image_annotations(
    image_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await get_image_or_403(image_id, db, current_user)
    return await list_annotations_for_image(db=db, image_id=image_id)


@router.get(
    "/projects/{project_id}/user-annotations",
    response_model=List[schemas.UserAnnotation],
)
async def list_project_annotations(
    project_id: uuid.UUID,
    class_id: Optional[uuid.UUID] = Query(None),
    user_id: Optional[uuid.UUID] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(10000, ge=1, le=50000),
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    await get_project_or_403(project_id, db, current_user)
    return await list_annotations_for_project(
        db=db, project_id=project_id,
        class_id=class_id, user_id=user_id,
        skip=skip, limit=limit,
    )


@router.get("/projects/{project_id}/user-annotations/export")
async def export_annotations(
    project_id: uuid.UUID,
    format: str = Query("coco", pattern="^(coco|yolo)$"),
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """Export user annotations in COCO or YOLO format."""
    project = await get_project_or_403(project_id, db, current_user)
    annotations = await list_annotations_for_project(db=db, project_id=project_id)

    if format == "coco":
        return _build_coco_export(annotations, project)
    else:
        return _build_yolo_export(annotations, project)


def _build_coco_export(annotations, project):
    images_map = {}
    categories_map = {}
    coco_annotations = []

    for idx, ann in enumerate(annotations):
        img_id_str = str(ann.image_id)
        if img_id_str not in images_map:
            images_map[img_id_str] = {
                "id": len(images_map) + 1,
                "width": ann.image_width,
                "height": ann.image_height,
                "file_name": img_id_str,
            }

        cls_id_str = str(ann.bbox_class_id)
        if cls_id_str not in categories_map:
            categories_map[cls_id_str] = {
                "id": len(categories_map) + 1,
                "name": ann.bbox_class.name if ann.bbox_class else cls_id_str,
            }

        x = ann.bbox_x_min
        y = ann.bbox_y_min
        w = ann.bbox_x_max - ann.bbox_x_min
        h = ann.bbox_y_max - ann.bbox_y_min

        coco_annotations.append({
            "id": idx + 1,
            "image_id": images_map[img_id_str]["id"],
            "category_id": categories_map[cls_id_str]["id"],
            "bbox": [x, y, w, h],
            "area": w * h,
            "iscrowd": 0,
        })

    coco = {
        "images": list(images_map.values()),
        "annotations": coco_annotations,
        "categories": list(categories_map.values()),
    }
    return JSONResponse(content=coco)


def _build_yolo_export(annotations, project):
    # Group annotations by image
    by_image = {}
    class_ids = {}
    for ann in annotations:
        img_key = str(ann.image_id)
        if img_key not in by_image:
            by_image[img_key] = []
        cls_key = str(ann.bbox_class_id)
        if cls_key not in class_ids:
            class_ids[cls_key] = len(class_ids)
        by_image[img_key].append((ann, class_ids[cls_key]))

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # classes.txt
        sorted_classes = sorted(class_ids.items(), key=lambda x: x[1])
        class_lines = []
        for cls_key, cls_idx in sorted_classes:
            # Find name from first annotation with this class
            name = cls_key
            for ann in annotations:
                if str(ann.bbox_class_id) == cls_key and ann.bbox_class:
                    name = ann.bbox_class.name
                    break
            class_lines.append(name)
        zf.writestr("classes.txt", "\n".join(class_lines) + "\n")

        for img_key, img_anns in by_image.items():
            lines = []
            for ann, cls_idx in img_anns:
                iw = ann.image_width
                ih = ann.image_height
                x_center = ((ann.bbox_x_min + ann.bbox_x_max) / 2) / iw
                y_center = ((ann.bbox_y_min + ann.bbox_y_max) / 2) / ih
                w = (ann.bbox_x_max - ann.bbox_x_min) / iw
                h = (ann.bbox_y_max - ann.bbox_y_min) / ih
                lines.append(
                    f"{cls_idx} {x_center:.6f} {y_center:.6f} {w:.6f} {h:.6f}"
                )
            zf.writestr(f"labels/{img_key}.txt", "\n".join(lines) + "\n")

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename={str(project.id)}_yolo.zip",
        },
    )


@router.put(
    "/user-annotations/{annotation_id}",
    response_model=schemas.UserAnnotation,
)
async def update_annotation(
    annotation_id: uuid.UUID,
    update: schemas.UserAnnotationUpdate,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    db_ann = await get_user_annotation(db, annotation_id)
    if not db_ann:
        raise HTTPException(status_code=404, detail="Annotation not found")
    await get_image_or_403(db_ann.image_id, db, user_context.user)

    update_dict = update.model_dump(exclude_unset=True)
    if not update_dict:
        raise HTTPException(status_code=400, detail="No fields to update")

    # If changing class, validate it belongs to same project
    if "bbox_class_id" in update_dict and update_dict["bbox_class_id"]:
        db_class = await get_bbox_class(db, update_dict["bbox_class_id"])
        if not db_class or db_class.project_id != db_ann.project_id:
            raise HTTPException(
                status_code=400,
                detail="BBox class not found or wrong project",
            )

    result = await update_user_annotation(
        db=db, annotation_id=annotation_id, update_data=update_dict,
        user_id=user_context.id, updated_by=user_context.email,
    )
    return result


@router.delete(
    "/user-annotations/{annotation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_annotation(
    annotation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user_context: UserContext = Depends(get_user_context),
):
    db_ann = await get_user_annotation(db, annotation_id)
    if not db_ann:
        raise HTTPException(status_code=404, detail="Annotation not found")
    await get_image_or_403(db_ann.image_id, db, user_context.user)
    success = await delete_user_annotation(
        db=db, annotation_id=annotation_id, deleted_by=user_context.email,
    )
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete annotation")
    return None
