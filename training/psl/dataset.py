"""Load recordings, choose training windows, split by signer, augment.

Everything works on raw frames (docs/FEATURES.md §1) so augmentation happens
before feature extraction, exactly where real-world variation happens.
"""
from __future__ import annotations

import json
import math
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

import numpy as np

from .features import (WINDOW_MS, WINDOW_T, RawFrame, mirror_frame, recording_features, resample_window)

NONE = "none"


@dataclass
class Take:
    frames: List[RawFrame]
    label: str
    kind: str  # "sign" | "none"
    signer: str
    session: str
    source: str
    take_id: str


@dataclass
class Split:
    mode: str  # "signer" | "session" | "take"
    train: List[Take] = field(default_factory=list)
    val: List[Take] = field(default_factory=list)
    test: List[Take] = field(default_factory=list)
    note: str = ""


def load_collected(root: Path) -> List[Take]:
    """Takes from data/collected/<signer>/<session>.json (psl-collect-v1).
    Left-handed signers are mirrored to right-dominant form (docs/FEATURES.md §3)."""
    takes: List[Take] = []
    for f in sorted(root.glob("*/*.json")):
        d = json.loads(f.read_text())
        if d.get("format") != "psl-collect-v1":
            continue
        left_handed = d["signer"]["handedness"] == "left"
        for tk in d["takes"]:
            frames = [RawFrame.from_json(x) for x in tk["frames"]]
            if left_handed:
                frames = [mirror_frame(x) for x in frames]
            label = NONE if tk["kind"] == "none" else tk["label"]
            takes.append(Take(frames, label, tk["kind"], d["signer"]["code"], d["session"]["id"], "collected", tk["id"]))
    return takes


def split_takes(takes: List[Take], seed: int = 0, test_signers: Optional[List[str]] = None) -> Split:
    """Signer-independent split when there are at least 3 signers; otherwise by
    session; otherwise by take. The weaker modes give optimistic numbers, and the
    evaluation report says so."""
    rng = np.random.default_rng(seed)
    signers = sorted({t.signer for t in takes})
    sessions = sorted({t.session for t in takes})
    if len(signers) >= 3:
        order = list(rng.permutation(signers))
        test = test_signers or [order[0]]
        rest = [s for s in order if s not in test]
        val = [rest[0]]
        sp = Split("signer", note=f"test signers: {', '.join(test)}; val signer: {val[0]}; train signers: {len(rest) - 1}")
        for t in takes:
            (sp.test if t.signer in test else sp.val if t.signer in val else sp.train).append(t)
        return sp
    if len(sessions) >= 3:
        order = list(rng.permutation(sessions))
        sp = Split("session", note=f"only {len(signers)} signer(s): split by recording session, so the "
                                   "test set contains signers seen in training. OPTIMISTIC.")
        for t in takes:
            (sp.test if t.session == order[0] else sp.val if t.session == order[1] else sp.train).append(t)
        return sp
    sp = Split("take", note=f"only {len(signers)} signer(s) and {len(sessions)} session(s): split by take. "
                            "Test takes come from the same person and session as training. VERY OPTIMISTIC.")
    by_label: dict = {}
    for t in takes:
        by_label.setdefault(t.label, []).append(t)
    for label, ts in by_label.items():
        idx = rng.permutation(len(ts))
        n_test = max(1, round(0.2 * len(ts))) if len(ts) >= 3 else 0
        n_val = max(1, round(0.15 * len(ts))) if len(ts) >= 4 else 0
        for k, i in enumerate(idx):
            (sp.test if k < n_test else sp.val if k < n_test + n_val else sp.train).append(ts[i])
    return sp


def activity_center(take: Take) -> float:
    """Middle of the span where hands are visible (where the sign is); take middle if none."""
    ts = [f.t for f in take.frames if f.left is not None or f.right is not None]
    if not ts:
        return 0.5 * (take.frames[0].t + take.frames[-1].t)
    return 0.5 * (ts[0] + ts[-1])


