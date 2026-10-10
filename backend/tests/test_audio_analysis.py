import numpy as np

from services.audio_analysis import (
    add_strong_changes,
    boundaries_from_silences,
    cuts_in_range,
    cuts_inside,
    find_cut_offset,
    novelty_curve,
    silences_from_rms,
    split_long_segments,
    tracks_from_profile,
)
from services.audio_profile import BLOCK_S, FRAME_S, RATE, AudioProfile, profile_from_samples, downsample_peaks


def test_silences_from_rms_finds_quiet_runs():
    rms = np.full(200, 0.3)       # 10 s of loud audio at 50 ms frames
    rms[40:60] = 0.001            # 1.0 s gap at 2.0-3.0 s
    rms[100:104] = 0.001          # 0.2 s blip: too short
    assert silences_from_rms(rms) == [(2.0, 3.0)]


def test_boundaries_prefer_long_gaps_and_respect_min_length():
    silences = [
        (200.0, 202.0),  # real gap between songs
        (230.0, 230.5),  # quiet bridge 30 s later: would make a too-short song
        (420.0, 421.0),  # second real gap
        (10.0, 12.0),    # intro silence: too close to the start
    ]
    cuts = boundaries_from_silences(silences, duration=650, min_track=90)
    assert [round(t, 2) for t, _ in cuts] == [201.0, 420.5]
    assert cuts[0][1] > cuts[1][1]  # the longer gap is more confident


def _step_features(change_blocks: list[int], n: int, seed: int = 0) -> np.ndarray:
    """Noisy features where each "new song" shifts a different group of 6 features."""
    rng = np.random.default_rng(seed)
    feats = rng.normal(0, 0.2, (n, 36))
    for i, b in enumerate(change_blocks):
        dims = slice((i * 6) % 36, (i * 6) % 36 + 6)
        feats[b:, dims] += 1.0 if i % 2 == 0 else -1.0
    return feats


def test_novelty_peaks_at_a_change_in_sound():
    feats = _step_features([400], n=800)
    curve = novelty_curve(feats)
    assert abs(int(np.argmax(curve)) - 400) <= 2
    assert curve.max() > 4


def test_strong_changes_become_cuts_with_low_confidence():
    n = 1200  # 600 s
    curve = novelty_curve(_step_features([300, 700], n=n))  # changes at 150 s and 350 s
    cuts = add_strong_changes([], curve, duration=n * BLOCK_S)
    assert [abs(t - expected) <= 1 for (t, _), expected in zip(cuts, [150, 350])] == [True, True]
    assert len(cuts) == 2
    assert all(c < 0.7 for _, c in cuts)


def test_strong_changes_respect_existing_silence_cuts():
    n = 1200
    curve = novelty_curve(_step_features([300], n=n))
    cuts = add_strong_changes([(160.0, 0.85)], curve, duration=n * BLOCK_S)
    assert cuts == [(160.0, 0.85)]  # the change at 150 s is within 90 s of a real gap


def test_long_segment_is_split_at_its_strongest_change():
    novelty = np.zeros(2000)       # 1000 s
    novelty[1000] = 2.0            # moderate change at 500 s
    cuts = split_long_segments([], novelty, duration=1000)
    assert [t for t, _ in cuts] == [500.25]


def test_long_segment_without_a_clear_change_is_left_alone():
    novelty = np.full(2000, 0.5)
    assert split_long_segments([], novelty, duration=1000) == []


def test_profile_finds_gaps_and_crossfades_in_synthetic_audio():
    """Song 1 -> 1.5 s silence -> song 2 crossfading straight into song 3."""
    t = lambda s: np.arange(int(s * RATE)) / RATE
    rng = np.random.default_rng(1)
    s1 = 0.3 * np.sin(2 * np.pi * 220 * t(140))
    gap = np.zeros(int(1.5 * RATE))
    s2 = 0.3 * np.sin(2 * np.pi * 523 * t(150))
    s3 = 0.3 * np.sin(2 * np.pi * 1245 * t(150)) + 0.05 * rng.normal(size=int(150 * RATE))
    fade = np.linspace(0, 1, 3 * RATE)
    s2[-len(fade):] *= 1 - fade
    s3[:len(fade)] *= fade
    overlap = s2[-len(fade):] + s3[:len(fade)]
    audio = np.concatenate([s1, gap, s2[:-len(fade)], overlap, s3[len(fade):]]).astype(np.float32)

    profile = profile_from_samples(audio)
    tracks = tracks_from_profile(profile, "src")
    starts = [tr["start"] for tr in tracks]
    assert len(tracks) == 3
    assert abs(starts[1] - 140.75) < 0.5           # silence gap, confident
    assert abs(starts[2] - (141.5 + 148.5)) < 4    # crossfade, flagged
    assert tracks[1]["confidence"] < 0.7 or tracks[2]["confidence"] < 0.7


