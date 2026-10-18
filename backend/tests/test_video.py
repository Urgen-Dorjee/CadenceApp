import asyncio
import os
import re

import pytest
from fastapi.testclient import TestClient

from config import settings
from core.db import get_store
from main import app
from services import pipeline, video, youtube

HOST = {"host": f"127.0.0.1:{settings.backend_port}"}
AUTH = {**HOST, "x-cadence-token": "test-token"}
OPTIONS = {"quality": "1080", "container": "mp4", "subtitles": ["en", "hi"], "auto_subtitles": True,
           "subtitle_mode": "embed", "chapters": True, "thumbnail": True, "description": False}


@pytest.fixture
def client():
    with TestClient(app, base_url=f"http://127.0.0.1:{settings.backend_port}") as c:
        yield c


def _fmt(fid, height=None, vcodec="none", acodec="none", size=None, tbr=None, ext="mp4", abr=None):
    return {"format_id": fid, "height": height, "vcodec": vcodec, "acodec": acodec, "filesize": size, "tbr": tbr, "ext": ext, "abr": abr,
            "url": f"https://example.com/{fid}", "protocol": "https"}


FORMATS = [
    _fmt("140", acodec="mp4a.40.2", size=60_000_000, ext="m4a", abr=128),
    _fmt("251", acodec="opus", size=55_000_000, ext="webm", abr=140),
    _fmt("137", 1080, vcodec="avc1.640028", size=700_000_000),
    _fmt("248", 1080, vcodec="vp9", size=500_000_000, ext="webm"),
    _fmt("136", 720, vcodec="avc1.4d401f", size=350_000_000),
    _fmt("313", 2160, vcodec="vp9", size=3_000_000_000, ext="webm"),
    _fmt("18", 360, vcodec="avc1.42001E", acodec="mp4a.40.2", size=90_000_000),
]


# --- What a link holds --------------------------------------------------------------

def test_each_quality_is_offered_with_the_size_of_what_would_download():
    choices = {c["id"]: c for c in video.quality_choices({"formats": FORMATS, "duration": 3600})}
    assert list(choices) == ["best", "2160", "1080", "720", "audio"]  # no 1440p or 480p in this video
    assert choices["best"]["label"] == "Best available (2160p)" and choices["best"]["sizes"] == choices["2160"]["sizes"]
    assert choices["1080"]["sizes"]["mp4"] == 700_000_000 + 60_000_000   # MP4: the H.264 picture and AAC sound
    assert choices["1080"]["sizes"]["mkv"] == 500_000_000 + 55_000_000   # MKV: the smaller VP9 picture and Opus
    assert choices["1080"]["size"] == choices["1080"]["sizes"]["mp4"]
    assert choices["audio"]["size"] == 60_000_000


def test_sizes_are_estimated_from_bitrate_when_youtube_gives_none():
    formats = [_fmt("140", acodec="mp4a", tbr=128, ext="m4a"), _fmt("137", 1080, vcodec="avc1", tbr=4000)]
    choices = {c["id"]: c["size"] for c in video.quality_choices({"formats": formats, "duration": 100})}
    assert choices["1080"] == (4000 + 128) * 125 * 100


def test_subtitles_offered_are_the_uploaders_plus_automatic_in_useful_languages():
    info = {
        "subtitles": {"en": [{"name": "English"}], "es-419": [{"name": "Spanish (Latin America)"}], "live_chat": [{}]},
        "automatic_captions": {"en-orig": [{"name": "English (Original)"}], "en": [{"name": "English"}],
                               "hi": [{"name": "Hindi"}], "de": [{"name": "German"}], "fr": [{"name": "French"}]},
    }
    choices = video.subtitle_choices(info, ["hi"])
    assert [(c["lang"], c["auto"]) for c in choices] == [("en", False), ("es", False), ("hi", True)]


def test_details_of_a_video_mark_whether_it_was_saved_before():
    info = {"id": "abc123def45", "title": "Lecture 1", "channel": "Some School", "duration": 3600,
            "chapters": [{"start_time": 0, "title": "Intro"}, {"start_time": 300, "title": "Vectors"}],
            "formats": FORMATS, "subtitles": {}, "automatic_captions": {}}
    described = video.describe(info, ["en"], saved=True)
    assert described["saved"] is True
    assert described["chapters"][1] == {"start": 300.0, "title": "Vectors"}
    assert [q["id"] for q in described["qualities"]][:2] == ["best", "2160"]