def window_ends(take: Take, n: int, rng: Optional[np.random.Generator] = None, jitter_ms: float = 0.0) -> List[float]:
    """Window end times for one take. Sign takes: windows centred on the hand
    activity (offsets in ±250 ms). None takes: spread over the whole take."""
    t0, t1 = take.frames[0].t, take.frames[-1].t
    if take.kind == "sign":
        c = activity_center(take) + WINDOW_MS / 2
        offs = np.linspace(-250, 250, n) if n > 1 else np.array([0.0])
        ends = c + offs
    else:
        ends = np.linspace(t0 + WINDOW_MS * 0.6, max(t0 + WINDOW_MS * 0.6, t1), n)
    if rng is not None and jitter_ms:
        ends = ends + rng.uniform(-jitter_ms, jitter_ms, size=len(ends))
    return [float(e) for e in ends]


# ---------------------------------------------------------------- augmentation

def _transform(p: Optional[np.ndarray], cx: float, cy: float, a: float, cos: float, sin: float, k: float,
               noise: float, rng: np.random.Generator) -> Optional[np.ndarray]:
    if p is None:
        return None
    x = (p[:, 0] * a - cx) * k
    y = (p[:, 1] - cy) * k
    xr = x * cos - y * sin
    yr = x * sin + y * cos
    out = np.column_stack([(xr + cx) / a, yr + cy, p[:, 2] * k])
    if noise:
        out[:, :2] += rng.normal(0, noise, size=(len(out), 2))
    return out


def augment(take: Take, rng: np.random.Generator) -> List[RawFrame]:
    """Random time warp, frame drops (slow devices), rotation/scale, jitter and
    short hand dropouts (detector flicker). Train split only."""
    frames = take.frames
    t_mid = 0.5 * (frames[0].t + frames[-1].t)
    warp = math.exp(rng.uniform(math.log(0.8), math.log(1.25)))
    keep_p = rng.uniform(0.4, 1.0)
    ang = math.radians(rng.uniform(-8, 8))
    cos, sin = math.cos(ang), math.sin(ang)
    k = rng.uniform(0.9, 1.1)
    noise = rng.uniform(0.0, 0.003)
    a = frames[0].aspect
    cx, cy = 0.5 * a, 0.5
    drop_side = rng.choice(["left", "right"]) if rng.random() < 0.15 else None
    drop_at = rng.integers(0, len(frames))
    drop_len = int(rng.integers(1, 4))
    out: List[RawFrame] = []
    for i, f in enumerate(frames):
        if rng.random() > keep_p and i not in (0, len(frames) - 1):
            continue
        left = _transform(f.left, cx, cy, f.aspect, cos, sin, k, noise, rng)
        right = _transform(f.right, cx, cy, f.aspect, cos, sin, k, noise, rng)
        if drop_side and drop_at <= i < drop_at + drop_len:
            if drop_side == "left":
                left = None
            else:
                right = None
        out.append(RawFrame(t=t_mid + (f.t - t_mid) * warp, aspect=f.aspect,
                            pose=_transform(f.pose, cx, cy, f.aspect, cos, sin, k, noise, rng), left=left, right=right))
    return out


def take_windows(take: Take, n: int, rng: Optional[np.random.Generator], aug: bool,
                 T: int = WINDOW_T, window_ms: float = WINDOW_MS) -> np.ndarray:
    """(n, T, 137) windows from one take, augmented if `aug`."""
    frames = augment(take, rng) if aug else take.frames
    feats = recording_features(frames)
    times = [f.t for f in frames]
    if aug:
        # Window ends follow the time warp: recompute on the warped take.
        warped = Take(frames, take.label, take.kind, take.signer, take.session, take.source, take.take_id)
        ends = window_ends(warped, n, rng, jitter_ms=120)
    else:
        ends = window_ends(take, n)
    return np.stack([resample_window(times, feats, e, T, window_ms) for e in ends])


def describe(takes: List[Take]) -> str:
    c = Counter(t.label for t in takes)
    return ", ".join(f"{k}:{v}" for k, v in sorted(c.items()))
