def test_part_metadata_sources_association_combines_nsipro_metadata(client):
    headers = {"X-User-Id": "metadata-sources@example.com", "X-User-Groups": '["metadata-sources-group"]'}
    project_resp = client.post(
        "/api/projects/",
        json={
            "name": "Metadata sources project",
            "description": "Regression coverage for project-level metadata association",
            "meta_group_id": "metadata-sources-group",
            "project_type": "PT3",
        },
        headers=headers,
    )
    assert project_resp.status_code == 201, project_resp.text
    project_id = project_resp.json()["id"]

    part_resp = client.post(
        f"/api/projects/{project_id}/parts",
        json={
            "serial_number": "SN-PT3-001",
            "display_name": "PT3 assigned part",
            "metadata": {
                "source_images": [
                    {"filename": "slice-001.png", "image_id": None, "side": "axial", "modality": "ct", "overlay": False}
                ]
            },
        },
        headers=headers,
    )
    assert part_resp.status_code == 201, part_resp.text
    part_id = part_resp.json()["id"]

    metadata_resp = client.post(
        f"/api/projects/{project_id}/metadata",
        json={
            "key": "associated_upload_metadata:sample.nsipro",
            "value": {
                "filename": "sample.nsipro",
                "file_type": "nsipro",
                "parser": "nsipro-key-value",
                "parser_id": "default",
                "metadata": {
                    "capture": {
                        "operator": "alice",
                        "scanner": "CT-9",
                    }
                },
            },
        },
        headers=headers,
    )
    assert metadata_resp.status_code == 201, metadata_resp.text

    update_resp = client.put(
        f"/api/projects/{project_id}/parts/{part_id}/metadata-sources",
        json={"metadata_source_keys": ["associated_upload_metadata:sample.nsipro"]},
        headers=headers,
    )
    assert update_resp.status_code == 200, update_resp.text
    metadata = update_resp.json()["metadata"]
    assert metadata["associated_metadata_refs"] == ["associated_upload_metadata:sample.nsipro"]
    assert metadata["nsipro_metadata"]["capture"]["operator"] == "alice"
    assert metadata["nsipro_metadata"]["capture"]["scanner"] == "CT-9"
    assert metadata["project_metadata_combined"]["capture"]["scanner"] == "CT-9"
    assert metadata["project_metadata_source_values"][0]["key"] == "associated_upload_metadata:sample.nsipro"
    assert metadata["nsipro_metadata_sources"][0]["key"] == "associated_upload_metadata:sample.nsipro"
