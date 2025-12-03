import uuid
import pytest
from fastapi.testclient import TestClient
from main import app
import os
import hmac, hashlib, time


def test_create_list_ml_analysis_flow(client):
    # Create project
    proj_resp = client.post("/api/projects/", json={
        "name": "Test Project",
        "description": "Desc",
        "meta_group_id": "data-scientists"
    })
    assert proj_resp.status_code == 201, proj_resp.text
    project = proj_resp.json()

    # Upload image (simplified using text file as image placeholder)
    files = {
        'file': ('test.png', b'\x89PNG\r\n', 'image/png')
    }
    data = { 'metadata': '{}'}
    img_resp = client.post(f"/api/projects/{project['id']}/images", files=files, data=data)
    assert img_resp.status_code == 201, img_resp.text
    image = img_resp.json()

    # Create analysis
    analysis_payload = {
        "image_id": image['id'],
        "model_name": "resnet50_classifier",
        "model_version": "1.0.0",
        "parameters": {"topk": 3}
    }
    a_resp = client.post(f"/api/images/{image['id']}/analyses", json=analysis_payload)
    assert a_resp.status_code == 201, a_resp.text
    analysis = a_resp.json()
    assert analysis['model_name'] == 'resnet50_classifier'
    assert analysis['status'] == 'queued'

    # List analyses
    list_resp = client.get(f"/api/images/{image['id']}/analyses")
    assert list_resp.status_code == 200
    data_list = list_resp.json()
    assert data_list['total'] == 1
    assert data_list['analyses'][0]['id'] == analysis['id']

    # Get single analysis detail
    detail_resp = client.get(f"/api/analyses/{analysis['id']}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail['id'] == analysis['id']
    assert detail['annotations'] == []


def test_annotations_list_and_limit_and_status_flow(client):
    # Create project
    proj_resp = client.post("/api/projects/", json={
        "name": "P2",
        "description": "Desc",
        "meta_group_id": "data-scientists"
    })
    assert proj_resp.status_code == 201
    project = proj_resp.json()

    # Upload image
    files = {'file': ('test2.png', b'\x89PNG\r\n', 'image/png')}
    img_resp = client.post(f"/api/projects/{project['id']}/images", files=files, data={'metadata': '{}'})
    assert img_resp.status_code == 201
    image = img_resp.json()

    # Create up to limit
    limit = 3  # use a smaller temp limit via env? current default is 10, we'll just create 3
    for i in range(limit):
        payload = {
            "image_id": image['id'],
            "model_name": "resnet50_classifier",
            "model_version": f"1.0.{i}",
            "parameters": {"k": i}
        }
        r = client.post(f"/api/images/{image['id']}/analyses", json=payload)
        assert r.status_code == 201, r.text

    # List analyses (should be == limit)
    list_resp = client.get(f"/api/images/{image['id']}/analyses")
    assert list_resp.status_code == 200
    data_list = list_resp.json()
    assert data_list['total'] == limit

    analysis_id = data_list['analyses'][0]['id']

    # Status transitions: queued -> processing -> completed
    proc_resp = client.patch(f"/api/analyses/{analysis_id}/status", json={"status": "processing"})
    assert proc_resp.status_code == 200, proc_resp.text
    comp_resp = client.patch(f"/api/analyses/{analysis_id}/status", json={"status": "completed"})
    assert comp_resp.status_code == 200, comp_resp.text

    # Illegal transition (completed -> queued) should 409
    bad_resp = client.patch(f"/api/analyses/{analysis_id}/status", json={"status": "queued"})
    assert bad_resp.status_code == 409

    # Annotations list (empty)
    ann_list = client.get(f"/api/analyses/{analysis_id}/annotations")
    assert ann_list.status_code == 200
    ann_payload = ann_list.json()
    assert ann_payload['total'] == 0


def test_feature_flag_off_returns_404(client, monkeypatch):
    # Temporarily disable flag (monkeypatch environment & settings attr if possible)
    from core import config as cfg
    original = cfg.settings.ML_ANALYSIS_ENABLED
    cfg.settings.ML_ANALYSIS_ENABLED = False  # type: ignore
    try:
        # Attempt list (random UUID)
        resp = client.get(f"/api/images/{uuid.uuid4()}/analyses")
        assert resp.status_code == 404
    finally:
        cfg.settings.ML_ANALYSIS_ENABLED = original  # restore


def _hmac_headers(body: bytes, secret: str):
    ts = str(int(time.time()))
    mac = hmac.new(secret.encode('utf-8'), msg=(ts.encode('utf-8') + b'.' + body), digestmod=hashlib.sha256)
    return {
        'X-ML-Timestamp': ts,
        'X-ML-Signature': 'sha256=' + mac.hexdigest()
    }


def test_phase2_bulk_and_finalize_flow(client, monkeypatch):
    from core import config as cfg
    # Patch the settings module directly where it's used
    secret = 'secret123'
    monkeypatch.setattr('routers.ml_analyses.settings.ML_CALLBACK_HMAC_SECRET', secret)
    monkeypatch.setattr('routers.ml_analyses.settings.ML_PIPELINE_REQUIRE_HMAC', True)

    # Create project & image & analysis
    proj = client.post('/api/projects/', json={"name":"P3","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()
    analysis = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"1","parameters":{}}).json()

    # Presign artifact
    presign_body = {"artifact_type":"heatmap","filename":"heat.png"}
    import json as _json
    presign_body_bytes = _json.dumps(presign_body).encode('utf-8')
    headers = _hmac_headers(presign_body_bytes, secret)
    headers['Content-Type'] = 'application/json'
    pre = client.post(f"/api/analyses/{analysis['id']}/artifacts/presign", data=presign_body_bytes, headers=headers)
    assert pre.status_code == 200, pre.text

    # Bulk annotations
    ann_body = {"annotations":[{"annotation_type":"classification","class_name":"cat","confidence":0.9,"data":{"score":0.9}}]}
    ann_body_bytes = _json.dumps(ann_body).encode('utf-8')
    headers = _hmac_headers(ann_body_bytes, secret)
    headers['Content-Type'] = 'application/json'
    bulk = client.post(f"/api/analyses/{analysis['id']}/annotations:bulk", data=ann_body_bytes, headers=headers)
    assert bulk.status_code == 200, bulk.text
    assert bulk.json()['total'] == 1

    # Finalize (completed)
    fin_body = {"status":"completed"}
    fin_body_bytes = _json.dumps(fin_body).encode('utf-8')
    headers = _hmac_headers(fin_body_bytes, secret)
    headers['Content-Type'] = 'application/json'
    fin = client.post(f"/api/analyses/{analysis['id']}/finalize", data=fin_body_bytes, headers=headers)
    assert fin.status_code == 200, fin.text
    assert fin.json()['status'] == 'completed'

    # Bad HMAC
    bad_body_bytes = _json.dumps(ann_body).encode('utf-8')
    bad = client.post(f"/api/analyses/{analysis['id']}/annotations:bulk", data=bad_body_bytes, headers={'X-ML-Timestamp':'0','X-ML-Signature':'sha256=deadbeef','Content-Type':'application/json'})
    assert bad.status_code in (401, 404)  # 404 if feature disabled, else 401


def test_model_allow_list_validation(client):
    """Test that only allowed models can be used."""
    # Create project & image
    proj = client.post('/api/projects/', json={"name":"AllowListTest","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()

    # Try creating analysis with allowed model (should succeed)
    allowed_payload = {
        "image_id": img['id'],
        "model_name": "resnet50_classifier",
        "model_version": "1.0.0",
        "parameters": {}
    }
    resp = client.post(f"/api/images/{img['id']}/analyses", json=allowed_payload)
    assert resp.status_code == 201, resp.text

    # Try creating analysis with disallowed model (should fail)
    disallowed_payload = {
        "image_id": img['id'],
        "model_name": "fake_model_not_allowed",
        "model_version": "1.0.0",
        "parameters": {}
    }
    resp = client.post(f"/api/images/{img['id']}/analyses", json=disallowed_payload)
    assert resp.status_code == 400, resp.text
    assert "not allowed" in resp.text.lower()


def test_per_image_analysis_limit(client, monkeypatch):
    """Test that per-image analysis limit is enforced."""
    from core import config as cfg
    monkeypatch.setattr('routers.ml_analyses.settings.ML_MAX_ANALYSES_PER_IMAGE', 3)

    # Create project & image
    proj = client.post('/api/projects/', json={"name":"LimitTest","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()

    # Create analyses up to limit
    for i in range(3):
        payload = {
            "image_id": img['id'],
            "model_name": "resnet50_classifier",
            "model_version": f"1.0.{i}",
            "parameters": {}
        }
        resp = client.post(f"/api/images/{img['id']}/analyses", json=payload)
        assert resp.status_code == 201, f"Failed on iteration {i}: {resp.text}"

    # Try to create one more (should fail)
    payload = {
        "image_id": img['id'],
        "model_name": "resnet50_classifier",
        "model_version": "2.0.0",
        "parameters": {}
    }
    resp = client.post(f"/api/images/{img['id']}/analyses", json=payload)
    assert resp.status_code == 400, resp.text
    assert "limit" in resp.text.lower()


def test_pagination_annotations(client, monkeypatch):
    """Test pagination of annotations."""
    from core import config as cfg
    import json as _json

    secret = 'secret123'; monkeypatch.setattr('routers.ml_analyses.settings.ML_CALLBACK_HMAC_SECRET', secret)
    monkeypatch.setenv('ML_CALLBACK_HMAC_SECRET', 'secret123')
    monkeypatch.setattr('routers.ml_analyses.settings.ML_PIPELINE_REQUIRE_HMAC', True)

    # Create project & image & analysis
    proj = client.post('/api/projects/', json={"name":"PaginationTest","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()
    analysis = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"1","parameters":{}}).json()

    # Create multiple annotations
    annotations = []
    for i in range(10):
        annotations.append({
            "annotation_type": "bounding_box",
            "class_name": f"object_{i}",
            "confidence": 0.8 + (i * 0.01),
            "data": {"x_min": i*10, "y_min": i*10, "x_max": (i+1)*10, "y_max": (i+1)*10, "image_width": 1024, "image_height": 768}
        })

    ann_body = {"annotations": annotations}
    ann_body_bytes = _json.dumps(ann_body).encode('utf-8')
    headers = _hmac_headers(ann_body_bytes, secret)
    headers['Content-Type'] = 'application/json'
    bulk = client.post(f"/api/analyses/{analysis['id']}/annotations:bulk", data=ann_body_bytes, headers=headers)
    assert bulk.status_code == 200, bulk.text

    # Test pagination
    resp = client.get(f"/api/analyses/{analysis['id']}/annotations?skip=0&limit=5")
    assert resp.status_code == 200
    data = resp.json()
    assert data['total'] == 10  # Total count should be actual total, not limited count
    assert len(data['annotations']) == 5  # But annotations array should be limited

    resp = client.get(f"/api/analyses/{analysis['id']}/annotations?skip=5&limit=5")
    assert resp.status_code == 200
    data = resp.json()
    assert data['total'] == 10  # Total count remains the same
    assert len(data['annotations']) == 5  # Second page also has 5 items


def test_access_control_other_user_analysis(client):
    """Test that users cannot access other users' analyses."""
    # Note: This test assumes we have multi-user support
    # For now, it just verifies 404 on non-existent analysis
    fake_analysis_id = uuid.uuid4()
    resp = client.get(f"/api/analyses/{fake_analysis_id}")
    assert resp.status_code == 404


def test_export_json_format(client, monkeypatch):
    """Test exporting analysis in JSON format."""
    from core import config as cfg
    import json as _json

    secret = 'secret123'; monkeypatch.setattr('routers.ml_analyses.settings.ML_CALLBACK_HMAC_SECRET', secret)
    monkeypatch.setenv('ML_CALLBACK_HMAC_SECRET', 'secret123')
    monkeypatch.setattr('routers.ml_analyses.settings.ML_PIPELINE_REQUIRE_HMAC', True)

    # Create project & image & analysis
    proj = client.post('/api/projects/', json={"name":"ExportTest","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()
    analysis = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"yolo_v8","model_version":"1.0","parameters":{"threshold": 0.5}}).json()

    # Add annotations
    ann_body = {
        "annotations": [
            {
                "annotation_type": "bounding_box",
                "class_name": "cat",
                "confidence": 0.95,
                "data": {"x_min": 10, "y_min": 20, "x_max": 100, "y_max": 200, "image_width": 1024, "image_height": 768}
            },
            {
                "annotation_type": "classification",
                "class_name": "cat",
                "confidence": 0.95,
                "data": {"topk": [{"class": "cat", "confidence": 0.95}]}
            }
        ]
    }
    ann_body_bytes = _json.dumps(ann_body).encode('utf-8')
    headers = _hmac_headers(ann_body_bytes, secret)
    headers['Content-Type'] = 'application/json'
    bulk = client.post(f"/api/analyses/{analysis['id']}/annotations:bulk", data=ann_body_bytes, headers=headers)
    assert bulk.status_code == 200

    # Finalize
    fin_body = {"status": "completed"}
    fin_body_bytes = _json.dumps(fin_body).encode('utf-8')
    headers = _hmac_headers(fin_body_bytes, secret)
    headers['Content-Type'] = 'application/json'
    client.post(f"/api/analyses/{analysis['id']}/finalize", data=fin_body_bytes, headers=headers)

    # Export as JSON
    resp = client.get(f"/api/analyses/{analysis['id']}/export?format=json")
    assert resp.status_code == 200
    export_data = resp.json()

    # Verify export structure
    assert export_data['id'] == analysis['id']
    assert export_data['model_name'] == 'yolo_v8'
    assert export_data['model_version'] == '1.0'
    assert export_data['status'] == 'completed'
    assert export_data['annotation_count'] == 2
    assert len(export_data['annotations']) == 2
    assert export_data['parameters']['threshold'] == 0.5


def test_export_csv_format(client, monkeypatch):
    """Test exporting analysis in CSV format."""
    from core import config as cfg
    import json as _json

    secret = 'secret123'; monkeypatch.setattr('routers.ml_analyses.settings.ML_CALLBACK_HMAC_SECRET', secret)
    monkeypatch.setenv('ML_CALLBACK_HMAC_SECRET', 'secret123')
    monkeypatch.setattr('routers.ml_analyses.settings.ML_PIPELINE_REQUIRE_HMAC', True)

    # Create project & image & analysis
    proj = client.post('/api/projects/', json={"name":"CSVTest","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()
    analysis = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"1","parameters":{}}).json()

    # Add annotation
    ann_body = {
        "annotations": [
            {
                "annotation_type": "classification",
                "class_name": "dog",
                "confidence": 0.88,
                "data": {"score": 0.88}
            }
        ]
    }
    ann_body_bytes = _json.dumps(ann_body).encode('utf-8')
    headers = _hmac_headers(ann_body_bytes, secret)
    headers['Content-Type'] = 'application/json'
    client.post(f"/api/analyses/{analysis['id']}/annotations:bulk", data=ann_body_bytes, headers=headers)

    # Export as CSV
    resp = client.get(f"/api/analyses/{analysis['id']}/export?format=csv")
    assert resp.status_code == 200
    assert resp.headers['content-type'] == 'text/csv; charset=utf-8'
    assert 'content-disposition' in resp.headers
    assert 'attachment' in resp.headers['content-disposition']

    # Verify CSV content
    csv_content = resp.text
    lines = csv_content.strip().split('\n')
    assert len(lines) >= 2  # header + at least one row
    assert 'annotation_id' in lines[0]
    assert 'annotation_type' in lines[0]
    assert 'dog' in csv_content


def test_status_state_machine_transitions(client):
    """Test all valid and invalid status transitions."""
    # Create project & image & analysis
    proj = client.post('/api/projects/', json={"name":"StateTest","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()

    # Test queued -> processing -> completed
    a1 = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"1","parameters":{}}).json()
    assert a1['status'] == 'queued'

    resp = client.patch(f"/api/analyses/{a1['id']}/status", json={"status": "processing"})
    assert resp.status_code == 200
    assert resp.json()['status'] == 'processing'

    resp = client.patch(f"/api/analyses/{a1['id']}/status", json={"status": "completed"})
    assert resp.status_code == 200
    assert resp.json()['status'] == 'completed'

    # Test queued -> processing -> failed
    a2 = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"2","parameters":{}}).json()
    client.patch(f"/api/analyses/{a2['id']}/status", json={"status": "processing"})
    resp = client.patch(f"/api/analyses/{a2['id']}/status", json={"status": "failed", "error_message": "Out of memory"})
    assert resp.status_code == 200
    assert resp.json()['status'] == 'failed'
    assert resp.json()['error_message'] == 'Out of memory'

    # Test queued -> canceled
    a3 = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"3","parameters":{}}).json()
    resp = client.patch(f"/api/analyses/{a3['id']}/status", json={"status": "canceled"})
    assert resp.status_code == 200
    assert resp.json()['status'] == 'canceled'

    # Test invalid transition: completed -> queued (should fail with 409)
    a4 = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"4","parameters":{}}).json()
    client.patch(f"/api/analyses/{a4['id']}/status", json={"status": "processing"})
    client.patch(f"/api/analyses/{a4['id']}/status", json={"status": "completed"})
    resp = client.patch(f"/api/analyses/{a4['id']}/status", json={"status": "queued"})
    assert resp.status_code == 409


