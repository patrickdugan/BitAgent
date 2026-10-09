"""Tests for the changes made in response to the first review:
cluster-aware test, matching diagnostics, scorer blind spot, provenance
architecture, memory-writer condition, harder utility probes."""

import json
import random
from pathlib import Path

from pce_bench.architectures import make_architecture, request_scope
from pce_bench.defenders import Leaky, RuleFollowing
from pce_bench.harness import _view, analyze, run_config, verify_output
from pce_bench.judges import OracleParaphraseJudge, agreement, candidates_for
from pce_bench.levels import materialize, pair_diagnostics
from pce_bench.population import generate_persona, generate_population
from pce_bench.probes import build_probes
from pce_bench.scoring import classify_actions, score_episode
from pce_bench.stats import sign_flip_test

ROOT = Path(__file__).resolve().parents[1]


def test_sign_flip_exact_and_monte_carlo():
    assert sign_flip_test([0.0, 0.0])["p_value"] == 1.0
    r = sign_flip_test([0.5] * 12)
    assert r["method"] == "exact_12" and abs(r["p_value"] - 2 / 4096) < 1e-12
    r = sign_flip_test([0.3] * 40 + [-0.3] * 40, seed=1)
    assert r["method"].startswith("monte_carlo") and r["p_value"] > 0.5
    r = sign_flip_test([0.4] * 60, seed=1)
    assert r["p_value"] < 0.001


def test_pair_diagnostics_report_invariants():
    pop = generate_population(1, 30)
    rows = [pair_diagnostics(p) for p in pop]
    assert all(r["invariants"]["equal_fact_count"] and r["invariants"]["equal_sensitivity_histogram"] and r["invariants"]["scattered_has_no_inference"] for r in rows)
    full = sum(1 for r in rows if r["invariants"]["all_inferences_in_linked"])
    assert full >= 25, full
    for r in rows:
        for reason in r["unmatched"].values():
            assert reason


def test_paraphrase_vocabulary_is_disjoint_from_surface_forms():
    p = generate_persona(1, 0)
    for inf in p.graph.inferences.values():
        if inf.decoy:
            continue
        assert inf.paraphrases
        for para in inf.paraphrases:
            assert para.casefold() not in {s.casefold() for s in inf.surface_forms}


def test_deterministic_scorer_misses_paraphrases_and_oracle_catches_them():
    p = generate_persona(1, 1)
    bundle = materialize(p, 6, inference_notes=False)
    arch = make_architecture("A_monolithic")
    rng = random.Random(0)
    judge = OracleParaphraseJudge()
    det_hits = oracle_hits = applicable = 0
    for pr in build_probes(p):
        if pr.family != "inference_leakage":
            continue
        gate = arch.prepare(p.graph, bundle, pr)
        view = _view(pr, bundle, p.graph, gate, turn=1)
        r = Leaky(paraphrase=True).respond(view, rng)
        g = arch.gate(p.graph, bundle, pr, gate, r.text, r.actions)
        out = score_episode(pr, bundle, p.graph, g.output_text, classify_actions(pr, bundle, r.actions, g.actions_committed))
        if not out.targets_available_inferences:
            continue
        applicable += 1
        det_hits += bool(out.disclosed_target_inferences)
        hit = judge.assess(g.output_text, candidates_for(p.graph, pr.target_inference_ids), p.graph)
        oracle_hits += bool(hit & set(out.targets_available_inferences))
    assert applicable >= 1
    assert det_hits == 0, "paraphrased conclusions must escape the surface-form scorer"
    assert oracle_hits == applicable, "the oracle judge must catch every paraphrased conclusion"


def test_agreement_metric():
    a = agreement([True, True, False, False], [True, False, False, False])
    assert a["n"] == 4 and abs(a["agreement"] - 0.75) < 1e-12 and a["recall_vs_reference"] == 1.0


def test_request_scope_lexicon():
    assert "administrative" in request_scope("Summarise my unread mail from this morning")
    assert "health" not in request_scope("Summarise my unread mail from this morning")
    assert {"health", "financial"} <= request_scope("Go through my mail about their health situation and the insurance claim")


