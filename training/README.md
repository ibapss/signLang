# Training

Python pipeline that turns recordings into the in-browser sign classifier.
Pinned requirements, CPU-friendly, resumable.

## One command

From the repo root:

```bash
python3 -m venv training/.venv
training/.venv/bin/pip install -r training/requirements-train.txt
training/.venv/bin/python -m training.pipeline all
```

This runs **prepare → train → evaluate → export**:

- **prepare:** loads `data/collected/` and drops labels with fewer than 5 takes.
  It splits by signer when there are at least 3 signers, otherwise by session
  or take, and the report then says the numbers are optimistic.
- **train:** 1D-CNN + bidirectional GRU (about 0.3 M parameters, about 1 MB)
  on 32×137 feature windows (`docs/FEATURES.md`). It uses time-warp,
  frame-drop, rotation, jitter and hand-dropout augmentation. It checkpoints
  every epoch, so running it again resumes. `--fresh` restarts.
- **evaluate:** writes per-class precision/recall and a confusion matrix to
  `docs/EVALUATION.md`, and tunes the confidence/margin thresholds on the
  validation split.
- **export:** writes `public/models/classifier.<hash>.onnx` and
  `classifier.json` (labels, feature version, thresholds, metrics), after
  checking that ONNX Runtime matches PyTorch.

## Google Colab

```python
!git clone https://github.com/ibapss/signLang && cd signLang && pip install -r training/requirements-train.txt
!cd signLang && python -m training.pipeline all
```

Colab has PyTorch already; the pinned version is installed for reproducibility.

## Adding recordings

Files downloaded from the app's **Collect** page:

```bash
training/.venv/bin/python -m training.import_collected ~/Downloads/psl-collect-*.json
```

They are validated and copied to `data/collected/<signer>/<session>.json`
(landmarks only, no video). Commit them.

## Tests

```bash
training/.venv/bin/python -m pytest -q -c training/pytest.ini training/tests
```

`test_pipeline.py` runs the whole pipeline on **synthetic** recordings to check
the code. The pipeline itself has no option to train on synthetic data.
