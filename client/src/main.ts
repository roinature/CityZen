import * as THREE from 'three';
import {
  type CityState,
  type BuildingType,
  type ZoneDensity,
  type WorldState,
  type EdgeDirection,
  type PlacedBuilding,
  getEffectiveSize,
  findAdjacentCity,
  getOppositeDirection,
  isZone,
  calculateNetIncome,
  calculateLaborStats,
  calculateDemandTargets,
  getZoneLevelHappinessRequirement,
  MIN_DEMAND_TO_GROW,
  MessageType,
  MessageCategory,
  MessagePriority,
  DisplayType,
} from '@cityzen/shared';
import { SceneManager } from './scene/SceneManager.js';
import { CameraController } from './scene/CameraController.js';
import { setupLighting } from './scene/LightingSetup.js';
import { createGridOverlay, setGridEditing } from './scene/GridOverlay.js';
import { EdgeRoadIndicator } from './scene/EdgeRoadIndicator.js';
import { createTerrain } from './world/Terrain.js';
import { CityRenderer } from './world/CityRenderer.js';
import { BuildMode } from './input/BuildMode.js';
import { MapInput } from './input/MapInput.js';
import { ResourceBar } from './ui/ResourceBar.js';
import { CityAdvisor } from './ui/CityAdvisor.js';
import { getHappinessAdvice, needsHappinessAdvice } from './ui/happinessAdvice.js';
import { Toolbar } from './ui/Toolbar.js';
import { Lobby } from './ui/Lobby.js';
import { WorldMap } from './ui/WorldMap.js';
import { GameMenu } from './ui/GameMenu.js';
import { OptionsPanel, type GameOptions } from './ui/OptionsPanel.js';
import { CarManager } from './world/CarManager.js';
import { BuildTools, type ToolMode } from './ui/BuildTools.js';
import { FinancePanel } from './ui/FinancePanel.js';
import { MaslowPanel } from './ui/MaslowPanel.js';
import { FooterIndicator } from './ui/FooterIndicator.js';
import { CompassIndicator } from './ui/CompassIndicator.js';
import { ZoomControl } from './ui/ZoomControl.js';
import { MessageManager } from './ui/MessageManager.js';
import { GameClient } from './network/GameClient.js';
import { SoundManager } from './audio/SoundManager.js';
import { CityLoading } from './ui/CityLoading.js';

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
const entranceRoad = createTerrain(sceneManager.scene);
const gridHelper = createGridOverlay(sceneManager.scene);
const edgeRoadIndicator = new EdgeRoadIndicator(sceneManager.scene);

const cityRenderer = new CityRenderer(sceneManager.scene, entranceRoad);
const carManager = new CarManager(sceneManager.scene);
const buildMode = new BuildMode(sceneManager.scene, sceneManager.camera, canvas);
const soundManager = new SoundManager();

// --- HUD visibility ---
// The build toolbars, resource bar etc. only make sense with a city on screen.
// CSS hides them unless <body> has the "in-city" class.
function setInCity(inCity: boolean): void {
  document.body.classList.toggle('in-city', inCity);
}

// --- Entering a city ---
// Switch to the city screen the instant the player picks a city; the state
// arrives a moment later and fills it in.
const cityLoading = new CityLoading(uiRoot);

function beginCityLoad(label: string): void {
  lobby.hide();
  worldMap.hide();
  cityState = null;
  cityAdvisor.hide();
  buildMode.setCityState(null);
  setToolMode('pointer');
  cityRenderer.clear();
  edgeRoadIndicator.clear();
  carManager.clear();
  setInCity(true);
  cityLoading.show(label, () => abortCityLoad('The city took too long to load. Please try again.'));
}

function abortCityLoad(message: string): void {
  if (!cityLoading.isVisible()) return;
  cityLoading.hide();
  footerIndicator.toast(message, 4000);
  showWorldMap();
}

// --- Notification Cooldowns ---
// Prevents the same notification type from firing more than once per cooldown period
const notificationCooldowns = new Map<string, number>();
function canNotify(key: string, cooldownMs: number): boolean {
  const now = Date.now();
  const last = notificationCooldowns.get(key) ?? 0;
  if (now - last < cooldownMs) return false;
  notificationCooldowns.set(key, now);
  return true;
}

