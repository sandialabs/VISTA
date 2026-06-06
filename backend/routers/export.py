import uuid
import io
import json
import logging
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as _func

from core import models, schemas
from core.database import get_db
from core.group_auth_helper import is_user_in_group
from utils.dependencies import get_current_user
from utils.crud.user_annotations import list_annotations_for_project
import utils.crud as crud

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Export"])


@router.get("/projects/{project_id}/export-excel")
async def export_project_excel(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: schemas.User = Depends(get_current_user),
):
    """
    Export all project image data as a Microsoft Excel (.xlsx) file.

    Each image corresponds to one row. Columns are dynamic:
    - Filename (always first)
    - One column per unique metadata key found across all project images
    - Review Status, Reviewer, Review Date (most recent review for the image)
    - Image Classes (derived from classifications)
    - Comment (derived from comments)
    """
    # Verify project exists and user has access
    db_project = await crud.get_project(db=db, project_id=project_id)
    if db_project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    if not is_user_in_group(current_user.email, db_project.meta_group_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User does not have access to project '{project_id}'.",
        )

    # Fetch all non-deleted images for the project
    result = await db.execute(
        select(models.DataInstance)
        .where(models.DataInstance.project_id == project_id)
        .where(models.DataInstance.deleted_at.is_(None))
        .order_by(models.DataInstance.created_at.asc())
    )
    images = result.scalars().all()
    image_ids = [img.id for img in images]

    # Build a class_id -> class_name lookup
    project_classes = await crud.get_image_classes_for_project(db, project_id)
    class_lookup = {str(c.id): c.name for c in project_classes}

    # Bulk-fetch all classifications for project images (avoids N+1 queries)
    classifications_by_image: dict[str, list] = defaultdict(list)
    if image_ids:
        cls_result = await db.execute(
            select(models.ImageClassification)
            .where(models.ImageClassification.image_id.in_(image_ids))
        )
        for c in cls_result.scalars().all():
            classifications_by_image[str(c.image_id)].append(c)

    # Bulk-fetch all comments for project images (avoids N+1 queries)
    comments_by_image: dict[str, list] = defaultdict(list)
    if image_ids:
        cmt_result = await db.execute(
            select(models.ImageComment)
            .where(models.ImageComment.image_id.in_(image_ids))
            .order_by(models.ImageComment.created_at.asc())
        )
        for c in cmt_result.scalars().all():
            comments_by_image[str(c.image_id)].append(c)

    # Bulk-fetch all user annotations for the project
    all_annotations = await list_annotations_for_project(db=db, project_id=project_id)
    annotations_by_image: dict[str, list] = defaultdict(list)
    bbox_class_lookup: dict[str, str] = {}
    for ann in all_annotations:
        annotations_by_image[str(ann.image_id)].append(ann)
        if ann.bbox_class and str(ann.bbox_class_id) not in bbox_class_lookup:
            bbox_class_lookup[str(ann.bbox_class_id)] = ann.bbox_class.name

    # Collect unique author IDs for batch user lookup
    author_ids = set()
    for comments in comments_by_image.values():
        for c in comments:
            if c.author_id:
                author_ids.add(c.author_id)
    for img in images:
        if img.uploader_id:
            author_ids.add(img.uploader_id)

    # Bulk-fetch the most recent review per image (status, reviewer_id, created_at)
    latest_review_by_image: dict[str, models.ImageReview] = {}
    if image_ids:
        latest_review_subq = (
            select(
                models.ImageReview.image_id,
                models.ImageReview.status,
                models.ImageReview.reviewer_id,
                models.ImageReview.created_at,
                _func.row_number().over(
                    partition_by=models.ImageReview.image_id,
                    order_by=models.ImageReview.created_at.desc(),
                ).label("rn"),
            )
            .where(models.ImageReview.image_id.in_(image_ids))
            .subquery()
        )
        rev_result = await db.execute(
            select(
                latest_review_subq.c.image_id,
                latest_review_subq.c.status,
                latest_review_subq.c.reviewer_id,
                latest_review_subq.c.created_at,
            ).where(latest_review_subq.c.rn == 1)
        )
        for row in rev_result:
            latest_review_by_image[str(row.image_id)] = row
            if row.reviewer_id:
                author_ids.add(row.reviewer_id)

    # Batch-fetch all referenced users
    user_cache: dict[str, models.User] = {}
    if author_ids:
        user_result = await db.execute(
            select(models.User)
            .where(models.User.id.in_(list(author_ids)))
        )
        for u in user_result.scalars().all():
            user_cache[str(u.id)] = u

    def get_user_display(user_id) -> str:
        if user_id is None:
            return ""
        user = user_cache.get(str(user_id))
        if user is None:
            return ""
        return user.username or user.email or ""

    # Collect all unique metadata keys across all images (in order of first appearance).
    # The "measurements" key stores internal pixel-measurement overlays and is excluded.
    _EXCLUDED_META_KEYS = {"measurements"}
    all_meta_keys: list[str] = []
    seen_keys: set[str] = set()
    for image in images:
        for key in (image.metadata_json or {}).keys():
            if key not in seen_keys and key not in _EXCLUDED_META_KEYS:
                seen_keys.add(key)
                all_meta_keys.append(key)

    # Build rows from the bulk-fetched data
    rows = []
    for image in images:
        meta = image.metadata_json or {}

        # Classifications
        class_names = []
        for c in classifications_by_image.get(str(image.id), []):
            name = class_lookup.get(str(c.class_id), "Unknown")
            class_names.append(name)

        # Comments
        comment_texts = []
        for c in comments_by_image.get(str(image.id), []):
            author = get_user_display(c.author_id)
            prefix = f"[{author}] " if author else ""
            comment_texts.append(f"{prefix}{c.text}")

        row: dict[str, str] = {"filename": image.filename or ""}
        for key in all_meta_keys:
            val = meta.get(key)
            if val is None:
                row[key] = ""
            elif isinstance(val, (dict, list)):
                row[key] = json.dumps(val)
            else:
                row[key] = str(val).strip()

        # Review fields from the most recent review
        review = latest_review_by_image.get(str(image.id))
        if review:
            row["review_status"] = review.status or ""
            row["reviewer"] = get_user_display(review.reviewer_id)
            if review.created_at:
                dt = review.created_at
                row["review_date"] = dt.strftime("%Y-%m-%d %H:%M UTC")
            else:
                row["review_date"] = ""
        else:
            row["review_status"] = ""
            row["reviewer"] = ""
            row["review_date"] = ""

        row["image_classes"] = ", ".join(class_names) if class_names else ""
        row["comment"] = " | ".join(comment_texts) if comment_texts else ""

        # Annotations summary
        img_annotations = annotations_by_image.get(str(image.id), [])
        if img_annotations:
            ann_parts = []
            for ann in img_annotations:
                cls_name = bbox_class_lookup.get(str(ann.bbox_class_id), "Unknown")
                coords = (
                    f"[{ann.bbox_x_min:.0f},{ann.bbox_y_min:.0f},"
                    f"{ann.bbox_x_max:.0f},{ann.bbox_y_max:.0f}]"
                )
                part = f"{cls_name} {coords}"
                if ann.notes:
                    part += f" ({ann.notes})"
                ann_parts.append(part)
            row["annotations"] = " | ".join(ann_parts)
            row["annotation_count"] = str(len(img_annotations))
        else:
            row["annotations"] = ""
            row["annotation_count"] = "0"

        rows.append(row)

    # Generate Excel workbook
    wb = _build_workbook(db_project.name, rows, all_meta_keys)

    # Stream response
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    safe_name = "".join(
        c if c.isalnum() or c in (" ", "-", "_") else "_"
        for c in db_project.name
    ).strip()
    filename = f"{safe_name}_export.xlsx"

    logger.info(
        "Excel export generated for project",
        extra={
            "row_count": len(rows),
        },
    )

    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


