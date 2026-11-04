"""PSL training pipeline: prepare -> train -> evaluate -> export.

One command runs everything (CPU is fine; also works in Google Colab):

    python -m training.pipeline all

Steps can be run separately: `prepare`, `train`, `evaluate`, `export`.
Training is resumable: re-running `train` continues from the last checkpoint
in the run directory (default training/runs/latest). Use --fresh to restart.

Only REAL recordings are used (data/collected/, imported with
training/import_collected.py). There is no synthetic-data option here on
purpose; synthetic data exists only in training/tests.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pickle
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from training.psl.dataset import NONE, Split, describe, load_collected, split_takes, take_windows  # noqa: E402
from training.psl.features import FEATURE_DIM, FEATURE_VERSION, WINDOW_MS, WINDOW_T  # noqa: E402


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ----------------------------------------------------------------- prepare

def cmd_prepare(a) -> None:
    takes = load_collected(Path(a.data_root))
    if not takes:
        raise SystemExit(f"No recordings found in {a.data_root}. Record with the Collect page and import with "
                         "`python -m training.import_collected <files>`.")
    counts = Counter(t.label for t in takes)
    keep = {l for l, n in counts.items() if n >= a.min_takes}
    dropped = sorted(set(counts) - keep)
    takes = [t for t in takes if t.label in keep]
    if NONE not in keep:
        raise SystemExit("No 'none' recordings: the model must learn when no sign is being made.")
    split = split_takes(takes, seed=a.seed)
    labels = [NONE] + sorted(l for l in keep if l != NONE)
    run = Path(a.run_dir)
    run.mkdir(parents=True, exist_ok=True)
    with open(run / "prepared.pkl", "wb") as fh:
        pickle.dump({"split": split, "labels": labels, "dropped": dropped}, fh)
    info = {"split_mode": split.mode, "note": split.note, "labels": labels, "dropped_too_few_takes": dropped,
            "signers": sorted({t.signer for t in takes}),
            "counts": {k: describe(getattr(split, k)) for k in ("train", "val", "test")}}
    (run / "prepared.json").write_text(json.dumps(info, indent=2))
    log(f"prepared {len(takes)} takes, {len(labels)} labels, split by {split.mode}. {split.note}")
    if dropped:
        log(f"dropped labels with fewer than {a.min_takes} takes: {', '.join(dropped)}")


def load_prepared(run: Path):
    with open(run / "prepared.pkl", "rb") as fh:
        return pickle.load(fh)


def windows_for(takes, labels, n, rng, aug):
    xs, ys, tids = [], [], []
    idx = {l: i for i, l in enumerate(labels)}
    for k, t in enumerate(takes):
        w = take_windows(t, n, rng, aug)
        xs.append(w)
        ys += [idx[t.label]] * len(w)
        tids += [k] * len(w)
    if not xs:
        return np.zeros((0, WINDOW_T, FEATURE_DIM), np.float32), np.zeros(0, np.int64), np.zeros(0, np.int64)
    return np.concatenate(xs).astype(np.float32), np.asarray(ys, np.int64), np.asarray(tids, np.int64)


# ------------------------------------------------------------------- train

def macro_f1(y, p, n):
    f1s = []
    for c in range(n):
        tp = np.sum((p == c) & (y == c))
        fp = np.sum((p == c) & (y != c))
        fn = np.sum((p != c) & (y == c))
        if tp + fn == 0:
            continue
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn)
        f1s.append(0.0 if prec + rec == 0 else 2 * prec * rec / (prec + rec))
    return float(np.mean(f1s)) if f1s else 0.0


def cmd_train(a) -> None:
    import torch
    from torch import nn
    from training.psl.model import SignClassifier, count_params

    torch.set_num_threads(max(1, a.threads))
    run = Path(a.run_dir)
    prep = load_prepared(run)
    split: Split = prep["split"]
    labels = prep["labels"]
    rng = np.random.default_rng(a.seed)
    torch.manual_seed(a.seed)
    xv, yv, _ = windows_for(split.val, labels, 3, None, aug=False)
    model = SignClassifier(len(labels))
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=1e-3)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=a.epochs)
    counts = Counter(t.label for t in split.train)
    weights = torch.tensor([1.0 / max(1, counts[l]) for l in labels], dtype=torch.float32)
    weights = weights / weights.mean()
    loss_fn = nn.CrossEntropyLoss(weight=weights, label_smoothing=0.05)
    ckpt = run / "checkpoint.pt"
    start, best, history = 0, -1.0, []
    if ckpt.exists() and not a.fresh:
        st = torch.load(ckpt, weights_only=False)
        if st["labels"] == labels:
            model.load_state_dict(st["model"]); opt.load_state_dict(st["opt"]); sched.load_state_dict(st["sched"])
            start, best, history = st["epoch"] + 1, st["best"], st["history"]
            rng = np.random.default_rng(a.seed + start)
            log(f"resuming at epoch {start}")
        else:
            log("labels changed since the checkpoint; starting fresh")
    log(f"model parameters: {count_params(model):,} (~{count_params(model) * 4 / 1e6:.2f} MB float32)")
    for epoch in range(start, a.epochs):
        model.train()
        x, y, _ = windows_for(split.train, labels, a.windows_per_take, rng, aug=True)
        perm = rng.permutation(len(x))
        total = 0.0
        for i in range(0, len(x), a.batch):
            b = perm[i:i + a.batch]
            if len(b) < 2:
                continue
            opt.zero_grad()
            loss = loss_fn(model(torch.from_numpy(x[b])), torch.from_numpy(y[b]))
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 2.0)
            opt.step()
            total += float(loss) * len(b)
        sched.step()
        model.eval()
        with torch.no_grad():
            pv = model(torch.from_numpy(xv)).argmax(1).numpy() if len(xv) else np.zeros(0)
        f1 = macro_f1(yv, pv, len(labels)) if len(xv) else 0.0
        acc = float(np.mean(pv == yv)) if len(xv) else 0.0
        history.append({"epoch": epoch, "loss": total / max(1, len(x)), "val_acc": acc, "val_macro_f1": f1})
        if f1 > best:
            best = f1
            torch.save({"model": model.state_dict(), "labels": labels}, run / "best.pt")
        torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "sched": sched.state_dict(), "epoch": epoch,
                    "best": best, "history": history, "labels": labels}, ckpt)
        log(f"epoch {epoch + 1}/{a.epochs} loss {history[-1]['loss']:.3f} val acc {acc:.3f} macro-F1 {f1:.3f}")
    (run / "history.json").write_text(json.dumps(history, indent=1))


# ---------------------------------------------------------------- evaluate

def predict(model, x):
    import torch
    with torch.no_grad():
        return torch.softmax(model(torch.from_numpy(x)), 1).numpy() if len(x) else np.zeros((0, 1))


def tune_thresholds(probs, y, none_idx):
    """Pick confidence and top-2 margin on validation windows. A window is
    accepted as a sign only if both are met; otherwise it counts as 'none'.
    Objective: correct sign accepts minus 3x wrong sign accepts (a confident
    wrong word is worse than a visible gap)."""
    best = (0.6, 0.2, -1e9)
    if len(probs) == 0:
        return {"confidence": best[0], "margin": best[1]}
    top = probs.argmax(1)
    srt = np.sort(probs, 1)
    conf, marg = srt[:, -1], srt[:, -1] - (srt[:, -2] if probs.shape[1] > 1 else 0)
    for c in np.arange(0.3, 0.96, 0.05):
        for m in np.arange(0.0, 0.61, 0.05):
            acc = (conf >= c) & (marg >= m) & (top != none_idx)
            good = np.sum(acc & (top == y))
            bad = np.sum(acc & (top != y))
            score = good - 3 * bad
            if score > best[2]:
                best = (float(c), float(m), score)
    return {"confidence": round(best[0], 2), "margin": round(best[1], 2)}


def cmd_evaluate(a) -> None:
    import torch
    from training.psl.model import SignClassifier

    run = Path(a.run_dir)
    prep = load_prepared(run)
    split: Split = prep["split"]
    labels = prep["labels"]
    st = torch.load(run / "best.pt", weights_only=False)
    model = SignClassifier(len(labels))
    model.load_state_dict(st["model"])
    model.eval()
    xv, yv, _ = windows_for(split.val, labels, 3, None, aug=False)
    thr = tune_thresholds(predict(model, xv), yv, labels.index(NONE))
    xt, yt, tid = windows_for(split.test, labels, 3, None, aug=False)
    pt = predict(model, xt)
    pred = pt.argmax(1) if len(pt) else np.zeros(0, int)
    n = len(labels)
    cm = np.zeros((n, n), int)
    for t_, p_ in zip(yt, pred):
        cm[t_, p_] += 1
    # Take-level: average the window probabilities of each take.
    take_pred, take_true = [], []
    for k in sorted(set(tid.tolist())):
        m = tid == k
        take_pred.append(int(pt[m].mean(0).argmax()))
        take_true.append(int(yt[m][0]))
    take_pred, take_true = np.asarray(take_pred), np.asarray(take_true)
    per_class = []
    for c, l in enumerate(labels):
        tp = cm[c, c]; fp = cm[:, c].sum() - tp; fn = cm[c, :].sum() - tp
        per_class.append({"label": l, "support_windows": int(cm[c, :].sum()),
                          "precision": float(tp / (tp + fp)) if tp + fp else None,
                          "recall": float(tp / (tp + fn)) if tp + fn else None})
    metrics = {"window_accuracy": float(np.mean(pred == yt)) if len(yt) else None,
               "window_macro_f1": macro_f1(yt, pred, n) if len(yt) else None,
               "take_accuracy": float(np.mean(take_pred == take_true)) if len(take_true) else None,
               "test_takes": int(len(take_true)), "test_windows": int(len(yt)),
               "thresholds": thr, "split_mode": split.mode, "split_note": split.note,
               "signers": sorted({t.signer for t in split.train + split.val + split.test}),
               "per_class": per_class, "confusion": cm.tolist(), "labels": labels,
               "counts": {k: describe(getattr(split, k)) for k in ("train", "val", "test")},
               "dropped": prep["dropped"]}
    (run / "metrics.json").write_text(json.dumps(metrics, indent=1))
    write_report(metrics, Path(a.report))
    log(f"test: window acc {metrics['window_accuracy']}, take acc {metrics['take_accuracy']} "
        f"({split.mode} split). Report: {a.report}")


def fmt(v):
    return "—" if v is None else f"{v:.2f}"


def write_report(m: dict, path: Path) -> None:
    labels = m["labels"]
    lines = [
        "# Evaluation", "",
        "Generated by `python -m training.pipeline evaluate`. Numbers are measured on held-out test",
        "recordings; nothing here is estimated.", "",
        f"- **Split:** by {m['split_mode']}. {m['split_note']}",
        f"- **Signers in the data:** {len(m['signers'])}",
        f"- **Takes:** train {m['counts']['train']}; val {m['counts']['val']}; test {m['counts']['test']}",
        f"- **Labels dropped for too few takes:** {', '.join(m['dropped']) or 'none'}",
        f"- **Test:** {m['test_takes']} takes, {m['test_windows']} windows (3 per take)",
        f"- **Take accuracy** (mean of window probabilities): {fmt(m['take_accuracy'])}",
        f"- **Window accuracy:** {fmt(m['window_accuracy'])}; window macro-F1: {fmt(m['window_macro_f1'])}",
        f"- **Thresholds tuned on validation:** confidence ≥ {m['thresholds']['confidence']}, margin ≥ {m['thresholds']['margin']}",
        "", "## Per class (test windows)", "", "| Label | Support | Precision | Recall |", "|---|---|---|---|",
    ]
    for r in m["per_class"]:
        lines.append(f"| {r['label']} | {r['support_windows']} | {fmt(r['precision'])} | {fmt(r['recall'])} |")
    lines += ["", "## Confusion matrix (rows = true, columns = predicted)", "",
              "| | " + " | ".join(labels) + " |", "|---|" + "---|" * len(labels)]
    for l, row in zip(labels, m["confusion"]):
        lines.append(f"| **{l}** | " + " | ".join(str(v) for v in row) + " |")
    lines.append("")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines))


# ------------------------------------------------------------------ export

def cmd_export(a) -> None:
    import onnxruntime as ort
    import torch
    from training.psl.model import SignClassifier

    run = Path(a.run_dir)
    labels = load_prepared(run)["labels"]
    st = torch.load(run / "best.pt", weights_only=False)
    model = SignClassifier(len(labels))
    model.load_state_dict(st["model"])
    model.eval()
    tmp = run / "classifier.onnx"
    dummy = torch.zeros(1, WINDOW_T, FEATURE_DIM)
    torch.onnx.export(model, (dummy,), str(tmp), input_names=["x"], output_names=["logits"], opset_version=17,
                      dynamo=False)
    # The exported graph must match PyTorch.
    sess = ort.InferenceSession(str(tmp), providers=["CPUExecutionProvider"])
    rng = np.random.default_rng(0)
    for _ in range(5):
        x = rng.normal(0, 1, size=(1, WINDOW_T, FEATURE_DIM)).astype(np.float32)
        with torch.no_grad():
            ref = model(torch.from_numpy(x)).numpy()
        got = sess.run(["logits"], {"x": x})[0]
        if not np.allclose(ref, got, atol=1e-4):
            raise SystemExit(f"ONNX output differs from PyTorch (max diff {np.abs(ref - got).max()})")
    data = tmp.read_bytes()
    digest = hashlib.sha256(data).hexdigest()[:10]
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("classifier.*.onnx"):
        old.unlink()
    name = f"classifier.{digest}.onnx"
    (out / name).write_bytes(data)
    metrics_path = run / "metrics.json"
    metrics = json.loads(metrics_path.read_text()) if metrics_path.exists() else {}
    sidecar = {"feature_version": FEATURE_VERSION, "T": WINDOW_T, "window_ms": WINDOW_MS, "feature_dim": FEATURE_DIM,
               "labels": labels, "file": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
               "thresholds": metrics.get("thresholds"),
               "trained_on": {"signers": metrics.get("signers"), "split_mode": metrics.get("split_mode"),
                              "counts": metrics.get("counts")},
               "metrics": {k: metrics.get(k) for k in ("take_accuracy", "window_accuracy", "window_macro_f1")}}
    (out / "classifier.json").write_text(json.dumps(sidecar, indent=2))
    log(f"exported {out / name} ({len(data) / 1e6:.2f} MB) and classifier.json")


# --------------------------------------------------------------------- cli

def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["prepare", "train", "evaluate", "export", "all"])
    ap.add_argument("--data-root", default=str(ROOT / "data" / "collected"))
    ap.add_argument("--run-dir", default=str(ROOT / "training" / "runs" / "latest"))
    ap.add_argument("--report", default=str(ROOT / "docs" / "EVALUATION.md"))
    ap.add_argument("--out-dir", default=str(ROOT / "public" / "models"))
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--windows-per-take", type=int, default=4)
    ap.add_argument("--min-takes", type=int, default=5, help="drop labels with fewer takes than this")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--fresh", action="store_true", help="ignore an existing checkpoint")
    a = ap.parse_args(argv)
    steps = ["prepare", "train", "evaluate", "export"] if a.command == "all" else [a.command]
    for s in steps:
        log(f"== {s}")
        globals()[f"cmd_{s}"](a)


if __name__ == "__main__":
    main()
