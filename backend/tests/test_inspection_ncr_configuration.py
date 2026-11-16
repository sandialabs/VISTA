"""Project configuration contracts for NCR code lists and UI section toggles."""

import pytest


def _headers(slug: str) -> dict:
    return {"X-User-Id": f"{slug}@example.com", "X-User-Groups": f'["{slug}"]'}


def _create_project(client, headers, group, project_type="PT2", name=None):
    resp = client.post(
        "/api/projects/",
        json={
            "name": name or f"NCR config {group}",
            "description": "NCR configuration test project",
            "meta_group_id": group,
            "project_type": project_type,
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _get_config(client, project_id, headers):
    resp = client.get(f"/api/projects/{project_id}/configuration", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["config"]


def _put_config(client, project_id, headers, config):
    return client.put(
        f"/api/projects/{project_id}/configuration",
        json={"config": config},
        headers=headers,
    )


NCR_CONFIG = {
    "failure_codes": [
        {"code": "FC-01", "description": "Porosity"},
        {"code": "FC-02", "description": "Crack"},
    ],
    "disposition_codes": [
        {"code": "UAI", "description": "Use as is"},
        {"code": "RWK", "description": "Rework"},
        {"code": "SCR", "description": "Scrap"},
    ],
}


def test_default_configuration_includes_empty_ncr_code_lists(client):
    headers = _headers("ncr-cfg-default")
    project_id = _create_project(client, headers, "ncr-cfg-default")
    config = _get_config(client, project_id, headers)
    assert config["ncr_configuration"] == {
        "failure_codes": [],
        "disposition_codes": [],
    }


def test_ncr_code_lists_survive_save_and_reload(client):
    headers = _headers("ncr-cfg-roundtrip")
    project_id = _create_project(client, headers, "ncr-cfg-roundtrip")
    config = _get_config(client, project_id, headers)
    config["ncr_configuration"] = NCR_CONFIG

    save = _put_config(client, project_id, headers, config)
    assert save.status_code == 200, save.text
    assert save.json()["config"]["ncr_configuration"] == NCR_CONFIG
    assert _get_config(client, project_id, headers)["ncr_configuration"] == NCR_CONFIG


def test_ncr_codes_are_trimmed_and_description_defaults_empty(client):
    headers = _headers("ncr-cfg-trim")
    project_id = _create_project(client, headers, "ncr-cfg-trim")
    config = _get_config(client, project_id, headers)
    config["ncr_configuration"] = {
        "failure_codes": [{"code": "  FC-9  ", "description": "  Burr "}],
        "disposition_codes": [{"code": "RWK"}],
    }
    save = _put_config(client, project_id, headers, config)
    assert save.status_code == 200, save.text
    saved = _get_config(client, project_id, headers)["ncr_configuration"]
    assert saved["failure_codes"] == [{"code": "FC-9", "description": "Burr"}]
    assert saved["disposition_codes"] == [{"code": "RWK", "description": ""}]


@pytest.mark.parametrize(
    "ncr_configuration",
    [
        {"failure_codes": [{"code": ""}], "disposition_codes": []},
        {"failure_codes": [{"code": "   "}], "disposition_codes": []},
        {"failure_codes": [{"code": "x" * 65}], "disposition_codes": []},
        {
            "failure_codes": [{"code": "FC-1", "description": "d" * 256}],
            "disposition_codes": [],
        },
        {
            "failure_codes": [{"code": "FC-1"}, {"code": "fc-1"}],
            "disposition_codes": [],
        },
        {
            "failure_codes": [],
            "disposition_codes": [{"code": "RWK"}, {"code": " rwk "}],
        },
        {"failure_codes": [{"description": "no code"}], "disposition_codes": []},
        {"failure_codes": "FC-1", "disposition_codes": []},
    ],
)
def test_invalid_ncr_code_lists_are_rejected_without_mutation(
    client, ncr_configuration
):
    headers = _headers("ncr-cfg-invalid")
    project_id = _create_project(client, headers, "ncr-cfg-invalid")
    config = _get_config(client, project_id, headers)
    config["ncr_configuration"] = NCR_CONFIG
    assert _put_config(client, project_id, headers, config).status_code == 200

    config["ncr_configuration"] = ncr_configuration
    resp = _put_config(client, project_id, headers, config)
    assert resp.status_code == 422, resp.text
    assert _get_config(client, project_id, headers)["ncr_configuration"] == NCR_CONFIG


def test_legacy_configuration_without_ncr_section_is_accepted(client):
    headers = _headers("ncr-cfg-legacy")
    project_id = _create_project(client, headers, "ncr-cfg-legacy")
    config = _get_config(client, project_id, headers)
    config.pop("ncr_configuration")
    resp = _put_config(client, project_id, headers, config)
    assert resp.status_code == 200, resp.text


def test_clone_copies_ncr_code_lists(client):
    headers = _headers("ncr-cfg-clone")
    source_id = _create_project(client, headers, "ncr-cfg-clone", name="Source")
    target_id = _create_project(client, headers, "ncr-cfg-clone", name="Target")
    source_config = _get_config(client, source_id, headers)
    source_config["ncr_configuration"] = NCR_CONFIG
    assert _put_config(client, source_id, headers, source_config).status_code == 200

    clone = client.post(
        f"/api/projects/{target_id}/configuration/clone",
        json={"source_project_id": source_id},
        headers=headers,
    )
    assert clone.status_code == 200, clone.text
    assert clone.json()["config"]["ncr_configuration"] == NCR_CONFIG
    assert _get_config(client, target_id, headers)["ncr_configuration"] == NCR_CONFIG


def test_clone_replaces_existing_target_ncr_code_lists(client):
    headers = _headers("ncr-cfg-clone-replace")
    source_id = _create_project(client, headers, "ncr-cfg-clone-replace", name="Source")
    target_id = _create_project(client, headers, "ncr-cfg-clone-replace", name="Target")
    source_config = _get_config(client, source_id, headers)
    source_config["ncr_configuration"] = NCR_CONFIG
    assert _put_config(client, source_id, headers, source_config).status_code == 200
    target_config = _get_config(client, target_id, headers)
    target_config["ncr_configuration"] = {
        "failure_codes": [{"code": "OLD", "description": "Old code"}],
        "disposition_codes": [],
    }
    assert _put_config(client, target_id, headers, target_config).status_code == 200

    clone = client.post(
        f"/api/projects/{target_id}/configuration/clone",
        json={"source_project_id": source_id},
        headers=headers,
    )
    assert clone.status_code == 200, clone.text
    assert _get_config(client, target_id, headers)["ncr_configuration"] == NCR_CONFIG


def test_ui_sections_survive_save_and_reload(client):
    """Regression: ui_sections used to be silently dropped by the backend schema."""
    headers = _headers("ncr-cfg-ui-sections")
    project_id = _create_project(client, headers, "ncr-cfg-ui-sections")
    config = _get_config(client, project_id, headers)
    ui_sections = {
        "main.inspection": True,
        "project_configuration.hotkeys": False,
        "project_configuration.ncr_configuration": False,
    }
    config["ui_sections"] = ui_sections
    save = _put_config(client, project_id, headers, config)
    assert save.status_code == 200, save.text
    assert save.json()["config"]["ui_sections"] == ui_sections
    assert _get_config(client, project_id, headers)["ui_sections"] == ui_sections


def test_clone_copies_ui_sections(client):
    headers = _headers("ncr-cfg-ui-clone")
    source_id = _create_project(client, headers, "ncr-cfg-ui-clone", name="Source")
    target_id = _create_project(client, headers, "ncr-cfg-ui-clone", name="Target")
    source_config = _get_config(client, source_id, headers)
    source_config["ui_sections"] = {"project_configuration.hotkeys": False}
    assert _put_config(client, source_id, headers, source_config).status_code == 200
    clone = client.post(
        f"/api/projects/{target_id}/configuration/clone",
        json={"source_project_id": source_id},
        headers=headers,
    )
    assert clone.status_code == 200, clone.text
    assert _get_config(client, target_id, headers)["ui_sections"] == {
        "project_configuration.hotkeys": False
    }


@pytest.mark.parametrize(
    "ui_sections",
    [
        {"main.inspection": "yes"},
        {"": True},
        {"k" * 129: True},
        ["main.inspection"],
    ],
)
def test_invalid_ui_sections_are_rejected(client, ui_sections):
    headers = _headers("ncr-cfg-ui-invalid")
    project_id = _create_project(client, headers, "ncr-cfg-ui-invalid")
    config = _get_config(client, project_id, headers)
    config["ui_sections"] = ui_sections
    resp = _put_config(client, project_id, headers, config)
    assert resp.status_code == 422, resp.text
