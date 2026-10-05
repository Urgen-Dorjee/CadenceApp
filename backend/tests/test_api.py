import os

import pytest
from fastapi.testclient import TestClient

from config import settings
from core.db import get_store
from main import app

HOST = {"host": f"127.0.0.1:{settings.backend_port}"}
AUTH = {**HOST, "x-cadence-token": "test-token"}


@pytest.fixture
def client():
    with TestClient(app, base_url=f"http://127.0.0.1:{settings.backend_port}") as c:
        yield c


def test_requests_without_token_are_rejected(client):
    assert client.get("/api/health", headers=HOST).status_code == 401
    assert client.get("/api/health", headers={**HOST, "x-cadence-token": "wrong"}).status_code == 401


def test_foreign_host_is_rejected_even_with_token(client):
    r = client.get("/api/health", headers={"host": "evil.example:8321", "x-cadence-token": "test-token"})
    assert r.status_code == 403


def test_health_with_token(client):
    r = client.get("/api/health", headers=AUTH)
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_token_in_query_for_media(client):
    assert client.get("/api/health?token=test-token", headers=HOST).status_code == 200


def test_rejects_non_youtube_urls(client):
    r = client.post("/api/jobs", json={"url": "https://example.com/video"}, headers=AUTH)
    assert r.status_code == 422


def test_work_files_outside_job_folder_are_never_served(client, tmp_path):
    secret = tmp_path / "secret.txt"
    secret.write_text("private")
    job = get_store().create("https://www.youtube.com/watch?v=x")
    get_store().update(job["id"], status="review", thumbnail=str(secret),
                       sources=[{"id": "s", "path": str(secret), "duration": 10}])
    assert client.get(f"/api/jobs/{job['id']}/thumbnail", headers=AUTH).status_code == 404
    assert client.get(f"/api/jobs/{job['id']}/sources/s/audio", headers=AUTH).status_code == 404


def test_review_validation(client):
    store = get_store()
    job = store.create("https://www.youtube.com/watch?v=y")
    store.update(job["id"], status="review", sources=[{"id": "s", "path": "", "duration": 300}])
    collection = {"type": "album", "name": "A", "album": "A"}
    good = {"id": "t1", "title": "Song", "start": 0, "end": 200, "source_id": "s"}

    r = client.put(f"/api/jobs/{job['id']}", json={"tracks": [good], "collection": collection}, headers=AUTH)
    assert r.status_code == 200
    assert r.json()["tracks"][0]["title"] == "Song"

    bad_order = {**good, "start": 250, "end": 100}
    r = client.put(f"/api/jobs/{job['id']}", json={"tracks": [bad_order], "collection": collection}, headers=AUTH)
    assert r.status_code == 422

    too_long = {**good, "end": 999}
    r = client.put(f"/api/jobs/{job['id']}", json={"tracks": [too_long], "collection": collection}, headers=AUTH)
    assert r.status_code == 422

    none_selected = {**good, "include": False}
    r = client.put(f"/api/jobs/{job['id']}", json={"tracks": [none_selected], "collection": collection}, headers=AUTH)
    assert r.status_code == 422


def test_interrupted_jobs_recover_on_startup():
    store = get_store()
    running = store.create("https://youtu.be/a")
    exporting = store.create("https://youtu.be/b")
    store.update(running["id"], status="downloading")
    store.update(exporting["id"], status="exporting")
    store.recover_interrupted()
    assert store.get(running["id"])["status"] == "failed"
    assert store.get(exporting["id"])["status"] == "review"
    assert os.path.exists(settings.db_path)


def test_token_never_reaches_the_logs(caplog):
    import logging

    caplog.set_level(logging.INFO)
    logging.getLogger("uvicorn.error").info('%s - "WebSocket %s" [accepted]', "127.0.0.1:5000", "/ws?token=SECRET123abc")
    logging.getLogger("uvicorn.access").info('GET /api/jobs/x/thumbnail?token=SECRET456&v=1 200')
    assert "SECRET" not in caplog.text
    assert caplog.text.count("token=[redacted]") == 2
