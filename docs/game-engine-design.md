# CityZen Game Engine Design

## Overview

The game engine runs multiple independent worlds. Each world is a self-contained simulation with a finite population of humans, a limited number of cities, and an interconnected infrastructure network that governs population flow.

---

## Core Concepts

### Worlds

- The engine supports **multiple worlds** running simultaneously.
- Each world is an independent simulation with its own state.
- A world has an **initial population** of humans, assigned at creation.
- A world has a **city cap** — a maximum number of cities it can host.

### World Population

- Humans are a **world-level resource**. The total count of humans belongs to the world.
- The world population is the sum of:
  - Humans living in cities.
  - Unclaimed humans (in the world but not assigned to any city).
- Population grows over time through **births**, which add to the world's total count.
- There is **no migration between worlds** — population is strictly intra-world.

### Cities

- Each city is founded with a **small group of people** drawn from the world's population.
- A city's **infrastructure determines its capacity** — the maximum number of people it can hold.
- As infrastructure is developed (residential zones, services, utilities), capacity increases.
- Cities grow through two mechanisms:
  1. **Natural reproduction** — people within the city have children over time (always available).
  2. **Migration inflow** — people move in from other connected cities (requires connections).

### Connections

- Cities can be **connected** to other cities in the same world.
- Connections enable **population migration** between cities.
- An **isolated city** (no connections to other cities) can only grow through natural reproduction.
- A **connected city** can attract people from neighboring cities, enabling faster growth.
- Building connections is a **strategic infrastructure decision** that directly impacts growth potential.

### People (Individual Simulation)

- Each person is an individual entity with **7 characteristic parameters** (TBD — see below).
- These 7 parameters combine to determine the person's **happiness score**.
- Happiness is evaluated continuously against a **threshold** set by the game's difficulty level.
- When happiness drops **below the threshold**:
  1. The person enters a **considering** state — they begin evaluating nearby alternatives.
  2. They look at **connected cities** to assess if any would make them happier.
  3. If a better alternative is found, the person **migrates** to that city.
  4. If no better alternative exists, they stay (unhappily).

#### The 7 Human Parameters (Maslow's Hierarchy of Needs)

Every person carries these 7 need levels. Based on Maslow's hierarchy, **lower needs dominate** — a person won't care about higher-level needs until lower ones are sufficiently met. Each parameter has a satisfaction score determined by what the city provides.

| # | Parameter          | Need Level | What Satisfies It (City Infrastructure)                          |
|---|--------------------|------------|------------------------------------------------------------------|
| 1 | **Physiological**  | Base       | Food, water, shelter, warmth — residential zones, water/energy   |
| 2 | **Safety**         | Base       | Security, stability, order — police, fire stations, low crime    |
| 3 | **Love/Belonging** | Social     | Relationships, community, family — population density, parks, community buildings |
| 4 | **Esteem**         | Social     | Respect, recognition, status — jobs, commercial zones, government buildings |
| 5 | **Cognitive**      | Growth     | Knowledge, curiosity, learning — schools, universities, libraries |
| 6 | **Aesthetic**       | Growth     | Beauty, order, environment — parks, landmarks, museums, city planning |
| 7 | **Self-actualization** | Peak   | Purpose, potential, creativity — diverse economy, culture, tourism, monuments |

#### Hierarchy Rule

The hierarchy is **weighted from bottom up**. Lower needs have outsized impact on happiness:

```
If Physiological is unmet → happiness crashes regardless of everything else
If Safety is unmet        → everything above Safety contributes very little
...
Self-actualization only matters when all 6 below are reasonably satisfied
```

This means:
- A city with great universities but no water infrastructure will still lose people.
- A safe city with jobs but no community will struggle to retain at the Belonging level.
- A fully developed city satisfying all 7 levels produces the happiest (and stickiest) citizens.

#### Happiness & Migration Decision Flow

```
Person in City A:
  │
  ├── Calculate happiness from 7 parameters
  │
  ├── Happiness >= threshold?
  │     └── Yes → Stay. No action.
  │
  └── Happiness < threshold?
        └── Evaluate connected cities (B, C, ...)
              │
              ├── City B would improve happiness? → Migrate to B
              ├── City C would improve happiness? → Migrate to C
              └── No better option? → Stay in City A (unhappy)
```

### Migration

- People can **move out** of a city when their happiness drops below the game-level threshold.
- People can **move into** a city from another city in the same world.
- Migration only flows along **established connections** between cities.
- Migration is an **individual decision** — each person evaluates their own happiness against what connected cities could offer.
- A person migrates only if they find a connected city that would make them happier.

---

## Population Flow Model

```
World (finite humans, grows via births across all cities)
│
├── City A ──── City B ──── City C
│   (migration flows freely along connections)
│
├── City D
│   (isolated — natural reproduction only)
│
└── Unclaimed Pool
    (humans not yet assigned to any city)
```

### Growth Rate Factors

A city's effective growth rate is determined by:

| Factor                  | Availability        | Description                                      |
|-------------------------|---------------------|--------------------------------------------------|
| Natural reproduction    | Always              | People in the city have children over time        |
| Migration inflow        | Connected cities only | People move in from neighboring connected cities |
| Infrastructure capacity | Always              | Sets the ceiling — no growth beyond capacity      |

---

## Architecture (Current → Target)

### Current State
- Single world with a grid of city plots.
- Population is per-city, grows based on residential capacity with no shared pool.
- City connections exist visually (edge roads) but have no gameplay effect on population.

### Target State
- Multi-world engine where each world is a full simulation.
- World-level population pool that cities draw from and contribute to.
- Connections between cities govern migration flow.
- Birth rate adds to world total, not conjured per-city.
- City capacity driven by infrastructure, acting as a ceiling.

---

## Open Questions (To Be Defined)

- ~~What determines migration attractiveness~~ → Resolved: Individual happiness from 7 parameters, evaluated against game-level threshold.
- ~~What are the 7 human characteristic parameters~~ → Resolved: Maslow's hierarchy — Physiological, Safety, Love/Belonging, Esteem, Cognitive, Aesthetic, Self-actualization.
- How exactly does the hierarchy weighting work? (hard cutoff vs diminishing returns vs multiplier chain?)
- Birth rate formula — flat rate, or influenced by city conditions?
- Death rate — do humans die? Age? Natural lifespan?
- Unclaimed pool behavior — do unclaimed humans seek cities on their own?
- World creation parameters — how are initial population and city cap configured?
- Connection types — are all connections equal, or do they have bandwidth/capacity?
- Can connections be severed or degraded?
