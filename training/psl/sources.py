"""Converters from source datasets to raw frames (docs/FEATURES.md §1)."""
from __future__ import annotations

import csv
from pathlib import Path
from typing import List

import numpy as np

from .features import RawFrame

# PSL dictionary (sign-language-translator/sign-language-datasets, CC BY 4.0):
# 640x480 video at 25 fps; CSV rows of 75 landmarks x (x, y, z, a, b):
# 33 pose, 21 left hand, 21 right hand; a missing hand is all zeros.
# Verified on all 788 files, see docs/DATASETS.md.
PSL_DICT_FPS = 25.0
PSL_DICT_ASPECT = 640 / 480


def _block_or_none(block: np.ndarray):
    return None if not np.any(block) else block.astype(np.float64)


def psl_dictionary_csv(path: Path) -> List[RawFrame]:
    with open(path, newline="") as fh:
        rows = list(csv.reader(fh))[1:]
    arr = np.asarray(rows, dtype=np.float64).reshape(len(rows), 75, 5)[:, :, :3]
    frames = []
    for i, fr in enumerate(arr):
        frames.append(RawFrame(
            t=i * 1000.0 / PSL_DICT_FPS,
            aspect=PSL_DICT_ASPECT,
            pose=_block_or_none(fr[0:33]),
            left=_block_or_none(fr[33:54]),
            right=_block_or_none(fr[54:75]),
        ))
    return frames


def frames_to_json(frames: List[RawFrame]) -> list:
    r = lambda a: None if a is None else np.round(a, 6).tolist()
    return [{"t": f.t, "aspect": f.aspect, "pose": r(f.pose), "left": r(f.left), "right": r(f.right)} for f in frames]
