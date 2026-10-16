"""PDF helpers for project export reports."""

from __future__ import annotations

import re
import textwrap
from urllib.parse import quote


def build_simple_report_pdf(report_payload: dict) -> bytes:
    """Render the current concise report payload as a paginated PDF."""
    project = report_payload.get("project", {})
    summary = report_payload.get("summary", {})
    parts = report_payload.get("parts", [])
    if not isinstance(parts, list):
        parts = []

    part_width = 60
    result_width = 10
    include_reviewed = report_payload.get("schema_version") == 2
    reviewed_width = 8
    table_header = f"{'Part':<{part_width}} | {'Result':<{result_width}}"
    if include_reviewed:
        table_header += f" | {'Reviewed':<{reviewed_width}}"
    table_rule = "-" * len(table_header)
    table_lines_per_page = 40

    def _sanitize_text(value: object) -> str:
        raw = str(value if value is not None else "")
        printable = "".join(
            character if ord(character) >= 32 else " " for character in raw
        )
        escaped = []
        for character in printable:
            try:
                character.encode("latin-1")
                escaped.append(character)
            except UnicodeEncodeError:
                codepoint = ord(character)
                escaped.append(
                    f"\\u{codepoint:04x}"
                    if codepoint <= 0xFFFF
                    else f"\\U{codepoint:08x}"
                )
        return "".join(escaped)

    def _wrap_text(value: object, width: int) -> list[str]:
        sanitized = _sanitize_text(value)
        return textwrap.wrap(
            sanitized,
            width=width,
            replace_whitespace=True,
            drop_whitespace=True,
            break_long_words=True,
            break_on_hyphens=False,
        ) or [""]

    def _format_table_row(
        identifier_lines: list[str],
        inspection_result: str,
        reviewed: str | None,
    ) -> list[str]:
        formatted_rows = []
        for line_index, identifier_line in enumerate(identifier_lines):
            formatted_row = (
                f"{identifier_line:<{part_width}} | "
                f"{inspection_result if line_index == 0 else '':<{result_width}}"
            )
            if include_reviewed:
                formatted_row += (
                    f" | {reviewed if line_index == 0 else '':<{reviewed_width}}"
                )
            formatted_rows.append(formatted_row)
        return formatted_rows

    logical_table_rows = []
    for part in parts:
        row = part if isinstance(part, dict) else {}
        identifier_lines = _wrap_text(row.get("part_identifier", ""), part_width)
        inspection_result = _sanitize_text(row.get("inspection_result", "unreviewed"))[
            :result_width
        ]
        reviewed = (
            ("yes" if row.get("reviewed") is True else "no")
            if include_reviewed
            else None
        )
        logical_table_rows.append((identifier_lines, inspection_result, reviewed))

    paginated_rows: list[list[str]] = []
    current_page_rows: list[str] = []
    for identifier_lines, inspection_result, reviewed in logical_table_rows:
        if len(identifier_lines) <= table_lines_per_page:
            formatted_row = _format_table_row(
                identifier_lines, inspection_result, reviewed
            )
            if (
                current_page_rows
                and len(current_page_rows) + len(formatted_row) > table_lines_per_page
            ):
                paginated_rows.append(current_page_rows)
                current_page_rows = []
            current_page_rows.extend(formatted_row)
            continue

        if current_page_rows:
            paginated_rows.append(current_page_rows)
            current_page_rows = []
        for start in range(0, len(identifier_lines), table_lines_per_page):
            identifier_chunk = identifier_lines[start : start + table_lines_per_page]
            paginated_rows.append(
                _format_table_row(identifier_chunk, inspection_result, reviewed)
            )
    if current_page_rows:
        paginated_rows.append(current_page_rows)
    if not paginated_rows:
        paginated_rows = [["(no parts)"]]

    def _prefixed_lines(prefix: str, value: object) -> list[str]:
        available_width = max(1, len(table_header) - len(prefix))
        wrapped = _wrap_text(value, available_width)
        return [f"{prefix}{wrapped[0]}", *wrapped[1:]]

    page_count = len(paginated_rows)
    page_lines = []
    for page_index, rows in enumerate(paginated_rows, start=1):
        if page_index == 1:
            lines = [
                "VISTA Inspection Report",
                *_prefixed_lines("Project: ", project.get("name", "Unknown")),
                f"Project ID: {_sanitize_text(project.get('id', 'Unknown'))}",
                f"Project Type: {_sanitize_text(project.get('project_type', 'PT1'))}",
                f"Total Parts: {summary.get('total_parts', len(parts))}",
                f"Reviewed Parts: {summary.get('reviewed_parts', 0)}",
                f"Unreviewed Parts: {summary.get('unreviewed_parts', 0)}",
                "",
            ]
        else:
            lines = [
                "VISTA Inspection Report (continued)",
                *_prefixed_lines("Project: ", project.get("name", "Unknown")),
                "",
            ]
        lines.extend(
            [table_header, table_rule, *rows, "", f"Page {page_index} of {page_count}"]
        )
        page_lines.append(lines)

    def _encode_pdf_lines(content_lines: list[str]) -> bytes:
        safe_lines = [
            str(line).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            for line in content_lines
        ]
        text_lines = ["BT", "/F1 9 Tf", "54 756 Td", "12 TL"]
        for index, line in enumerate(safe_lines):
            if index > 0:
                text_lines.append("T*")
            text_lines.append(f"({line}) Tj")
        text_lines.append("ET")
        return "\n".join(text_lines).encode("latin-1", errors="replace")

    content_streams = [_encode_pdf_lines(lines) for lines in page_lines]
    page_object_ids = [4 + (index * 2) for index in range(page_count)]
    kids = " ".join(f"{object_id} 0 R" for object_id in page_object_ids)
    objects = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        (
            f"2 0 obj << /Type /Pages /Kids [{kids}] /Count {page_count} >> endobj\n"
        ).encode("ascii"),
        b"3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Courier >> endobj\n",
    ]
    for page_index, content_stream in enumerate(content_streams):
        page_object_id = page_object_ids[page_index]
        content_object_id = page_object_id + 1
        objects.append(
            (
                f"{page_object_id} 0 obj << /Type /Page /Parent 2 0 R "
                "/MediaBox [0 0 612 792] "
            ).encode("ascii")
            + (
                f"/Resources << /Font << /F1 3 0 R >> >> /Contents "
                f"{content_object_id} 0 R >> endobj\n"
            ).encode("ascii")
        )
        objects.append(
            (
                f"{content_object_id} 0 obj << /Length {len(content_stream)} >> "
                "stream\n"
            ).encode("ascii")
            + content_stream
            + b"\nendstream endobj\n"
        )

    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(pdf))
        pdf.extend(obj)
    xref_offset = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.extend(
        (
            f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF"
        ).encode("ascii")
    )
    return bytes(pdf)


