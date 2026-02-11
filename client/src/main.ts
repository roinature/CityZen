import * as THREE from 'three';
import {
  type CityState,
  type BuildingType,
  type ZoneDensity,
  type WorldState,
  type EdgeDirection,
  type PlacedBuilding,
  BUILDING_DEFS,
  findAdjacentCity,
  getOppositeDirection,
} from '@cityzen/shared';
import { SceneManager } from './scene/SceneManager.js';
import { CameraController } from './scene/CameraController.js';
import { setupLighting } from './scene/LightingSetup.js';
import { createGridOverlay } from './scene/GridOverlay.js';
import { createTerrain } from './world/Terrain.js';
import { CityRenderer } from './world/CityRenderer.js';
import { BuildMode } from './input/BuildMode.js';
import { ResourceBar } from './ui/ResourceBar.js';
import { Toolbar } from './ui/Toolbar.js';
import { Lobby } from './ui/Lobby.js';
import { WorldMap } from './ui/WorldMap.js';
import { GameMenu } from './ui/GameMenu.js';
import { OptionsPanel, type GameOptions } from './ui/OptionsPanel.js';
import { CarManager } from './world/CarManager.js';
import { ToolSidebar, type ToolMode } from './ui/ToolSidebar.js';
import { FinancePanel } from './ui/FinancePanel.js';
import { MaslowPanel } from './ui/MaslowPanel.js';
import { FooterIndicator } from './ui/FooterIndicator.js';
import { InfraToolbar } from './ui/InfraToolbar.js';
import { GameClient } from './network/GameClient.js';

const SERVER_URL = window.location.origin;
const SESSION_KEY = 'cityzen_session';
const PLAYER_ID_KEY = 'cityzen_player_id';

interface SavedSession {
  cityId: string;
  playerName: string;
}

function saveSession(cityId: string, playerName: string): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ cityId, playerName }));
}

function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as SavedSession;
    if (session.cityId && session.playerName) return session;
    return null;
  } catch {
    return null;
  }
}

function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