// Resume AudioContext on first user interaction (browser autoplay policy)
const resumeAudio = () => {
  soundManager.resume();
  window.removeEventListener('click', resumeAudio);
  window.removeEventListener('keydown', resumeAudio);
};
window.addEventListener('click', resumeAudio);
window.addEventListener('keydown', resumeAudio);

// --- UI ---
const cityHud = document.createElement('div');
cityHud.className = 'city-hud';
uiRoot.appendChild(cityHud);
const resourceBar = new ResourceBar(cityHud);
const footerIndicator = new FooterIndicator(uiRoot, cityHud);
const compassIndicator = new CompassIndicator(cityHud);
const zoomControl = new ZoomControl(cityHud, cameraController);

// --- Message System ---
const messageManager = new MessageManager(cityHud, {
  onMessageRead: (messageId) => {
    console.log(`Message read: ${messageId}`);
  },
  onMessageClick: (message) => {
    console.log(`Message clicked: ${message.title}`);
  }
});
const toolbar = new Toolbar(uiRoot, resourceBar.demand, (type: BuildingType, density?: ZoneDensity) => {
  if (buildMode.getSelectedType() === type && !density) {
    setToolMode('pointer');
    return;
  }

  setToolMode('build');
  buildMode.select(type);
  buildMode.setDensity(density ?? null);
  toolbar.setActive(type);
  cityRenderer.highlightZones(isZone(type));
});
const buildTools = new BuildTools(toolbar.controls, setToolMode, (size) => buildMode.setBrushSize(size));
const mapInput = new MapInput(canvas, cameraController, buildMode, () => toolbar.dismissPicker());

function setToolMode(mode: ToolMode): void {
  mapInput.cancel();
  buildMode.setToolMode(mode);
  buildTools.setActiveMode(mode);
  setGridEditing(gridHelper, mode !== 'pointer');
  if (mode !== 'build') {
    toolbar.setActive(null);
    toolbar.close();
    cityRenderer.highlightZones(false);
  }
}

let isNight = false;
const financePanel = new FinancePanel(uiRoot, {
  onTaxRateChange: (rate) => gameClient.setTaxRate(rate, playerId),
  onTakeLoan: (amount, termDays) => gameClient.takeLoan(amount, termDays, playerId),
  onRepayLoan: (loanId) => gameClient.repayLoan(loanId, playerId),
});
const maslowPanel = new MaslowPanel(uiRoot);

const cityAdvisor = new CityAdvisor(uiRoot, action => {
  if (!cityState) return;
  if (action.kind === 'finance') {
    toolbar.close();
    financePanel.update(cityState);
    financePanel.show();
  } else if (action.kind === 'build') {
    toolbar.showBuilding(action.building);
  } else {
    toolbar.close();
    if (cityState.resources.populationSummary) maslowPanel.update(cityState.resources.populationSummary);
    maslowPanel.show();
  }
});

resourceBar.onOpenAdvisor = () => {
  if (!cityState) return;
  toolbar.close();
  cityAdvisor.show(cityState);
};

let unhappyCityId: string | null = null;
function refreshCityAdvisor(city: CityState): void {
  if (cityAdvisor.isOpen()) cityAdvisor.update(city);
  if (!needsHappinessAdvice(city)) {
    unhappyCityId = null;
    return;
  }
  if (unhappyCityId === city.id) return;
  unhappyCityId = city.id;
  if (!canNotify(`city_advisor_${city.id}`, 120_000)) return;

  const [firstTip] = getHappinessAdvice(city);
  messageManager.addMessage({
    id: `city_advisor_${city.id}_${Date.now()}`,
    type: MessageType.HAPPINESS_LOW,
    category: MessageCategory.HAPPINESS,
    priority: MessagePriority.HIGH,
    title: 'City Advisor',
    content: `Happiness is at ${Math.floor(city.resources.happiness)}%. ${firstTip.title}. Select Happiness for details.`,
    cityId: city.id,
    playerId,
    createdAt: Date.now(),
    isRead: false,
    displayType: DisplayType.NOTIFICATION,
  });
  soundManager.triggerNotification();
}

