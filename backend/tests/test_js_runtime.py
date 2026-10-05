from core import js_runtime


def test_prefers_deno_from_env(tmp_path, monkeypatch):
    deno = tmp_path / "deno.exe"
    deno.write_text("")
    monkeypatch.setenv("DENO_PATH", str(deno))
    monkeypatch.setattr(js_runtime.shutil, "which", lambda name: None)
    assert js_runtime.js_runtimes() == {"deno": {"path": str(deno)}}


def test_falls_back_to_node_on_path(monkeypatch, tmp_path):
    monkeypatch.setenv("DENO_PATH", str(tmp_path / "missing.exe"))
    monkeypatch.setattr(js_runtime, "find_deno", lambda: None)
    monkeypatch.setattr(js_runtime.shutil, "which", lambda name: "C:/node/node.exe" if name == "node" else None)
    assert js_runtime.js_runtimes() == {"node": {"path": "C:/node/node.exe"}}


def test_default_lets_yt_dlp_search_for_deno(monkeypatch):
    monkeypatch.setattr(js_runtime, "find_deno", lambda: None)
    monkeypatch.setattr(js_runtime.shutil, "which", lambda name: None)
    assert js_runtime.js_runtimes() == {"deno": {}}
