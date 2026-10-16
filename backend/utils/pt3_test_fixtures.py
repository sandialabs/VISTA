"""Server-owned allowlist for built-in PT3 test fixtures.

Persisted image metadata is untrusted.  Callers must resolve repository fixture
paths through this module rather than joining metadata-derived paths directly.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Final
from uuid import UUID

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
PT3_TEST_DATA_ROOT: Final[Path] = REPO_ROOT / "test" / "data" / "3D"
DEFAULT_PT3_FIXTURE_ID: Final[str] = "default"
NIST_COCR_FIXTURE_ID: Final[str] = "nist-cocr"


@dataclass(frozen=True)
class PT3FixtureFile:
    filename: str
    relative_path: str
    role: str
    dtype: str | None = None

    @property
    def path(self) -> Path:
        return PT3_TEST_DATA_ROOT / self.relative_path


@dataclass(frozen=True)
class PT3Fixture:
    fixture_id: str
    files: tuple[PT3FixtureFile, ...]

    def file_by_name(self, filename: str) -> PT3FixtureFile | None:
        return next((item for item in self.files if item.filename == filename), None)


_GEOMETRIC_FILES = tuple(
    PT3FixtureFile(
        filename=f"PT3_GEOMETRIC_DUAL_LABEL_Z{index:03d}.png",
        relative_path=f"geometric/PT3_GEOMETRIC_DUAL_LABEL_Z{index:03d}.png",
        role="base",
    )
    for index in range(64)
) + tuple(
    PT3FixtureFile(
        filename=f"PT3_GEOMETRIC_DUAL_LABEL_Z{index:03d}_overlay.png",
        relative_path=f"geometric/overlays/PT3_GEOMETRIC_DUAL_LABEL_Z{index:03d}_overlay.png",
        role="overlay",
    )
    for index in range(64)
)

_NIST_COCR_FILES = (
    PT3FixtureFile(
        filename="set1sample5raw_center_cylinder_uint16.npy",
        relative_path="nist_cocr/set1sample5raw_center_cylinder_uint16.npy",
        role="base",
        dtype="uint16",
    ),
    PT3FixtureFile(
        filename="set1sample5segmented_center_cylinder_uint8.npy",
        relative_path="nist_cocr/set1sample5segmented_center_cylinder_uint8.npy",
        role="overlay",
        dtype="uint8",
    ),
)

PT3_TEST_FIXTURES: Final[dict[str, PT3Fixture]] = {
    DEFAULT_PT3_FIXTURE_ID: PT3Fixture(DEFAULT_PT3_FIXTURE_ID, _GEOMETRIC_FILES),
    NIST_COCR_FIXTURE_ID: PT3Fixture(NIST_COCR_FIXTURE_ID, _NIST_COCR_FILES),
}


def get_pt3_test_fixture(fixture_id: str) -> PT3Fixture | None:
    """Return a fixture only when its public identifier is exactly allowlisted."""

    return PT3_TEST_FIXTURES.get(fixture_id)


def resolve_pt3_test_fixture_file(
    *,
    fixture_id: object,
    fixture_filename: object,
    image_filename: object,
    object_storage_key: object,
    project_id: UUID | str,
) -> Path | None:
    """Resolve an authoritative fixture record to a contained repository path.

    The default identifier may be absent only for backward compatibility with
    existing geometric records created before fixture identifiers were stored.
    Every other value, filename, and storage key must match the registry exactly.
    """

    normalized_fixture_id = (
        DEFAULT_PT3_FIXTURE_ID if fixture_id in (None, "") else fixture_id
    )
    if not isinstance(normalized_fixture_id, str):
        return None
    fixture = get_pt3_test_fixture(normalized_fixture_id)
    if (
        fixture is None
        or not isinstance(fixture_filename, str)
        or not isinstance(image_filename, str)
    ):
        return None
    if (
        fixture_filename != Path(fixture_filename).name
        or fixture_filename != image_filename
    ):
        return None
    file_spec = fixture.file_by_name(fixture_filename)
    if file_spec is None:
        return None
    expected_storage_key = f"{project_id}/test-data/{file_spec.filename}"
    if object_storage_key != expected_storage_key:
        return None

    fixture_root = PT3_TEST_DATA_ROOT.resolve()
    resolved_path = file_spec.path.resolve()
    try:
        resolved_path.relative_to(fixture_root)
    except ValueError:
        return None
    if not resolved_path.is_file():
        return None
    return resolved_path