def test_a_video_with_only_low_qualities_still_offers_its_picture():
    formats = [_fmt("140", acodec="mp4a", size=300_000, ext="m4a"), _fmt("160", 144, vcodec="avc1", size=200_000),
               _fmt("133", 240, vcodec="avc1", size=400_000)]
    choices = video.quality_choices({"formats": formats, "duration": 19})
    assert [(c["id"], c["label"]) for c in choices] == [("best", "Best available (240p)"), ("audio", "Sound only (M4A)")]


def test_one_subtitle_track_per_language():
    # What "Me at the zoo" has: the uploader's English and German, and machine translations.
    manual, auto = video.one_track_per_language({"en": [1], "de": [2]}, {"en-en": [3], "en-de": [4], "de-en": [5]}, ["en"])
    assert sorted(manual) == ["de", "en"] and sorted(auto) == ["de-en"]   # German is not wanted: left alone
    # No track of the uploader's: YouTube's automatic one, the plain code first, then the original.
    manual, auto = video.one_track_per_language({"en-GB": [1], "en-US": [2]}, {"en": [3]}, ["en"])
    assert sorted(manual) == ["en-GB"] and auto == {}
    manual, auto = video.one_track_per_language({}, {"hi-orig": [1], "hi-en": [2], "hi": [3]}, ["hi"])
    assert manual == {} and sorted(auto) == ["hi"]


# --- Where files go and how they are made ---------------------------------------------

def test_courses_get_their_own_numbered_folder():
    assert video.output_template("channel", False) == "%(channel,uploader|Unknown channel)s/%(title)s.%(ext)s"
    assert video.output_template("flat", False) == "%(title)s.%(ext)s"
    course = video.output_template("flat", True)
    assert course.startswith("%(playlist_title,playlist|Playlist)s/%(playlist_index)02d - ")


def test_subtitle_patterns_take_any_track_of_the_language():
    (pattern,) = video.subtitle_patterns(["en"])
    assert all(re.match(pattern, code) for code in ("en", "en-GB", "en-orig"))
    assert not any(re.match(pattern, code) for code in ("eng", "hi", "de-en"))
    assert video.subtitle_patterns(["../x"]) == []


def test_mp4_prefers_formats_that_play_everywhere_up_to_the_chosen_height():
    opts = video.build_options(OPTIONS, "C:/Videos", "channel", playlist=False)
    assert opts["format"] == "bv*+ba/b" and opts["merge_output_format"] == "mp4"
    assert opts["format_sort"] == ["res:1080", "vcodec:h264", "acodec:aac"]
    assert opts["noplaylist"] is True and opts["writesubtitles"] is True and opts["writeautomaticsub"] is True
    keys = [p["key"] for p in opts["postprocessors"]]
    assert keys == ["FFmpegThumbnailsConvertor", "FFmpegSubtitlesConvertor", "FFmpegEmbedSubtitle", "FFmpegMetadata", "EmbedThumbnail"]
    meta = next(p for p in opts["postprocessors"] if p["key"] == "FFmpegMetadata")
    assert meta["add_chapters"] is True


def test_best_mkv_and_sound_only_choices():
    best = video.build_options({**OPTIONS, "quality": "best", "container": "mkv", "subtitles": []}, "C:/V", "flat", playlist=True)
    assert best["format_sort"] == ["res"] and best["merge_output_format"] == "mkv"
    assert "writesubtitles" not in best and best["noplaylist"] is False
    audio = video.build_options({**OPTIONS, "quality": "audio", "thumbnail": False}, "C:/V", "flat", playlist=False)
    assert audio["format"].startswith("ba[ext=m4a]")
    keys = [p["key"] for p in audio["postprocessors"]]
    assert "FFmpegExtractAudio" in keys and "EmbedThumbnail" not in keys and "FFmpegEmbedSubtitle" not in keys


def test_subtitle_files_are_kept_when_asked():
    both = video.build_options({**OPTIONS, "subtitle_mode": "both"}, "C:/V", "flat", playlist=False)
    embed = next(p for p in both["postprocessors"] if p["key"] == "FFmpegEmbedSubtitle")
    assert embed["already_have_subtitle"] is True
    files = video.build_options({**OPTIONS, "subtitle_mode": "srt"}, "C:/V", "flat", playlist=False)
    assert all(p["key"] != "FFmpegEmbedSubtitle" for p in files["postprocessors"])