function addHudAction(label: string, onClick: () => void, compactLabel?: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'hud-button';
  button.textContent = label;
  if (compactLabel) {
    const full = document.createElement('span');
    full.className = 'hud-label-full';
    full.textContent = label;
    const compact = document.createElement('span');
    compact.className = 'hud-label-compact';
    compact.textContent = compactLabel;
    button.replaceChildren(full, compact);
    button.setAttribute('aria-label', label);
  }
  button.addEventListener('click', onClick);
  resourceBar.actions.appendChild(button);
  return button;
}

addHudAction('Finance', () => {
  if (!cityState) return;
  toolbar.close();
  financePanel.update(cityState);
  financePanel.toggle();
});
addHudAction('City Needs', () => {
  if (!cityState) return;
  toolbar.close();
  if (cityState.resources.populationSummary) maslowPanel.update(cityState.resources.populationSummary);
  maslowPanel.toggle();
}, 'Needs');
const nightButton = addHudAction('Night View', () => {
  isNight = !isNight;
  lighting.setNight(isNight);
  sceneManager.setDayNight(isNight);
  nightButton.setAttribute('aria-pressed', String(isNight));
}, 'Night');
nightButton.setAttribute('aria-pressed', 'false');

// --- Session ---
let currentPlayerName = 'Player';

// --- Network ---
let gameClient!: GameClient;

