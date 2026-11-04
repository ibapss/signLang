"""Python side of the feature parity check, plus property tests.

Synthetic landmarks below are test-only and named as such.
"""
import json
from pathlib import Path

import numpy as np
import pytest

from training.psl.features import (FEATURE_DIM, FEATURE_VERSION, LEFT_PRESENT, POSE_PRESENT, RIGHT_PRESENT,
                                   RawFrame, mirror_frame, recording_features, resample_window)

ROOT = Path(__file__).resolve().parents[2]
GOLDEN = json.loads((ROOT / "tests" / "golden" / f"features-{FEATURE_VERSION}.json").read_text())


@pytest.mark.parametrize("case", GOLDEN["cases"], ids=lambda c: c["name"])
def test_golden(case):
    frames = [RawFrame.from_json(f) for f in case["frames"]]
    if case["mirror"]:
        frames = [mirror_frame(f) for f in frames]
    feats = recording_features(frames)
    np.testing.assert_allclose(feats, np.asarray(case["frameFeatures"]), atol=GOLDEN["tolerance"], rtol=0)
    times = [f.t for f in frames]
    for w in case["windows"]:
        out = resample_window(times, feats, w["tEnd"], w["T"], w["windowMs"])
        np.testing.assert_allclose(out, np.asarray(w["out"]), atol=GOLDEN["tolerance"], rtol=0)


def _real_frames(prefix="real-"):
    case = next(c for c in GOLDEN["cases"] if c["name"].startswith(prefix) and not c["mirror"])
    return [RawFrame.from_json(f) for f in case["frames"]]


def test_mirror_twice_is_identity():
    for f in _real_frames():
        g = mirror_frame(mirror_frame(f))
        for a, b in ((f.pose, g.pose), (f.left, g.left), (f.right, g.right)):
            assert (a is None) == (b is None)
            if a is not None:
                np.testing.assert_allclose(a, b, atol=1e-12)


def test_features_invariant_to_translation_and_scale():
    """Moving/scaling the whole person in the image must not change the features
    (synthetic transform of real frames)."""
    frames = _real_frames()

    def shift(f, dx, dy, k):
        tr = lambda p: None if p is None else np.column_stack([(p[:, 0] - 0.5) * k + 0.5 + dx, (p[:, 1] - 0.5) * k + 0.5 + dy, p[:, 2] * k])
        return RawFrame(f.t, f.aspect, tr(f.pose), tr(f.left), tr(f.right))

    a = recording_features(frames)
    b = recording_features([shift(f, 0.07, -0.05, 0.8) for f in frames])
    np.testing.assert_allclose(a, b, atol=1e-4)


def test_missing_hand_is_zero_with_flag():
    frames = _real_frames()
    feats = recording_features([RawFrame(f.t, f.aspect, f.pose, None, f.right) for f in frames])
    assert np.all(feats[:, :LEFT_PRESENT + 1] == 0)
    assert feats.shape[1] == FEATURE_DIM


def test_resample_is_time_based_not_frame_based():
    """Dropping every other frame (25 -> 12.5 fps, a slower device) leaves the window nearly unchanged.
    Uses the 25 fps PSL dictionary recording (real landmarks)."""
    frames = _real_frames("real-psl-dictionary")
    feats = recording_features(frames)
    times = [f.t for f in frames]
    full = resample_window(times, feats, times[-1])
    half = resample_window(times[::2], feats[::2], times[-1])
    flags = [LEFT_PRESENT, RIGHT_PRESENT, POSE_PRESENT]
    both = (full[:, flags] == half[:, flags]).all(axis=1)
    assert both.mean() > 0.8
    assert np.abs(full[both] - half[both]).mean() < 0.05
