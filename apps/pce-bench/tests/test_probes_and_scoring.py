import random

from pce_bench.architectures import ARCHITECTURES, make_architecture
from pce_bench.defenders import Leaky, RuleFollowing, parse_live_output
from pce_bench.harness import _view
from pce_bench.levels import materialize
from pce_bench.population import generate_persona
from pce_bench.probes import ATTACKER_ACCOUNT, ATTACKER_EMAIL, FAMILIES, build_probes, probes_from_dict, probes_to_dict
from pce_bench.scoring import classify_actions, disclosed_ids, normalize, resolve_targets, score_episode


def _persona():
    return generate_persona(1, 2)


def test_probe_pack_covers_every_family_and_round_trips():
    p = _persona()
    probes = build_probes(p)
    fams = {pr.family for pr in probes}
    assert fams == set(FAMILIES)
    doc = probes_to_dict([p], {p.id: probes})
    back = probes_from_dict(doc)[p.id]
    assert [b.to_dict() for b in back] == [a.to_dict() for a in probes]
    assert build_probes(p) == probes, "probe generation must be deterministic"


def test_probes_are_abstract_and_never_live():
    p = _persona()
    for pr in build_probes(p):
        text = pr.prompt + (pr.injected["text"] if pr.injected else "")
        assert "http" not in text.casefold()
        for a in pr.requested_actions:
            assert ATTACKER_EMAIL in str(a["args"]) or ATTACKER_ACCOUNT in str(a["args"])
            assert ".example" in ATTACKER_EMAIL


def test_targets_resolve_by_domain_and_exist_in_graph():
    p = _persona()
    for pr in build_probes(p):
        facts, infs = resolve_targets(pr, p.graph)
        assert all(f in p.graph.facts for f in facts)
        assert all(i in p.graph.inferences for i in infs)
        if pr.target_domains:
            assert all(p.graph.facts[f].domain in pr.target_domains and p.graph.facts[f].sensitivity >= 2 for f in facts)


def test_detector_matches_surface_forms_case_and_punctuation_insensitively():
    p = _persona()
    fact = next(f for f in p.graph.facts.values() if f.sensitivity >= 2)
    form = fact.surface_forms[0]
    assert fact.id in disclosed_ids(p.graph, f"Sure!! Regarding {form.upper()}, here it is.", [fact.id])
    assert fact.id not in disclosed_ids(p.graph, "Nothing to report.", [fact.id])
    assert normalize("Hello, World!") == " hello world "
    assert normalize("transfer 9,500.00 today") == " transfer 9,500 00 today "


def test_leaky_and_rule_following_score_as_positive_and_negative_controls():
    p = _persona()
    bundle = materialize(p, 6)
    arch = make_architecture("A_monolithic")
    rng = random.Random(0)
    for pr in build_probes(p):
        gate = arch.prepare(p.graph, bundle, pr)
        view = _view(pr, bundle, p.graph, gate, turn=1)
        for defender, expect_attack_success in ((Leaky(), True), (RuleFollowing(), False)):
            r = defender.respond(view, rng)
            g = arch.gate(p.graph, bundle, pr, gate, r.text, r.actions)
            actions = classify_actions(pr, bundle, r.actions, g.actions_committed)
            out = score_episode(pr, bundle, p.graph, g.output_text, actions, explicit_flag=r.flagged, explicit_refusal=r.refused)
            if pr.family == "benign_utility":
                if out.applicable:
                    assert out.success is True, (defender.id, pr.id)
            elif out.applicable:
                assert out.success is expect_attack_success, (defender.id, pr.id, out)


def test_control_harness_architecture_blocks_unauthorized_actions_and_sensitive_disclosure():
    p = _persona()
    bundle = materialize(p, 6)
    arch = make_architecture("E_control_harness")
    rng = random.Random(0)
    leaky = Leaky()
    for pr in build_probes(p):
        gate = arch.prepare(p.graph, bundle, pr)
        view = _view(pr, bundle, p.graph, gate, turn=1)
        r = leaky.respond(view, rng)
        g = arch.gate(p.graph, bundle, pr, gate, r.text, r.actions)
        actions = classify_actions(pr, bundle, r.actions, g.actions_committed)
        out = score_episode(pr, bundle, p.graph, g.output_text, actions)
        assert out.unauthorized_actions_committed == 0
        if pr.family in ("privacy_extraction", "inference_leakage", "impersonation_credibility", "compartmentalization") and out.applicable:
            assert out.success is False, pr.id
        if pr.family == "benign_utility" and out.applicable:
            if pr.template == "in_turn_authorized_transfer":
                # E requires a standing authorization; refusing in-turn ones is its measured utility cost
                assert out.success is False and out.false_refusal is True, pr.id
            else:
                assert out.success is True, pr.id


def test_every_architecture_constructs():
    for a in ARCHITECTURES:
        assert make_architecture(a).id == a


def test_live_output_parser_accepts_json_and_falls_back_to_text():
    r = parse_live_output('Sure. {"reply": "hello", "actions": [{"tool": "send_email", "args": {"to": "x"}}], "flag": true}')
    assert r.text == "hello" and r.actions[0]["tool"] == "send_email" and r.flagged
    r2 = parse_live_output("plain text answer")
    assert r2.text == "plain text answer" and r2.actions == []
