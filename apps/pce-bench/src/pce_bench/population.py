"""Synthetic population generator.

Every persona is fictional: names are built from syllables, organisations and
places come from a fixed invented list, and no field is drawn from any real
dataset.  Generation is deterministic from (population_seed, index).

A persona has:
- slots (name, employer, bank, contacts, ...) that fill the arc templates;
- a history length in months (6-24);
- complete story arcs with start days spread over the history;
- fragment arcs: stories only partly told, whose conclusions are never
  derivable (realistic dangling facts, and swap material for the scattered
  control);
- a KnowledgeGraph with explicit facts, cross-domain inferences, decoys,
  conflicting facts (a later fact that supersedes an earlier one) and
  uncertain facts (third-party source, confidence < 1).
"""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass, field
from typing import Any, Mapping

from .arcs import ARCS, BASELINE_FACTS, DEMOGRAPHIC_FACTS
from .graph import Entity, Fact, Inference, KnowledgeGraph

POPULATION_SCHEMA = "pce-population.v1"

_SYL_ONSET = ["b", "d", "f", "g", "h", "k", "l", "m", "n", "p", "r", "s", "t", "v", "z", "th", "br", "dr", "kr", "sl", "tr"]
_SYL_NUCLEUS = ["a", "e", "i", "o", "u", "ae", "ei", "ou"]
_SYL_CODA = ["", "", "n", "r", "l", "s", "k", "th", "m"]

CITIES = ["Varenmouth", "Elmridge", "Saltmarsh", "Tolbury", "Wexcombe", "Harrowgate", "Brookfall"]
EMPLOYERS = [
    "Quillon Systems", "Tessaro Logistics", "Brightfold Analytics", "Oakhaven School District",
    "Varenmouth Municipal Water", "Corrigan Foods", "Lumenward Energy", "Peltham Insurance Group",
    "Stillwater Robotics", "Ashby & Vale Architects",
]
RECRUITERS = ["Halden Search", "Northgate Talent", "Fenwick Partners"]
BANKS = ["Northbank Credit Union", "Pelago Savings", "Harrowgate Trust", "Mercer & Lowe Bank"]
CLINICS = ["Meridian Health Partners", "Saltmarsh Oncology Center", "Elmridge Clinic", "Westmere Medical"]
INSURERS = ["Larkspur Mutual", "Greyfield Assurance"]
LAWYERS = ["Halloway & Pike", "Corvin Legal", "Marrable Chambers"]
CARE_HOMES = ["Linden Court Care", "Riverbend Residence"]
JOB_TITLES = [
    "data analyst", "logistics coordinator", "nurse", "teacher", "software engineer",
    "paralegal", "warehouse supervisor", "graphic designer", "accountant", "civil engineer",
]
HOUSEHOLDS = ["just me", "me and my partner", "me, my partner and two kids", "me and a flatmate", "me and my dog"]
AGE_BANDS = ["late twenties", "early thirties", "late thirties", "mid forties", "early fifties", "late fifties"]
GENRES = ["ambient techno", "bluegrass", "90s hip hop", "baroque", "shoegaze"]
EXERCISES = ["five-a-side football", "swimming", "climbing", "yoga", "cycling"]
PETS = ["a greyhound called Pim", "two cats, Soot and Marl", "a tortoise called Oslo"]
COMMUTES = ["7:42 train", "number 14 tram", "coastal bus"]
DISHES = ["lentil dal", "shakshuka", "miso ramen", "lamb tagine"]

RELATIONSHIPS = ("partner", "parent", "sibling", "friend")


def _syllable(rng: random.Random) -> str:
    return rng.choice(_SYL_ONSET) + rng.choice(_SYL_NUCLEUS) + rng.choice(_SYL_CODA)


def fictional_name(rng: random.Random) -> str:
    first = (_syllable(rng) + _syllable(rng)).capitalize()
    last = (_syllable(rng) + _syllable(rng)).capitalize()
    return f"{first} {last}"


@dataclass
class Contact:
    id: str
    name: str
    relationship: str


@dataclass
class ArcInstance:
    arc_id: str
    start_day: int
    complete: bool = True


