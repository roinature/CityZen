import {
  type CityState,
  type BuildingType,
  type UtilityLayer,
  type ZoneDensity,
  type WorldState,
  type EdgeDirection,
  type PlacedBuilding,
  CELL_SIZE,
  EMERGENCY_LABELS,
  clearGridBuilding,
  getBuildingUtilityLayer,
  hasOperationalResponder,
  levelRoadTerrain,
  setGridBuilding,
  findAdjacentCity,
  getOppositeDirection,
  isZone,
  isRoad,
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
import { CAMERA_VIEWS, CameraController } from './scene/CameraController.js';
import { setupLighting } from './scene/LightingSetup.js';
import { createGridOverlay, setGridEditing } from './scene/GridOverlay.js';
import { EdgeRoadIndicator } from './scene/EdgeRoadIndicator.js';
import { createTerrain } from './world/Terrain.js';
import { CityRenderer } from './world/CityRenderer.js';
import { BuildMode } from './input/BuildMode.js';
import { MapInput } from './input/MapInput.js';
import { ResourceBar } from './ui/ResourceBar.js';
import { CityAdvisor } from './ui/CityAdvisor.js';
import { getBlockedZoneLevel, getHappinessAdvice, needsHappinessAdvice } from './ui/happinessAdvice.js';
import { Toolbar } from './ui/Toolbar.js';
import { Lobby } from './ui/Lobby.js';
import { WorldMap } from './ui/WorldMap.js';
import { GameMenu } from './ui/GameMenu.js';
import { OptionsPanel, type GameOptions } from './ui/OptionsPanel.js';
import { CarManager } from './world/CarManager.js';
import { BoatManager } from './world/BoatManager.js';
import { EXPLORE_MODES, ExploreMode, type ExploreKind } from './world/explore/ExploreMode.js';
import { GridRaycaster } from './input/Raycaster.js';
import { BuildTools, type ToolMode } from './ui/BuildTools.js';
import { FinancePanel } from './ui/FinancePanel.js';
import { MaslowPanel } from './ui/MaslowPanel.js';
import { ShareModal } from './ui/ShareModal.js';
import { FooterIndicator } from './ui/FooterIndicator.js';
import { CompassIndicator } from './ui/CompassIndicator.js';
import { ZoomControl } from './ui/ZoomControl.js';
import { MessageManager } from './ui/MessageManager.js';
import { GameClient, type GameCallbacks } from './network/GameClient.js';
import type { CityConnection } from './network/CityConnection.js';
import { P2PGameClient } from './network/p2p/P2PGameClient.js';
import { SoundManager } from './audio/SoundManager.js';
import { TownPlannerPanel } from './ui/TownPlannerPanel.js';
import { CityLoading } from './ui/CityLoading.js';
import { UtilityLayerEditor } from './ui/UtilityLayerEditor.js';
import { BuildingCard } from './ui/BuildingCard.js';

const SERVER_URL = window.location.origin;
const LAST_WORLD_KEY = 'cityzen_last_p2p_world';

/**
 * Distributed peer-to-peer mode is the default: each player owns and stores
 * their own city locally in IndexedDB and connects to friends in the same
 * `?world=<id>` over WebRTC. Pass `?server` to use the legacy central server.
 */
function resolveP2PWorld(): string | null {
  const params = new URLSearchParams(window.location.search);
  if (params.has('server')) return null;

  const valid = (value: string | null): string | null =>
    value && /^[\w-]{4,64}$/.test(value) ? value : null;

  let world = valid(params.get('world')) ?? valid(params.get('room'));
  const hadLegacyRoom = !params.get('world') && Boolean(params.get('room'));
  const hadLegacyP2P = params.has('p2p');

  if (!world) {
    world = valid(localStorage.getItem(LAST_WORLD_KEY)) ?? crypto.randomUUID().slice(0, 8);
  }
  localStorage.setItem(LAST_WORLD_KEY, world);

  if (params.get('world') !== world || hadLegacyRoom || hadLegacyP2P) {
    params.delete('room');
    params.delete('p2p');
    params.set('world', world);
    window.history.replaceState({}, '', `${window.location.pathname}?${params}`);
  }
  return world;
}
const P2P_WORLD = resolveP2PWorld();

function connect(callbacks: GameCallbacks): Promise<CityConnection> {
  return P2P_WORLD
    ? P2PGameClient.create(P2P_WORLD, playerId, callbacks)
    : GameClient.create(SERVER_URL, callbacks);
}
// Each P2P world remembers its own last visited city separately.
const SESSION_KEY = P2P_WORLD ? `cityzen_session_p2p_${P2P_WORLD}` : 'cityzen_session';
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
let isReadOnlyCity = false;
const playerId = getOrCreatePlayerId();

// --- Scene setup ---
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root')!;

const sceneManager = new SceneManager(canvas);
const cameraController = new CameraController(sceneManager);
const lighting = setupLighting(sceneManager.scene);
const { entranceRoad, setSite } = createTerrain(sceneManager.scene);
const gridHelper = createGridOverlay(sceneManager.scene);
const edgeRoadIndicator = new EdgeRoadIndicator(sceneManager.scene);

const cityRenderer = new CityRenderer(sceneManager.scene, entranceRoad);
const carManager = new CarManager(sceneManager.scene);
const boatManager = new BoatManager(sceneManager.scene);
const exploreMode = new ExploreMode(
  sceneManager.scene, sceneManager, cameraController, carManager, boatManager,
  () => cityRenderer.getObstacles(), uiRoot, canvas,
);
const buildMode = new BuildMode(sceneManager.scene, () => sceneManager.camera, canvas);
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
  stopExploring();
  lobby.hide();
  worldMap.hide();
  cityState = null;
  cityAdvisor.hide();
  buildingCard.hide();
  cityRenderer.setSelectedBuilding(null);
  buildMode.setCityState(null);
  setToolMode('pointer');
  cityRenderer.clear();
  edgeRoadIndicator.clear();
  carManager.clear();
  boatManager.clear();
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
    const pos = message.data?.position as { x: number; z: number } | undefined;
    if (pos && !exploreMode.isActive()) {
      cameraController.lookAt((pos.x + 0.5) * CELL_SIZE, (pos.z + 0.5) * CELL_SIZE);
    }
  }
});
const toolbar = new Toolbar(uiRoot, resourceBar.demand, (type: BuildingType, density?: ZoneDensity) => {
  if (isReadOnlyCity) {
    footerIndicator.toast('Read-only view — owner is offline', 2500);
    return;
  }
  if (buildMode.getSelectedType() === type && !density) {
    setToolMode('pointer');
    return;
  }

  const targetLayer = getBuildingUtilityLayer(type);
  if (targetLayer !== 'surface') {
    setActiveLayer(targetLayer);
  }
  setToolMode('build');
  buildMode.select(type);
  buildMode.setDensity(density ?? null);
  toolbar.setActive(type);
  utilityLayerEditor.setActiveTool('build', type);
  cityRenderer.highlightZones(isZone(type));
});
const buildTools = new BuildTools(toolbar.controls, setToolMode, (size) => buildMode.setBrushSize(size));
const mapInput = new MapInput(canvas, cameraController, buildMode, () => toolbar.dismissPicker());