def test_progress_reads_as_one_figure_for_picture_and_sound_and_for_a_course():
    seen = []
    tracker = video._Tracker(lambda f, m: seen.append((round(f, 3), m)), count=4)
    # As yt-dlp sends it: each part's own details (no list of parts), named "Title.f<format>.ext".
    picture = {"id": "v2", "playlist_index": 2, "format_id": "137"}
    sound = {**picture, "format_id": "140"}
    tracker.hook({"status": "downloading", "info_dict": picture, "downloaded_bytes": 50, "total_bytes": 100,
                  "speed": 4.2 * 1024 ** 2, "eta": 100, "tmpfilename": "a.f137.mp4.part", "filename": "a.f137.mp4"})
    tracker.hook({"status": "finished", "info_dict": picture, "filename": "a.f137.mp4"})
    tracker.hook({"status": "downloading", "info_dict": sound, "downloaded_bytes": 0, "total_bytes": 10, "filename": "a.f140.m4a"})
    assert seen[0][0] == round((1 + 0.25) / 4, 3)          # video 2 of 4, picture half done
    assert seen[0][1].startswith("Video 2 of 4 · 25% · picture ") and "4.2 MB/s" in seen[0][1] and "1 min 40 s left" in seen[0][1]
    assert "· sound " in seen[1][1]
    assert seen[1][0] == round((1 + 0.5) / 4, 3)           # picture done, sound starting
    assert "a.f137.mp4.part" in tracker.part_files and tracker.bases == {"a"}


# --- Downloading, pausing and cancelling (yt-dlp replaced by a stand-in) ---------------

class FakeYDL:
    """Calls the hooks the way yt-dlp does, writing a real file for each video."""

    behaviour = "finish"

    def __init__(self, opts):
        self.opts = opts

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def add_post_processor(self, pp, when="post_process"):
        self.opts.setdefault("added", []).append((type(pp).__name__, when))

    def download(self, urls):
        folder = self.opts["paths"]["home"]
        for i, vid in enumerate(("aaaaaaaaaaa", "bbbbbbbbbbb"), start=1):
            info = {"id": vid, "title": f"Part {i}", "channel": "School", "playlist_index": i, "playlist_title": "Course",
                    "height": 1080, "duration": 60, "requested_subtitles": {"en": {}}}
            if self.opts.get("match_filter") and self.opts["match_filter"](info, incomplete=False):
                continue
            if FakeYDL.behaviour == "second fails" and i == 2:
                self.opts["logger"].error(f"ERROR: [youtube] {vid}: Video unavailable. This video has been removed")
                continue
            if FakeYDL.behaviour == "no subtitles":
                self.opts["logger"].warning("Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests")
            # Like yt-dlp: thumbnail and subtitles are written before the video downloads.
            open(os.path.join(folder, f"Part {i}.jpg"), "w").close()
            open(os.path.join(folder, f"Part {i}.en.srt"), "w").close()
            final = os.path.join(folder, f"Part {i}.mp4")
            part = final + ".part"
            open(part, "w").close()
            for hook in self.opts["progress_hooks"]:
                hook({"status": "downloading", "info_dict": info, "downloaded_bytes": 5, "total_bytes": 10, "tmpfilename": part, "filename": final})
            if FakeYDL.behaviour in ("pause", "cancel"):
                FakeYDL.stop_now()
                for hook in self.opts["progress_hooks"]:
                    hook({"status": "downloading", "info_dict": info, "downloaded_bytes": 6, "total_bytes": 10, "tmpfilename": part, "filename": final})
            os.replace(part, final)
            for hook in self.opts["postprocessor_hooks"]:
                hook({"status": "finished", "postprocessor": "MoveFiles", "info_dict": {**info, "filepath": final}})


