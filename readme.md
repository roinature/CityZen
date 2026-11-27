# CityZen

A real-time multiplayer 3D city builder game. Players collaborate to build and manage a shared city on a grid, placing buildings, laying roads, and watching their city come to life with animated traffic.

Players found cities on one shared Earth, choosing from ~50 sites across every inhabited continent on an interactive 3D globe that opens on the player's location (time-zone estimate, or precise geolocation on request) and suggests the nearest open sites. Sites live in `shared/src/terrain/sites.ts`; refresh their terrain and the globe texture with `python3 scripts/sample-earth-sites.py --globe`. Each site covers 3.2 km × 3.2 km, sampled at 50 m per cell. The playable map uses elevation shading, with open sea and slopes above a 40% grade closed to construction. Terrain is bundled with the game. [Mapzen elevation data and attribution](https://registry.opendata.aws/terrain-tiles/)

## Play Now

**[roinature.github.io/CityZen](https://roinature.github.io/CityZen/)** — or scan to play on your phone:

<a href="https://roinature.github.io/CityZen/"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=https%3A%2F%2Froinature.github.io%2FCityZen%2F" alt="QR code linking to CityZen" width="200" height="200"></a>

## Tech Stack

- **Client**: Three.js (3D rendering), Vite + PWA (`vite-plugin-pwa`), WebRTC (`trystero`), IndexedDB
- **Shared**: Pure TypeScript types, constants, terrain, and simulation runtime (`CityRoom`, `PopulationManager`, `WorldTickEngine`)
- **Hosting**: 100% static (GitHub Pages) in default peer-to-peer mode; optional legacy Node.js / Express / Prisma / Supabase backend (`?server`)
- **Monorepo**: npm workspaces (`shared/`, `client/`, `server/`)

## Getting Started

### Prerequisites

- Node.js 22+
- npm 9+

### Install & Run

```bash
npm install
npm run dev -w client
```

Open `http://localhost:5173` in your browser. Distributed peer-to-peer mode starts automatically with zero database or backend setup — share the `?world=<id>` link (or use **Invite Friends**) to play across devices or tabs.

> For 4G/5G mobile cellular networks behind strict CGNAT, configure optional TURN relay credentials (see [client/.env.example](client/.env.example)).

To run the legacy central server mode (`?server`), start both workspaces with `npm run dev` (requires database configuration in `server/`).

### Build for Production

```bash
npm run build
```

To build just the static client for GitHub Pages:

```bash
npm run clean && npm run build -w shared && VITE_BASE=/CityZen/ npm run build -w client
```

## Project Structure

```
CityZen/
├── shared/                         # Types, constants, terrain, and simulation runtime
│   └── src/
│       ├── types/                  # Grid, Building, Resources, City, World, Events
│       ├── constants/              # Building definitions, economy, simulation, grid
│       ├── logic/                  # Placement validation, simulation, migration, town planner
│       ├── terrain/                # Bundled Earth elevation sites
│       └── sim/                    # CityRoom, PopulationManager, WorldTickEngine
├── client/                         # Three.js browser + PWA client
│   ├── src/
│   │   ├── main.ts                 # Entry point, wires everything together
│   │   ├── scene/                  # SceneManager, CameraController, Lighting, Grid
│   │   ├── world/                  # Terrain, BuildingFactory, CityRenderer, CarManager, DriveMode
│   │   ├── input/                  # BuildMode (placement, demolish, drag-draw)
│   │   ├── ui/                     # Toolbar, ResourceBar, Lobby, WorldMap, GameMenu, OptionsPanel
│   │   └── network/
│   │       ├── CityConnection.ts   # Shared transport interface
│   │       ├── GameClient.ts       # Legacy server/Supabase client (?server)
│   │       └── p2p/                # Distributed WebRTC mesh (default)
│   │           ├── P2PGameClient.ts
│   │           ├── LocalCityHost.ts
│   │           ├── LocalStore.ts   # IndexedDB saves + JSON backup/restore
│   │           ├── rtcConfig.ts    # STUN + optional TURN configuration
│   │           └── siteConflict.ts # Deterministic offline site-claim tie-breaker
│   └── tests/                      # P2P unit tests (node --test)
└── server/                         # Optional legacy authoritative server (?server)
```

## Gameplay

### Buildings

| Type        | Cost | Size | Effects                                |
|-------------|------|------|----------------------------------------|
| House       | $100 | 1x1  | +10 population capacity, -$2 income    |
| Shop        | $200 | 1x1  | +5 jobs, +$10 income, +2 happiness     |
| Factory     | $300 | 2x2  | +20 jobs, +$25 income, -5 happiness    |
| Road        | $10  | 1x1  | Enables car traffic                    |
| Park        | $50  | 1x1  | +10 happiness                          |

### Controls

- **Left click**: Place selected building
- **Left click + drag**: Draw a road or paint a zone rectangle, then release to build
- **Right click**: Demolish building under cursor
- **WASD / Arrow keys**: Pan camera
- **Scroll wheel**: Zoom in/out
- **Right-drag / middle-drag** (or **Shift + left-drag**): Orbit: sideways to rotate, up and down to tilt
- **Q / E**: Rotate camera · **R / F**: Tilt
- **Space**: Pause / resume · **1-3**: Game speed
- **B**: Toggle bulldozer
- **ESC**: Open/close game menu (or deselect building)

On a touchscreen:

- **Tap** a plot with a tool selected to build or bulldoze.
- **Drag** to move the map. With a road or zone selected, a one-finger drag draws a road or fills a rectangle.
- **Use two fingers** to move or pinch-zoom the map, and twist to rotate it, with any tool selected. The camera buttons also zoom and rotate.

### Town Planner

Menu → **Town Planner** replaces the city with a planned town, with a live preview. Pick a character (city, crossroads, hill, river or village) and a seed, then adjust blocks, curves, cul-de-sacs, downtown, parks, parking and roads out. The same settings on the same site always give the same town.

### Looks

**V** or the **View** button switches between skyline, isometric, top-down and street cameras. Options has city styles, skyline height, crosswalks and trees. Building shading and the planner's vocabulary are adapted from [citygen](https://github.com/hxtnv/citygen); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

### Resources

Resources update every 2-second simulation tick:
- **Money**: Earned from commercial/industrial buildings, spent on construction
- **Population**: Grows based on available housing capacity and citizen needs
- **Happiness**: Affected by parks (+), services, taxes, and factories (-)

## Multiplayer (Distributed Peer-to-Peer)

CityZen runs **without a central database**. Each player's browser or phone owns and simulates their own city locally and connects to friends over WebRTC (`trystero`):

### Flow

1. Open the game — you are placed in a shareable Earth world (`?world=<id>`)
2. Claim an Earth site to found your city (saved locally in IndexedDB)
3. Tap **Invite Friends** to share your `?world=<id>` link
4. Friends appear live on the Earth map with status badges (**Yours · Local**, **Online**, or **Offline · Cached**)
5. Visit a friend's city to **co-build together in real time**, or connect edge roads to exchange citizens between cities
6. If a city's owner closes the app or locks their phone, visitors seamlessly switch to a **Read-Only cached view** and resume live editing when the owner reconnects

## Game Menu

Press **ESC** or click the **Menu** button to access:

- **Save Game**: Flush your city state to local IndexedDB immediately
- **Load Game**: Switch between your cities and friends' cities in this world
- **Town Planner**: Generate a procedural town layout with live preview
- **Export / Import Backup**: Save or restore your world as a `.json` file across devices
- **Restart City**: Reset your city to a blank state
- **End Game**: Save and return to the Earth map
- **Options**: Configure game settings

### Options

- Show/hide grid overlay
- Enable/disable car traffic and adjust max car count
- City styles, skyline height, crosswalks, and trees
- Camera pan speed and view presets
- Toggle shadows and post-processing

Options are persisted in `localStorage`.

## Persistence

- Owned cities, local population, and cached snapshots of friends' cities are stored in **IndexedDB** (`LocalStore`), auto-saving on changes and immediately on mobile background/screen-lock (`visibilitychange` / `pagehide`)
- Manual **Export / Import Backup (.json)** is available in the Game Menu
- Installing the PWA (**Add to Home Screen** on mobile) helps protect local saves from browser storage eviction

## Architecture

### Owner-Authoritative P2P Mesh

Each player's device runs `LocalCityHost` (wrapping `CityRoom`, `PopulationManager`, and `WorldTickEngine` from `@cityzen/shared`) exclusively for the city(ies) they own. Peers exchange lightweight world announcements (~200 B), targeted incremental city events (`BUILDING_PLACED`, `RESOURCES_UPDATE`, `ZONE_GROWTH`), co-build commands, and cross-city citizen migration over WebRTC DataChannels. Passing `?server` opts into the legacy Express / Supabase backend.

### Shared Logic

Pure TypeScript modules in `shared/` handle placement validation, economy, Maslow satisfaction, migration, town planning, and the tick runtime — shared identically between the browser P2P host and the optional server.

### Car System

The client-side `CarManager` spawns animated cars on road tiles. Cars navigate by preferring to continue straight, turning at intersections, and reversing at dead ends. Car count scales with the number of road tiles placed. Press **C** or tap **Drive** to take a car for a drive yourself.
