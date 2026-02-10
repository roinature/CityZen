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
- **The game always runs.** The simulation never pauses — worlds tick continuously whether players are online or not.
- **Time is shared** across all cities within a world. There is a single world clock, and all cities experience the same time progression. There is no per-city time — when the world ticks, every city ticks.

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

- Each person is an individual entity with **7 characteristic parameters** (see below).
- Each person has an **age** that advances with the world clock.
- Age determines **additional needs** on top of the 7 base parameters — the same Maslow levels apply, but *what* satisfies them changes with life stage.
- These 7 parameters combine to determine the person's **happiness score**.
- Happiness is evaluated continuously against a **threshold** set by the game's difficulty level.
- When happiness drops **below the threshold**:
  1. The person enters a **considering** state — they begin evaluating nearby alternatives.
  2. They look at **connected cities** to assess if any would make them happier.
  3. If a better alternative is found, the person **migrates** to that city.
  4. If no better alternative exists, they stay (unhappily).
- People **die** of old age. A city needs a graveyard/cemetery to handle this.

#### Age & Life Stages

A person's age modifies which specific infrastructure they need. The same Maslow level (e.g. Cognitive, Health) requires different buildings depending on life stage.

| Life Stage    | Age Range   | Age-Specific Needs                                              |
|---------------|-------------|-----------------------------------------------------------------|
| **Child**     | 0–12        | Elementary School (Cognitive), Clinic (Health)                  |
| **Teen**      | 13–17       | High School (Cognitive), Clinic (Health)                        |
| **Young Adult**| 18–25      | University (Cognitive), Jobs (Esteem), Hospital (Health)        |
| **Adult**     | 26–59       | Jobs (Esteem), Hospital (Health), Full hierarchy                |
| **Elder**     | 60+         | Hospital/Clinic (Health), reduced job need, Cemetery on death   |

> Age ranges and specific needs are initial estimates — to be refined during balancing.

Key implications:
- A city full of children needs **schools** or Cognitive satisfaction drops.
- A city with an aging population needs **hospitals** and eventually **cemeteries**.
- A city without a cemetery suffers a happiness penalty when people die with no burial.
- Age distribution across a city creates shifting infrastructure demands over time.

#### The 7 Human Parameters (Maslow's Hierarchy of Needs)

Every person carries these 7 need levels. Based on Maslow's hierarchy, **lower needs dominate** — a person won't care about higher-level needs until lower ones are sufficiently met. Each parameter has a satisfaction score determined by what the city provides.

| # | Parameter              | Need Level | Infrastructure Categories          | What Satisfies It                                    |
|---|------------------------|------------|------------------------------------|------------------------------------------------------|
| 1 | **Physiological**      | Base       | Energy + Water & Sewage            | Power, clean water, shelter, warmth                  |
| 2 | **Safety**             | Base       | Police + Fire Dept                 | Security, crime prevention, disaster protection      |
| 3 | **Love/Belonging**     | Social     | Health + Transport                 | Community health, connectivity, access to people     |
| 4 | **Esteem**             | Social     | Tourism                            | Landmarks, stadiums, recognition, civic pride        |
| 5 | **Cognitive**          | Growth     | Education                          | Schools, universities, libraries, knowledge          |
| 6 | **Aesthetic**          | Growth     | Art & Culture *(new)*              | Theaters, galleries, creative expression, beauty     |
| 7 | **Self-actualization** | Peak       | Government                         | City Hall, Courthouse, Parliament — self-governance  |

#### Infrastructure → Maslow Mapping

Each infrastructure category directly feeds one Maslow level. This is the bridge between what the player builds and how people feel.

```
Maslow Level          Infrastructure Category      Buildings
─────────────────────────────────────────────────────────────────────
1. Physiological  ←── Energy                   ←── Wind Turbine, Solar Farm, Coal Plant, Nuclear Plant
                  ←── Water & Sewage           ←── Water Tower, Pump Station, Treatment Plant, Sewage Plant

2. Safety         ←── Police                   ←── Station, HQ, Jail, Academy
                  ←── Fire Dept                ←── Station, HQ, Helicopter Pad, Training Center

3. Love/Belonging ←── Health                   ←── Clinic, Hospital, Research Center, Cemetery
                  ←── Transport                ←── Bus Depot, Train Station, Airport, Harbor

4. Esteem         ←── Tourism                  ←── Landmark, Museum, Stadium, Amusement Park

5. Cognitive      ←── Education                ←── Elementary, High School, University, Library

6. Aesthetic      ←── Art & Culture (NEW)      ←── TBD (e.g. Theater, Gallery, Concert Hall, Studio)

7. Self-actual.   ←── Government               ←── City Hall, Courthouse, Parliament, Monument
```

> **Art & Culture** is a new infrastructure category to be added. It provides creative expression, cultural identity, and beauty. Buildings TBD.

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

## Economy & Money System

The money system exists partially in the current codebase (building costs, maintenance, tax income). It needs to be extended so that **every infrastructure category has detailed costs** tied to the Maslow hierarchy.

### Revenue

- **Tax income** — collected from the population, scaled by tax rate and population size.
- Tax rate affects happiness — too high and people leave, too low and the city can't sustain itself.

### Expenses

Every infrastructure category has ongoing costs. The player must balance spending across the Maslow pyramid.

| Maslow Level       | Infrastructure Categories  | Cost Types                                          |
|--------------------|----------------------------|-----------------------------------------------------|
| 1. Physiological   | Energy + Water & Sewage    | Build cost, maintenance, fuel/resource consumption   |
| 2. Safety          | Police + Fire Dept         | Build cost, maintenance, staffing                    |
| 3. Love/Belonging  | Health + Transport         | Build cost, maintenance, staffing, vehicle upkeep    |
| 4. Esteem          | Tourism                    | Build cost, maintenance, event costs                 |
| 5. Cognitive       | Education                  | Build cost, maintenance, staffing                    |
| 6. Aesthetic       | Art & Culture              | Build cost, maintenance, program funding             |
| 7. Self-actual.    | Government                 | Build cost, maintenance, administrative overhead     |

### Budget Pressure

- Each Maslow level has a **total operational cost** based on the buildings placed.
- If the city can't afford maintenance, buildings **degrade or shut down** — directly hitting the Maslow level they serve.
- This creates a cascading failure: budget crisis → buildings shut down → happiness drops → people leave → less tax revenue → deeper crisis.
- Conversely, a well-funded city retains people, grows tax base, and can invest in higher Maslow levels.

### Key Mechanics

- **Build cost** — one-time payment to place a building.
- **Maintenance** — recurring per-tick cost to keep it running (already partially exists).
- **Staffing** — some buildings require population to operate (e.g. hospitals need adults with jobs).
- **Upgrade cost** — cost to improve existing buildings or zones.

> The exact cost formulas per category are TBD — to be defined during balancing.

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
- ~~Death rate — do humans die?~~ → Resolved: Yes. People age with the world clock and die of old age. Cities need cemeteries.
- What is the natural lifespan range? (e.g. 70–90 game years?)
- ~~Cemetery — is this a new building, or does it fit into an existing category?~~ → Resolved: Health category. New building alongside Clinic, Hospital, Research Center.
- Unclaimed pool behavior — do unclaimed humans seek cities on their own?
- World creation parameters — how are initial population and city cap configured?
- Connection types — are all connections equal, or do they have bandwidth/capacity?
- Can connections be severed or degraded?