def test_downsample_peaks_is_bounded_and_normalised():
    peaks = downsample_peaks(np.abs(np.sin(np.linspace(0, 50, 10000))), 500)
    assert len(peaks) == 500
    assert max(peaks) == 1.0 and min(peaks) >= 0


def _music(seconds: float, rate: int = 8000, seed: int = 0) -> np.ndarray:
    """Noisy "music" with a 40 ms near-silence between notes every 0.4 s."""
    rng = np.random.default_rng(seed)
    x = rng.normal(0, 0.3, int(seconds * rate)).astype(np.float32)
    for t in np.arange(0.2, seconds, 0.4):
        x[int(t * rate):int((t + 0.04) * rate)] *= 0.001
    return x


def test_cut_lands_in_the_gap():
    rate = 8000
    samples = _music(4)
    samples[int(2.6 * rate):int(2.8 * rate)] = 0.0  # gap 0.6 s after the rough cut at 2.0 s
    offset = find_cut_offset(samples, rate, center=2.0)
    assert 2.6 <= offset <= 2.8


def test_dips_between_notes_do_not_trap_the_cut():
    """The old snapper picked the quietest 20 ms, which is often a dip inside a song."""
    rate = 8000
    samples = _music(10)
    samples[int(8.0 * rate):int(8.3 * rate)] = 0.0  # real gap 3 s after the timestamp
    offset = find_cut_offset(samples, rate, center=5.0)
    assert 8.0 <= offset <= 8.3


def test_cut_prefers_the_gap_nearest_the_timestamp():
    rate = 8000
    samples = _music(10)
    samples[int(1.0 * rate):int(1.3 * rate)] = 0.0   # pause far from the timestamp
    samples[int(5.4 * rate):int(5.7 * rate)] = 0.0   # gap next to it
    assert 5.4 <= find_cut_offset(samples, rate, center=5.0) <= 5.7


def test_cut_goes_mid_silence_not_to_the_end_of_a_fade():
    """Digital silence at the end of a fade and gap hiss are equally inaudible."""
    rate = 8000
    rng = np.random.default_rng(1)
    samples = _music(6)
    samples[int(2.0 * rate):int(3.0 * rate)] *= np.linspace(1, 0, rate) ** 2  # fade-out to exact zero
    samples[int(3.0 * rate):int(4.0 * rate)] = rng.normal(0, 1e-4, rate)      # 1 s gap with hiss
    offset = find_cut_offset(samples, rate, center=3.0)
    assert 3.0 <= offset <= 4.0


def test_crossfade_cuts_at_the_loudness_valley():
    rate = 8000
    rng = np.random.default_rng(2)
    n = 10 * rate
    t = np.arange(n) / rate
    gain = np.clip(np.abs(t - 6.0) / 1.5, 0.15, 1.0)  # songs crossfade around 6 s, never silent
    samples = (rng.normal(0, 0.3, n) * gain).astype(np.float32)
    assert abs(find_cut_offset(samples, rate, center=4.5) - 6.0) < 0.4


def test_cut_stays_put_in_silence():
    samples = np.zeros(8000 * 2, dtype=np.float32)
    assert abs(find_cut_offset(samples, 8000, center=1.0) - 1.0) < 0.05


def test_refine_tracks_drift_and_flags_cuts_without_a_gap(monkeypatch):
    import asyncio

    from services import audio_analysis
    from services.tracklist import make_track

    calls = []

    async def fake_snap(path, t, window, duration, min_gap=0.15, allow_crossfade=True, also=None):
        calls.append(round(t, 2))
        if t < 150:
            return 104.0, True        # first cut: real gap 4 s after its timestamp
        return t + 0.5, False         # second cut: no gap anywhere

    monkeypatch.setattr(audio_analysis, "snap_to_gap", fake_snap)
    tracks = [
        make_track(title="A", start=0, end=100, origin="chapters", source_id="s"),
        make_track(title="B", start=100, end=200, origin="chapters", source_id="s"),
        make_track(title="C", start=200, end=300, origin="chapters", source_id="s"),
    ]
    asyncio.run(audio_analysis.refine_boundaries(tracks, "x", 300, 5.0))
    assert calls[0] == 100.0
    assert calls[1] == 204.0            # searched at its timestamp plus the 4 s drift
    assert tracks[1]["confidence"] == 0.95
    assert tracks[2]["confidence"] == 0.6  # no gap: shown as "Check"
    assert tracks[1]["end"] == tracks[2]["start"] == 204.5


