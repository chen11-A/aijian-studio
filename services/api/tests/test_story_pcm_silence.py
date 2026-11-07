"""Exact-zero bypass and a physical reproduction of the observed bad loudnorm stage."""

import io
import struct
import wave
from pathlib import Path

import pytest
from aijian_api import story_film
from aijian_api.story_pcm_silence import is_exact_zero_pcm
from test_draft_export_runtime import toolchain
from test_story_speech_window import _empty_speech_pcm, clip, pcm, samples


def wav(data, *, width=2, rate=48000, channels=1):
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setframerate(rate)
        audio.setnchannels(channels)
        audio.setsampwidth(width)
        audio.writeframes(data)
    return output.getvalue()


def test_exact_zero_requires_complete_signed_pcm_and_scans_the_last_chunk(tmp_path):
    source = tmp_path / "input.wav"
    silent = story_film._silent_wav()
    source.write_bytes(silent)
    assert is_exact_zero_pcm(source)
    assert source.read_bytes() == silent
    source.write_bytes(wav(bytes(9000 * 4), channels=2))
    assert is_exact_zero_pcm(source)
    # Even one least-significant-bit nonzero sample at the end is not silence.
    source.write_bytes(wav(bytes(9000 * 2) + struct.pack("<h", -1)))
    assert not is_exact_zero_pcm(source)
    for invalid in [silent[:-2], b"", b"ID3unknown", wav(b"\x80" * 16, width=1), wav(b"")]:
        source.write_bytes(invalid)
        assert not is_exact_zero_pcm(source)
    assert not is_exact_zero_pcm(tmp_path / "missing.wav")


def test_zero_recognition_is_bounded_before_wave_parsing(tmp_path, monkeypatch):
    from aijian_api import story_pcm_silence

    source = tmp_path / "input.wav"
    source.write_bytes(story_film._silent_wav())
    monkeypatch.setattr(story_pcm_silence, "MAX_EXACT_ZERO_PCM_BYTES", 64)

    def unexpected(*args, **kwargs):
        raise AssertionError("oversized source must not be parsed")

    monkeypatch.setattr(story_pcm_silence.wave, "open", unexpected)
    assert not is_exact_zero_pcm(source)


@pytest.mark.parametrize("bypass", [False, True])
def test_observed_full_scale_loudnorm_fault_is_avoided_only_for_verified_zero(
    tmp_path, monkeypatch, bypass
):
    tools = toolchain()
    video = tmp_path / "video.mp4"
    video_bytes = clip(video, 2)
    provider_video = tmp_path / "provider-original.mp4"
    provider_video.write_bytes(video_bytes)
    raw = story_film._silent_wav()
    cache = tmp_path / "raw-cache.wav"
    voice = tmp_path / "working.wav"
    cache.write_bytes(raw)
    voice.write_bytes(raw)
    original = story_film._ffmpeg
    measured = []
    bad_stages = []

    def no_measurement(*args):
        measured.append(True)
        return None

    def observed_bad_loudnorm(binary, args, **kwargs):
        actual = list(args)
        if "-af" in actual:
            index = actual.index("-af") + 1
            if actual[index].startswith("loudnorm="):
                # Reproduce the actual Windows evidence with real FFmpeg: every
                # 0.2s/48k/stereo PCM sample becomes -32768, not tiny dither.
                actual[index] = "aeval=exprs=-1|-1:c=stereo"
                result = original(binary, actual, **kwargs)
                bad_stages.append(_empty_speech_pcm(str(actual[-1])))
                return result
        return original(binary, actual, **kwargs)

    monkeypatch.setattr(story_film, "_measure_loudness", no_measurement)
    monkeypatch.setattr(story_film, "_ffmpeg", observed_bad_loudnorm)
    if not bypass:
        # The former decision path: unavailable measurement goes to dynamic loudnorm.
        monkeypatch.setattr(story_film, "is_exact_zero_pcm", lambda _: False)
    _, _, frames, fitted = story_film._normalize_film_media(
        tools.ffmpeg_path, tools.ffprobe_path, video, voice, 2, strict_cap=True
    )
    assert frames == 48
    assert samples(fitted)[:2] == (48000, 2)
    if bypass:
        assert measured == []
        assert bad_stages == []
        assert not any(samples(fitted)[2])
    else:
        assert measured == [True]
        assert len(bad_stages) == 1
        stage = bad_stages[0]
        assert stage["samples"] == stage["nonzero"] == 19200
        assert stage["peakAbs"] == 32768
        assert stage["rms"] == pytest.approx(32768, abs=0.001)
        final = _empty_speech_pcm(str(fitted))
        assert final["samples"] == 199680
        assert final["nonzero"] == 19200
        assert final["peakAbs"] == 32768
        assert final["rms"] == pytest.approx(10160.925458, abs=0.000001)
        assert any(samples(fitted)[2])
    assert cache.read_bytes() == raw
    assert provider_video.read_bytes() == video_bytes


def test_short_nonzero_with_no_loudness_measurement_keeps_the_original_spoken_policy(
    tmp_path, monkeypatch
):
    tools = toolchain()
    video = tmp_path / "video.mp4"
    clip(video, 2)
    voice = tmp_path / "voice.wav"
    raw = pcm(0.05)
    voice.write_bytes(raw)
    assert not is_exact_zero_pcm(voice)
    original = story_film._ffmpeg
    filters = []
    measurements = []

    def unmeasurable(*args):
        measurements.append(True)
        return None

    def trace(binary, args, **kwargs):
        if "-af" in args and kwargs.get("stage") == "normalize_voice":
            filters.append(args[args.index("-af") + 1])
        return original(binary, args, **kwargs)

    monkeypatch.setattr(story_film, "_measure_loudness", unmeasurable)
    monkeypatch.setattr(story_film, "_ffmpeg", trace)
    _, _, _, fitted = story_film._normalize_film_media(
        tools.ffmpeg_path, tools.ffprobe_path, video, voice, 2
    )
    assert measurements == [True]
    assert any(item.startswith("loudnorm=") for item in filters)
    assert "anull" not in filters
    assert any(samples(Path(fitted))[2])
