import sys
from pathlib import Path

# Make `training.*` importable when pytest runs from the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
