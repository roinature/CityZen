import * as THREE from 'three';
import {
  type CityState,
  type BuildingType,
  type CityListItem,
  BUILDING_DEFS,
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
import { GameMenu } from './ui/GameMenu.js';
import { OptionsPanel, type GameOptions } from './ui/OptionsPanel.js';
import { CarManager } from './world/CarManager.js';
import { SocketClient } from './network/SocketClient.js';

const SERVER_URL = 'http://localhost:3030';
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
const playerId = getOrCreatePlayerId();

// --- Scene setup ---
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root')!;

const sceneManager = new SceneManager(canvas);
const cameraController = new CameraController(sceneManager);
setupLighting(sceneManager.scene);
createTerrain(sceneManager.scene);
const gridHelper = createGridOverlay(sceneManager.scene);

const cityRenderer = new CityRenderer(sceneManager.scene);
const carManager = new CarManager(sceneManager.scene);
const buildMode = new BuildMode(sceneManager.scene, sceneManager.camera);

// --- UI ---
const resourceBar = new ResourceBar(uiRoot);
const toolbar = new Toolbar(uiRoot, (type: BuildingType) => {
  if (buildMode.getSelectedType() === type) {
    buildMode.deselect();
    toolbar.setActive(null);
  } else {
    buildMode.select(type);
    toolbar.setActive(type);
  }
});

// --- Session ---
let currentPlayerName = 'Player';

// --- Network ---
const socketClient = new SocketClient(SERVER_URL, {
  onCityState: (city, players) => {
    cityState = city;
    cityRenderer.syncState(city);
    carManager.clear();
    resourceBar.update(city.resources, cityState);
    lobby.hide();
    saveSession(city.id, currentPlayerName);
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
    const building = cityState.buildings.find(b => b.id === payload.buildingId);
    if (building) {
      const def = BUILDING_DEFS[building.type];
      for (let dx = 0; dx < def.size.w; dx++) {
        for (let dz = 0; dz < def.size.d; dz++) {
          cityState.grid[building.position.x + dx][building.position.z + dz].buildingId = null;
        }
      }
    }
    cityState.buildings = cityState.buildings.filter(b => b.id !== payload.buildingId);
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
  },

  onZoneGrowth: (payload) => {
    if (!cityState) return;
    for (const update of payload.buildings) {
      const building = cityState.buildings.find(b => b.id === update.id);
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

  onPlayerLeft: (playerId) => {
    console.log(`Player ${playerId} left the city`);
  },

  onError: (error) => {
    console.error(`Server error: ${error.message} (${error.code})`);
    if (error.code === 'NOT_FOUND') {
      clearSession();
      lobby.show();
      fetchCityList();
    }
  },

  onSaved: () => {
    gameMenu.showStatus('Game saved!');
  },
});

// --- Build mode wiring ---
// --- Tax rate wiring ---
resourceBar.onTaxRateChange = (rate) => {
  socketClient.setTaxRate(rate);
};

// --- Game speed wiring ---
resourceBar.onGameSpeedChange = (speed) => {
  socketClient.setGameSpeed(speed);
};

buildMode.onPlace = (pos, type) => {
  socketClient.placeBuilding(pos, type);
};

buildMode.onDemolish = (pos) => {
  socketClient.demolish(pos);
};

// --- Lobby ---
const lobby = new Lobby(uiRoot, {
  onCreate: (cityName, playerName) => {
    currentPlayerName = playerName;
    socketClient.createCity(cityName, playerName, playerId);
  },
  onJoin: (cityId, playerName) => {
    currentPlayerName = playerName;
    socketClient.joinCity(cityId, playerName, playerId);
  },
});

// --- Game Menu ---
const gameMenu = new GameMenu(uiRoot, {
  onSave: () => {
    socketClient.save();
    gameMenu.showStatus('Saving...');
  },
  onLoadCity: (cityId: string) => {
    socketClient.leave();
    cityState = null;
    cityRenderer.clear();
    carManager.clear();
    clearSession();
    socketClient.joinCity(cityId, currentPlayerName, playerId);
  },
  fetchCities: async () => {
    const res = await fetch(`${SERVER_URL}/api/cities`);
    return res.json();
  },
  onRestart: () => {
    cityRenderer.clear();
    carManager.clear();
    socketClient.restart();
  },
  onEndGame: () => {
    socketClient.save();
    socketClient.leave();
    cityState = null;
    cityRenderer.clear();
    carManager.clear();
    clearSession();
    lobby.show();
    fetchCityList();
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

  // Unlimited money
  socketClient.setUnlimitedMoney(options.unlimitedMoney);
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

  if (optionsPanel.isVisible()) {
    optionsPanel.hide();
    gameMenu.show();
  } else if (gameMenu.isVisible()) {
    gameMenu.hide();
  } else if (cityState) {
    // If a building is selected, deselect it first
    if (buildMode.getSelectedType()) {
      buildMode.deselect();
      toolbar.setActive(null);
    } else {
      gameMenu.show();
    }
  }
});

// --- Fetch city list ---
async function fetchCityList(): Promise<void> {
  try {
    const res = await fetch(`${SERVER_URL}/api/cities`);
    const cities: CityListItem[] = await res.json();
    lobby.updateCityList(cities);
  } catch {
    // Server not available yet
  }
}

// Auto-rejoin saved session or show lobby
const savedSession = loadSession();
if (savedSession) {
  currentPlayerName = savedSession.playerName;
  socketClient.joinCity(savedSession.cityId, savedSession.playerName, playerId);
} else {
  fetchCityList();
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
