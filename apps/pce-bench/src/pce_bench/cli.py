"""Command line for PCE-Bench.

    python -m pce_bench generate-population --seed 1 --size 100 --out data/population_s1.json
    python -m pce_bench build-probes --population data/population_s1.json --out data/probes_s1.json
    python -m pce_bench run --config configs/preflight_scripted.json --out results/preflight
    python -m pce_bench analyze --out results/preflight
    python -m pce_bench verify --out results/preflight
    python -m pce_bench report --out results/preflight
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .graph import canonical_sha256
from .harness import analyze, run_config, verify_output
from .population import generate_population, population_from_dict, population_summary, population_to_dict
from .probes import build_probes, probes_to_dict


def _cmd_generate_population(args: argparse.Namespace) -> int:
    personas = generate_population(args.seed, args.size)
    doc = population_to_dict(args.seed, personas)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(doc, indent=1, sort_keys=True), encoding="utf-8")
    print(json.dumps({"written": args.out, "content_sha256": canonical_sha256(doc), **population_summary(personas)}, indent=2))
    return 0


def _cmd_build_probes(args: argparse.Namespace) -> int:
    doc = json.loads(Path(args.population).read_text(encoding="utf-8"))
    _, personas = population_from_dict(doc)
    probes = {p.id: build_probes(p, probe_seed=args.probe_seed) for p in personas}
    pdoc = probes_to_dict(personas, probes)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(pdoc, indent=1, sort_keys=True), encoding="utf-8")
    counts: dict[str, int] = {}
    for prs in probes.values():
        for p in prs:
            counts[p.family] = counts.get(p.family, 0) + 1
    print(json.dumps({"written": args.out, "content_sha256": canonical_sha256(pdoc), "probes": sum(counts.values()), "by_family": counts}, indent=2))
    return 0


def _cmd_run(args: argparse.Namespace) -> int:
    def progress(done: int, total: int) -> None:
        print(f"  {done}/{total} persona-conditions", file=sys.stderr)

    out = run_config(args.config, args.out, allow_live=args.allow_live_inference, progress=progress)
    ok, msg = verify_output(out)
    print(json.dumps({"output": str(out), "verified": ok, "message": msg}, indent=2))
    return 0 if ok else 1


def _cmd_analyze(args: argparse.Namespace) -> int:
    result = analyze(args.out, n_boot=args.n_boot, seed=args.seed)
    print(json.dumps({"written": str(Path(args.out) / "analysis.json"), "design": result["design"], "scaling_entries": len(result.get("scaling", [])), "matched_pair_tests": len(result.get("matched_pair_tests", []))}, indent=2))
    return 0


def _cmd_verify(args: argparse.Namespace) -> int:
    ok, msg = verify_output(args.out)
    print(msg)
    return 0 if ok else 1


def _fmt(x: float | None, digits: int = 2) -> str:
    return "-" if x is None else f"{x:.{digits}f}"


def _cmd_report(args: argparse.Namespace) -> int:
    out = Path(args.out)
    summary = json.loads((out / "summary.json").read_text(encoding="utf-8"))
    lines = [f"# {summary['experiment']}", "", f"{summary['episodes']} episodes. {summary['warning']}", ""]
    lines += ["## Architecture comparison", "", "| architecture | attack success | 95% CI | unauthorized committed / attempted | benign served | false refusals | extra round trips |", "|---|---:|---|---:|---:|---:|---:|"]
    for a, v in summary["by_architecture"].items():
        s = v["attack_success"]
        lines.append(f"| {a} | {s['k']}/{s['n']} ({_fmt(s['rate'])}) | [{_fmt(s['wilson_low'])}, {_fmt(s['wilson_high'])}] | {v['unauthorized_actions_committed']} / {v['unauthorized_actions_attempted']} | {v['benign_served']['k']}/{v['benign_served']['n']} | {_fmt(v['false_refusal_rate'])} | {_fmt(v['extra_round_trips_mean'])} |")
    lines += ["", "## Cells", "", "| defender | architecture | family | condition | applicable | success | leak frac | flagged | refused | unauth. committed | decoys |", "|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|"]
    for c in summary["cells"]:
        s = c["success"]
        lines.append(f"| {c['defender']} | {c['architecture']} | {c['family']} | {c['condition']} | {c['applicable']} | {s['k']}/{s['n']} ({_fmt(s['rate'])}) | {_fmt(c['leak_fraction_mean'])} | {_fmt(c['flagged_rate'])} | {_fmt(c['refused_rate'])} | {c['unauthorized_actions_committed']} | {c['decoys_asserted']} |")
    analysis_path = out / "analysis.json"
    if analysis_path.is_file():
        analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
        if analysis.get("scaling"):
            lines += ["", "## Scaling shape (attack success vs context measure)", "", "| defender | architecture | family | n | by sensitivity mass | by available inferences | by level | connectivity partial coef | volume partial coef | dAIC(+connectivity) |", "|---|---|---|---:|---|---|---|---:|---:|---:|"]
            for e in analysis["scaling"]:
                d = e["decomposition"]
                lines.append(f"| {e['defender']} | {e['architecture']} | {e['family']} | {e['n']} | {e['shape_by_sensitivity_mass'].get('verdict')} | {e['shape_by_n_available_inferences'].get('verdict')} | {e['shape_by_level'].get('verdict')} | {_fmt(d['connectivity_partial_coefficient'])} | {_fmt(d['volume_partial_coefficient'])} | {_fmt(d['delta_aic_adding_connectivity_to_volume'], 1)} |")
        if analysis.get("matched_pair_tests"):
            lines += ["", "## Matched connectivity pairs (linked vs scattered, unconditional outcome)", "", "| defender | architecture | family | pairs | personas | linked rate | scattered rate | only linked | only scattered | sign-flip p (Holm) | McNemar p (Holm) | bootstrap diff [95% CI] | count-matched pairs: diff, p | judge diff |", "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---:|"]
            for t in analysis["matched_pair_tests"]:
                p = t["paired"]
                b = t["cluster_bootstrap_difference"]
                m = t["paired_target_count_matched"]
                sf = t.get("sign_flip", {})
                j = t.get("judge")
                jd = _fmt(j["paired"]["difference"]) if j else "-"
                lines.append(f"| {t['defender']} | {t['architecture']} | {t['family']} | {p['n_pairs']} | {sf.get('n_clusters', '-')} | {_fmt(p['rate_a'])} | {_fmt(p['rate_b'])} | {p['only_a']} | {p['only_b']} | {sf.get('p_value', float('nan')):.2g} ({sf.get('p_value_holm', float('nan')):.2g}) | {p['mcnemar_p']:.2g} ({p.get('mcnemar_p_holm', float('nan')):.2g}) | {_fmt(b['estimate'])} [{_fmt(b['low'])}, {_fmt(b['high'])}] | {m['n_pairs']} ({_fmt(m['fraction_of_pairs'])}): {_fmt(m['difference'])}, {m['mcnemar_p']:.2g} | {jd} |")
        if analysis.get("architecture_comparison"):
            templates = sorted({t for e in analysis["architecture_comparison"] for t in e.get("benign_by_template", {})})
            if templates:
                lines += ["", "## Utility by benign template (served / applicable)", "", "| defender | architecture | " + " | ".join(templates) + " |", "|---|---|" + "---:|" * len(templates)]
                for e in analysis["architecture_comparison"]:
                    cells = []
                    for t in templates:
                        r = e.get("benign_by_template", {}).get(t)
                        cells.append(f"{r['k']}/{r['n']}" if r and r["n"] else "-")
                    lines.append(f"| {e['defender']} | {e['architecture']} | " + " | ".join(cells) + " |")
        if analysis.get("scorer_agreement"):
            lines += ["", "## Scorer agreement (deterministic vs judge, unconditional outcome)", "", "| defender | n | deterministic rate | judge rate | agreement | kappa | deterministic recall vs judge |", "|---|---:|---:|---:|---:|---:|---:|"]
            for d, v in analysis["scorer_agreement"].items():
                lines.append(f"| {d} | {v['n']} | {_fmt(v['deterministic_rate'])} | {_fmt(v['judge_rate'])} | {_fmt(v['agreement'])} | {_fmt(v['kappa'])} | {_fmt(v['recall_vs_reference'])} |")
    text = "\n".join(lines) + "\n"
    (out / "report.md").write_text(text, encoding="utf-8")
    print(text)
    return 0


def _cmd_pair_diagnostics(args: argparse.Namespace) -> int:
    from .levels import pair_diagnostics

    personas = generate_population(args.seed, args.size)
    rows = [pair_diagnostics(p) for p in personas]
    inv_keys = list(rows[0]["invariants"].keys())
    counts = {k: sum(1 for r in rows if r["invariants"][k]) for k in inv_keys}
    unmatched: dict[str, int] = {}
    for r in rows:
        for reason in r["unmatched"].values():
            unmatched[reason] = unmatched.get(reason, 0) + 1
    out = {
        "population_seed": args.seed,
        "personas": len(rows),
        "invariants_satisfied": counts,
        "inferences_total": sum(r["inferences_total"] for r in rows),
        "inferences_matched": sum(r["inferences_matched"] for r in rows),
        "unmatched_reasons": unmatched,
        "personas_fully_matched": sum(1 for r in rows if r["invariants"]["all_inferences_in_linked"]),
    }
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps({"summary": out, "personas": rows}, indent=1, sort_keys=True), encoding="utf-8")
        out["written"] = args.out
    print(json.dumps(out, indent=2))
    return 0


def _cmd_validate_judge(args: argparse.Namespace) -> int:
    """Run a config whose defenders include the paraphrasing control and report scorer agreement."""
    out = run_config(args.config, args.out, allow_live=args.allow_live_inference)
    result = analyze(out, n_boot=args.n_boot, seed=0)
    print(json.dumps({"output": str(out), "scorer_agreement": result.get("scorer_agreement")}, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pce-bench", description="Personal Context Exploitation Benchmark")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("generate-population", help="write a synthetic population file")
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--size", type=int, default=100)
    p.add_argument("--out", required=True)
    p.set_defaults(func=_cmd_generate_population)

    p = sub.add_parser("build-probes", help="write the probe pack for a population file")
    p.add_argument("--population", required=True)
    p.add_argument("--probe-seed", type=int, default=0)
    p.add_argument("--out", required=True)
    p.set_defaults(func=_cmd_build_probes)

    p = sub.add_parser("run", help="run a config and verify the output")
    p.add_argument("--config", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--allow-live-inference", action="store_true", help="permit defenders that call a model server")
    p.set_defaults(func=_cmd_run)

    p = sub.add_parser("analyze", help="write analysis.json for a run")
    p.add_argument("--out", required=True)
    p.add_argument("--n-boot", type=int, default=1000)
    p.add_argument("--seed", type=int, default=0)
    p.set_defaults(func=_cmd_analyze)

    p = sub.add_parser("verify", help="recompute every hash and receipt chain")
    p.add_argument("--out", required=True)
    p.set_defaults(func=_cmd_verify)

    p = sub.add_parser("report", help="render summary and analysis as markdown")
    p.add_argument("--out", required=True)
    p.set_defaults(func=_cmd_report)

    p = sub.add_parser("pair-diagnostics", help="which matching invariants each persona's linked/scattered pair satisfies")
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--size", type=int, default=100)
    p.add_argument("--out", default=None)
    p.set_defaults(func=_cmd_pair_diagnostics)

    p = sub.add_parser("validate-judge", help="run a scorer-validation config and report deterministic-vs-judge agreement")
    p.add_argument("--config", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--n-boot", type=int, default=100)
    p.add_argument("--allow-live-inference", action="store_true")
    p.set_defaults(func=_cmd_validate_judge)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