def test_ml_artifact_content_streaming(client):
    """Test the new ML artifact content streaming endpoint."""
    # Create project & image & analysis
    proj = client.post('/api/projects/', json={"name":"ArtifactTest","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()
    analysis = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"1","parameters":{}}).json()

    # Test 404 when S3 client not available (simulates real environment for artifact content)
    # In test environment, boto3_client is None, so endpoint returns 503
    path = f"ml_outputs/{analysis['id']}/heatmap.png"
    resp = client.get(f"/api/ml/artifacts/content?path={path}")
    assert resp.status_code == 503  # Service unavailable when no S3 client


def test_ml_artifact_content_invalid_paths(client):
    """Test path validation and security for artifact content endpoint."""
    # Test invalid path format - not starting with ml_outputs/
    resp = client.get("/api/ml/artifacts/content?path=invalid/path.png")
    assert resp.status_code == 400
    assert "Invalid artifact path" in resp.text

    # Test path traversal attempt
    resp = client.get("/api/ml/artifacts/content?path=ml_outputs/../../../etc/passwd")
    assert resp.status_code == 400
    assert "Invalid analysis ID in path" in resp.text

    # Test invalid analysis ID format
    resp = client.get("/api/ml/artifacts/content?path=ml_outputs/not-a-uuid/file.png")
    assert resp.status_code == 400
    assert "Invalid analysis ID in path" in resp.text