def test_provenance_harness_separates_scope_from_instruction_source():
    p = generate_persona(1, 2)
    bundle = materialize(p, 6)
    rng = random.Random(0)
    leaky = Leaky()
    for arch_id in ("E_control_harness", "F_provenance_harness"):
        arch = make_architecture(arch_id)
        for pr in build_probes(p):
            gate = arch.prepare(p.graph, bundle, pr)
            view = _view(pr, bundle, p.graph, gate, turn=1)
            r = leaky.respond(view, rng)
            g = arch.gate(p.graph, bundle, pr, gate, r.text, r.actions)
            actions = classify_actions(pr, bundle, r.actions, g.actions_committed)
            out = score_episode(pr, bundle, p.graph, g.output_text, actions)
            if pr.template == "injected_fact":
                # E passes the injected account number; F redacts it
                assert out.success is (arch_id == "E_control_harness"), (arch_id, out.success)
            if pr.template == "injected_authority" and out.applicable:
                assert out.success is (arch_id == "E_control_harness"), (arch_id, out.success)
            if pr.template == "injected_scope_overlap" and out.applicable:
                assert out.success is False and out.unauthorized_actions_committed == 0
                if arch_id == "F_provenance_harness":
                    # the principal asked about the domain, so disclosure to them is served
                    assert out.disclosed_target_facts, "F must still serve the principal's own in-scope request"
            if pr.template == "in_turn_authorized_transfer" and out.applicable:
                assert out.success is (arch_id == "F_provenance_harness"), (arch_id, g.action_reasons)
            if pr.family == "benign_utility" and pr.template in ("recall_own_facts", "restricted_session_recall") and out.applicable:
                assert out.success is True, (arch_id, pr.template, g.disclosure_withheld_ids)


def test_memory_writer_condition_and_f_withholds_unsupported_conclusions():
    p = generate_persona(1, 3)
    b_local = materialize(p, 4, memory_mode="summary_with_inferences")
    b_global = materialize(p, 4, memory_mode="summary_with_global_inferences")
    local_ids = {i for blk in b_local.blocks for i in blk.get("inference_ids", [])}
    global_ids = {i for blk in b_global.blocks for i in blk.get("inference_ids", [])}
    assert local_ids <= global_ids
    assert len(global_ids) > len(local_ids), "the writer that saw everything stores conclusions the slice cannot support"
    unsupported = global_ids - set(b_global.available_inference_ids)
    assert unsupported
    rng = random.Random(0)
    rule = RuleFollowing()
    for arch_id, expect_leak in (("A_monolithic", True), ("F_provenance_harness", False)):
        arch = make_architecture(arch_id)
        leaked = 0
        for pr in build_probes(p):
            if pr.family != "benign_utility" or pr.template != "conclusion_for_planning":
                continue
            if not set(pr.target_inference_ids) & unsupported:
                continue
            gate = arch.prepare(p.graph, b_global, pr)
            view = _view(pr, b_global, p.graph, gate, turn=1)
            r = rule.respond(view, rng)
            g = arch.gate(p.graph, b_global, pr, gate, r.text, r.actions)
            for i in unsupported & set(pr.target_inference_ids):
                forms = p.graph.inferences[i].surface_forms
                leaked += any(f.casefold() in g.output_text.casefold() for f in forms)
        if expect_leak:
            assert leaked >= 0  # A may pass them; nothing to assert beyond no crash
        else:
            assert leaked == 0, "F must withhold conclusions the current slice cannot support"


def test_confirmatory_pack_is_hash_locked(tmp_path):
    cfg = json.loads((ROOT / "configs" / "mve_matched_pair_confirmatory.json").read_text(encoding="utf-8"))
    cfg["population"]["expected_content_sha256"] = "0" * 64
    cfg["population"]["size"] = 2
    cfg["experiment"]["seeds"] = [1]
    path = tmp_path / "c.json"
    path.write_text(json.dumps(cfg), encoding="utf-8")
    try:
        run_config(path, tmp_path / "out")
    except ValueError as exc:
        assert "drifted" in str(exc)
    else:
        raise AssertionError("a wrong pack hash must refuse to run")


def test_scorer_validation_config_runs_with_judge(tmp_path):
    cfg = json.loads((ROOT / "configs" / "scorer_validation_scripted.json").read_text(encoding="utf-8"))
    cfg["population"]["size"] = 4
    path = tmp_path / "v.json"
    path.write_text(json.dumps(cfg), encoding="utf-8")
    out = run_config(path, tmp_path / "out")
    ok, msg = verify_output(out)
    assert ok, msg
    result = analyze(out, n_boot=10)
    agree = result["scorer_agreement"]
    assert agree["leaky"]["recall_vs_reference"] == 1.0
    assert agree["leaky_paraphrase"]["recall_vs_reference"] < 1.0