const utilityLayerEditor = new UtilityLayerEditor(cityHud, {
  onSelectLayer: (layer) => {
    setActiveLayer(layer);
    if (layer === 'surface' && buildMode.getSelectedType() && getBuildingUtilityLayer(buildMode.getSelectedType()!) !== 'surface') {
      setToolMode('pointer');
    }
  },
  onSelectBuilding: (type, layer) => {
    if (isReadOnlyCity) {
      footerIndicator.toast('Read-only view — owner is offline', 2500);
      return;
    }
    if (buildMode.getSelectedType() === type && buildMode.getToolMode() === 'build') {
      setToolMode('pointer');
      return;
    }
    setActiveLayer(layer);
    setToolMode('build');
    buildMode.select(type);
    buildMode.setDensity(null);
    toolbar.setActive(type);
    utilityLayerEditor.setActiveTool('build', type);
  },
  onSelectBulldoze: (layer) => {
    if (isReadOnlyCity) {
      footerIndicator.toast('Read-only view — owner is offline', 2500);
      return;
    }
    setActiveLayer(layer);
    setToolMode(buildMode.getToolMode() === 'bulldoze' ? 'pointer' : 'bulldoze');
  },
});

function setActiveLayer(layer: UtilityLayer): void {
  buildMode.setActiveLayer(layer);
  const report = cityRenderer.setActiveLayer(layer);
  utilityLayerEditor.setLayer(layer);
  utilityLayerEditor.update(cityState, report);
  if (cityState && buildingCard.isVisible()) buildingCard.refresh(cityState, report);
  setGridEditing(gridHelper, layer !== 'surface' || buildMode.getToolMode() !== 'pointer');
}

function setToolMode(mode: ToolMode): void {
  if (mode !== 'pointer') {
    setExplorePicking(null);
    buildingCard.hide();
    cityRenderer.setSelectedBuilding(null);
  }
  mapInput.cancel();
  buildMode.setToolMode(mode);
  buildTools.setActiveMode(mode);
  setGridEditing(gridHelper, mode !== 'pointer' || cityRenderer.getActiveLayer() !== 'surface');
  if (mode !== 'build') {
    toolbar.setActive(null);
    toolbar.close();
    cityRenderer.highlightZones(false);
  }
  utilityLayerEditor.setActiveTool(mode, buildMode.getSelectedType());
}

let isNight = false;
const financePanel = new FinancePanel(uiRoot, {
  onTaxRateChange: (rate) => gameClient.setTaxRate(rate, playerId),
  onTakeLoan: (amount, termDays) => gameClient.takeLoan(amount, termDays, playerId),
  onRepayLoan: (loanId) => gameClient.repayLoan(loanId, playerId),
});
const maslowPanel = new MaslowPanel(uiRoot);
const buildingCard = new BuildingCard(uiRoot, {
  getDepotStatus: (buildingId) => carManager.getDepotFleetStatus(buildingId, cityState),
  getMaritimeStatus: (buildingId) => boatManager.getBuildingMaritimeStatus(buildingId, cityState),
  onSetFleetSize: (buildingId, fleetSize) => gameClient.setBuildingFleet(buildingId, fleetSize, playerId),
  onDispatchVehicle: (buildingId) => carManager.dispatchDepotVehicle(buildingId, cityState),
  onRecallVehicles: (buildingId) => carManager.recallDepotVehicles(buildingId),
  onDispatchVessel: (buildingId) => boatManager.dispatchVesselToBuilding(buildingId, cityState),
  onFocusPosition: (cellX, cellZ) => {
    if (!exploreMode.isActive()) {
      cameraController.lookAt(cellX * CELL_SIZE, cellZ * CELL_SIZE);
    }
  },
  onOpenUtilityLayer: (layer) => setActiveLayer(layer),
  onDemolish: (building) => {
    if (isReadOnlyCity) return;
    cityRenderer.setSelectedBuilding(null);
    void gameClient.demolish(building.position, playerId, 'surface');
  },
  onClose: () => {
    cityRenderer.setSelectedBuilding(null);
  },
});