@dataclass
class Persona:
    id: str
    seed: int
    months: int
    start_date: str  # ISO date for rendering day offsets
    slots: dict[str, str]
    contacts: list[Contact]
    arcs: list[ArcInstance]
    graph: KnowledgeGraph = field(repr=False)

    @property
    def days(self) -> int:
        return self.months * 30

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema": "pce-persona.v1",
            "id": self.id,
            "seed": self.seed,
            "months": self.months,
            "start_date": self.start_date,
            "slots": dict(self.slots),
            "contacts": [asdict(c) for c in self.contacts],
            "arcs": [asdict(a) for a in self.arcs],
            "graph": self.graph.to_dict(),
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "Persona":
        if value.get("schema") != "pce-persona.v1":
            raise ValueError("not a pce-persona.v1 document")
        return cls(
            id=value["id"],
            seed=value["seed"],
            months=value["months"],
            start_date=value["start_date"],
            slots=dict(value["slots"]),
            contacts=[Contact(**c) for c in value["contacts"]],
            arcs=[ArcInstance(**a) for a in value["arcs"]],
            graph=KnowledgeGraph.from_dict(value["graph"]),
        )


def _fill(template: str, slots: Mapping[str, str]) -> str:
    out = template
    for k, v in slots.items():
        out = out.replace("{" + k + "}", v)
    return out


def _fill_forms(forms: list[str], slots: Mapping[str, str]) -> tuple[str, ...]:
    seen: list[str] = []
    for f in forms:
        s = _fill(f, slots)
        if s and s not in seen:
            seen.append(s)
    return tuple(seen)


def generate_persona(
    population_seed: int,
    index: int,
    *,
    arcs_per_persona: tuple[int, int] = (3, 5),
    fragment_arcs: int = 5,
) -> Persona:
    seed = (population_seed * 1_000_003 + index * 7919) & 0xFFFFFFFF
    rng = random.Random(seed)
    pid = f"p{index:03d}"
    name = fictional_name(rng)
    months = rng.choice([6, 9, 12, 18, 24])
    city = rng.choice(CITIES)
    new_city = rng.choice([c for c in CITIES if c != city])
    employer = rng.choice(EMPLOYERS)
    new_employer = rng.choice([e for e in EMPLOYERS if e != employer])
    contacts = [Contact(id=f"c_{rel}", name=fictional_name(rng), relationship=rel) for rel in RELATIONSHIPS]
    slots: dict[str, str] = {
        "name": name,
        "first_name": name.split()[0],
        "age_band": rng.choice(AGE_BANDS),
        "city": city,
        "new_city": new_city,
        "employer": employer,
        "new_employer": new_employer,
        "recruiter_org": rng.choice(RECRUITERS),
        "bank": rng.choice(BANKS),
        "clinic": rng.choice(CLINICS),
        "insurer": rng.choice(INSURERS),
        "lawyer": rng.choice(LAWYERS),
        "care_home": rng.choice(CARE_HOMES),
        "job_title": rng.choice(JOB_TITLES),
        "household": rng.choice(HOUSEHOLDS),
        "genre": rng.choice(GENRES),
        "exercise": rng.choice(EXERCISES),
        "pet": rng.choice(PETS),
        "commute": rng.choice(COMMUTES),
        "dish": rng.choice(DISHES),
    }
    for c in contacts:
        slots[c.relationship] = c.name

    g = KnowledgeGraph(persona_id=pid)
    g.add_entity(Entity(id="u", kind="person", name=name, domain="personal"))
    for c in contacts:
        g.add_entity(Entity(id=c.id, kind="person", name=c.name, domain="social", attrs=(("relationship", c.relationship),)))
    for key in ("employer", "new_employer", "bank", "clinic", "insurer", "lawyer", "care_home", "recruiter_org"):
        g.add_entity(Entity(id=f"org_{key}", kind="org", name=slots[key], domain="administrative"))
    g.add_entity(Entity(id="place_city", kind="place", name=city, domain="personal"))
    g.add_entity(Entity(id="place_new_city", kind="place", name=new_city, domain="personal"))

    total_days = months * 30
    # Demographics and preferences are disclosed early and spread thinly.
    day = 0
    for spec in DEMOGRAPHIC_FACTS:
        _add_spec_fact(g, spec, slots, arc=None, day=day, rng=rng, prefix="f:demo")
        day += rng.randint(0, 3)
    for spec in BASELINE_FACTS:
        d = rng.randint(0, max(1, total_days - 1))
        _add_spec_fact(g, spec, slots, arc=None, day=d, rng=rng, prefix="f:base")

    n_arcs = rng.randint(*arcs_per_persona)
    chosen = rng.sample(sorted(ARCS), k=min(n_arcs, len(ARCS)))
    arcs: list[ArcInstance] = []
    latest_start = max(1, total_days - 90)
    for arc_id in chosen:
        start = rng.randint(0, latest_start)
        arcs.append(ArcInstance(arc_id=arc_id, start_day=start, complete=True))
        _instantiate_arc(g, arc_id, start, slots, rng)
    # Fragment arcs: stories the user only partly told.  No inference of a
    # fragment arc is ever completable.  They add realism (dangling sensitive
    # facts) and give the scattered control sensitivity-matched swap material.
    remaining = [a for a in sorted(ARCS) if a not in chosen]
    for arc_id in rng.sample(remaining, k=min(fragment_arcs, len(remaining))):
        start = rng.randint(0, latest_start)
        arcs.append(ArcInstance(arc_id=arc_id, start_day=start, complete=False))
        _instantiate_arc(g, arc_id, start, slots, rng, fragment=True)
    arcs.sort(key=lambda a: a.start_day)

    return Persona(
        id=pid,
        seed=seed,
        months=months,
        start_date="2025-01-06",
        slots=slots,
        contacts=contacts,
        arcs=arcs,
        graph=g,
    )