def _run(tmp_path, monkeypatch, behaviour="finish", skip=()):
    monkeypatch.setattr(video.yt_dlp, "YoutubeDL", FakeYDL)
    monkeypatch.setattr(youtube, "_base_opts", lambda: {})
    state = {"stop": ""}
    FakeYDL.behaviour = behaviour
    FakeYDL.stop_now = staticmethod(lambda: state.update(stop=behaviour))
    saved, progress = [], []
    _run.thumbnails = []
    result = asyncio.run(video.download(
        "https://www.youtube.com/playlist?list=PLx", OPTIONS, str(tmp_path), "flat", playlist=True, count=2,
        skip_ids=set(skip), pause_s=5, rate_limit_mb=2, on_progress=lambda f, m: progress.append(m),
        on_saved=saved.append, stop=lambda: state["stop"], on_thumbnail=_run.thumbnails.append,
    ))
    return result, saved, progress


def test_a_course_downloads_every_video_and_records_each_for_the_library(tmp_path, monkeypatch):
    result, saved, progress = _run(tmp_path, monkeypatch)
    assert result == {"saved": 2, "failed": [], "missing_subtitles": 0} and [s["title"] for s in saved] == ["Part 1", "Part 2"]
    assert saved[0]["playlist"] == "Course" and saved[0]["playlist_index"] == 1 and saved[0]["subtitles"] == ["en"]
    assert saved[0]["thumbnail"] == video.thumb_path("aaaaaaaaaaa") and os.path.isfile(saved[0]["thumbnail"])
    assert not os.path.exists(tmp_path / "Part 1.jpg")          # moved out of the video folder
    assert progress[0].startswith("Video 1 of 2")
    assert _run.thumbnails[0] == video.thumb_path("aaaaaaaaaaa")  # shown while it downloads


def test_videos_already_saved_are_skipped(tmp_path, monkeypatch):
    result, saved, _ = _run(tmp_path, monkeypatch, skip={"aaaaaaaaaaa"})
    assert result["saved"] == 1 and saved[0]["video_id"] == "bbbbbbbbbbb"


def test_pausing_keeps_the_partial_file_so_it_can_resume(tmp_path, monkeypatch):
    with pytest.raises(video.Paused):
        _run(tmp_path, monkeypatch, behaviour="pause")
    assert os.path.exists(tmp_path / "Part 1.mp4.part")


def test_one_failing_video_doesnt_stop_the_rest_and_is_reported(tmp_path, monkeypatch):
    result, saved, _ = _run(tmp_path, monkeypatch, behaviour="second fails")
    assert result["saved"] == 1 and [s["title"] for s in saved] == ["Part 1"]
    assert "Video unavailable" in result["failed"][0]


def test_refused_subtitles_dont_cost_the_video(tmp_path, monkeypatch):
    result, saved, _ = _run(tmp_path, monkeypatch, behaviour="no subtitles")
    assert result["saved"] == 2 and result["missing_subtitles"] == 2 and not result["failed"]


def test_a_single_video_that_cant_be_downloaded_fails_with_its_reason(tmp_path, monkeypatch):
    class Broken(FakeYDL):
        def download(self, urls):
            self.opts["logger"].error("ERROR: [youtube] aaaaaaaaaaa: Private video")

    monkeypatch.setattr(video.yt_dlp, "YoutubeDL", Broken)
    monkeypatch.setattr(youtube, "_base_opts", lambda: {})
    with pytest.raises(video.yt_dlp.utils.DownloadError, match="Private video"):
        asyncio.run(video.download("https://www.youtube.com/watch?v=aaaaaaaaaaa", OPTIONS, str(tmp_path), "flat",
                                   playlist=False, count=1, skip_ids=set(), pause_s=0, rate_limit_mb=0,
                                   on_progress=lambda f, m: None, on_saved=lambda r: None, stop=lambda: ""))


def test_a_course_with_missing_videos_ends_as_failed_so_try_again_fetches_them(monkeypatch):
    job = get_store().create("https://www.youtube.com/playlist?list=PLx", kind="video", options=OPTIONS)

    async def fake_download(url, options, folder, layout, **kw):
        kw["on_saved"]({"path": os.path.abspath("Course/01 - One.mp4"), "video_id": "aaaaaaaaaaa", "title": "One",
                        "thumbnail": ""})
        return video.DownloadResult(saved=1, failed=["ERROR: [youtube] bbbbbbbbbbb: Video unavailable"], missing_subtitles=0)

    async def fake_list(url):
        return {"title": "Course", "entries": [{"id": "a"}, {"id": "b"}]}

    monkeypatch.setattr(video, "download", fake_download)
    monkeypatch.setattr(youtube, "list_videos", fake_list)
    monkeypatch.setattr(get_store(), "add_video", lambda record: None)
    asyncio.run(pipeline._video(job["id"]))
    done = get_store().get(job["id"])
    assert done["status"] == "failed" and len(done["outputs"]) == 1
    assert done["error"].startswith("Saved 1 of 2. 1 video couldn't be downloaded:") and "Try again" in done["error"]