const cityAdvisor = new CityAdvisor(uiRoot, action => {
  if (!cityState) return;
  if (action.kind === 'finance') {
    toolbar.close();
    financePanel.update(cityState);
    financePanel.show();
  } else if (action.kind === 'layer') {
    toolbar.close();
    setActiveLayer(action.layer);
  } else if (action.kind === 'build') {
    toolbar.showBuilding(action.building);
  } else {
    toolbar.close();
    if (cityState.resources.populationSummary) maslowPanel.update(cityState.resources.populationSummary);
    maslowPanel.show();
  }
});

const toggleFinancePanel = () => {
  if (!cityState) return;
  toolbar.close();
  financePanel.update(cityState);
  financePanel.toggle();
};

resourceBar.onOpenFinance = toggleFinancePanel;

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

interface HudActionOptions {
  compactLabel?: string;
  title?: string;
  iconSvg?: string;
  iconOnly?: boolean;
}

function addHudAction(label: string, onClick: () => void, options: HudActionOptions = {}): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = options.iconOnly ? 'hud-button hud-icon-button' : 'hud-button';
  button.title = options.title ?? label;
  button.setAttribute('aria-label', label);

  if (options.iconOnly && options.iconSvg) {
    button.innerHTML = options.iconSvg;
  } else if (options.compactLabel || options.iconSvg) {
    const iconHtml = options.iconSvg ? `<span class="hud-btn-icon" aria-hidden="true">${options.iconSvg}</span>` : '';
    if (options.compactLabel) {
      button.innerHTML = `${iconHtml}<span class="hud-label-full">${label}</span><span class="hud-label-compact">${options.compactLabel}</span>`;
    } else {
      button.innerHTML = `${iconHtml}<span>${label}</span>`;
    }
  } else {
    button.textContent = label;
  }

  button.addEventListener('click', onClick);
  resourceBar.actions.appendChild(button);
  return button;
}

addHudAction('Finance', toggleFinancePanel, { title: 'City Finances & Loans' });
addHudAction('Needs', () => {
  if (!cityState) return;
  toolbar.close();
  if (cityState.resources.populationSummary) maslowPanel.update(cityState.resources.populationSummary);
  maslowPanel.toggle();
}, { title: 'Citizen Needs (Maslow Pyramid)' });
// --- Explore mode: drive, walk, fly or sail through the city ---
// Explore → pick a mode → click a spot on the map → set off from the nearest suitable place.
const exploreRaycaster = new GridRaycaster(canvas);
let explorePicking: ExploreKind | null = null;

function setExplorePicking(kind: ExploreKind | null): void {
  explorePicking = kind;
  mapInput.onTap = kind ? pickExploreStart : null;
  canvas.classList.toggle('drive-picking', !!kind);
  refreshExploreButton();
}

function refreshExploreButton(): void {
  const kind = explorePicking ?? exploreMode.getKind();
  exploreButton?.setAttribute('aria-pressed', String(!!kind));
  exploreMenu?.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(item =>
    item.setAttribute('aria-pressed', String(item.dataset.kind === kind)));
}

function pickExploreStart(clientX: number, clientY: number): void {
  const kind = explorePicking;
  if (!cityState || !kind) return setExplorePicking(null);
  const cell = exploreRaycaster.getGridPosition(clientX, clientY, sceneManager.camera);
  if (!cell) return;
  if (!exploreMode.start(kind, cityState, { x: cell.x + 0.5, z: cell.z + 0.5 })) {
    footerIndicator.toast(EXPLORE_MODES[kind].none);
    return;
  }
  setExplorePicking(null);
  mapInput.enabled = false;
  refreshExploreButton();
  footerIndicator.toast(`${EXPLORE_MODES[kind].label} · Esc to stop`);
}

function toggleExplore(kind: ExploreKind): void {
  setExploreMenu(false);
  const current = exploreMode.getKind();
  if (current) {
    exploreMode.stop();
    if (current === kind) return;
  }
  if (explorePicking === kind) {
    setExplorePicking(null);
    return;
  }
  if (!cityState) return;
  if (!exploreMode.canStart(kind, cityState)) {
    footerIndicator.toast(kind === 'drive' ? 'Build a road first, then take it for a drive' : 'This city has no water to sail on');
    return;
  }
  toolbar.close();
  setToolMode('pointer');
  setExplorePicking(kind);
  footerIndicator.toast(EXPLORE_MODES[kind].pick, 4000);
}

/** Leaves explore mode, or stops waiting for a starting spot. */
function stopExploring(): void {
  setExplorePicking(null);
  exploreMode.stop();
}

