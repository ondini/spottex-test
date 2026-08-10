"""Read-only adapter for the annual AQUA SPP reference data in /home/michal/Studie.

It emits only the physical 15-minute load and calibrated PV arrays to stdout.
No customer data is copied into the SpotTEX repository.
"""
from __future__ import annotations

import json
import os
import sys


study_analysis = os.environ.get("STUDY_ANALYSIS_ROOT", "/home/michal/Studie/aqua_spp_analyza")
sys.path.insert(0, study_analysis)

import aqua_sim as simulation  # noqa: E402


prepared = simulation.prepare("existing")
start = simulation.WARMUP_DAYS * 96
payload = {
    "intervalMinutes": 15,
    "startAt": prepared["idx"][start].isoformat(),
    "loadKwh": (prepared["load"][start:] * simulation.DT).round(8).tolist(),
    "productionKwh": (prepared["pv"][start:] * simulation.DT).round(8).tolist(),
    "buyCzkKwh": (prepared["price"][start:] + simulation.DIST_CZK_KWH).round(8).tolist(),
    "sellCzkKwh": (prepared["price"][start:] - simulation.EXPORT_FEE).round(8).tolist(),
}
json.dump(payload, sys.stdout, separators=(",", ":"))