def test_cancelling_removes_the_partial_file(tmp_path, monkeypatch):
    with pytest.raises(youtube.Cancelled):
        _run(tmp_path, monkeypatch, behaviour="cancel")
    assert not os.path.exists(tmp_path / "Part 1.mp4.part")


def test_cancelling_removes_the_unfinished_videos_extras_but_never_older_files(tmp_path, monkeypatch):
    older = tmp_path / "Part 1.description"
    older.write_text("from an earlier download")
    os.utime(older, (1_000_000, 1_000_000))
    with pytest.raises(youtube.Cancelled):
        _run(tmp_path, monkeypatch, behaviour="cancel")
    assert not os.path.exists(tmp_path / "Part 1.jpg") and not os.path.exists(tmp_path / "Part 1.en.srt")
    assert older.exists()


def test_cleaning_up_removes_folders_left_empty_up_to_the_video_folder(tmp_path):
    channel = tmp_path / "Videos" / "Blender"
    channel.mkdir(parents=True)
    (channel / "Film.jpg").write_text("x")
    video.remove_unfinished({str(channel / "Film")}, set(), 0, str(tmp_path / "Videos"))
    assert not channel.exists() and (tmp_path / "Videos").exists()


def test_base_name_drops_only_the_downloading_formats_tag():
    assert video._base_name("C:/V/Film.f315.webm.part", "315") == "C:/V/Film"
    assert video._base_name("C:/V/Talk.f1.mp4", "18") == "C:/V/Talk.f1"   # one file: ".f1" is part of the title


def test_the_download_options_carry_the_pause_and_speed_limit(tmp_path, monkeypatch):
    captured = {}

    class Capture(FakeYDL):
        def __init__(self, opts):
            captured.clear()
            captured["opts"] = opts
            super().__init__(opts)

    monkeypatch.setattr(video.yt_dlp, "YoutubeDL", Capture)
    monkeypatch.setattr(youtube, "_base_opts", lambda: {})
    FakeYDL.behaviour = "finish"
    asyncio.run(video.download("https://www.youtube.com/playlist?list=PLx", OPTIONS, str(tmp_path), "flat", playlist=True,
                               count=2, skip_ids=set(), pause_s=5, rate_limit_mb=2, on_progress=lambda f, m: None,
                               on_saved=lambda r: None, stop=lambda: ""))
    opts = captured["opts"]
    assert opts["sleep_interval"] == 5 and opts["max_sleep_interval"] == 10
    assert opts["ratelimit"] == 2 * 1024 * 1024
    assert opts["added"] == [("_OneTrackPerLanguage", "pre_process")]


# --- The library and the API -----------------------------------------------------------

def test_library_records_videos_and_knows_which_are_still_there(tmp_path):
    store = get_store()
    real = tmp_path / "Lecture.mp4"
    real.write_bytes(b"x")
    store.add_video({"path": str(real), "video_id": "ccccccccccc", "title": "Lecture", "subtitles": ["en"], "height": 720})
    store.add_video({"path": str(tmp_path / "gone.mp4"), "video_id": "ddddddddddd", "title": "Gone"})
    listed = {v["video_id"]: v for v in store.list_videos()}
    assert listed["ccccccccccc"]["subtitles"] == ["en"] and listed["ccccccccccc"]["height"] == 720
    ids = store.downloaded_video_ids()
    assert "ccccccccccc" in ids and "ddddddddddd" not in ids
    assert store.remove_video(str(real))["title"] == "Lecture"
    assert "ccccccccccc" not in store.downloaded_video_ids()