const exploreButton = addHudAction('Explore', () => {
  if (exploreMode.isActive() || explorePicking) return stopExploring();
  setExploreMenu(exploreMenu.hidden);
}, { title: 'Drive, walk, fly or sail through the city' });
exploreButton.setAttribute('aria-pressed', 'false');
exploreButton.setAttribute('aria-haspopup', 'menu');
const exploreMenu = document.createElement('div');
exploreMenu.className = 'explore-menu';
exploreMenu.setAttribute('role', 'menu');
exploreMenu.hidden = true;
for (const kind of Object.keys(EXPLORE_MODES) as ExploreKind[]) {
  const { label, key } = EXPLORE_MODES[kind];
  const item = document.createElement('button');
  item.className = 'explore-menu-item';
  item.dataset.kind = kind;
  item.setAttribute('role', 'menuitem');
  item.innerHTML = `<span>${label}</span><kbd>${key}</kbd>`;
  item.addEventListener('click', () => toggleExplore(kind));
  exploreMenu.appendChild(item);
}
uiRoot.appendChild(exploreMenu);

function setExploreMenu(open: boolean): void {
  exploreMenu.hidden = !open;
  exploreButton.setAttribute('aria-expanded', String(open));
  if (!open) return;
  const rect = exploreButton.getBoundingClientRect();
  exploreMenu.style.top = `${rect.bottom + 6}px`;
  exploreMenu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 168))}px`;
}
document.addEventListener('pointerdown', (e) => {
  if (!exploreMenu.hidden && !exploreMenu.contains(e.target as Node) && !exploreButton.contains(e.target as Node)) setExploreMenu(false);
});
exploreMode.onExit = () => {
  mapInput.enabled = true;
  refreshExploreButton();
};
exploreMode.onChange = () => refreshExploreButton();

addHudAction('Switch camera view', () => {
  footerIndicator.toast(`${CAMERA_VIEWS[optionsPanel.nextCameraView()].label} view`);
}, {
  iconOnly: true,
  title: 'Switch camera view (V)',
  iconSvg: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2 14 5.2v5.6L8 14 2 10.8V5.2L8 2Z"/><path d="M2 5.2 8 8.4l6-3.2M8 8.4V14"/></svg>',
});

const nightButton = addHudAction('Night View', () => {
  isNight = !isNight;
  lighting.setNight(isNight);
  sceneManager.setDayNight(isNight);
  boatManager.setNight(isNight);
  nightButton.setAttribute('aria-pressed', String(isNight));
}, {
  iconOnly: true,
  title: 'Toggle Day / Night View',
  iconSvg: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 9.8A5.8 5.8 0 0 1 6.2 2.5a5.8 5.8 0 1 0 7.3 7.3Z"/></svg>',
});
nightButton.setAttribute('aria-pressed', 'false');

const readOnlyPill = document.createElement('span');
readOnlyPill.className = 'hud-readonly-pill';
readOnlyPill.textContent = 'Read-Only';
readOnlyPill.title = 'Read-only view — city owner is offline';
readOnlyPill.hidden = true;
resourceBar.actions.appendChild(readOnlyPill);

function setReadOnlyCity(readOnly: boolean, reason?: string): void {
  const wasReadOnly = isReadOnlyCity;
  isReadOnlyCity = readOnly;
  document.body.classList.toggle('read-only-city', readOnly);
  readOnlyPill.hidden = !readOnly;
  buildingCard.setReadOnly(readOnly);
  if (readOnly) {
    setToolMode('pointer');
    toolbar.close();
    financePanel.hide();
    townPlanner.hide();
    if (reason) footerIndicator.toast(reason, 5000);
  } else if (wasReadOnly) {
    footerIndicator.toast('Owner reconnected — live co-building resumed!', 3500);
  }
}

const shareModal = new ShareModal(uiRoot, {
  onCopySuccess: () => footerIndicator.toast('World invite link copied. Friends who open it share this Earth.', 4000),
  onCopyFallback: (link) => footerIndicator.toast(`Share this link: ${link}`, 8000),
});

function shareWorldInvite(): void {
  if (!P2P_WORLD) return;
  const params = new URLSearchParams({ world: P2P_WORLD });
  if (cityState) params.set('cityId', cityState.id);
  const link = `${window.location.origin}${window.location.pathname}?${params}`;
  shareModal.show(link);
}

if (P2P_WORLD) {
  addHudAction('Invite', shareWorldInvite, {
    title: 'Invite friends to this Earth',
    iconSvg: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="3.5" r="2"/><circle cx="4" cy="8" r="2"/><circle cx="12" cy="12.5" r="2"/><path d="M5.8 7l4.4-2.5M5.8 9l4.4 2.5"/></svg>',
  });
}

// --- Session ---
let currentPlayerName = 'Player';

// --- Network ---
let gameClient!: CityConnection;

connect({
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
      exploreMode.stop();
      buildingCard.hide();
      cityRenderer.setSelectedBuilding(null);
      cameraController.frameCity(city);
    }
    setSite(city.siteId, city.grid);
    cityState = city;
    buildMode.setCityState(city);
    cityRenderer.syncState(city);
    utilityLayerEditor.update(city);
    edgeRoadIndicator.update(city.buildings, worldState, city.id);
    carManager.clear();
    boatManager.clear();
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
    let terrainLeveled = false;
    for (const building of additions) {
      cityState.buildings.push(building);
      if (isRoad(building.type) && levelRoadTerrain(cityState.grid, building.position, building.type, building.orientation) > 0) {
        terrainLeveled = true;
      }
      setGridBuilding(cityState.grid, building);
    }
    if (terrainLeveled) {
      setSite(cityState.siteId, cityState.grid);
    }

    cityState.resources = payload.resources;
    cityRenderer.syncState(cityState);
    utilityLayerEditor.update(cityState);
    edgeRoadIndicator.update(cityState.buildings, worldState, cityState.id);
    resourceBar.update(cityState.resources, cityState);
    refreshCityAdvisor(cityState);
    if (buildingCard.isVisible()) buildingCard.refresh(cityState, cityRenderer.getUtilityReport());
    soundManager.triggerConstruction();
  },

  onBuildingUpdated: (payload) => {
    if (!cityState) return;
    const idx = cityState.buildings.findIndex((b: PlacedBuilding) => b.id === payload.building.id);
    if (idx >= 0) {
      cityState.buildings[idx] = payload.building;
    }
    cityState.resources = payload.resources;
    resourceBar.update(cityState.resources, cityState);
    if (financePanel.isVisible()) financePanel.update(cityState);
    if (buildingCard.isVisible()) buildingCard.refresh(cityState, cityRenderer.getUtilityReport());
  },

  onBuildingDemolished: (payload) => {
    if (!cityState) return;
    const building = cityState.buildings.find((b: PlacedBuilding) => b.id === payload.buildingId);
    if (building) {
      clearGridBuilding(cityState.grid, building);
    }
    cityState.buildings = cityState.buildings.filter((b: PlacedBuilding) => b.id !== payload.buildingId);
    cityState.resources = payload.resources;
    cityRenderer.syncState(cityState);
    utilityLayerEditor.update(cityState);
    edgeRoadIndicator.update(cityState.buildings, worldState, cityState.id);
    resourceBar.update(cityState.resources, cityState);
    refreshCityAdvisor(cityState);
    if (buildingCard.getBuildingId() === payload.buildingId) {
      buildingCard.hide();
      cityRenderer.setSelectedBuilding(null);
    } else if (buildingCard.isVisible()) {
      buildingCard.refresh(cityState, cityRenderer.getUtilityReport());
    }
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
    utilityLayerEditor.update(cityState, cityRenderer.getUtilityReport());
    refreshCityAdvisor(cityState);
    if (financePanel.isVisible()) {
      financePanel.update(cityState);
    }
    if (maslowPanel.isVisible() && resources.populationSummary) {
      maslowPanel.update(resources.populationSummary);
    }
    if (buildingCard.isVisible()) {
      buildingCard.refresh(cityState, cityRenderer.getUtilityReport());
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
    if (buildingCard.isVisible()) {
      buildingCard.refresh(cityState, cityRenderer.getUtilityReport());
    }
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
    if (error.code === 'SITE_CONFLICT') {
      footerIndicator.toast(error.message, 7000);
    }
    if (error.code === 'NOT_FOUND') {
      clearSession();
      cityState = null;
      cityLoading.hide();
      footerIndicator.toast('That city no longer exists', 4000);
      showWorldMap();
    }
  },

  onReadOnlyChange: (readOnly, reason) => {
    setReadOnlyCity(readOnly, reason);
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

  onEmergencyStarted: ({ emergency }) => {
    if (!cityState) return;
    const existing = cityState.emergencies ?? [];
    if (!existing.some(e => e.id === emergency.id)) {
      cityState.emergencies = [...existing, emergency];
    }
    const responderOk = hasOperationalResponder(cityState, emergency.kind);
    const neededLabel = {
      robbery: 'Police Station',
      fire: 'Fire Station',
      medical: 'Clinic or Hospital',
      sewage_overflow: 'Sewage Station or Plant',
    }[emergency.kind];
    const icon = {
      robbery: '🚨',
      fire: '🔥',
      medical: '🚑',
      sewage_overflow: '☣️',
    }[emergency.kind];

    messageManager.addMessage({
      id: `em_start_${emergency.id}`,
      type: MessageType.GAME_EVENT,
      category: MessageCategory.SYSTEM,
      priority: responderOk ? MessagePriority.HIGH : MessagePriority.CRITICAL,
      title: `${icon} ${EMERGENCY_LABELS[emergency.kind]}!`,
      content: responderOk
        ? `Emergency units are dispatching to (${emergency.position.x}, ${emergency.position.z}). Click to view.`
        : `No ${neededLabel} connected by road! Build one fast or face catastrophe!`,
      data: { position: emergency.position, emergencyId: emergency.id },
      cityId: cityState.id,
      playerId,
      createdAt: Date.now(),
      isRead: false,
      displayType: responderOk ? DisplayType.NOTIFICATION : DisplayType.BOTH,
    });
    soundManager.triggerEmergencyAlert();
    if (buildingCard.isVisible()) buildingCard.refresh(cityState, cityRenderer.getUtilityReport());
  },

  onEmergencyResponding: ({ emergencyId, respondingAtTick }) => {
    if (!cityState?.emergencies) return;
    const em = cityState.emergencies.find(e => e.id === emergencyId);
    if (em) em.respondingAtTick = respondingAtTick;
    if (cityState && buildingCard.isVisible()) buildingCard.refresh(cityState, cityRenderer.getUtilityReport());
  },

  onEmergencyOutcome: ({ outcome, resources }) => {
    if (!cityState) return;
    cityState.emergencies = (cityState.emergencies ?? []).filter(e => e.id !== outcome.emergency.id);
    cityState.resources = resources;
    resourceBar.update(resources, cityState);
    refreshCityAdvisor(cityState);
    if (buildingCard.isVisible()) buildingCard.refresh(cityState, cityRenderer.getUtilityReport());

    if (outcome.resolution === 'failed') {
      messageManager.addMessage({
        id: `em_fail_${outcome.emergency.id}`,
        type: MessageType.SYSTEM_ALERT,
        category: MessageCategory.SYSTEM,
        priority: MessagePriority.CRITICAL,
        title: `💀 ${EMERGENCY_LABELS[outcome.emergency.kind]} — Disaster!`,
        content: outcome.summary,
        data: { position: outcome.emergency.position },
        cityId: cityState.id,
        playerId,
        createdAt: Date.now(),
        isRead: false,
        displayType: DisplayType.BOTH,
      });
      soundManager.triggerBulldoze();
    } else {
      footerIndicator.toast(`✅ ${outcome.summary}`, 3500);
    }
  },
}).then((client) => {
  gameClient = client;

  // Check for deep-link: ?cityId=xxx
  const urlParams = new URLSearchParams(window.location.search);
  const urlCityId = urlParams.get('cityId');
  if (urlCityId) {
    // Clear only cityId so refreshes preserve ?world=<id>
    urlParams.delete('cityId');
    const query = urlParams.toString();
    window.history.replaceState({}, '', query ? `${window.location.pathname}?${query}` : window.location.pathname);
    beginCityLoad('Loading city…');
    gameClient.joinCity(urlCityId, currentPlayerName, playerId);
  } else {
    // Auto-rejoin saved session or show lobby
    const savedSession = loadSession();
    // In a peer-to-peer world the saved city may not be cached locally yet.
    const sessionCityExists = !P2P_WORLD || worldState?.cities.some(c => c.cityId === savedSession?.cityId);
    if (savedSession && sessionCityExists) {
      currentPlayerName = savedSession.playerName;
      beginCityLoad('Loading your city…');
      gameClient.joinCity(savedSession.cityId, savedSession.playerName, playerId);
    }
  }
});

// --- Build mode wiring ---
carManager.onEmergencyArrived = (emergencyId) => {
  if (isReadOnlyCity || !gameClient) return;
  void gameClient.reportEmergencyResponding(emergencyId, playerId);
};
carManager.onEmergencyResolved = (emergencyId) => {
  if (isReadOnlyCity || !gameClient) return;
  void gameClient.reportEmergencyResolved(emergencyId, playerId);
};

// --- Game speed wiring ---
resourceBar.onGameSpeedChange = (speed) => {
  if (isReadOnlyCity) return;
  gameClient.setGameSpeed(speed, playerId);
};

buildMode.onPlace = (pos, type, density, orientation) => {
  if (isReadOnlyCity) return;
  gameClient.placeBuilding(pos, type, playerId, density, orientation);
};

buildMode.onPaint = (stroke) => {
  if (isReadOnlyCity) return;
  void gameClient.paintBuildings(stroke, playerId);
};

buildMode.onDemolish = (pos, layer) => {
  if (isReadOnlyCity) return;
  gameClient.demolish(pos, playerId, layer);
};

buildMode.onPreviewClearance = (rect) => {
  cityRenderer.setPreviewClearance(rect);
};

buildMode.onDragCostUpdate = (cost, affordable = true, gradingCost = 0, invalidReason) => {
  if (cost !== null) {
    const levelingNote = gradingCost > 0 ? ` (includes $${gradingCost.toLocaleString()} leveling)` : '';
    if (!affordable) {
      footerIndicator.show(`Cost: $${cost.toLocaleString()}${levelingNote} — not enough money`, 'warn');
    } else if (invalidReason) {
      footerIndicator.show(`Cost: $${cost.toLocaleString()}${levelingNote} — ${invalidReason.toLowerCase()}`, 'warn');
    } else {
      footerIndicator.show(`Cost: $${cost.toLocaleString()}${levelingNote}`, 'info');
    }
  } else {
    footerIndicator.hide();
  }
};

// --- Building selection & Edge road click ---
buildMode.onSelectBuilding = (building) => {
  if (!cityState || !building) {
    buildingCard.hide();
    cityRenderer.setSelectedBuilding(null);
    return;
  }
  cityRenderer.setSelectedBuilding(building);
  buildingCard.show(building, cityState, cityRenderer.getUtilityReport());
};

buildMode.onEdgeRoadClick = (direction: EdgeDirection, position: number): boolean => {
  if (!worldState || !cityState) return false;

  // Find current city's world position
  const currentCityEntry = worldState.cities.find(c => c.cityId === cityState!.id);
  if (!currentCityEntry) return false;

  // Find adjacent city in the clicked direction
  const adjacentCity = findAdjacentCity(currentCityEntry.position, direction, worldState.cities);
  if (!adjacentCity) {
    console.log(`No city found to the ${direction}`);
    return false;
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
    return true;
  }
  console.log(`Road not connected to ${adjacentCity.name}`);
  return false;
};

// --- Earth lobby ---
const lobby = new Lobby(uiRoot, {
  onEnterWorld: async (playerName) => {
    currentPlayerName = playerName;
    if (!gameClient) {
      throw new Error('Game client is not connected yet');
    }
    const loaded = await gameClient.fetchWorldState();
    if (!loaded) {
      throw new Error('Could not load Earth');
    }
    lobby.hide();
    worldMap.show();
  },
});

// --- World Map ---
const worldMap = new WorldMap(uiRoot, {
  playerId,
  onInvite: P2P_WORLD ? shareWorldInvite : undefined,
  onClaimPlot: (siteId, cityName) => {
    beginCityLoad(`Founding ${cityName}…`);
    gameClient.claimPlot(siteId, cityName, currentPlayerName, playerId).catch((err) => {
      console.error('Claim failed:', err);
      abortCityLoad('Could not reach the host');
    });
  },
  onEnterCity: (cityId) => {
    const name = worldState?.cities.find(c => c.cityId === cityId)?.name ?? 'city';
    beginCityLoad(`Loading ${name}…`);
    gameClient.joinCity(cityId, currentPlayerName, playerId).catch((err) => {
      console.error('Join failed:', err);
      abortCityLoad('Could not load city');
    });
  },
});

// --- Game Menu ---
const gameMenu = new GameMenu(uiRoot, {
  isP2P: Boolean(P2P_WORLD),
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
      abortCityLoad('Could not load city');
    }
  },
  fetchCities: async () => {
    return gameClient.listCities();
  },
  onRestart: () => {
    if (isReadOnlyCity) {
      footerIndicator.toast('Read-only view — cannot restart', 2500);
      return;
    }
    exploreMode.stop();
    cityRenderer.clear();
    edgeRoadIndicator.clear();
    carManager.clear();
    boatManager.clear();
    gameClient.restart(playerId);
  },
  onEndGame: async () => {
    await gameClient.save(playerId);
    await gameClient.leave(playerId);
    setReadOnlyCity(false);
    cityState = null;
    cityRenderer.clear();
    edgeRoadIndicator.clear();
    carManager.clear();
    boatManager.clear();
    clearSession();
    showWorldMap();
  },
  onOptions: () => {
    optionsPanel.show();
  },
  onPlanTown: () => {
    if (isReadOnlyCity) {
      footerIndicator.toast('Read-only view — Town Planner unavailable', 2500);
      return;
    }
    if (cityState) townPlanner.show(cityState);
  },
  onInvite: P2P_WORLD ? shareWorldInvite : undefined,
  onExportBackup: P2P_WORLD ? async () => {
    if (!gameClient.exportBackup) return;
    const json = await gameClient.exportBackup();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cityzen-${P2P_WORLD}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    gameMenu.showStatus('Backup downloaded!');
  } : undefined,
  onImportBackup: P2P_WORLD ? async (rawJson: string) => {
    if (!gameClient.importBackup) return;
    const ok = await gameClient.importBackup(rawJson);
    if (!ok) {
      gameMenu.showStatus('Invalid backup file');
      return;
    }
    gameMenu.showStatus('Backup restored!');
    await gameClient.leave(playerId);
    setReadOnlyCity(false);
    cityState = null;
    clearSession();
    gameMenu.hide();
    showWorldMap();
  } : undefined,
  onResume: () => {
    // Menu closes itself
  },
});

// --- Options Panel ---
function applyOptions(options: GameOptions): void {
  // Grid visibility
  gridHelper.visible = options.showGrid;

  // Cars & boats
  carManager.setEnabled(options.showCars);
  carManager.setMaxCars(options.maxCars);
  boatManager.setEnabled(options.showCars);
  boatManager.setMaxBoats(Math.max(0, Math.round(options.maxCars * 0.7)));

  // Looks
  cityRenderer.setLook({
    style: options.cityStyle,
    skyline: options.skyline / 100,
    crossings: options.crossings,
    trees: options.trees,
  });
  buildMode.setStyle(options.cityStyle);
  cameraController.setView(options.cameraView);

  // Camera speed
  cameraController.setPanSpeed(options.cameraSpeed);

  // Unlimited money (gameClient may not be ready during initial OptionsPanel construction)
  gameClient?.setUnlimitedMoney(options.unlimitedMoney, playerId);
  resourceBar.setUnlimitedMoney(options.unlimitedMoney);
  buildMode.setUnlimitedMoney(options.unlimitedMoney);

  // Shadows
  sceneManager.renderer.shadowMap.enabled = options.shadowsEnabled;
  sceneManager.post.enabled = options.postEffects;

  // Sound
  soundManager.setEnabled(options.soundEnabled);
  soundManager.setMasterVolume(options.masterVolume / 100);
  soundManager.setMusicVolume(options.musicVolume / 100);
  soundManager.setSfxVolume(options.sfxVolume / 100);
}

const townPlanner = new TownPlannerPanel(uiRoot, async (settings) => {
  const built = await gameClient.generateTown(settings, playerId);
  if (built && cityState) cameraController.frameCity(cityState);
  return built;
});

const optionsPanel = new OptionsPanel(uiRoot, applyOptions);

addHudAction('Menu', () => {
  if (!cityState) return;
  toolbar.close();
  gameMenu.show();
}, {
  title: 'Game Menu (Esc)',
  iconSvg: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/></svg>',
});

// --- ESC key handler ---
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || cityAdvisor.isOpen()) return;

  if (shareModal.isVisible()) {
    shareModal.hide();
  } else if (maslowPanel.isVisible()) {
    maslowPanel.hide();
  } else if (financePanel.isVisible()) {
    financePanel.hide();
  } else if (townPlanner.isVisible()) {
    townPlanner.hide();
  } else if (optionsPanel.isVisible()) {
    optionsPanel.hide();
    gameMenu.show();
  } else if (gameMenu.isVisible()) {
    gameMenu.hide();
  } else if (!exploreMenu.hidden) {
    setExploreMenu(false);
  } else if (exploreMode.isActive() || explorePicking) {
    stopExploring();
  } else if (buildingCard.isVisible()) {
    buildingCard.hide();
    cityRenderer.setSelectedBuilding(null);
  } else if (cityState) {
    if (buildMode.getSelectedType() || buildMode.getToolMode() === 'bulldoze') {
      setToolMode('pointer');
    } else if (cityRenderer.getActiveLayer() !== 'surface') {
      setActiveLayer('surface');
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
  if (!cityState || !gameClient || cityAdvisor.isOpen() || shareModal.isVisible() || gameMenu.isVisible() || optionsPanel.isVisible() || townPlanner.isVisible()) return;

  const exploreKey = ({ KeyC: 'drive', KeyG: 'walk', KeyH: 'fly', KeyN: 'boat', KeyJ: 'ride' } as const)[e.code as 'KeyC'];
  if (exploreKey) {
    toggleExplore(exploreKey);
    return;
  }
  // Explore mode owns the movement keys (Space brakes or jumps, V switches camera).
  if (exploreMode.isActive() && e.code !== 'Digit1' && e.code !== 'Digit2' && e.code !== 'Digit3') return;

  if (e.code === 'Space' && !el?.closest('button, select')) {
    if (isReadOnlyCity) return;
    e.preventDefault();
    const current = cityState.clock?.speed ?? 1;
    if (current > 0) {
      speedBeforePause = current;
      gameClient.setGameSpeed(0, playerId);
    } else {
      gameClient.setGameSpeed(speedBeforePause, playerId);
    }
  } else if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
    if (isReadOnlyCity) return;
    gameClient.setGameSpeed(Number(e.code.slice(-1)), playerId);
  } else if (e.code === 'KeyV') {
    footerIndicator.toast(`${CAMERA_VIEWS[optionsPanel.nextCameraView()].label} view`);
  } else if (e.code === 'KeyB') {
    if (isReadOnlyCity) return;
    setToolMode(buildMode.getToolMode() === 'bulldoze' ? 'pointer' : 'bulldoze');
  } else if (e.code === 'KeyL') {
    const next = utilityLayerEditor.cycleLayer();
    footerIndicator.toast(`${next === 'surface' ? 'Surface' : next[0].toUpperCase() + next.slice(1)} layer`);
  } else if (e.code === 'KeyR' && buildMode.getToolMode() === 'build') {
    buildMode.rotateSelection();
  }
});

// --- Show world map helper ---
function showWorldMap(): void {
  stopExploring();
  cityAdvisor.hide();
  buildingCard.hide();
  cityRenderer.setSelectedBuilding(null);
  unhappyCityId = null;
  // No city on screen any more: drop the active tool and hide the HUD
  setToolMode('pointer');
  setInCity(false);
  worldMap.show();
}

// --- Game loop ---
let lastTime = performance.now();
let cardRefreshTimer = 0;
let roadCount = 0;
let roadCountSource: PlacedBuilding[] | null = null;
let roadCountLength = -1;

function gameLoop(): void {
  requestAnimationFrame(gameLoop);

  const now = performance.now();
  // Clamp so a backgrounded tab doesn't come back with one giant step
  const deltaTime = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (exploreMode.isActive()) exploreMode.update(deltaTime, cityState);
  else cameraController.update(deltaTime);
  lighting.update(deltaTime);
  sceneManager.post.setNight(lighting.getNight());
  cityRenderer.update(deltaTime, isNight);
  // Paused (speed 0) freezes all simulated movement; camera/UI stay live
  const paused = cityState?.clock?.speed === 0;
  if (!paused) {
    carManager.update(deltaTime, cityState);
    boatManager.update(deltaTime, cityState);
  }
  if (cityState && buildingCard.isVisible()) {
    cardRefreshTimer += deltaTime;
    if (cardRefreshTimer >= 0.4) {
      cardRefreshTimer = 0;
      buildingCard.refresh(cityState, cityRenderer.getUtilityReport());
    }
  } else {
    cardRefreshTimer = 0;
  }
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
    && target.residential <= MIN_DEMAND_TO_GROW && labor.employmentRate < 0.9) {
    advise('no_jobs', 'Not enough jobs',
      `There are ${Math.round(labor.jobs)} jobs for ${Math.round(labor.workers)} workers, so nobody new wants to move in. ` +
      (hasAny('zone_industrial') || hasAny('zone_commercial')
        ? 'Zone more commercial or industrial land. It also pays tax once staffed.'
        : 'Zone some commercial and industrial land next to your housing.'),
      city);
  } else if (emptyOf('zone_commercial') && target.commercial <= MIN_DEMAND_TO_GROW && city.tick > 30) {
    advise('no_customers', 'Shops have no customers',
      'Commercial zones develop as the population grows. Grow your residential zones first.',
      city, MessagePriority.LOW);
  }

  // Zones that are ready to grow taller but held back by the mood of the city
  const blockedLevel = getBlockedZoneLevel(city);
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

// Dev-only handle for poking the game from the console or browser tests.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __cityzen: {
      get client() { return gameClient; },
      get city() { return cityState; },
      get world() { return worldState; },
    },
  });
}
