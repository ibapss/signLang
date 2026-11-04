"""Small temporal classifier: 1D-CNN + bidirectional GRU over a (T, 137) window."""
from __future__ import annotations

import torch
from torch import nn

from .features import FEATURE_DIM


class SignClassifier(nn.Module):
    def __init__(self, n_classes: int, width: int = 96, dropout: float = 0.3):
        super().__init__()
        self.inp = nn.LayerNorm(FEATURE_DIM)
        self.conv = nn.Sequential(
            nn.Conv1d(FEATURE_DIM, width, kernel_size=5, padding=2),
            nn.BatchNorm1d(width),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Conv1d(width, width, kernel_size=5, padding=2),
            nn.BatchNorm1d(width),
            nn.ReLU(),
        )
        self.gru = nn.GRU(width, width, batch_first=True, bidirectional=True)
        self.head = nn.Sequential(nn.Dropout(dropout), nn.Linear(4 * width, n_classes))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, T, F)
        h = self.inp(x).transpose(1, 2)        # (B, F, T)
        h = self.conv(h).transpose(1, 2)       # (B, T, W)
        h, _ = self.gru(h)                     # (B, T, 2W)
        pooled = torch.cat([h.mean(dim=1), h.max(dim=1).values], dim=1)
        return self.head(pooled)               # (B, n_classes) logits


def count_params(m: nn.Module) -> int:
    return sum(p.numel() for p in m.parameters())