function getOrCreatePlayerId(): string {
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

// --- State ---
let cityState: CityState | null = null;
let worldState: WorldState | null = null;
const playerId = getOrCreatePlayerId();

// --- Scene setup ---
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root')!;

const sceneManager = new SceneManager(canvas);
const cameraController = new CameraController(sceneManager);
const lighting = setupLighting(sceneManager.scene);
createTerrain(sceneManager.scene);
const gridHelper = createGridOverlay(sceneManager.scene);

const cityRenderer = new CityRenderer(sceneManager.scene);
const carManager = new CarManager(sceneManager.scene);
const buildMode = new BuildMode(sceneManager.scene, sceneManager.camera);

// --- UI ---
const resourceBar = new ResourceBar(uiRoot);
const footerIndicator = new FooterIndicator(uiRoot);
const toolbar = new Toolbar(uiRoot, (type: BuildingType, density?: ZoneDensity) => {
  if (buildMode.getSelectedType() === type && !density) {
    buildMode.deselect();
    toolbar.setActive(null);
  } else {
    buildMode.setToolMode('build');
    cameraController.setLeftClickPanEnabled(false);
    toolSidebar.setActiveMode('build');
    buildMode.select(type);
    buildMode.setDensity(density ?? null);
    toolbar.setActive(type);
    infraToolbar.setActive(null);
  }
});

// --- Infrastructure Toolbar (bottom) ---
const infraToolbar = new InfraToolbar(uiRoot, (type: BuildingType) => {
  if (buildMode.getSelectedType() === type) {
    buildMode.deselect();
    infraToolbar.setActive(null);
    toolbar.setActive(null);
  } else {
    buildMode.setToolMode('build');
    cameraController.setLeftClickPanEnabled(false);
    toolSidebar.setActiveMode('build');
    buildMode.select(type);
    toolbar.setActive(null);
    infraToolbar.setActive(type);
  }
});

// --- Tool Sidebar ---
let isNight = false;
const financePanel = new FinancePanel(uiRoot);
const maslowPanel = new MaslowPanel(uiRoot);

const toolSidebar = new ToolSidebar(uiRoot, {
  onToolChange: (mode: ToolMode) => {
    buildMode.setToolMode(mode);
    cameraController.setLeftClickPanEnabled(mode === 'pointer');
    if (mode !== 'build') {
      toolbar.setActive(null);
      infraToolbar.setActive(null);
    }
  },
  onBrushSizeChange: (size: number) => {
    buildMode.setBrushSize(size);
  },
  onDayNightToggle: () => {
    isNight = !isNight;
    lighting.setNight(isNight);
    sceneManager.setDayNight(isNight);
  },
  onFinanceToggle: () => {
    if (cityState) financePanel.update(cityState);
    financePanel.toggle();
  },
  onMaslowToggle: () => {
    if (cityState?.resources.populationSummary) {
      maslowPanel.update(cityState.resources.populationSummary);
    }
    maslowPanel.toggle();
  },
});

// --- Session ---
let currentPlayerName = 'Player';

// --- Network ---
let gameClient!: GameClient;

GameClient.create(SERVER_URL, {
  onWorldState: (world) => {
    worldState = world;
    worldMap.updateWorld(world);
  },

  onCityState: (city, players) => {
    cityState = city;
    buildMode.setCityState(city);
    cityRenderer.syncState(city);
    carManager.clear();
    resourceBar.update(city.resources, cityState);
    lobby.hide();
    worldMap.hide();
    saveSession(city.id, currentPlayerName);
    // Re-apply options to the new server room (unlimited money, etc.)
    applyOptions(optionsPanel.getOptions());
    console.log(`Joined city: ${city.name} with ${players.length} players`);
  },

  onBuildingPlaced: (payload) => {
    if (!cityState) return;
    cityState.buildings.push(payload.building);

    const def = BUILDING_DEFS[payload.building.type];
    for (let dx = 0; dx < def.size.w; dx++) {
      for (let dz = 0; dz < def.size.d; dz++) {
        cityState.grid[payload.building.position.x + dx][payload.building.position.z + dz].buildingId = payload.building.id;
      }
    }

    cityState.resources = payload.resources;
    cityRenderer.syncState(cityState);
    resourceBar.update(cityState.resources, cityState);
  },

  onBuildingDemolished: (payload) => {
    if (!cityState) return;
    const building = cityState.buildings.find((b: PlacedBuilding) => b.id === payload.buildingId);
    if (building) {
      const def = BUILDING_DEFS[building.type];
      for (let dx = 0; dx < def.size.w; dx++) {
        for (let dz = 0; dz < def.size.d; dz++) {
          cityState.grid[building.position.x + dx][building.position.z + dz].buildingId = null;
        }
      }
    }
    cityState.buildings = cityState.buildings.filter((b: PlacedBuilding) => b.id !== payload.buildingId);
    cityState.resources = payload.resources;
    cityRenderer.syncState(cityState);
    resourceBar.update(cityState.resources, cityState);
  },

  onResourcesUpdate: (resources, tick, clock) => {
    if (!cityState) return;
    cityState.resources = resources;
    cityState.tick = tick;
    cityState.clock = clock;
    resourceBar.update(resources, cityState);
    resourceBar.updateClock(clock);
    if (maslowPanel.isVisible() && resources.populationSummary) {
      maslowPanel.update(resources.populationSummary);
    }
  },

  onZoneGrowth: (payload) => {
    if (!cityState) return;
    for (const update of payload.buildings) {
      const building = cityState.buildings.find((b: PlacedBuilding) => b.id === update.id);
      if (building) {
        building.developmentLevel = update.developmentLevel;
        building.developedAt = update.developedAt;
      }
    }
    cityRenderer.syncState(cityState);
  },

  onPlayerJoined: (player) => {
    console.log(`${player.name} joined the city`);
  },

  onPlayerLeft: (leftPlayerId) => {
    console.log(`Player ${leftPlayerId} left the city`);
  },

  onError: (error) => {
    console.error(`Server error: ${error.message} (${error.code})`);
    if (error.code === 'NOT_FOUND') {
      clearSession();
      showWorldMap();
    }
  },

  onSaved: () => {
    gameMenu.showStatus('Game saved!');
  },

  onMigrationEvent: (payload) => {
    if (!cityState) return;
    const direction = payload.fromCityId === cityState.id ? 'out' : 'in';
    const otherCityId = direction === 'out' ? payload.toCityId : payload.fromCityId;
    const otherName = worldState?.cities.find(c => c.cityId === otherCityId)?.name ?? otherCityId;
    maslowPanel.showMigrationWarning(payload.personCount, direction, otherName);
  },
}).then((client) => {
  gameClient = client;

  // Auto-rejoin saved session or show lobby
  const savedSession = loadSession();
  if (savedSession) {
    currentPlayerName = savedSession.playerName;
    gameClient.joinCity(savedSession.cityId, savedSession.playerName, playerId);
  }
});

// --- Build mode wiring ---
// --- Tax rate wiring ---
resourceBar.onTaxRateChange = (rate) => {
  gameClient.setTaxRate(rate, playerId);
};

// --- Game speed wiring ---
resourceBar.onGameSpeedChange = (speed) => {
  gameClient.setGameSpeed(speed, playerId);
};

buildMode.onPlace = (pos, type, density) => {
  console.log('[Client] onPlace called', { pos, type, density });
  gameClient.placeBuilding(pos, type, playerId, density);
};

buildMode.onDemolish = (pos) => {
  gameClient.demolish(pos, playerId);
};

buildMode.onDragCostUpdate = (cost) => {
  if (cost !== null) {
    footerIndicator.show(`Road cost: $${cost}`);
  } else {
    footerIndicator.hide();
  }
};

// --- Edge road click: Navigate to adjacent city ---
buildMode.onEdgeRoadClick = (direction: EdgeDirection, position: number) => {
  if (!worldState || !cityState) return;

  // Find current city's world position
  const currentCityEntry = worldState.cities.find(c => c.cityId === cityState!.id);
  if (!currentCityEntry) return;

  // Find adjacent city in the clicked direction
  const adjacentCity = findAdjacentCity(currentCityEntry.position, direction, worldState.cities);
  if (!adjacentCity) {
    console.log(`No city found to the ${direction}`);
    return;
  }

  // Check if the adjacent city has a matching connection
  const oppositeDir = getOppositeDirection(direction);
  const hasMatchingRoad = adjacentCity.edgeConnections?.some(
    conn => conn.direction === oppositeDir && conn.positions.includes(position)
  );

  if (hasMatchingRoad) {
    console.log(`Traveling ${direction} to ${adjacentCity.name}`);
    gameClient.leave(playerId);
    cityState = null;
    cityRenderer.clear();
    carManager.clear();
    gameClient.joinCity(adjacentCity.cityId, currentPlayerName, playerId);
  } else {
    console.log(`Road not connected to ${adjacentCity.name}`);
  }
};

// --- Lobby (name entry + world selection) ---
const lobby = new Lobby(uiRoot, {
  onEnterWorld: (playerName, worldId) => {
    currentPlayerName = playerName;
    console.log(`Entering world: ${worldId}`);
    lobby.hide();
    worldMap.show();
  },
  fetchWorlds: async () => {
    const res = await fetch(`${SERVER_URL}/api/worlds`);
    return res.json();
  },
  onCreateWorld: async (name) => {
    const res = await fetch(`${SERVER_URL}/api/worlds/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (data.success) return { worldId: data.worldId };
    return null;
  },
});

// --- World Map ---
const worldMap = new WorldMap(uiRoot, {
  onClaimPlot: (position, cityName) => {
    gameClient.claimPlot(position, cityName, currentPlayerName, playerId);
  },
  onEnterCity: (cityId) => {
    gameClient.joinCity(cityId, currentPlayerName, playerId);
  },
});

// --- Game Menu ---
const gameMenu = new GameMenu(uiRoot, {
  onSave: () => {
    gameClient.save(playerId);
    gameMenu.showStatus('Saving...');
  },
  onLoadCity: (cityId: string) => {
    gameClient.leave(playerId);
    cityState = null;
    cityRenderer.clear();
    carManager.clear();
    clearSession();
    gameClient.joinCity(cityId, currentPlayerName, playerId);
  },
  fetchCities: async () => {
    const res = await fetch(`${SERVER_URL}/api/cities`);
    return res.json();
  },
  onRestart: () => {
    cityRenderer.clear();
    carManager.clear();
    gameClient.restart(playerId);
  },
  onEndGame: () => {
    gameClient.save(playerId);
    gameClient.leave(playerId);
    cityState = null;
    cityRenderer.clear();
    carManager.clear();
    clearSession();
    showWorldMap();
  },
  onOptions: () => {
    optionsPanel.show();
  },
  onResume: () => {
    // Menu closes itself
  },
});

// --- Options Panel ---
function applyOptions(options: GameOptions): void {
  // Grid visibility
  gridHelper.visible = options.showGrid;

  // Cars
  carManager.setEnabled(options.showCars);
  carManager.setMaxCars(options.maxCars);

  // Camera speed
  cameraController.setPanSpeed(options.cameraSpeed);

  // Unlimited money (gameClient may not be ready during initial OptionsPanel construction)
  gameClient?.setUnlimitedMoney(options.unlimitedMoney, playerId);
  resourceBar.setUnlimitedMoney(options.unlimitedMoney);
  buildMode.setUnlimitedMoney(options.unlimitedMoney);

  // Shadows
  sceneManager.renderer.shadowMap.enabled = options.shadowsEnabled;
  sceneManager.scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = options.shadowsEnabled;
      obj.receiveShadow = options.shadowsEnabled;
    }
    if (obj instanceof THREE.DirectionalLight) {
      obj.castShadow = options.shadowsEnabled;
    }
  });
}

const optionsPanel = new OptionsPanel(uiRoot, applyOptions);

// --- Menu toggle button ---
const menuToggle = document.createElement('button');
menuToggle.className = 'menu-toggle';
menuToggle.textContent = 'Menu';
uiRoot.appendChild(menuToggle);
menuToggle.addEventListener('click', () => {
  if (cityState) gameMenu.show();
});

// --- ESC key handler ---
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;

  if (maslowPanel.isVisible()) {
    maslowPanel.hide();
  } else if (financePanel.isVisible()) {
    financePanel.hide();
  } else if (optionsPanel.isVisible()) {
    optionsPanel.hide();
    gameMenu.show();
  } else if (gameMenu.isVisible()) {
    gameMenu.hide();
  } else if (cityState) {
    // If a building is selected, deselect it first
    if (buildMode.getSelectedType()) {
      buildMode.deselect();
      toolbar.setActive(null);
      infraToolbar.setActive(null);
    } else {
      gameMenu.show();
    }
  }
});

// --- Show world map helper ---
function showWorldMap(): void {
  worldMap.show();
}

// --- Game loop ---
let lastTime = performance.now();

function gameLoop(): void {
  requestAnimationFrame(gameLoop);

  const now = performance.now();
  const deltaTime = (now - lastTime) / 1000;
  lastTime = now;

  cameraController.update(deltaTime);
  carManager.update(deltaTime, cityState);
  buildMode.updatePreview(cityState);
  sceneManager.render();
}

gameLoop();