GameClient.create(SERVER_URL, {
  onWorldState: (world) => {
    worldState = world;
    worldMap.updateWorld(world);
    // Refresh edge road indicators so connection status stays current
    // (e.g. neighbor placed/demolished a road, or worldState arrived after cityState)
    if (cityState) {
      edgeRoadIndicator.update(cityState.buildings, worldState, cityState.id);
    }
  },

  onCityState: (city, players) => {
    if (cityState?.id !== city.id || (city.tick === 0 && cityState.tick > 0)) {
      cameraController.frameCity(city);
    }
    cityState = city;
    buildMode.setCityState(city);
    cityRenderer.syncState(city);
    edgeRoadIndicator.update(city.buildings, worldState, city.id);
    carManager.clear();
    resourceBar.update(city.resources, cityState);
    refreshCityAdvisor(cityState);
    lobby.hide();
    worldMap.hide();
    cityLoading.hide();
    setInCity(true);
    footerIndicator.hideToast();
    saveSession(city.id, currentPlayerName);
    // Re-apply options to the new server room (unlimited money, etc.)
    applyOptions(optionsPanel.getOptions());
    console.log(`Joined city: ${city.name} with ${players.length} players`);
  },

  onBuildingsPlaced: (payload) => {
    if (!cityState) return;
    const existingIds = new Set(cityState.buildings.map(building => building.id));
    const additions = payload.buildings.filter(building => !existingIds.has(building.id));
    if (!additions.length) return;
    for (const building of additions) {
      cityState.buildings.push(building);
      const { w, d } = getEffectiveSize(building.type, building.orientation);
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < d; dz++) {
          cityState.grid[building.position.x + dx][building.position.z + dz].buildingId = building.id;
        }
      }
    }

    cityState.resources = payload.resources;
    cityRenderer.syncState(cityState);
    edgeRoadIndicator.update(cityState.buildings, worldState, cityState.id);
    resourceBar.update(cityState.resources, cityState);
    refreshCityAdvisor(cityState);
    soundManager.triggerConstruction();
  },

  onBuildingDemolished: (payload) => {
    if (!cityState) return;
    const building = cityState.buildings.find((b: PlacedBuilding) => b.id === payload.buildingId);
    if (building) {
      const { w, d } = getEffectiveSize(building.type, building.orientation);
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < d; dz++) {
          cityState.grid[building.position.x + dx][building.position.z + dz].buildingId = null;
        }
      }
    }
    cityState.buildings = cityState.buildings.filter((b: PlacedBuilding) => b.id !== payload.buildingId);
    cityState.resources = payload.resources;
    cityRenderer.syncState(cityState);
    edgeRoadIndicator.update(cityState.buildings, worldState, cityState.id);
    resourceBar.update(cityState.resources, cityState);
    refreshCityAdvisor(cityState);
    soundManager.triggerBulldoze();
  },

  onResourcesUpdate: (resources, tick, clock) => {
    if (!cityState) return;

    // Store previous state for change detection
    const previousState = { ...cityState.resources };

    cityState.resources = resources;
    cityState.tick = tick;
    cityState.clock = clock;
    resourceBar.update(resources, cityState);
    refreshCityAdvisor(cityState);
    if (financePanel.isVisible()) {
      financePanel.update(cityState);
    }
    if (maslowPanel.isVisible() && resources.populationSummary) {
      maslowPanel.update(resources.populationSummary);
    }

    // Generate messages based on resource changes
    generateResourceMessages(previousState, resources, cityState);
    generateAdvisorHints(cityState);
  },

  onZoneGrowth: (payload) => {
    if (!cityState) return;

    // Collect zone type breakdown while updating state
    const typeCounts = new Map<string, number>();
    for (const update of payload.buildings) {
      const building = cityState.buildings.find((b: PlacedBuilding) => b.id === update.id);
      if (building) {
        building.developmentLevel = update.developmentLevel;
        building.developedAt = update.developedAt;
        const label = building.type.replace(/_/g, ' ').replace(/^zone /i, '');
        typeCounts.set(label, (typeCounts.get(label) || 0) + 1);
      }
    }

    // Throttled aggregated notification (at most once per 30 s)
    if (payload.buildings.length > 0 && canNotify('zone_development', 30_000)) {
      const parts = Array.from(typeCounts.entries()).map(
        ([type, n]) => `${n} ${type.charAt(0).toUpperCase() + type.slice(1)}`
      );
      const message = {
        id: `dev_${Date.now()}`,
        type: MessageType.ZONE_DEVELOPED,
        category: MessageCategory.DEVELOPMENT,
        priority: MessagePriority.LOW,
        title: 'Zone Development',
        content: `${parts.join(', ')} zone${payload.buildings.length === 1 ? '' : 's'} developed!`,
        cityId: cityState.id,
        playerId,
        createdAt: Date.now(),
        isRead: false,
        displayType: DisplayType.NOTIFICATION,
      };
      messageManager.addMessage(message);
      soundManager.triggerNotification();
    }

    cityRenderer.syncState(cityState);
    soundManager.triggerConstruction();
  },

  onPlayerJoined: (player) => {
    console.log(`${player.name} joined the city`);
  },

  onPlayerLeft: (leftPlayerId) => {
    console.log(`Player ${leftPlayerId} left the city`);
  },

  onError: (error) => {
    console.error(`Server error: ${error.message} (${error.code})`);
    // Tell the player why a build failed. "Cell occupied" is skipped: the red
    // preview already shows it, and dragging a road across another one is normal.
    if (error.code === 'PLACEMENT_FAILED' && error.message !== 'Cell occupied' && canNotify('placement_error', 1500)) {
      footerIndicator.toast(error.message);
    }
    if (error.code === 'CLAIM_FAILED' || error.code === 'JOIN_FAILED') {
      if (cityLoading.isVisible()) {
        abortCityLoad(error.message);
      } else {
        footerIndicator.toast(error.message, 4000);
      }
    }
    if (error.code === 'NOT_FOUND') {
      clearSession();
      cityState = null;
      cityLoading.hide();
      footerIndicator.toast('That city no longer exists', 4000);
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

  // Check for deep-link: ?cityId=xxx
  const urlCityId = new URLSearchParams(window.location.search).get('cityId');
  if (urlCityId) {
    // Clear the query param from URL so refreshes don't re-trigger
    window.history.replaceState({}, '', window.location.pathname);
    beginCityLoad('Loading city…');
    gameClient.joinCity(urlCityId, currentPlayerName, playerId);
  } else {
    // Auto-rejoin saved session or show lobby
    const savedSession = loadSession();
    if (savedSession) {
      currentPlayerName = savedSession.playerName;
      beginCityLoad('Loading your city…');
      gameClient.joinCity(savedSession.cityId, savedSession.playerName, playerId);
    }
  }
});

// --- Build mode wiring ---
// --- Game speed wiring ---
resourceBar.onGameSpeedChange = (speed) => {
  gameClient.setGameSpeed(speed, playerId);
};

buildMode.onPlace = (pos, type, density, orientation) => {
  gameClient.placeBuilding(pos, type, playerId, density, orientation);
};

buildMode.onPaint = (stroke) => {
  void gameClient.paintBuildings(stroke, playerId);
};

buildMode.onDemolish = (pos) => {
  gameClient.demolish(pos, playerId);
};

