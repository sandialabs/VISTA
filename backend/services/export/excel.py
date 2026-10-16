"""Excel workbook helpers for project exports."""

from __future__ import annotations

import json
from collections import defaultdict

from sqlalchemy import func as _func
from sqlalchemy import select

from core import models
from repositories import image_classes as image_class_repository


async def collect_project_excel_rows(db, project_id) -> tuple[list[dict], list[str]]:
    """Collect one Excel export row per non-deleted project image."""
    result = await db.execute(
        select(models.DataInstance)
        .where(models.DataInstance.project_id == project_id)
        .where(models.DataInstance.deleted_at.is_(None))
        .order_by(models.DataInstance.created_at.asc())
    )
    images = result.scalars().all()
    image_ids = [img.id for img in images]

    project_classes = await image_class_repository.get_image_classes_for_project(
        db, project_id
    )
    class_lookup = {str(c.id): c.name for c in project_classes}

    classifications_by_image: dict[str, list] = defaultdict(list)
    if image_ids:
        cls_result = await db.execute(
            select(models.ImageClassification).where(
                models.ImageClassification.image_id.in_(image_ids)
            )
        )
        for classification in cls_result.scalars().all():
            classifications_by_image[str(classification.image_id)].append(
                classification
            )

    comments_by_image: dict[str, list] = defaultdict(list)
    if image_ids:
        cmt_result = await db.execute(
            select(models.ImageComment)
            .where(models.ImageComment.image_id.in_(image_ids))
            .order_by(models.ImageComment.created_at.asc())
        )
        for comment in cmt_result.scalars().all():
            comments_by_image[str(comment.image_id)].append(comment)

    author_ids = set()
    for comments in comments_by_image.values():
        for comment in comments:
            if comment.author_id:
                author_ids.add(comment.author_id)
    for image in images:
        if image.uploader_id:
            author_ids.add(image.uploader_id)

    latest_review_by_image: dict[str, models.ImageReview] = {}
    if image_ids:
        latest_review_subq = (
            select(
                models.ImageReview.image_id,
                models.ImageReview.status,
                models.ImageReview.reviewer_id,
                models.ImageReview.created_at,
                _func.row_number()
                .over(
                    partition_by=models.ImageReview.image_id,
                    order_by=models.ImageReview.created_at.desc(),
                )
                .label("rn"),
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

    user_cache: dict[str, models.User] = {}
    if author_ids:
        user_result = await db.execute(
            select(models.User).where(models.User.id.in_(list(author_ids)))
        )
        for user in user_result.scalars().all():
            user_cache[str(user.id)] = user

    def get_user_display(user_id) -> str:
        if user_id is None:
            return ""
        user = user_cache.get(str(user_id))
        if user is None:
            return ""
        return user.username or user.email or ""

    excluded_meta_keys = {"measurements"}
    all_meta_keys: list[str] = []
    seen_keys: set[str] = set()
    for image in images:
        for key in image.metadata_json or {}:
            if key not in seen_keys and key not in excluded_meta_keys:
                seen_keys.add(key)
                all_meta_keys.append(key)

    rows = []
    for image in images:
        meta = image.metadata_json or {}

        class_names = []
        for classification in classifications_by_image.get(str(image.id), []):
            name = class_lookup.get(str(classification.class_id), "Unknown")
            class_names.append(name)

        comment_texts = []
        for comment in comments_by_image.get(str(image.id), []):
            author = get_user_display(comment.author_id)
            prefix = f"[{author}] " if author else ""
            comment_texts.append(f"{prefix}{comment.text}")

        row: dict[str, str] = {"filename": image.filename or ""}
        for key in all_meta_keys:
            val = meta.get(key)
            if val is None:
                row[key] = ""
            elif isinstance(val, (dict, list)):
                row[key] = json.dumps(val)
            else:
                row[key] = str(val).strip()

        review = latest_review_by_image.get(str(image.id))
        if review:
            row["review_status"] = review.status or ""
            row["reviewer"] = get_user_display(review.reviewer_id)
            if review.created_at:
                row["review_date"] = review.created_at.strftime("%Y-%m-%d %H:%M UTC")
            else:
                row["review_date"] = ""
        else:
            row["review_status"] = ""
            row["reviewer"] = ""
            row["review_date"] = ""

        row["image_classes"] = ", ".join(class_names) if class_names else ""
        row["comment"] = " | ".join(comment_texts) if comment_texts else ""
        rows.append(row)

    return rows, all_meta_keys


def build_workbook(project_name: str, rows: list[dict], meta_keys: list[str]):
    """Build an openpyxl Workbook from the collected row data.

    Columns are dynamic:
    - Filename (always first)
    - One column per unique metadata key
    - Review Status, Reviewer, Review Date
    - Image Classes
    - Comment
    """
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
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

    # The dict keys used to retrieve values from each row
    row_keys = (
        ["filename"]
        + list(meta_keys)
        + ["review_status", "reviewer", "review_date", "image_classes", "comment"]
    )

    # Header styling
    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(
        start_color="2F5496", end_color="2F5496", fill_type="solid"
    )
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