def _profile_with_dips(duration: float, dips: list[float]) -> AudioProfile:
    rms = np.full(int(duration / FRAME_S), 0.25)
    for t in dips:
        rms[int(t / FRAME_S):int(t / FRAME_S) + 4] = 1e-5   # 0.2 s of silence between songs
    return AudioProfile(duration=duration, rms=rms, peak=rms, features=np.zeros((int(duration / BLOCK_S), 4)))


def test_known_number_of_songs_is_found_at_brief_silences():
    profile = _profile_with_dips(2000, [300, 610, 905, 1210, 1530])
    cuts = cuts_in_range(profile, 0, 2000, 5)
    assert [round(t) for t, _ in cuts] == [300, 610, 905, 1210, 1530]
    assert all(conf >= 0.7 for _, conf in cuts)


def test_extra_silences_are_left_out_by_song_length():
    # 400 is a pause 100 s into a song; the other dips are ~5 minutes apart.
    profile = _profile_with_dips(1800, [300, 400, 600, 900, 1200, 1500])
    cuts = cuts_in_range(profile, 0, 1800, 5)
    assert [round(t) for t, _ in cuts] == [300, 600, 900, 1200, 1500]


def test_short_songs_from_brief_silences_are_flagged():
    profile = _profile_with_dips(1200, [300, 400, 800])
    cuts = cuts_in_range(profile, 0, 1200, 3)
    assert [round(t) for t, _ in cuts] == [300, 400, 800]
    assert [conf for _, conf in cuts] == [0.5, 0.5, 0.75]


def test_listening_finds_songs_at_brief_silences():
    # A jukebox with only 0.2 s of silence between songs, every ~5 minutes.
    profile = _profile_with_dips(1800, [300, 610, 905, 1210, 1530])
    tracks = tracks_from_profile(profile, "s")
    assert [round(t["start"]) for t in tracks] == [0, 300, 610, 905, 1210, 1530]


def test_cuts_inside_a_range_come_from_listening():
    profile = _profile_with_dips(1800, [300, 610, 905, 1210, 1530])
    assert [round(t) for t, _ in cuts_inside(profile, 600, 1800)] == [905, 1210, 1530]


def test_tracklist_songs_too_long_to_be_one_song_are_split_by_listening():
    from services import pipeline
    from services.tracklist import make_track

    profile = _profile_with_dips(1800, [300, 610, 905, 1210, 1530])
    # The description timed only the first two songs.
    timed = [make_track(title="A", start=0, end=300, origin="description", source_id="s"),
             make_track(title="B", start=300, end=1800, origin="description", source_id="s")]
    tracks = pipeline._split_long_tracks(timed, profile, "s")
    assert [round(t["start"]) for t in tracks] == [0, 300, 610, 905, 1210, 1530]
    assert [t["title"] for t in tracks[:2]] == ["A", "B"]
    assert all(t["confidence"] < 0.7 for t in tracks[2:])   # new songs are marked Check


def test_long_songs_from_chapters_or_a_full_list_are_never_split():
    from services import pipeline
    from services.tracklist import make_track

    # A 10.8-minute song with a silence in the middle, between 5-minute songs.
    profile = _profile_with_dips(1500, [300, 600, 950, 1250])
    for origin in ("chapters", "description"):
        tracks = [make_track(title=n, start=a, end=b, origin=origin, source_id="s")
                  for n, a, b in [("A", 0, 300), ("Long", 300, 950), ("B", 950, 1250), ("C", 1250, 1500)]]
        assert [t["title"] for t in pipeline._split_long_tracks(tracks, profile, "s")] == ["A", "Long", "B", "C"]


def test_listening_keeps_a_long_song_whole_between_clear_gaps():
    # Songs of ~5 minutes with gaps, and one 9.5-minute song (no gap inside it).
    edges = [300, 600, 900, 1470, 1770, 2070]
    profile = _profile_with_dips(2370, edges)
    profile.features[:] = np.random.default_rng(1).normal(size=profile.features.shape)
    starts = [round(t["start"]) for t in tracks_from_profile(profile, "s")]
    assert starts == [0] + edges
