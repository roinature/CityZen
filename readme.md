# CityZen

A real-time multiplayer 3D city builder game. Players collaborate to build and manage a shared city on a grid, placing buildings, laying roads, and watching their city come to life with animated traffic.

## Tech Stack

- **Client**: Three.js (3D rendering), Vite (bundler), Socket.IO Client
- **Server**: Node.js, Express, Socket.IO
- **Shared**: Pure TypeScript types, constants, and game logic
- **Monorepo**: npm workspaces (`shared/`, `server/`, `client/`)

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Install & Run

```bash
npm install
npm run dev
```

This starts both the server (port 3030) and the Vite dev server (port 5173). Open `http://localhost:5173` in your browser.

### Build for Production

```bash
npm run build
```

## Project Structure

```
CityZen/
├── shared/                         # Types, constants, pure game logic
│   └── src/
│       ├── types/                  # Grid, Building, Resources, City, Events
│       ├── constants/              # Building definitions, simulation, grid
│       └── logic/                  # Placement validation, simulation, resources
├── server/                         # Authoritative game server
│   └── src/
│       ├── index.ts                # Express + Socket.IO bootstrap
│       ├── socket/handlers.ts      # Socket event handlers
│       ├── game/
│       │   ├── GameRoom.ts         # City state, tick loop, validation
│       │   └── RoomManager.ts      # Room lifecycle management
│       └── persistence/
│           └── jsonStore.ts        # JSON file save/load
├── client/                         # Three.js browser client
│   └── src/
│       ├── main.ts                 # Entry point, wires everything together
│       ├── scene/                  # SceneManager, CameraController, Lighting, Grid
│       ├── world/                  # Terrain, BuildingFactory, CityRenderer, CarManager
│       ├── input/                  # BuildMode (placement, demolish, drag-draw)
│       ├── ui/                     # Toolbar, ResourceBar, Lobby, GameMenu, OptionsPanel
│       └── network/                # SocketClient wrapper
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
- **Left click + drag**: Continuously draw roads
- **Right click**: Demolish building under cursor
- **WASD / Arrow keys**: Pan camera
- **Scroll wheel**: Zoom in/out
- **ESC**: Open/close game menu (or deselect building)

### Resources

Resources update every 2-second server tick:
- **Money**: Earned from commercial/industrial buildings, spent on construction
- **Population**: Grows based on available housing capacity
- **Happiness**: Affected by parks (+) and factories (-)

## Multiplayer

Multiple players can join the same city and build collaboratively in real-time. The server is authoritative -- all placements are validated server-side and broadcast to all connected clients.

### Flow

1. Open the game and enter your name
2. Create a new city or join an existing one from the lobby
3. Build together -- all changes sync instantly via Socket.IO

## Game Menu

Press **ESC** or click the **Menu** button to access:

- **Save Game**: Persist the current city state to the server
- **Load Game**: Browse and select from saved cities
- **Restart City**: Reset the current city to a blank state
- **End Game**: Save and return to the lobby
- **Options**: Configure game settings

### Options

- Show/hide grid overlay
- Enable/disable car traffic
- Adjust max car count
- Camera pan speed
- Toggle shadows

Options are persisted in localStorage.

## Persistence

- City state auto-saves to the server after each mutation (debounced)
- Manual save available through the game menu
- Cities are stored as JSON files in `server/data/`
- Client sessions are stored in localStorage for auto-rejoin on page refresh

## Architecture

### Server-Authoritative

All game logic runs on the server. The client sends placement/demolish requests; the server validates them against the shared logic (`canPlaceBuilding`), updates the authoritative `CityState`, and broadcasts deltas to all connected clients.

### Shared Logic

Pure functions in the `shared/` package handle placement validation, resource calculation, and simulation ticking. This keeps the server and client in sync and makes the logic testable in isolation.

### Real-Time Communication

Socket.IO events are defined as constants in `shared/src/types/events.ts`:

- **Client-to-Server**: `city:join`, `city:create`, `building:place`, `building:demolish`, `city:save`, `city:restart`, `city:leave`
- **Server-to-Client**: `city:state`, `building:placed`, `building:demolished`, `city:resources`, `player:joined`, `player:left`, `city:saved`, `error`

### Car System

The client-side `CarManager` spawns animated cars on road tiles. Cars navigate by preferring to continue straight, turning at intersections, and reversing at dead ends. Car count scales with the number of road tiles placed.
