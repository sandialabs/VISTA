from pathlib import Path

from backend.metadata.nsipro_parsers import parse_nsipro_text


def test_parse_nsipro_text_decodes_xml_fields_attributes_text_and_repeated_elements():
    xml = """<?xml version="1.0" encoding="UTF-8"?>
<NSIProMetadata schema="pt3" version="2">
  <Acquisition operator="alice" valid="true">
    <Exposure unit="ms">12.5</Exposure>
    <Mode>brightfield</Mode>
  </Acquisition>
  <Channel index="1"><Name>Brightfield</Name><Wavelength>550</Wavelength></Channel>
  <Channel index="2"><Name>DAPI</Name><Wavelength>405</Wavelength></Channel>
  <Notes>ready for review</Notes>
</NSIProMetadata>
"""

    assert parse_nsipro_text(xml, "scan.nsipro") == {
        "parser": "nsipro-xml",
        "parser_id": "default",
        "parser_version": "1.0.0",
        "parser_hash": "sha256:3295a8f571b23a6bb2a5ae1ef21e5500d39fdabf209ea122d7352f65d1b217df",
        "source_filename": "scan.nsipro",
        "warnings": [],
        "metadata": {
            "NSIProMetadata": {
                "@attributes": {"schema": "pt3", "version": 2},
                "Acquisition": {
                    "@attributes": {"operator": "alice", "valid": True},
                    "Exposure": {"@attributes": {"unit": "ms"}, "#text": 12.5},
                    "Mode": "brightfield",
                },
                "Channel": [
                    {"@attributes": {"index": 1}, "Name": "Brightfield", "Wavelength": 550},
                    {"@attributes": {"index": 2}, "Name": "DAPI", "Wavelength": 405},
                ],
                "Notes": "ready for review",
            }
        },
    }


def test_parse_nsipro_text_extracts_fields_from_pt3_sample_fixture():
    fixture_path = Path(__file__).resolve().parents[2] / "test/data/3D/geometric/PT3_GEOMETRIC_DUAL_LABEL.nsipro"
    result = parse_nsipro_text(fixture_path.read_text(encoding="utf-8"), fixture_path.name)

    assert result["parser"] == "nsipro-key-value"
    assert result["parser_id"] == "default"
    assert result["source_filename"] == "PT3_GEOMETRIC_DUAL_LABEL.nsipro"
    metadata = result["metadata"]
    assert metadata["Application"]["application_info"] == "NIS-Elements AR 5.30.00 (Build 1688)"
    assert metadata["Acquisition"]["acquisition_datetime"] == "2026-02-17T14:22:31Z"
    assert metadata["Microscope"]["objective_magnification"] == 20
    assert metadata["Camera"]["exposure_ms"] == 12.5
    assert metadata["Calibration"]["voxel_size_um"] == [2.5, 2.5, 5.0]
    assert metadata["Volume"]["slices"] == 64
    assert metadata["Stage"]["stage_x_um"] == 1024.25
    assert metadata["Channels"]["channel_1_name"] == "Brightfield"


def test_parse_nsipro_text_rejects_unsafe_xml_entity_declarations():
    xml = '<!DOCTYPE root [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root>&xxe;</root>'

    try:
        parse_nsipro_text(xml, "unsafe.nsipro")
    except ValueError as exc:
        assert "DOCTYPE or entity declarations" in str(exc)
    else:
        raise AssertionError("unsafe XML should not parse successfully")