buildMode.onDragCostUpdate = (cost, affordable = true) => {
  if (cost !== null) {
    footerIndicator.show(
      affordable ? `Cost: $${cost.toLocaleString()}` : `Cost: $${cost.toLocaleString()} — not enough money`,
      affordable ? 'info' : 'warn',
    );
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
    beginCityLoad(`Traveling to ${adjacentCity.name}…`);
    (async () => {
      await gameClient.leave(playerId);
      await gameClient.joinCity(adjacentCity.cityId, currentPlayerName, playerId);
    })().catch(() => abortCityLoad('Could not reach the server'));
  } else {
    console.log(`Road not connected to ${adjacentCity.name}`);
  }
};

// --- Lobby (name entry + world selection) ---
const lobby = new Lobby(uiRoot, {
  onEnterWorld: async (playerName, worldId) => {
    currentPlayerName = playerName;
    if (!gameClient) {
      throw new Error('Game client is not connected yet');
    }
    // Load the map of the world that was actually selected
    const loaded = await gameClient.setWorld(worldId);
    if (!loaded) {
      throw new Error(`Could not load world ${worldId}`);
    }
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
    console.error('Create world failed:', data.error);
    return null;
  },
});

lobby.refreshWorlds();

// --- World Map ---
const worldMap = new WorldMap(uiRoot, {
  onClaimPlot: (position, cityName) => {
    beginCityLoad(`Founding ${cityName}…`);
    gameClient.claimPlot(position, cityName, currentPlayerName, playerId).catch((err) => {
      console.error('Claim failed:', err);
      abortCityLoad('Could not reach the server');
    });
  },
  onEnterCity: (cityId) => {
    const name = worldState?.cities.find(c => c.cityId === cityId)?.name ?? 'city';
    beginCityLoad(`Loading ${name}…`);
    gameClient.joinCity(cityId, currentPlayerName, playerId).catch((err) => {
      console.error('Join failed:', err);
      abortCityLoad('Could not reach the server');
    });
  },
});

// --- Game Menu ---
const gameMenu = new GameMenu(uiRoot, {
  onSave: () => {
    gameClient.save(playerId);
    gameMenu.showStatus('Saving...');
  },
  onLoadCity: async (cityId: string) => {
    beginCityLoad('Loading city…');
    try {
      await gameClient.leave(playerId);
      clearSession();
      await gameClient.joinCity(cityId, currentPlayerName, playerId);
    } catch (err) {
      console.error('Load city failed:', err);
      abortCityLoad('Could not reach the server');
    }
  },
  fetchCities: async () => {
    const res = await fetch(`${SERVER_URL}/api/cities`);
    return res.json();
  },
  onRestart: () => {
    cityRenderer.clear();
    edgeRoadIndicator.clear();
    carManager.clear();
    gameClient.restart(playerId);
  },
  onEndGame: async () => {
    await gameClient.save(playerId);
    await gameClient.leave(playerId);
    cityState = null;
    cityRenderer.clear();
    edgeRoadIndicator.clear();
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

  // Sound
  soundManager.setEnabled(options.soundEnabled);
  soundManager.setMasterVolume(options.masterVolume / 100);
  soundManager.setMusicVolume(options.musicVolume / 100);
  soundManager.setSfxVolume(options.sfxVolume / 100);
}

const optionsPanel = new OptionsPanel(uiRoot, applyOptions);

addHudAction('Menu', () => {
  if (!cityState) return;
  toolbar.close();
  gameMenu.show();
});

// --- ESC key handler ---
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || cityAdvisor.isOpen()) return;

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
    if (buildMode.getSelectedType() || buildMode.getToolMode() === 'bulldoze') {
      setToolMode('pointer');
    } else if (!toolbar.close()) {
      gameMenu.show();
    }
  }
});

// --- Gameplay shortcuts: Space = pause/resume, 1-3 = speed, B = bulldoze ---
let speedBeforePause = 1;
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const el = e.target as HTMLElement | null;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (!cityState || !gameClient || cityAdvisor.isOpen() || gameMenu.isVisible() || optionsPanel.isVisible()) return;

  if (e.code === 'Space' && !el?.closest('button, select')) {
    e.preventDefault();
    const current = cityState.clock?.speed ?? 1;
    if (current > 0) {
      speedBeforePause = current;
      gameClient.setGameSpeed(0, playerId);
    } else {
      gameClient.setGameSpeed(speedBeforePause, playerId);
    }
  } else if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
    gameClient.setGameSpeed(Number(e.code.slice(-1)), playerId);
  } else if (e.code === 'KeyB') {
    setToolMode(buildMode.getToolMode() === 'bulldoze' ? 'pointer' : 'bulldoze');
  }
});

