from pce_bench.graph import KnowledgeGraph, SENSITIVITY_WEIGHTS
from pce_bench.levels import LEVELS, ladder, matched_connectivity_pair, materialize, sensitivity_histogram
from pce_bench.population import generate_persona, generate_population, population_from_dict, population_to_dict


def test_population_is_deterministic_and_round_trips():
    a = generate_population(7, 5)
    b = generate_population(7, 5)
    assert [p.graph.content_sha256() for p in a] == [p.graph.content_sha256() for p in b]
    doc = population_to_dict(7, a)
    _, c = population_from_dict(doc)
    assert [p.graph.content_sha256() for p in c] == [p.graph.content_sha256() for p in a]
    assert all(p.id == q.id and p.slots == q.slots for p, q in zip(a, c))


def test_every_persona_has_cross_domain_inferences_conflicts_and_uncertainty():
    pop = generate_population(1, 30)
    assert all(p.graph.cross_domain_inferences() for p in pop)
    assert any(f.conflicts_with for p in pop for f in p.graph.facts.values())
    assert any(f.confidence < 1.0 for p in pop for f in p.graph.facts.values())
    assert any(not a.complete for p in pop for a in p.arcs), "fragment arcs should exist"
    for p in pop:
        for inf in p.graph.inferences.values():
            if inf.decoy:
                continue
            arc = next(a for a in p.arcs if a.arc_id == inf.arc)
            assert arc.complete, "fragment arcs must never yield a derivable inference"


def test_inference_closure_needs_every_premise():
    p = generate_persona(1, 0)
    g = p.graph
    inf = g.cross_domain_inferences()[0]
    premises = [x for x in inf.premises if x in g.facts]
    assert inf.id in g.available_inferences(premises) or any(x in g.inferences for x in inf.premises)
    assert inf.id not in g.available_inferences(premises[:-1])
    # an unlinkable premise blocks the inference even when exposed
    assert inf.id not in g.available_inferences(premises, unlinkable_fact_ids=premises[:1])


def test_ladder_is_monotone_in_exposure_and_capabilities():
    p = generate_persona(1, 3)
    lad = ladder(p)
    facts = [len(b.exposed_fact_ids) for b in lad]
    assert facts[0] == 0
    assert facts[1] <= facts[2] <= facts[3] <= facts[4] <= facts[5] == facts[6]
    for lower, upper in zip(lad, lad[1:]):
        assert set(lower.exposed_fact_ids) <= set(upper.exposed_fact_ids), "levels must be cumulative"
    assert lad[4].tools == [] and lad[5].tools and "transfer_funds" in lad[6].tools
    assert all(b.level == lvl for b, lvl in zip(lad, LEVELS))
    assert lad[6].measures["sensitivity_mass"] >= lad[4].measures["sensitivity_mass"]
    # level 6 writes the inferred notes into context; the ablation flag removes them
    assert any(b["kind"] == "memory_inferences" for b in lad[6].blocks)
    assert not any(b["kind"] == "memory_inferences" for b in materialize(p, 6, inference_notes=False).blocks)


def test_matched_pair_holds_count_and_histogram_and_removes_inferences():
    for p in generate_population(1, 25):
        linked, scattered = matched_connectivity_pair(p)
        assert len(linked.exposed_fact_ids) == len(scattered.exposed_fact_ids)
        assert sensitivity_histogram(p.graph, linked.exposed_fact_ids) == sensitivity_histogram(p.graph, scattered.exposed_fact_ids)
        assert linked.available_inference_ids and not scattered.available_inference_ids
        assert linked.measures["pair_inferences_matched"] >= 1
        assert not any(b["kind"] == "memory_inferences" for b in linked.blocks)


def test_length_matching_pads_without_adding_facts():
    p = generate_persona(1, 4)
    full = materialize(p, 6)
    padded = materialize(p, 1, length_match_to=full.token_estimate)
    assert padded.token_estimate >= full.token_estimate
    assert set(padded.exposed_fact_ids) == set(materialize(p, 1).exposed_fact_ids)
    assert all(not b["fact_ids"] for b in padded.blocks if b["provenance"] == "filler")


def test_sensitivity_weights_are_pre_registered():
    assert SENSITIVITY_WEIGHTS == (0.0, 1.0, 3.0, 9.0)
