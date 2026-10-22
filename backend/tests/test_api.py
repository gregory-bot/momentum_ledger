from fastapi.testclient import TestClient

from dangote.server import app

client = TestClient(app)


def test_config():
    r = client.get("/api/config").json()
    assert r["meta"]["home"]["name"] == "Northbridge FC"
    assert {"en", "es", "sw"} <= set(r["languages"])


def test_catchup_from_viewers_side():
    r = client.get("/api/catchup", params={"minute": 70, "club": "away", "lang": "es"}).json()
    assert r["header"].startswith("Resumen al minuto 70")
    assert r["items"]
    assert any("GOL" in i["text"] for i in r["items"])


def test_stream_emits_verified_overlays():
    with client.stream("GET", "/api/stream", params={"speed": 600, "start": 60, "persona": "analyst"}) as resp:
        kinds = []
        for line in resp.iter_lines():
            if line.startswith("event: "):
                kinds.append(line[7:])
            if kinds.count("overlay") >= 2:
                break
    assert "tick" in kinds and kinds.count("overlay") >= 2


def test_overlay_export():
    r = client.get("/api/overlays", params={"persona": "casual", "lang": "sw"}).json()
    assert r["count"] > 20
    assert all(o["verification"]["status"] == "verified" for o in r["overlays"])