// --- Show world map helper ---
function showWorldMap(): void {
  cityAdvisor.hide();
  unhappyCityId = null;
  // No city on screen any more: drop the active tool and hide the HUD
  setToolMode('pointer');
  setInCity(false);
  worldMap.show();
}

// --- Game loop ---
let lastTime = performance.now();
let roadCount = 0;
let roadCountSource: PlacedBuilding[] | null = null;
let roadCountLength = -1;

function gameLoop(): void {
  requestAnimationFrame(gameLoop);

  const now = performance.now();
  // Clamp so a backgrounded tab doesn't come back with one giant step
  const deltaTime = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  cameraController.update(deltaTime);
  lighting.update(deltaTime);
  cityRenderer.update(deltaTime);
  // Paused (speed 0) freezes all simulated movement; camera/UI stay live
  const paused = cityState?.clock?.speed === 0;
  if (!paused) carManager.update(deltaTime, cityState);
  buildMode.updatePreview(cityState);
  compassIndicator.update(cameraController.getRotationAngle());
  zoomControl.update();

  // Update sound system
  soundManager.updateZoom(sceneManager.getFrustumSize());
  if (cityState) {
    // Recount roads only when the building list changes, not every frame
    if (cityState.buildings !== roadCountSource || cityState.buildings.length !== roadCountLength) {
      roadCountSource = cityState.buildings;
      roadCountLength = cityState.buildings.length;
      roadCount = cityState.buildings.filter(b => b.type.startsWith('road_')).length;
    }
    soundManager.updateTrafficLevel(paused ? 0 : roadCount);
  }

  sceneManager.render();
}

gameLoop();

// --- Advisor: explain *why* the city is stuck, not just that it is ---
function advise(key: string, title: string, content: string, city: CityState, priority = MessagePriority.MEDIUM): void {
  if (!canNotify(`advisor_${key}`, 180_000)) return;
  messageManager.addMessage({
    id: `advisor_${key}_${Date.now()}`,
    type: MessageType.INFRASTRUCTURE_NEEDED,
    category: MessageCategory.DEVELOPMENT,
    priority,
    title,
    content,
    cityId: city.id,
    playerId,
    createdAt: Date.now(),
    isRead: false,
    displayType: DisplayType.NOTIFICATION,
  });
  soundManager.triggerNotification();
}

function generateAdvisorHints(city: CityState): void {
  if (city.clock?.speed === 0) return;
  const res = city.resources;
  const zones = city.buildings.filter(b => isZone(b.type));
  const emptyOf = (type: string) => zones.some(b => b.type === type && (b.developmentLevel ?? 0) === 0);
  const hasAny = (type: string) => zones.some(b => b.type === type);
  const happiness = Math.round(res.happiness);
  if (res.money < 0 && !needsHappinessAdvice(city)) {
    advise('debt', 'The city is in debt',
      `The treasury is at -$${Math.abs(Math.floor(res.money)).toLocaleString()}. Review expenses and income in Finance to restore city services.`,
      city, MessagePriority.HIGH);
  } else if (res.money >= 0 && res.population > 0 && calculateNetIncome(city) < 0 && res.money < 2000) {
    advise('deficit', 'Running a deficit',
      'Upkeep costs more than taxes bring in. Zone more housing and workplaces or review expenses in Finance.',
      city);
  }

  const labor = calculateLaborStats(city);
  const target = calculateDemandTargets(city);
  const housingFull = labor.housingCapacity > 0 && res.population >= labor.housingCapacity * 0.9;

  if (hasAny('zone_residential') && (emptyOf('zone_residential') || housingFull)
    && target.residential < MIN_DEMAND_TO_GROW && labor.employmentRate < 0.9) {
    advise('no_jobs', 'Not enough jobs',
      `There are ${Math.round(labor.jobs)} jobs for ${Math.round(labor.workers)} workers, so nobody new wants to move in. ` +
      (hasAny('zone_industrial') || hasAny('zone_commercial')
        ? 'Zone more commercial or industrial land. It also pays tax once staffed.'
        : 'Zone some commercial and industrial land next to your housing.'),
      city);
  } else if (emptyOf('zone_commercial') && target.commercial < MIN_DEMAND_TO_GROW && city.tick > 30) {
    advise('no_customers', 'Shops have no customers',
      'Commercial zones develop as the population grows. Grow your residential zones first.',
      city, MessagePriority.LOW);
  }

  // Zones that are ready to grow taller but held back by the mood of the city
  const blockedLevel = [2, 3].find(level =>
    res.happiness < getZoneLevelHappinessRequirement(level) &&
    zones.some(b => (b.developmentLevel ?? 0) === level - 1));
  if (blockedLevel && res.population > 0 && !needsHappinessAdvice(city)) {
    advise('growth_capped', 'Buildings have stopped growing',
      `Zones only develop to level ${blockedLevel} once happiness reaches ${getZoneLevelHappinessRequirement(blockedLevel)}% (now ${happiness}%).`,
      city);
  }
}