def build_legacy_simple_report_pdf(report_payload: dict) -> bytes:
    """Render the pre-concise-schema report payload as a PDF."""
    project = report_payload.get("project", {})
    summary = report_payload.get("summary", {})
    dropped = summary.get("metadata_normalization", {}).get(
        "dropped_non_object_items", {}
    )
    assignments = report_payload.get("part_assignments", [])
    part_review_summary = report_payload.get("part_review_summary", [])
    image_mappings = report_payload.get("image_part_mappings", [])
    lines = [
        "VISTA Inspection Report",
        f"Project: {project.get('name', 'Unknown')}",
        f"Project ID: {project.get('id', 'Unknown')}",
        f"Project Type: {project.get('project_type', 'PT1')}",
        f"Total Images: {summary.get('total_images', 0)}",
        f"Total Batches: {summary.get('total_batches', 0)}",
        f"Total Parts: {summary.get('total_parts', 0)}",
        f"Reviewed Parts: {summary.get('reviewed_parts', 0)}",
        f"Unreviewed Parts: {summary.get('unreviewed_parts', 0)}",
        "Part Status Counts: "
        f"pass={summary.get('part_status_counts', {}).get('pass', 0)}, "
        f"reject={summary.get('part_status_counts', {}).get('reject', 0)}, "
        f"unreviewed={summary.get('part_status_counts', {}).get('unreviewed', 0)}",
        "Dropped Metadata Items:",
    ]
    for field, count in dropped.items():
        lines.append(f"- {field or 'unknown_field'}: {count}")
    lines.append("Part Status Summary:")
    for part_status in part_review_summary[:40]:
        lines.append(
            f"- {part_status.get('part_identifier', '')}: "
            f"{part_status.get('review_status', 'unreviewed')}"
        )
    lines.append("Part Pass/Fail Assignments:")
    for assignment in assignments[:20]:
        lines.append(
            f"- {assignment.get('part_identifier', '')}: "
            f"{assignment.get('pass_fail', '')} by "
            f"{assignment.get('username', '')} | "
            f"owner {assignment.get('batch_owner', '')} | "
            f"{assignment.get('assigned_at', '')}"
        )
    mapping_lines = [
        "VISTA Report Image-to-Part Mapping",
        f"Project: {project.get('name', 'Unknown')}",
    ]
    for mapping in image_mappings[:40]:
        mapping_lines.append(
            f"- {mapping.get('filename', '')} -> {mapping.get('part_identifier', '')}"
        )

    def encode_lines(content_lines):
        safe_lines = [
            str(line).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            for line in content_lines
        ]
        text_lines = ["BT", "/F1 10 Tf", "54 760 Td", "13 TL"]
        for index, line in enumerate(safe_lines):
            if index:
                text_lines.append("T*")
            text_lines.append(f"({line}) Tj")
        text_lines.append("ET")
        return "\n".join(text_lines).encode("latin-1", errors="replace")

    streams = [encode_lines(lines), encode_lines(mapping_lines)]
    objects = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        b"2 0 obj << /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >> endobj\n",
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n",
        b"4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
        b"5 0 obj << /Length "
        + str(len(streams[0])).encode("ascii")
        + b" >> stream\n"
        + streams[0]
        + b"\nendstream endobj\n",
        b"6 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >> endobj\n",
        b"7 0 obj << /Length "
        + str(len(streams[1])).encode("ascii")
        + b" >> stream\n"
        + streams[1]
        + b"\nendstream endobj\n",
    ]
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(pdf))
        pdf.extend(obj)
    xref_offset = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.extend(
        f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF".encode("ascii")
    )
    return bytes(pdf)


def report_content_disposition(
    project_name: object, report_stem: str = "report"
) -> str:
    """Build a Content-Disposition header value for a downloadable report."""
    raw_name = str(project_name or "project").strip() or "project"
    safe_name = (
        "".join(
            "_"
            if character in {"/", "\\"} or ord(character) < 32 or ord(character) == 127
            else character
            for character in raw_name
        ).strip(" .")
        or "project"
    )
    unicode_filename = f"{safe_name}-{report_stem}.pdf"

    ascii_stem = safe_name.encode("ascii", errors="replace").decode("ascii")
    ascii_stem = re.sub(r"[^A-Za-z0-9._ -]", "_", ascii_stem).strip(" .") or "project"
    ascii_stem = ascii_stem[:180].rstrip(" .") or "project"
    ascii_filename = f"{ascii_stem}-{report_stem}.pdf"
    encoded_filename = quote(unicode_filename, safe="!#$&+-.^_`|~")
    return (
        f'attachment; filename="{ascii_filename}"; '
        f"filename*=UTF-8''{encoded_filename}"
    )