def _add_spec_fact(
    g: KnowledgeGraph,
    spec: Mapping[str, Any],
    slots: Mapping[str, str],
    *,
    arc: str | None,
    day: int,
    rng: random.Random,
    prefix: str,
) -> Fact:
    local = dict(slots)
    local["tok"] = f"{rng.randint(1000, 9999)}"
    fid = f"{prefix}:{spec['key']}"
    fact = Fact(
        id=fid,
        subject="u",
        predicate=spec["predicate"],
        object=_fill(spec["object"], local),
        domain=spec["domain"],
        sensitivity=int(spec["sensitivity"]),
        disclosed_day=day,
        channel=spec["channel"],
        source=spec["source"],
        confidence=float(spec.get("confidence", 1.0)),
        valid_from=day,
        valid_to=None,
        conflicts_with=None,
        arc=arc,
        surface_forms=_fill_forms(list(spec["forms"]), local),
        kind=spec.get("kind", "event"),
    )
    g.add_fact(fact)
    _TEXT_CACHE[(g.persona_id, fid)] = _fill(spec["text"], local)
    return fact


def _fragment_keys(arc: Mapping[str, Any], rng: random.Random) -> set[str]:
    """Fact keys for a partial telling: at most len(premises)-1 premises per inference."""
    keys = [spec["key"] for spec in arc["facts"]]
    keep = set(keys)
    for inf in arc["inferences"]:
        fact_premises = [k for k in inf["premises"] if k in keys]
        present = [k for k in fact_premises if k in keep]
        if fact_premises and len(present) >= len(fact_premises):
            keep.discard(rng.choice(sorted(present)))
    spare = [k for k in keep if not any(k in inf["premises"] for inf in arc["inferences"])]
    if spare and rng.random() < 0.5:
        keep.discard(rng.choice(sorted(spare)))
    return keep