def test_ml_artifact_content_unauthorized_access(client):
    """Test access control for artifact content endpoint."""
    # Test access to non-existent analysis (should be 404 from analysis lookup)
    fake_analysis_id = str(uuid.uuid4())
    path = f"ml_outputs/{fake_analysis_id}/heatmap.png"
    resp = client.get(f"/api/ml/artifacts/content?path={path}")

    # In test environment without S3 client, it gets to the analysis lookup which returns 404
    # If we had proper S3 mocking, this would be 404 for analysis not found
    assert resp.status_code in [503, 404]  # Either no S3 client (503) or analysis not found (404)


def test_ml_artifact_content_feature_flag(client, monkeypatch):
    """Test that artifact content endpoint respects ML_ANALYSIS_ENABLED flag."""
    from routers import ml_analyses
    original = ml_analyses.settings.ML_ANALYSIS_ENABLED
    ml_analyses.settings.ML_ANALYSIS_ENABLED = False
    try:
        resp = client.get("/api/ml/artifacts/content?path=ml_outputs/fake/heatmap.png")
        assert resp.status_code == 404  # Feature disabled
    finally:
        ml_analyses.settings.ML_ANALYSIS_ENABLED = original


def test_ml_artifact_download_url_presigned(client):
    """Test the existing artifact download URL endpoint."""
    # Create project & image & analysis
    proj = client.post('/api/projects/', json={"name":"DownloadTest","description":"d","meta_group_id":"data-scientists"}).json()
    img = client.post(f"/api/projects/{proj['id']}/images", files={'file': ('f.png', b'\x89PNG\r\n', 'image/png')}, data={'metadata':'{}'}).json()
    analysis = client.post(f"/api/images/{img['id']}/analyses", json={"image_id": img['id'], "model_name":"resnet50_classifier","model_version":"1","parameters":{}}).json()

    # Test presigned download URL endpoint
    path = f"ml_outputs/{analysis['id']}/mask.png"
    resp = client.get(f"/api/ml/artifacts/download?path={path}")
    data = resp.json()

    # In test environment without S3 client, returns mock URL
    assert resp.status_code == 200
    assert "url" in data
    if "example.com" in data["url"]:
        assert "signature=fake" in data["url"]