def test_creating_a_video_job_uses_the_settings_when_no_choices_are_sent(client, monkeypatch):
    started = []
    monkeypatch.setattr(pipeline, "start_video", started.append)
    r = client.post("/api/jobs", headers=AUTH, json={"url": "https://www.youtube.com/watch?v=jNQXAC9IVRw", "kind": "video"})
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["kind"] == "video" and job["options"]["quality"] == "1080" and job["options"]["container"] == "mp4"
    assert started == [job["id"]]


def test_video_choices_are_checked(client, monkeypatch):
    monkeypatch.setattr(pipeline, "start_video", lambda job_id: None)
    bad = client.post("/api/jobs", headers=AUTH, json={
        "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw", "kind": "video", "video": {**OPTIONS, "quality": "8k"}})
    assert bad.status_code == 422
    no_file = client.post("/api/jobs", headers=AUTH, json={"path": __file__, "kind": "video"})
    assert no_file.status_code == 422


def test_only_video_downloads_can_be_paused(client, monkeypatch):
    monkeypatch.setattr(pipeline, "start_analysis", lambda job_id: None)
    job = client.post("/api/jobs", headers=AUTH, json={"url": "https://www.youtube.com/watch?v=jNQXAC9IVRw"}).json()
    assert client.post(f"/api/jobs/{job['id']}/pause", headers=AUTH).status_code == 409


def test_a_paused_video_resumes_as_a_video_download(client, monkeypatch):
    monkeypatch.setattr(pipeline, "start_video", lambda job_id: None)
    resumed = []
    job = client.post("/api/jobs", headers=AUTH, json={"url": "https://www.youtube.com/watch?v=jNQXAC9IVRw", "kind": "video"}).json()
    get_store().update(job["id"], status="paused")
    monkeypatch.setattr(pipeline, "start_video", resumed.append)
    assert client.post(f"/api/jobs/{job['id']}/retry", headers=AUTH).status_code == 200
    assert resumed == [job["id"]]


def test_removing_a_video_from_the_library(client, tmp_path):
    path = tmp_path / "Talk.mp4"
    path.write_bytes(b"x")
    get_store().add_video({"path": str(path), "video_id": "eeeeeeeeeee", "title": "Talk"})
    assert any(v["path"] == str(path) for v in client.get("/api/library/videos", headers=AUTH).json())
    r = client.post("/api/library/videos/remove", headers=AUTH, json={"path": str(path)})
    assert r.json() == {"removed": True, "deleted": False} and path.exists()
    assert client.post("/api/library/videos/remove", headers=AUTH, json={"path": str(path)}).status_code == 404


def test_removing_one_copy_keeps_the_picture_the_other_copy_uses(client, tmp_path):
    thumb = tmp_path / "ffffffffffff.jpg"
    thumb.write_bytes(b"jpg")
    for name in ("Film.mp4", "Film.mkv"):
        (tmp_path / name).write_bytes(b"x")
        get_store().add_video({"path": str(tmp_path / name), "video_id": "fffffffffff", "title": "Film", "thumbnail": str(thumb)})
    client.post("/api/library/videos/remove", headers=AUTH, json={"path": str(tmp_path / "Film.mp4")})
    assert thumb.exists()
    client.post("/api/library/videos/remove", headers=AUTH, json={"path": str(tmp_path / "Film.mkv")})
    assert not thumb.exists()


def test_video_settings_are_checked(client):
    prefs = client.get("/api/preferences", headers=AUTH).json()
    assert prefs["video_quality"] == "1080" and prefs["download_mode"] == "music"
    assert client.put("/api/preferences", headers=AUTH, json={**prefs, "video_subtitles": ["en", "../x"]}).status_code == 422
    assert client.put("/api/preferences", headers=AUTH, json={**prefs, "video_layout": "random"}).status_code == 422
    ok = client.put("/api/preferences", headers=AUTH, json={**prefs, "video_quality": "720", "download_mode": "video"})
    assert ok.status_code == 200 and ok.json()["video_quality"] == "720"


def test_the_chosen_subtitles_are_trimmed_before_downloading():
    info = {"subtitles": {"en": [{}], "de": [{}]}, "automatic_captions": {"en-en": [{}], "en-de": [{}]},
            "requested_subtitles": {"en": {"ext": "srt"}, "en-en": {"ext": "srt"}, "en-de": {"ext": "srt"}}}
    _, info = video._OneTrackPerLanguage(["en"]).run(info)
    assert list(info["requested_subtitles"]) == ["en"]