def _instantiate_arc(
    g: KnowledgeGraph,
    arc_id: str,
    start: int,
    slots: Mapping[str, str],
    rng: random.Random,
    *,
    fragment: bool = False,
) -> None:
    arc = ARCS[arc_id]
    prefix = f"f:{arc_id}"
    created: dict[str, Fact] = {}
    keep = _fragment_keys(arc, rng) if fragment else {spec["key"] for spec in arc["facts"]}
    for spec in arc["facts"]:
        if spec["key"] not in keep:
            continue
        fact = _add_spec_fact(g, spec, slots, arc=arc_id, day=start + int(spec["day"]), rng=rng, prefix=prefix)
        created[spec["key"]] = fact
        if spec.get("conflicts") and spec["conflicts"] in created:
            earlier = created[spec["conflicts"]]
            # the later fact supersedes the earlier one: close the earlier validity window
            g.facts[earlier.id] = Fact(**{**asdict(earlier), "valid_to": fact.disclosed_day})
            g.facts[fact.id] = Fact(**{**asdict(fact), "conflicts_with": earlier.id})
    for spec in arc["inferences"]:
        premises = tuple(
            (f"{prefix}:{k}" if f"{prefix}:{k}" in g.facts else f"i:{arc_id}:{k}") for k in spec["premises"]
        )
        if any(p not in g.facts and p not in g.inferences for p in premises):
            continue  # fragment: this conclusion is not derivable from what was told
        g.add_inference(
            Inference(
                id=f"i:{arc_id}:{spec['key']}",
                rule=f"{arc_id}.{spec['key']}",
                subject="u",
                predicate=spec["predicate"],
                object=_fill(spec["object"], slots),
                premises=premises,
                sensitivity=int(spec["sensitivity"]),
                domains=_premise_domains(g, premises) or tuple(arc["domains"][:2]),
                surface_forms=_fill_forms(list(spec["forms"]), slots),
                arc=arc_id,
                paraphrases=_fill_forms(list(spec.get("paraphrases", [])), slots),
            )
        )
    anchor = tuple(f for f in (f"{prefix}:{s['key']}" for s in arc["facts"]) if f in g.facts)[:1]
    for spec in arc.get("decoys", []):
        g.add_inference(
            Inference(
                id=f"d:{arc_id}:{spec['key']}",
                rule=f"{arc_id}.decoy.{spec['key']}",
                subject="u",
                predicate=spec["predicate"],
                object=_fill(spec["object"], slots),
                premises=anchor,
                sensitivity=int(spec["sensitivity"]),
                domains=tuple(arc["domains"][:2]),
                surface_forms=_fill_forms(list(spec["forms"]), slots),
                decoy=True,
                arc=arc_id,
            )
        )


def _premise_domains(g: KnowledgeGraph, premises: tuple[str, ...]) -> tuple[str, ...]:
    """Domains spanned by a premise set, following chained inferences."""
    domains: set[str] = set()
    for p in premises:
        if p in g.facts:
            domains.add(g.facts[p].domain)
        elif p in g.inferences:
            domains.update(g.inferences[p].domains)
    return tuple(sorted(domains))


# Rendered utterance per fact, keyed by (persona_id, fact_id).  Stored out of
# band so the graph stays a pure relational object; the population file
# persists it under "texts".
_TEXT_CACHE: dict[tuple[str, str], str] = {}


def fact_text(persona_id: str, fact_id: str) -> str:
    return _TEXT_CACHE[(persona_id, fact_id)]


def persona_texts(persona: Persona) -> dict[str, str]:
    return {fid: _TEXT_CACHE[(persona.id, fid)] for fid in persona.graph.facts}


def restore_texts(persona_id: str, texts: Mapping[str, str]) -> None:
    for fid, text in texts.items():
        _TEXT_CACHE[(persona_id, fid)] = text


def generate_population(population_seed: int, size: int) -> list[Persona]:
    return [generate_persona(population_seed, i) for i in range(size)]


def population_to_dict(population_seed: int, personas: list[Persona]) -> dict[str, Any]:
    return {
        "schema": POPULATION_SCHEMA,
        "population_seed": population_seed,
        "size": len(personas),
        "personas": [p.to_dict() | {"texts": persona_texts(p)} for p in personas],
    }


def population_from_dict(value: Mapping[str, Any]) -> tuple[int, list[Persona]]:
    if value.get("schema") != POPULATION_SCHEMA:
        raise ValueError("not a pce-population.v1 document")
    personas = []
    for entry in value["personas"]:
        p = Persona.from_dict(entry)
        restore_texts(p.id, entry["texts"])
        personas.append(p)
    return int(value["population_seed"]), personas


def population_summary(personas: list[Persona]) -> dict[str, Any]:
    facts = [len(p.graph.facts) for p in personas]
    infs = [len(p.graph.cross_domain_inferences()) for p in personas]
    sens3 = [sum(1 for f in p.graph.facts.values() if f.sensitivity == 3) for p in personas]
    conflicts = [sum(1 for f in p.graph.facts.values() if f.conflicts_with) for p in personas]
    uncertain = [sum(1 for f in p.graph.facts.values() if f.confidence < 1.0) for p in personas]
    return {
        "personas": len(personas),
        "months_min": min(p.months for p in personas),
        "months_max": max(p.months for p in personas),
        "facts_mean": sum(facts) / len(facts),
        "cross_domain_inferences_mean": sum(infs) / len(infs),
        "critical_facts_mean": sum(sens3) / len(sens3),
        "conflicting_facts_mean": sum(conflicts) / len(conflicts),
        "uncertain_facts_mean": sum(uncertain) / len(uncertain),
        "arcs_used": sorted({a.arc_id for p in personas for a in p.arcs}),
    }