def _build_workbook(project_name: str, rows: list[dict], meta_keys: list[str]):
    """Build an openpyxl Workbook from the collected row data.

    Columns are dynamic:
    - Filename (always first)
    - One column per unique metadata key
    - Review Status, Reviewer, Review Date
    - Image Classes
    - Comment
    """
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "Image Data"

    # Dynamic column definitions: (header_label, width)
    columns = [("Filename", 35)]
    for key in meta_keys:
        columns.append((key, 20))
    columns.append(("Review Status", 20))
    columns.append(("Reviewer", 25))
    columns.append(("Review Date", 22))
    columns.append(("Image Classes", 30))
    columns.append(("Comment", 50))
    columns.append(("Annotation Count", 18))
    columns.append(("Annotations", 60))

    # The dict keys used to retrieve values from each row
    row_keys = (
        ["filename"]
        + list(meta_keys)
        + ["review_status", "reviewer", "review_date", "image_classes", "comment",
           "annotation_count", "annotations"]
    )

    # Header styling
    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="2F5496", end_color="2F5496", fill_type="solid")
    header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    thin_border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin"),
    )

    # Characters that trigger formula evaluation in Excel
    _FORMULA_CHARS = frozenset("=+-@")

    # Write headers
    for col_idx, (header, width) in enumerate(columns, start=1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment
        cell.border = thin_border
        if isinstance(header, str) and header and header[0] in _FORMULA_CHARS:
            cell.quotePrefix = True
        ws.column_dimensions[cell.column_letter].width = width

    # Data styling
    data_alignment = Alignment(vertical="top", wrap_text=True)
    alt_fill = PatternFill(start_color="F2F2F2", end_color="F2F2F2", fill_type="solid")

    for row_idx, row_data in enumerate(rows, start=2):
        for col_idx, key in enumerate(row_keys, start=1):
            value = row_data.get(key, "") or ""
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            cell.alignment = data_alignment
            # Prevent formula injection: values starting with formula characters
            # are marked as text-prefixed so Excel does not evaluate them.
            if isinstance(value, str) and value and value[0] in _FORMULA_CHARS:
                cell.quotePrefix = True
            cell.border = thin_border

            # Alternate row shading
            if row_idx % 2 == 0:
                cell.fill = alt_fill

    # Freeze the header row
    ws.freeze_panes = "A2"

    # Add autofilter
    if rows and columns:
        ws.auto_filter.ref = f"A1:{get_column_letter(len(columns))}{len(rows) + 1}"

    return wb
