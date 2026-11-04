"""Import files exported by the Collect page (format "psl-collect-v1").

    python -m training.import_collected path/to/psl-collect-*.json [...]

Each file is validated and copied to data/collected/<signer>/<session>.json.
Those are our own landmark recordings (no video) and ARE committed to git.
A summary of takes per label and signer is printed. Re-importing the same
session replaces it.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "collected"
SUPPORTED_FEATURE_VERSIONS = {"psl-f1"}


class InvalidFile(ValueError):
    pass


def validate(d: dict, name: str) -> None:
    def need(cond, msg):
        if not cond:
            raise InvalidFile(f"{name}: {msg}")

    need(d.get("format") == "psl-collect-v1", "not a psl-collect-v1 file")
    need(d.get("feature_version") in SUPPORTED_FEATURE_VERSIONS, f"unsupported feature_version {d.get('feature_version')}")
    need(d.get("consent", {}).get("agreed") is True, "consent not recorded")
    s = d.get("signer", {})
    need(isinstance(s.get("code"), str) and 3 <= len(s["code"]) <= 16, "bad signer code")
    need(s.get("handedness") in ("right", "left"), "bad handedness")
    need(isinstance(d.get("session", {}).get("id"), str), "missing session id")
    takes = d.get("takes")
    need(isinstance(takes, list) and takes, "no takes")
    for tk in takes:
        need(isinstance(tk.get("label"), str) and tk.get("kind") in ("sign", "none"), f"bad take {tk.get('id')}")
        frames = tk.get("frames")
        need(isinstance(frames, list) and len(frames) >= 5, f"take {tk.get('id')} has too few frames")
        last = -float("inf")
        for f in frames:
            need(f["t"] > last, f"take {tk.get('id')}: timestamps not increasing")
            last = f["t"]
            need(f.get("aspect", 0) > 0, "bad aspect")
            for key, n in (("pose", 33), ("left", 21), ("right", 21)):
                v = f.get(key)
                need(v is None or (len(v) == n and all(len(p) == 3 for p in v)), f"bad {key} block")


def import_file(path: Path, out_root: Path = OUT) -> Path:
    d = json.loads(path.read_text())
    validate(d, path.name)
    signer = d["signer"]["code"].upper()
    dest = out_root / signer / f"{d['session']['id']}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(d, separators=(",", ":")))
    return dest


def summarize(root: Path = OUT) -> str:
    per_label: Counter = Counter()
    signers: dict = {}
    for f in sorted(root.glob("*/*.json")):
        d = json.loads(f.read_text())
        code = d["signer"]["code"]
        signers.setdefault(code, Counter())
        for tk in d["takes"]:
            per_label[tk["label"]] += 1
            signers[code][tk["label"]] += 1
    lines = [f"{len(signers)} signer(s), {sum(per_label.values())} takes"]
    for label, n in sorted(per_label.items()):
        lines.append(f"  {label:12s} {n:4d}   " + " ".join(f"{c}:{signers[c][label]}" for c in sorted(signers)))
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", type=Path)
    args = ap.parse_args(argv)
    bad = 0
    for p in args.files:
        try:
            print(f"imported {p} -> {import_file(p).relative_to(ROOT)}")
        except (InvalidFile, json.JSONDecodeError, KeyError) as e:
            bad += 1
            print(f"REJECTED {p}: {e}", file=sys.stderr)
    print(summarize())
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
