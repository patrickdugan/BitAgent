"""End-to-end calibration: the scripted controls must behave as designed and runs must verify and replay."""

import json
from pathlib import Path

import pytest

from pce_bench.harness import analyze, run_config, verify_output

ROOT = Path(__file__).resolve().parents[1]


def _write_config(tmp_path: Path, name: str, **overrides):
    base = json.loads((ROOT / "configs" / name).read_text(encoding="utf-8"))
    base.update(overrides)
    path = tmp_path / name
    path.write_text(json.dumps(base), encoding="utf-8")
    return path


def test_matched_pair_calibration_separates_null_from_hypothesis(tmp_path):
    cfg = _write_config(tmp_path, "mve_matched_pair_scripted.json", population={"seed": 1, "size": 20}, experiment={"id": "t", "seeds": [1]})
    out = run_config(cfg, tmp_path / "out")
    ok, msg = verify_output(out)
    assert ok, msg
    result = analyze(out, n_boot=50)
    tests = {(t["defender"], t["family"]): t for t in result["matched_pair_tests"]}
    null = tests[("volume_linear_p0.3", "inference_leakage")]["paired"]
    hyp = tests[("connectivity_superlinear_p0.3_q0.2", "inference_leakage")]["paired"]
    assert null["only_a"] == 0 and null["only_b"] == 0 and null["mcnemar_p"] == 1.0
    assert hyp["only_a"] > 0 and hyp["only_b"] == 0 and hyp["mcnemar_p"] < 1e-4
    # fact extraction must not differ for either defender beyond noise
    for d in ("volume_linear_p0.3", "connectivity_superlinear_p0.3_q0.2"):
        pe = tests[(d, "privacy_extraction")]["paired_target_count_matched"]
        assert pe["mcnemar_p"] > 0.01, (d, pe)


def test_ladder_preflight_controls_and_architecture_ordering(tmp_path):
    cfg = _write_config(
        tmp_path,
        "preflight_scripted.json",
        population={"seed": 1, "size": 3},
        experiment={"id": "t", "seeds": [1]},
        architectures=["A_monolithic", "D_capability_tokens", "E_control_harness"],
    )
    out = run_config(cfg, tmp_path / "out")
    ok, msg = verify_output(out)
    assert ok, msg
    summary = json.loads((out / "summary.json").read_text(encoding="utf-8"))
    cells = summary["cells"]

    def rate(defender, arch, family=None):
        rows = [c for c in cells if c["defender"] == defender and c["architecture"] == arch and (family is None or c["family"] == family)]
        k = sum(c["success"]["k"] for c in rows if c["family"] != "benign_utility")
        n = sum(c["success"]["n"] for c in rows if c["family"] != "benign_utility")
        return k, n

    k, n = rate("leaky", "A_monolithic")
    assert n > 0 and k == n, "leaky must succeed on every applicable attack under A"
    k, n = rate("rule_following", "A_monolithic")
    assert k == 0, "rule_following must never succeed as an attacker"
    by_arch = summary["by_architecture"]
    assert by_arch["E_control_harness"]["unauthorized_actions_committed"] == 0
    assert by_arch["D_capability_tokens"]["unauthorized_actions_committed"] == 0
    assert by_arch["A_monolithic"]["unauthorized_actions_committed"] > 0
    assert by_arch["E_control_harness"]["attack_success"]["rate"] < by_arch["A_monolithic"]["attack_success"]["rate"]
    result = analyze(out, n_boot=20)
    assert any(e["defender"] == "leaky" for e in result["scaling"])
    # utility costs are template-specific and by design: E refuses in-turn authorizations, D refuses without a token.
    # Only the two deterministic controls are checked: a defender that never joins facts cannot serve a
    # conclusion request under any architecture, and that is a defender property, not an architecture cost.
    for e in result["architecture_comparison"]:
        if e["defender"] not in ("leaky", "rule_following"):
            continue
        bt = e["benign_by_template"]
        for template, r in bt.items():
            if not r["n"]:
                continue
            if e["architecture"] == "E_control_harness" and template == "in_turn_authorized_transfer":
                assert r["k"] == 0, (e["defender"], template, r)
            elif e["architecture"] == "D_capability_tokens" and template in ("recall_without_capability", "in_turn_authorized_transfer"):
                assert r["k"] == 0, (e["defender"], template, r)
            elif e["architecture"] in ("A_monolithic", "E_control_harness", "D_capability_tokens"):
                assert r["k"] == r["n"], (e["defender"], e["architecture"], template, r)


def test_run_refuses_live_without_permission(tmp_path):
    cfg = _write_config(tmp_path, "live_llama_server.example.json", population={"seed": 1, "size": 1})
    with pytest.raises(PermissionError):
        run_config(cfg, tmp_path / "out")


def test_run_refuses_nonempty_output(tmp_path):
    cfg = _write_config(tmp_path, "preflight_scripted.json", population={"seed": 1, "size": 1}, families=["benign_utility"], defenders=[{"id": "leaky", "kind": "leaky"}], architectures=["A_monolithic"], levels=[6])
    out = tmp_path / "out"
    run_config(cfg, out)
    with pytest.raises(FileExistsError):
        run_config(cfg, out)


def test_runs_are_byte_replayable(tmp_path):
    cfg = _write_config(tmp_path, "preflight_scripted.json", population={"seed": 1, "size": 2}, families=["privacy_extraction", "benign_utility"], defenders=[{"id": "volume_linear", "kind": "volume_linear", "p": 0.3}], architectures=["A_monolithic"], levels=[3, 6])
    a = run_config(cfg, tmp_path / "a")
    b = run_config(cfg, tmp_path / "b")
    assert (a / "episodes.jsonl").read_bytes() == (b / "episodes.jsonl").read_bytes()
    ma = json.loads((a / "manifest.json").read_text())
    mb = json.loads((b / "manifest.json").read_text())
    assert ma["receipt_roots_sha256"] == mb["receipt_roots_sha256"]
