"""Model input features, version psl-f1.

The single definition is docs/FEATURES.md. src/features/features.ts implements
the same thing; tests/golden/ keeps the two in agreement (CI). Change both or
neither, and bump FEATURE_VERSION for any change in output.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence

import numpy as np

FEATURE_VERSION = "psl-f1"
FEATURE_DIM = 137
WINDOW_T = 32
WINDOW_MS = 1600.0

LEFT_SHAPE, LEFT_POS, LEFT_PRESENT = 0, 60, 62
RIGHT_SHAPE, RIGHT_POS, RIGHT_PRESENT = 63, 123, 125
POSE, POSE_PRESENT = 126, 136

POSE_PAIRS = [(1, 4), (2, 5), (3, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16),
              (17, 18), (19, 20), (21, 22), (23, 24), (25, 26), (27, 28), (29, 30), (31, 32)]

BLOCKS = [(LEFT_SHAPE, LEFT_PRESENT, LEFT_PRESENT),
          (RIGHT_SHAPE, RIGHT_PRESENT, RIGHT_PRESENT),
          (POSE, POSE_PRESENT, POSE_PRESENT)]


@dataclass
class RawFrame:
    """docs/FEATURES.md §1. Arrays are (33,3) / (21,3) float, or None if missing."""
    t: float
    aspect: float
    pose: Optional[np.ndarray]
    left: Optional[np.ndarray]
    right: Optional[np.ndarray]

    @staticmethod
    def from_json(d: dict) -> "RawFrame":
        arr = lambda v: None if v is None else np.asarray(v, dtype=np.float64)
        return RawFrame(float(d["t"]), float(d["aspect"]), arr(d.get("pose")), arr(d.get("left")), arr(d.get("right")))


def mirror_frame(f: RawFrame) -> RawFrame:
    """docs/FEATURES.md §3: opposite-handed form."""
    def flip(p):
        if p is None:
            return None
        q = p.copy()
        q[:, 0] = 1.0 - q[:, 0]
        return q
    pose = flip(f.pose)
    if pose is not None:
        for a, b in POSE_PAIRS:
            pose[[a, b]] = pose[[b, a]]
    return RawFrame(f.t, f.aspect, pose, flip(f.right), flip(f.left))


def _body_frame(f: RawFrame):
    if f.pose is None:
        return None
    a = f.aspect
    l, r = f.pose[11], f.pose[12]
    lx, rx = l[0] * a, r[0] * a
    s = float(np.hypot(lx - rx, l[1] - r[1]))
    if not s >= 1e-6:
        return None
    return ((lx + rx) / 2.0, (l[1] + r[1]) / 2.0, s)


def carry_body_frames(frames: Sequence[RawFrame]):
    own = [_body_frame(f) for f in frames]
    out = [None] * len(frames)
    last = None
    for i, b in enumerate(own):
        if b is not None:
            last = b
        out[i] = last
    nxt = None
    for i in range(len(frames) - 1, -1, -1):
        if own[i] is not None:
            nxt = own[i]
        if out[i] is None:
            out[i] = nxt
    return out


def _hand_shape(out: np.ndarray, off: int, hand: np.ndarray, a: float) -> None:
    wx, wy, wz = hand[0, 0] * a, hand[0, 1], hand[0, 2] * a
    h = float(np.hypot(hand[9, 0] * a - wx, hand[9, 1] - wy))
    if not h >= 1e-6:
        h = 1e-6
    p = hand[1:21]
    v = np.stack([(p[:, 0] * a - wx) / h, (p[:, 1] - wy) / h, (p[:, 2] * a - wz) / h], axis=1)
    out[off:off + 60] = v.reshape(-1)


def frame_features(f: RawFrame, bf) -> np.ndarray:
    out = np.zeros(FEATURE_DIM, dtype=np.float64)
    a = f.aspect

    def body(p, o):
        if bf is None:
            return
        ox, oy, s = bf
        out[o] = (p[0] * a - ox) / s
        out[o + 1] = (p[1] - oy) / s

    for hand, shape_off, pos_off, pres_off, pose_wrist in (
        (f.left, LEFT_SHAPE, LEFT_POS, LEFT_PRESENT, 15),
        (f.right, RIGHT_SHAPE, RIGHT_POS, RIGHT_PRESENT, 16),
    ):
        if hand is None:
            continue
        _hand_shape(out, shape_off, hand, a)
        body(f.pose[pose_wrist] if f.pose is not None else hand[0], pos_off)
        out[pres_off] = 1.0
    if f.pose is not None:
        for k, idx in enumerate((13, 14, 15, 16, 0)):
            body(f.pose[idx], POSE + 2 * k)
        out[POSE_PRESENT] = 1.0
    return out.astype(np.float32)


def recording_features(frames: Sequence[RawFrame]) -> np.ndarray:
    """(n_frames, 137) float32."""
    bfs = carry_body_frames(frames)
    if not frames:
        return np.zeros((0, FEATURE_DIM), dtype=np.float32)
    return np.stack([frame_features(f, b) for f, b in zip(frames, bfs)])


def resample_window(times: Sequence[float], feats: np.ndarray, t_end: float,
                    T: int = WINDOW_T, window_ms: float = WINDOW_MS) -> np.ndarray:
    """docs/FEATURES.md §4. Returns (T, 137) float32."""
    out = np.zeros((T, FEATURE_DIM), dtype=np.float32)
    n = len(times)
    if n == 0:
        return out
    j = 0
    for k in range(T):
        tk = t_end - window_ms + (k * window_ms) / (T - 1)
        while j < n and times[j] < tk:
            j += 1
        if j == 0:
            ia = ib = 0
        elif j == n:
            ia = ib = n - 1
        else:
            ia, ib = j - 1, j
        fa, fb = feats[ia], feats[ib]
        if ia == ib:
            out[k] = fa
            continue
        ta, tb = times[ia], times[ib]
        w = (tk - ta) / (tb - ta)
        near = fa if (tk - ta) <= (tb - tk) else fb
        for s, e, flag in BLOCKS:
            out[k, flag] = near[flag]
            if near[flag] == 0:
                continue
            has_a, has_b = fa[flag] != 0, fb[flag] != 0
            if has_a and has_b:
                a64, b64 = fa[s:e].astype(np.float64), fb[s:e].astype(np.float64)
                out[k, s:e] = a64 + (b64 - a64) * w
            else:
                out[k, s:e] = (fa if has_a else fb)[s:e]
    return out