// --- Message Generation Functions ---
function generateResourceMessages(previousState: any, currentResources: any, city: CityState): void {
  // Check for low funds (cooldown: 60 s to avoid oscillation spam)
  if (currentResources.money < 1000 && previousState.money >= 1000 && canNotify('low_funds', 60_000)) {
    const message = {
      id: `low_funds_${Date.now()}`,
      type: MessageType.LOW_FUNDS,
      category: MessageCategory.ECONOMY,
      priority: MessagePriority.HIGH,
      title: 'Low Funds Alert',
      content: `Your city treasury is critically low at $${Math.floor(currentResources.money)}! Consider adjusting tax rates or cutting expenses.`,
      cityId: city.id,
      playerId,
      createdAt: Date.now(),
      isRead: false,
      displayType: DisplayType.NOTIFICATION,
    };
    messageManager.addMessage(message);
    soundManager.triggerNotification();
  }

  // Check for budget surplus (cooldown: 60 s)
  if (currentResources.money > 10000 && previousState.money <= 10000 && canNotify('budget_surplus', 60_000)) {
    const message = {
      id: `surplus_${Date.now()}`,
      type: MessageType.BUDGET_SURPLUS,
      category: MessageCategory.ECONOMY,
      priority: MessagePriority.MEDIUM,
      title: 'Budget Surplus!',
      content: `Excellent! Your city has a budget surplus of $${Math.floor(currentResources.money)}.`,
      cityId: city.id,
      playerId,
      createdAt: Date.now(),
      isRead: false,
      displayType: DisplayType.BANNER,
    };
    messageManager.addMessage(message);
    soundManager.triggerNotification();
  }

  // Check population milestones (no cooldown — these are one-time crossings)
  const popMilestones = [100, 500, 1000, 2500, 5000];
  for (const milestone of popMilestones) {
    if (currentResources.population >= milestone && previousState.population < milestone) {
      const message = {
        id: `pop_${milestone}_${Date.now()}`,
        type: MessageType.POPULATION_MILESTONE,
        category: MessageCategory.POPULATION,
        priority: MessagePriority.MEDIUM,
        title: 'Population Milestone!',
        content: `Congratulations! ${city.name} has reached ${milestone} citizens!`,
        cityId: city.id,
        playerId,
        createdAt: Date.now(),
        isRead: false,
        displayType: DisplayType.BANNER,
      };
      messageManager.addMessage(message);
      soundManager.triggerNotification();
      break;
    }
  }

  // Celebrate crossings into very high happiness.
  if (currentResources.happiness > 80 && previousState.happiness <= 80 && canNotify('happiness_high', 60_000)) {
    const message = {
      id: `happiness_high_${Date.now()}`,
      type: MessageType.HAPPINESS_HIGH,
      category: MessageCategory.HAPPINESS,
      priority: MessagePriority.MEDIUM,
      title: 'Happy Citizens!',
      content: `Your citizens are thriving with ${Math.floor(currentResources.happiness)}% happiness in ${city.name}!`,
      cityId: city.id,
      playerId,
      createdAt: Date.now(),
      isRead: false,
      displayType: DisplayType.BANNER,
    };
    messageManager.addMessage(message);
    soundManager.triggerNotification();
  }
}
