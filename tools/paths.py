#!/usr/bin/env python3
"""Portable paths shared by the optional catalog-import utilities.

Environment variables:
  INTEGRALL_PROJECT_ROOT      Project root (defaults to the parent of tools/)
  INTEGRALL_SOURCE_PDF_DIR    Directory containing the source catalog PDFs
                              (defaults to <project>/catalogos-fonte)
"""
from __future__ import annotations

import os
from pathlib import Path


def _resolved_env(name: str, fallback: Path) -> Path:
    raw = os.environ.get(name, '').strip()
    return Path(raw).expanduser().resolve() if raw else fallback.resolve()


PROJECT_ROOT = _resolved_env('INTEGRALL_PROJECT_ROOT', Path(__file__).resolve().parents[1])
SOURCE_PDF_DIR = _resolved_env('INTEGRALL_SOURCE_PDF_DIR', PROJECT_ROOT / 'catalogos-fonte')
EXTRACT_DIR = PROJECT_ROOT / 'extract'
OUTPUT_DIR = PROJECT_ROOT / 'out'
PRODUCT_ASSET_DIR = PROJECT_ROOT / 'public' / 'assets' / 'products' / 'pdf'
