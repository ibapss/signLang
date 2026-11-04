"""End-to-end smoke test of import -> prepare -> train -> evaluate -> export.

ALL DATA HERE IS SYNTHETIC (generated below, named synthetic_*). It only checks
that the code runs and the outputs have the right shape and contract. The
resulting model is written to a temp dir and never used or committed.
"""
import json
import math

import numpy as np
import pytest

from training import import_collected
from training.pipeline import main as pipeline_main
from training.psl.features import FEATURE_VERSION


def synthetic_frame(t, motion, phase):
    """A synthetic person: fixed shoulders, right hand moving by `motion`."""
    pose = [[0.5, 0.5, 0.0] for _ in range(33)]
    pose[11], pose[12] = [0.6, 0.6, 0.0], [0.4, 0.6, 0.0]
    pose[13], pose[14] = [0.65, 0.8, 0.0], [0.35, 0.8, 0.0]
    if motion == "none":
        pose[15], pose[16] = [0.66, 0.95, 0.0], [0.34, 0.95, 0.0]
        return {"t": t, "aspect": 4 / 3, "pose": pose, "left": None, "right": None}
    dx, dy = (0.1 * math.sin(phase), 0.0) if motion == "side" else (0.0, 0.1 * math.sin(phase))
    wx, wy = 0.4 + dx, 0.55 + dy
    pose[16] = [wx, wy, 0.0]
    pose[15] = [0.66, 0.95, 0.0]
    hand = [[wx + 0.004 * (i % 5), wy - 0.01 * (i // 4), 0.0] for i in range(21)]
    return {"t": t, "aspect": 4 / 3, "pose": pose, "left": None, "right": hand}


def synthetic_session(code, n_per_label, rng):
    takes = []
    for label, motion in (("SIDE", "side"), ("UPDOWN", "up"), ("none", "none")):
        for k in range(n_per_label):
            t0 = 1000.0 * (len(takes) + 1) * 5
            fps = rng.uniform(12, 30)
            frames = [synthetic_frame(t0 + i * 1000 / fps, motion, i / fps * 2 * math.pi * 1.2)
                      for i in range(int(2.5 * fps))]
            takes.append({"id": f"{code}-{label}-{k}", "label": label, "kind": "none" if motion == "none" else "sign",
                          "none_kind": "rest" if motion == "none" else None, "start_t": t0, "end_t": t0 + 2500,
                          "frames": frames})
    return {"format": "psl-collect-v1", "feature_version": FEATURE_VERSION, "signer": {"code": code, "handedness": "right", "psl": "fluent"},
            "session": {"id": f"{code}-s1", "camera": "user"}, "consent": {"agreed": True, "text": "x", "at": "x"}, "takes": takes}


def test_import_rejects_bad_files(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"format": "psl-collect-v1", "feature_version": FEATURE_VERSION, "consent": {"agreed": False}}))
    with pytest.raises(import_collected.InvalidFile):
        import_collected.import_file(bad, tmp_path / "out")


@pytest.mark.slow
def test_pipeline_end_to_end_on_synthetic_data(tmp_path):
    pytest.importorskip("torch")
    pytest.importorskip("onnxruntime")
    rng = np.random.default_rng(0)
    data = tmp_path / "collected"
    for code in ("S-AAAA", "S-BBBB", "S-CCCC", "S-DDDD"):
        f = tmp_path / f"{code}.json"
        f.write_text(json.dumps(synthetic_session(code, 6, rng)))
        import_collected.import_file(f, data)
    run, report, out = tmp_path / "run", tmp_path / "EVAL.md", tmp_path / "models"
    args = ["--data-root", str(data), "--run-dir", str(run), "--report", str(report), "--out-dir", str(out),
            "--epochs", "6", "--threads", "2"]
    pipeline_main(["all", *args])
    prepared = json.loads((run / "prepared.json").read_text())
    assert prepared["split_mode"] == "signer"
    side = json.loads((out / "classifier.json").read_text())
    assert side["feature_version"] == FEATURE_VERSION and side["labels"][0] == "none"
    assert side["bytes"] < 2_000_000
    assert (out / side["file"]).exists()
    assert "Confusion matrix" in report.read_text()
    # Resuming continues from the checkpoint instead of starting over.
    pipeline_main(["train", *args[:4], "--epochs", "7", "--threads", "2"])
    hist = json.loads((run / "history.json").read_text())
    assert [h["epoch"] for h in hist] == list(range(7))
