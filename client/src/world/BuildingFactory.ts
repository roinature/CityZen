import * as THREE from 'three';
import { type PlacedBuilding, BUILDING_DEFS, CELL_SIZE, BuildingType, isZone, isRoad, getZoneLevelDef, type ZoneType, ZoneDensity } from '@cityzen/shared';

export interface RoadNeighbors {
  hasNorth: boolean;
  hasSouth: boolean;
  hasEast: boolean;
  hasWest: boolean;
}

interface TextureConfig {
  categories: {
    id: string;
    minScore: number;
    textures: {
      residential: { facades: string[], roofs: string[] };
      commercial: { facades: string[], roofs: string[] };
      industrial: { facades: string[], roofs: string[] };
    };
  }[];
}

// Sub-building slot layouts per density (positions/sizes as fraction of CELL_SIZE)
const ZONE_SLOT_LAYOUTS: Record<string, Array<{ x: number; z: number; w: number; d: number; heightScale: number }>> = {
  low: [
    { x: -0.22, z: -0.22, w: 0.35, d: 0.35, heightScale: 1.0 },
    { x: 0.22, z: -0.22, w: 0.33, d: 0.35, heightScale: 0.9 },
    { x: -0.22, z: 0.22, w: 0.35, d: 0.33, heightScale: 0.85 },
    { x: 0.22, z: 0.22, w: 0.33, d: 0.33, heightScale: 0.95 },
  ],
  medium: [
    { x: -0.2, z: 0, w: 0.4, d: 0.55, heightScale: 1.0 },
    { x: 0.2, z: -0.18, w: 0.38, d: 0.35, heightScale: 0.88 },
    { x: 0.2, z: 0.22, w: 0.38, d: 0.3, heightScale: 0.82 },
  ],
  high: [
    { x: -0.13, z: 0, w: 0.5, d: 0.6, heightScale: 1.0 },
    { x: 0.28, z: 0, w: 0.35, d: 0.5, heightScale: 0.85 },
  ],
};

export class BuildingFactory {
  private textureLoader = new THREE.TextureLoader();
  private textures: Record<string, THREE.Texture> = {};
  private config: TextureConfig | null = null;
  private currentScore = 0;

  constructor() {
    this.loadConfig();
  }

  private async loadConfig() {
    try {
      const response = await fetch('/config/texture_mapping.json');
      this.config = await response.json();
    } catch (e) {
      console.error('Failed to load texture mapping config', e);
    }
  }

  setCityScore(score: number) {
    this.currentScore = score;
  }

  private getTexture(path: string, wrapS = 1, wrapT = 1): THREE.Texture {
    if (!this.textures[path]) {
      const texture = this.textureLoader.load(path);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      this.textures[path] = texture;
    }
    const tex = this.textures[path].clone();
    tex.repeat.set(wrapS, wrapT);
    return tex;
  }

  private getNightTexturePath(path: string): string {
    const parts = path.split('.');
    if (parts.length < 2) return path;
    const ext = parts.pop();
    return `${parts.join('.')}_night.${ext}`;
  }

  createBuilding(building: PlacedBuilding, neighbors?: RoadNeighbors, populationRatio?: number): THREE.Group {
    const def = BUILDING_DEFS[building.type];
    const group = new THREE.Group();

    const w = def.size.w * CELL_SIZE;
    const d = def.size.d * CELL_SIZE;

    if (building.type === BuildingType.PARK) {
      this.createPark(group, w, d);
    } else if (isRoad(building.type)) {
      this.createRoad(group, building, neighbors);
    } else if (isZone(building.type)) {
      this.createZone(group, building, populationRatio);
    } else {
      this.createInfrastructure(group, building);
    }

    // Position on grid
    group.position.set(
      building.position.x * CELL_SIZE + w / 2,
      0,
      building.position.z * CELL_SIZE + d / 2,
    );
    group.userData = { buildingId: building.id, buildingType: building.type };

    return group;
  }

  private createPark(group: THREE.Group, w: number, d: number): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.95, d * 0.95),
      new THREE.MeshLambertMaterial({ color: 0x4caf50 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.02;
    ground.receiveShadow = true;
    group.add(ground);

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.08, 0.6, 6),
      new THREE.MeshLambertMaterial({ color: 0x8b4513 }),
    );
    trunk.position.y = 0.3;
    trunk.castShadow = true;
    group.add(trunk);

    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0x228b22 }),
    );
    canopy.position.y = 0.7;
    canopy.castShadow = true;
    group.add(canopy);
  }


  // Texture mapping for infrastructure buildings
  public static readonly INFRASTRUCTURE_TEXTURES: Partial<Record<BuildingType, string>> = {
    [BuildingType.ENERGY_WIND_TURBINE]: 'wind_turbine_facade.png',
    [BuildingType.ENERGY_SOLAR_FARM]: 'solar_farm_facade.png',
    [BuildingType.ENERGY_COAL_PLANT]: 'coal_plant_facade.png',
    [BuildingType.ENERGY_NUCLEAR_PLANT]: 'nuclear_plant_facade.png',
    [BuildingType.POLICE_STATION]: 'police_station_facade.png',
    [BuildingType.POLICE_HQ]: 'police_hq_facade.png',
    [BuildingType.POLICE_JAIL]: 'police_jail_facade.png',
    [BuildingType.POLICE_ACADEMY]: 'police_academy_facade.png',
    [BuildingType.HEALTH_CLINIC]: 'clinic_facade.png',
    [BuildingType.HEALTH_HOSPITAL]: 'hospital_facade.png',
    [BuildingType.HEALTH_RESEARCH_CENTER]: 'research_center_facade.png',
    [BuildingType.FIRE_STATION]: 'fire_station_facade.png',
    [BuildingType.FIRE_HQ]: 'fire_hq_facade.png',
    [BuildingType.FIRE_HELICOPTER]: 'fire_helicopter_facade.png',
    [BuildingType.FIRE_TRAINING]: 'fire_training_facade.png',
    [BuildingType.WATER_TOWER]: 'water_tower_facade.png',
    [BuildingType.WATER_PUMP_STATION]: 'water_pump_facade.png',
    [BuildingType.WATER_TREATMENT]: 'water_treatment_facade.png',
    [BuildingType.WATER_SEWAGE_PLANT]: 'sewage_plant_facade.png',
    [BuildingType.EDU_ELEMENTARY]: 'elementary_facade.png',
    [BuildingType.EDU_HIGH_SCHOOL]: 'high_school_facade.png',
    [BuildingType.EDU_UNIVERSITY]: 'university_facade.png',
    [BuildingType.EDU_LIBRARY]: 'library_facade.png',
    [BuildingType.GOV_CITY_HALL]: 'city_hall_facade.png',
    [BuildingType.GOV_COURTHOUSE]: 'courthouse_facade.png',
    [BuildingType.GOV_PARLIAMENT]: 'parliament_facade.png',
    [BuildingType.GOV_MONUMENT]: 'monument_facade.png',
    [BuildingType.TOUR_LANDMARK]: 'landmark_facade.png',
    [BuildingType.TOUR_MUSEUM]: 'museum_facade.png',
    [BuildingType.TOUR_STADIUM]: 'stadium_facade.png',
    [BuildingType.TOUR_AMUSEMENT]: 'amusement_park_facade.png',
    [BuildingType.TRANS_BUS_DEPOT]: 'bus_depot_facade.png',
    [BuildingType.TRANS_TRAIN_STATION]: 'train_station_facade.png',
    [BuildingType.TRANS_AIRPORT]: 'airport_facade.png',
    [BuildingType.TRANS_HARBOR]: 'harbor_facade.png',
  };

  public static readonly INFRASTRUCTURE_ROOFS: Partial<Record<BuildingType, string>> = {
    [BuildingType.ENERGY_COAL_PLANT]: 'coal_plant_roof.png',
    [BuildingType.ENERGY_SOLAR_FARM]: 'solar_farm_roof.png',
    [BuildingType.ENERGY_WIND_TURBINE]: 'wind_turbine_roof.png',
    [BuildingType.ENERGY_NUCLEAR_PLANT]: 'nuclear_plant_roof.png',
    [BuildingType.HEALTH_CLINIC]: 'clinic_roof.png',
    [BuildingType.HEALTH_HOSPITAL]: 'hospital_roof.png',
    [BuildingType.HEALTH_RESEARCH_CENTER]: 'research_center_roof.png',
    [BuildingType.FIRE_STATION]: 'fire_station_roof.png',
    [BuildingType.WATER_TOWER]: 'water_tower_roof.png',
    [BuildingType.WATER_PUMP_STATION]: 'water_pump_roof.png',
    [BuildingType.WATER_TREATMENT]: 'water_treatment_roof.png',
    [BuildingType.WATER_SEWAGE_PLANT]: 'sewage_plant_roof.png',
    [BuildingType.EDU_ELEMENTARY]: 'elementary_roof.png',
    [BuildingType.EDU_HIGH_SCHOOL]: 'high_school_roof.png',
    [BuildingType.EDU_UNIVERSITY]: 'university_roof.png',
    [BuildingType.EDU_LIBRARY]: 'library_roof.png',
    [BuildingType.GOV_CITY_HALL]: 'city_hall_roof.png',
    [BuildingType.GOV_COURTHOUSE]: 'courthouse_roof.png',
    [BuildingType.GOV_PARLIAMENT]: 'parliament_roof.png',
    [BuildingType.GOV_MONUMENT]: 'monument_roof.png',
    [BuildingType.TOUR_LANDMARK]: 'landmark_roof.png',
    [BuildingType.TOUR_MUSEUM]: 'museum_roof.png',
    [BuildingType.TOUR_STADIUM]: 'stadium_roof.png',
    [BuildingType.TOUR_AMUSEMENT]: 'amusement_park_roof.png',
    [BuildingType.TRANS_BUS_DEPOT]: 'bus_depot_roof.png',
    [BuildingType.TRANS_TRAIN_STATION]: 'train_station_roof.png',
    [BuildingType.TRANS_AIRPORT]: 'airport_roof.png',
    [BuildingType.TRANS_HARBOR]: 'harbor_roof.png',
  };

  /**
   * Returns a path to an image file represent the building icon/preview.
   */
  public static getBuildingIcon(type: BuildingType): string | null {
    // 1. Check mapped infrastructure icons
    if (this.INFRASTRUCTURE_TEXTURES[type]) {
      return `/textures/buildings/${this.INFRASTRUCTURE_TEXTURES[type]}`;
    }

    // 2. Check hardcoded zone fallbacks
    if (type === BuildingType.ZONE_RESIDENTIAL) return '/textures/buildings/residential_facade.png';
    if (type === BuildingType.ZONE_COMMERCIAL) return '/textures/buildings/commercial_facade.png';
    if (type === BuildingType.ZONE_INDUSTRIAL) return '/textures/buildings/industrial_facade.png';

    return null;
  }

  private createInfrastructure(group: THREE.Group, building: PlacedBuilding): void {
    const def = BUILDING_DEFS[building.type];
    const w = def.size.w * CELL_SIZE;
    const d = def.size.d * CELL_SIZE;
    const h = def.height;
    const color = new THREE.Color(def.color);

    // Foundation pad
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.95, d * 0.95),
      new THREE.MeshLambertMaterial({ color: color.clone().multiplyScalar(0.3) }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.01;
    pad.receiveShadow = true;
    group.add(pad);

    // Main body dimensions
    const bodyW = w * 0.8;
    const bodyD = d * 0.8;
    const bodyH = h * 0.7;

    // Check if this building has a texture
    const texturePath = BuildingFactory.INFRASTRUCTURE_TEXTURES[building.type];

    if (texturePath) {
      // Create textured building
      const geometry = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
      const facadeTexPath = `/textures/buildings/${texturePath}`;

      // --- Day Mesh (Layer 1) ---
      const matSideXDay = new THREE.MeshLambertMaterial({
        map: this.getTexture(facadeTexPath, bodyD / 2, bodyH / 2),
      });
      const matSideZDay = new THREE.MeshLambertMaterial({
        map: this.getTexture(facadeTexPath, bodyW / 2, bodyH / 2),
      });

      // Roof texture
      const roofTexFile = BuildingFactory.INFRASTRUCTURE_ROOFS[building.type];
      let matTop: THREE.Material;
      if (roofTexFile) {
        const roofTexPath = `/textures/buildings/${roofTexFile}`;
        matTop = new THREE.MeshLambertMaterial({
          map: this.getTexture(roofTexPath, bodyW / 2, bodyD / 2),
        });
      } else {
        matTop = new THREE.MeshLambertMaterial({ color: color.clone().multiplyScalar(0.7) });
      }

      const matBottom = new THREE.MeshLambertMaterial({ color: 0x333333 });

      const materialsDay = [
        matSideXDay, // Right
        matSideXDay, // Left
        matTop,      // Top
        matBottom,   // Bottom
        matSideZDay, // Front
        matSideZDay  // Back
      ];

      const meshDay = new THREE.Mesh(geometry, materialsDay);
      meshDay.position.y = bodyH / 2;
      meshDay.castShadow = true;
      meshDay.receiveShadow = true;
      meshDay.layers.set(1); // Layer 1 = Day
      group.add(meshDay);

      // --- Night Mesh (Layer 2) ---
      // Many infrastructure buildings don't have explicit _night textures yet, 
      // so we use a fallback to just a slightly glowing color or special night texture if exists
      const nightTexturePath = this.getNightTexturePath(facadeTexPath);
      const nightTex = this.getTexture(nightTexturePath, bodyD / 2, bodyH / 2); // getTexture handles missing files gracefully? 
      // Actually we should check if night texture exists to avoid errors or use emissive fallback

      const matSideXNight = new THREE.MeshBasicMaterial({
        map: nightTex,
        color: 0xffffff,
      });
      const matSideZNight = new THREE.MeshBasicMaterial({
        map: nightTex,
        color: 0xffffff,
      });

      // Night roof
      let matTopNight: THREE.Material;
      if (roofTexFile) {
        const roofNightTexPath = this.getNightTexturePath(`/textures/buildings/${roofTexFile}`);
        matTopNight = new THREE.MeshBasicMaterial({
          map: this.getTexture(roofNightTexPath, bodyW / 2, bodyD / 2),
          color: 0xffffff,
        });
      } else {
        matTopNight = matTop; // Fallback to day top
      }

      const materialsNight = [
        matSideXNight, // Right
        matSideXNight, // Left
        matTopNight,   // Top
        matBottom,     // Bottom
        matSideZNight, // Front
        matSideZNight  // Back
      ];

      const meshNight = new THREE.Mesh(geometry, materialsNight);
      meshNight.position.y = bodyH / 2;
      meshNight.layers.set(2); // Layer 2 = Night
      group.add(meshNight);

    } else {
      // Fallback to colored building
      const bodyMesh = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW, bodyH, bodyD),
        new THREE.MeshLambertMaterial({ color: color }),
      );
      bodyMesh.position.y = bodyH / 2;
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;
      group.add(bodyMesh);
    }

    // Roof / top accent (slightly wider, flat)
    const roofH = h * 0.08;
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(bodyW * 1.05, roofH, bodyD * 1.05),
      new THREE.MeshLambertMaterial({ color: color.clone().multiplyScalar(0.6) }),
    );
    roof.position.y = bodyH + roofH / 2;
    roof.castShadow = true;
    group.add(roof);

    // Accent tower/feature for taller buildings (height >= 4) - only for non-textured
    if (h >= 4 && !texturePath) {
      const towerW = bodyW * 0.25;
      const towerD = bodyD * 0.25;
      const towerH = h * 0.35;
      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(towerW, towerH, towerD),
        new THREE.MeshLambertMaterial({ color: color.clone().multiplyScalar(0.8) }),
      );
      tower.position.y = bodyH + roofH + towerH / 2;
      tower.castShadow = true;
      group.add(tower);
    }

    // Door indicator (front face) - only for non-textured buildings
    if (!texturePath) {
      const doorW = Math.min(bodyW * 0.2, CELL_SIZE * 0.3);
      const doorH = Math.min(bodyH * 0.4, CELL_SIZE * 0.5);
      const door = new THREE.Mesh(
        new THREE.PlaneGeometry(doorW, doorH),
        new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.2) }),
      );
      door.position.set(0, doorH / 2, bodyD / 2 + 0.01);
      group.add(door);
    }

    // --- Base plinth (foundation strip) ---
    const plinthH = Math.min(h * 0.05, 0.12);
    const concreteColor = color.clone().multiplyScalar(0.4);
    const matPlinthDay = new THREE.MeshLambertMaterial({ color: concreteColor });
    const matPlinthNight = new THREE.MeshBasicMaterial({ color: concreteColor.clone().multiplyScalar(0.5) });
    const plinthGeo = new THREE.BoxGeometry(bodyW + 0.08, plinthH, bodyD + 0.08);

    const plinthDay = new THREE.Mesh(plinthGeo, matPlinthDay);
    plinthDay.position.y = plinthH / 2;
    plinthDay.receiveShadow = true;
    plinthDay.layers.set(1);
    group.add(plinthDay);
    const plinthNight = new THREE.Mesh(plinthGeo, matPlinthNight);
    plinthNight.position.y = plinthH / 2;
    plinthNight.layers.set(2);
    group.add(plinthNight);

    // --- Entrance canopy (front awning) ---
    const canopyW = bodyW * 0.4;
    const canopyD = Math.min(bodyD * 0.15, 0.3);
    const canopyH = 0.04;
    const canopyY = Math.min(bodyH * 0.55, bodyH - 0.1);
    const canopyGeo = new THREE.BoxGeometry(canopyW, canopyH, canopyD);

    const matCanopyDay = new THREE.MeshLambertMaterial({ color: color.clone().multiplyScalar(0.55) });
    const canopyDay = new THREE.Mesh(canopyGeo, matCanopyDay);
    canopyDay.position.set(0, canopyY, bodyD / 2 + canopyD / 2);
    canopyDay.castShadow = true;
    canopyDay.receiveShadow = true;
    canopyDay.layers.set(1);
    group.add(canopyDay);

    const matCanopyNight = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.3) });
    const canopyNight = new THREE.Mesh(canopyGeo, matCanopyNight);
    canopyNight.position.set(0, canopyY, bodyD / 2 + canopyD / 2);
    canopyNight.layers.set(2);
    group.add(canopyNight);
  }

  private createZone(group: THREE.Group, building: PlacedBuilding, populationRatio?: number): void {
    const def = BUILDING_DEFS[building.type];
    const w = def.size.w * CELL_SIZE;
    const d = def.size.d * CELL_SIZE;
    const level = building.developmentLevel ?? 0;
    const zoneColor = new THREE.Color(def.color);

    // Zone ground fill — darken for contrast against grass
    const groundColor = zoneColor.clone().multiplyScalar(0.55);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.92, d * 0.92),
      new THREE.MeshLambertMaterial({ color: groundColor, transparent: true, opacity: 0.75 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.015;
    ground.receiveShadow = true;
    group.add(ground);

    // Bright colored border edges
    const borderThickness = CELL_SIZE * 0.04;
    const borderMat = new THREE.MeshBasicMaterial({ color: def.color });
    const halfW = w * 0.46;
    const halfD = d * 0.46;
    const borderY = 0.02;

    for (const side of [-1, 1]) {
      const edgeNS = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.92, borderThickness), borderMat);
      edgeNS.rotation.x = -Math.PI / 2;
      edgeNS.position.set(0, borderY, side * halfD);
      group.add(edgeNS);

      const edgeEW = new THREE.Mesh(new THREE.PlaneGeometry(borderThickness, d * 0.92), borderMat);
      edgeEW.rotation.x = -Math.PI / 2;
      edgeEW.position.set(side * halfW, borderY, 0);
      group.add(edgeEW);
    }

    if (level === 0) {
      // Undeveloped: corner stakes
      const stakeMat = new THREE.MeshLambertMaterial({ color: zoneColor.clone().multiplyScalar(0.8) });
      const stakeH = 0.3;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, stakeH, 4), stakeMat);
          stake.position.set(sx * halfW, stakeH / 2, sz * halfD);
          stake.castShadow = true;
          group.add(stake);
        }
      }

      // Diamond indicator in center
      const indicator = new THREE.Mesh(
        new THREE.PlaneGeometry(CELL_SIZE * 0.15, CELL_SIZE * 0.15),
        new THREE.MeshBasicMaterial({ color: def.color }),
      );
      indicator.rotation.x = -Math.PI / 2;
      indicator.rotation.z = Math.PI / 4;
      indicator.position.y = 0.025;
      group.add(indicator);
    } else if (building.density) {
      // Multi-building rendering: multiple sub-buildings based on population
      this.createMultiZoneBuildings(group, building, level, populationRatio ?? 0);
    } else {
      // Backward compat: single building rendering
      const levelDef = getZoneLevelDef(building.type as ZoneType, building.density, level);
      // Slightly different logic for width/depth to match original visuals
      const bw = w * (0.8 + level * 0.05); // Make them fill more of the lot
      const bd = d * (0.8 + level * 0.05);
      const h = levelDef.height;

      const geometry = new THREE.BoxGeometry(bw, h, bd);

      // Map textures based on zone type and city score
      let facadeTexPath = '/textures/buildings/residential_facade.png';
      let roofTexPath = '/textures/buildings/residential_roof.png';

      if (this.config) {
        // Find the highest scoring category that is <= currentScore
        // We assume categories are sorted or we filter and sort
        const validCategories = this.config.categories.filter(c => c.minScore <= this.currentScore);
        // Sort by minScore descending to get the 'best' category
        validCategories.sort((a, b) => b.minScore - a.minScore);
        const category = validCategories[0];

        if (category) {
          let typeKey: 'residential' | 'commercial' | 'industrial' = 'residential';
          if (building.type === BuildingType.ZONE_COMMERCIAL) typeKey = 'commercial';
          if (building.type === BuildingType.ZONE_INDUSTRIAL) typeKey = 'industrial';

          const textures = category.textures[typeKey];
          // Deterministic random based on building ID so it doesn't change on every re-render
          // Simple hash of string ID
          let hash = 0;
          for (let i = 0; i < building.id.length; i++) {
            hash = ((hash << 5) - hash) + building.id.charCodeAt(i);
            hash |= 0;
          }
          const rand = Math.abs(hash);

          if (textures.facades.length > 0) {
            facadeTexPath = `/textures/buildings/${textures.facades[rand % textures.facades.length]}`;
          }
          if (textures.roofs.length > 0) {
            roofTexPath = `/textures/buildings/${textures.roofs[rand % textures.roofs.length]}`;
          }
        }
      } else {
        // Fallback if config not loaded
        if (building.type === BuildingType.ZONE_COMMERCIAL) {
          facadeTexPath = '/textures/buildings/commercial_facade.png';
          roofTexPath = '/textures/buildings/commercial_roof.png';
        } else if (building.type === BuildingType.ZONE_INDUSTRIAL) {
          facadeTexPath = '/textures/buildings/industrial_facade.png';
          roofTexPath = '/textures/buildings/industrial_roof.png';
        }
      }

      // Scale textures
      // Facade: repeat horizontally based on width, vertically based on height
      const roofRepeatW = Math.max(1, bw / 2);
      const roofRepeatD = Math.max(1, bd / 2);

      // --- Create Day Mesh (Layer 1) ---
      const matRoofDay = new THREE.MeshLambertMaterial({
        map: this.getTexture(roofTexPath, roofRepeatW, roofRepeatD)
      });
      const matSideXDay = new THREE.MeshLambertMaterial({ map: this.getTexture(facadeTexPath, bd / 2, h / 2) });
      const matSideZDay = new THREE.MeshLambertMaterial({ map: this.getTexture(facadeTexPath, bw / 2, h / 2) });
      const matBottom = new THREE.MeshLambertMaterial({ color: 0x333333 });

      const materialsDay = [
        matSideXDay, // Right
        matSideXDay, // Left
        matRoofDay,  // Top
        matBottom,   // Bottom
        matSideZDay, // Front
        matSideZDay  // Back
      ];

      const meshDay = new THREE.Mesh(geometry, materialsDay);
      meshDay.position.y = h / 2;
      meshDay.castShadow = true;
      meshDay.receiveShadow = true;
      meshDay.layers.set(1); // Layer 1 = Day
      group.add(meshDay);

      // --- Create Night Mesh (Layer 2) ---
      const facadeNightPath = this.getNightTexturePath(facadeTexPath);
      const roofNightPath = this.getNightTexturePath(roofTexPath);
      const facadeNightTex = this.getTexture(facadeNightPath, bd / 2, h / 2);
      const roofNightTex = this.getTexture(roofNightPath, roofRepeatW, roofRepeatD);

      const matRoofNight = new THREE.MeshBasicMaterial({
        map: roofNightTex,
        color: 0xffffff
      });
      const matSideXNight = new THREE.MeshBasicMaterial({
        map: facadeNightTex,
        color: 0xffffff
      });
      const matSideZNight = new THREE.MeshBasicMaterial({
        map: facadeNightTex,
        color: 0xffffff
      });

      const materialsNight = [
        matSideXNight, // Right
        matSideXNight, // Left
        matRoofNight,  // Top
        matBottom,     // Bottom
        matSideZNight, // Front
        matSideZNight  // Back
      ];

      const meshNight = new THREE.Mesh(geometry, materialsNight);
      meshNight.position.y = h / 2;
      meshNight.castShadow = true;
      meshNight.receiveShadow = true;
      meshNight.layers.set(2); // Layer 2 = Night
      group.add(meshNight);

      // --- Add Building Lights (Layer 2) ---
      // Add a point light for developed zones to simulate window/building glow on surrounding area
      if (level > 0) {
        let lightColor = 0xffaa00; // Default warm residential
        let intensity = 1.0;
        let distance = 8;

        if (building.type === BuildingType.ZONE_COMMERCIAL) {
          lightColor = 0xaaccff; // Cool commercial
          intensity = 1.5;
          distance = 12;
        } else if (building.type === BuildingType.ZONE_INDUSTRIAL) {
          lightColor = 0xff8800; // Orange industrial
          intensity = 1.2;
          distance = 10;
        }

        const light = new THREE.PointLight(lightColor, intensity, distance);
        light.position.set(0, h * 0.7, 0); // Position slightly up
        light.layers.set(2); // Night only
        group.add(light);
      }
    }
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  private getZoneTexturePaths(building: PlacedBuilding, hash: number): { facade: string; roof: string } {
    let facade = '/textures/buildings/residential_facade.png';
    let roof = '/textures/buildings/residential_roof.png';

    if (this.config) {
      const validCategories = this.config.categories.filter(c => c.minScore <= this.currentScore);
      validCategories.sort((a, b) => b.minScore - a.minScore);
      const category = validCategories[0];

      if (category) {
        let typeKey: 'residential' | 'commercial' | 'industrial' = 'residential';
        if (building.type === BuildingType.ZONE_COMMERCIAL) typeKey = 'commercial';
        if (building.type === BuildingType.ZONE_INDUSTRIAL) typeKey = 'industrial';

        const textures = category.textures[typeKey];
        const rand = Math.abs(hash);

        if (textures.facades.length > 0) {
          facade = `/textures/buildings/${textures.facades[rand % textures.facades.length]}`;
        }
        if (textures.roofs.length > 0) {
          roof = `/textures/buildings/${textures.roofs[rand % textures.roofs.length]}`;
        }
      }
    } else {
      if (building.type === BuildingType.ZONE_COMMERCIAL) {
        facade = '/textures/buildings/commercial_facade.png';
        roof = '/textures/buildings/commercial_roof.png';
      } else if (building.type === BuildingType.ZONE_INDUSTRIAL) {
        facade = '/textures/buildings/industrial_facade.png';
        roof = '/textures/buildings/industrial_roof.png';
      }
    }

    return { facade, roof };
  }

  private createMultiZoneBuildings(group: THREE.Group, building: PlacedBuilding, level: number, populationRatio: number): void {
    const density = building.density ?? ZoneDensity.MEDIUM;
    const levelDef = getZoneLevelDef(building.type as ZoneType, density, level);
    const maxBuildings = levelDef.maxBuildings;
    const slots = ZONE_SLOT_LAYOUTS[density] || ZONE_SLOT_LAYOUTS.medium;

    // Calculate visible count from population ratio
    const visibleCount = Math.min(Math.max(1, Math.ceil(populationRatio * maxBuildings)), slots.length);

    for (let i = 0; i < visibleCount; i++) {
      const slot = slots[i];
      const subSeed = this.hashString(building.id + i.toString());

      // Each sub-building gets a different texture variant
      const textures = this.getZoneTexturePaths(building, subSeed);

      // Sub-building dimensions with slight random height variation
      const subW = slot.w * CELL_SIZE;
      const subD = slot.d * CELL_SIZE;
      const heightVariation = 0.85 + (subSeed % 30) / 100;
      const subH = levelDef.height * slot.heightScale * heightVariation;

      // Position within cell
      const subX = slot.x * CELL_SIZE;
      const subZ = slot.z * CELL_SIZE;

      // Weathering: older buildings (lower index) are slightly darker
      const weatherFactor = 0.85 + 0.15 * (i / Math.max(1, maxBuildings - 1));

      this.createTexturedBox(group, subX, subZ, subW, subD, subH, textures.facade, textures.roof, building.type, weatherFactor);
    }
  }

  private createTexturedBox(
    group: THREE.Group,
    x: number, z: number,
    width: number, depth: number, height: number,
    facadeTexPath: string, roofTexPath: string,
    buildingType: BuildingType,
    weatherFactor = 1.0,
  ): void {
    // --- Setback: tall buildings get a stepped upper portion ---
    const setbackThreshold = 4.0;
    const hasSetback = height > setbackThreshold;
    const mainHeight = hasSetback ? height * 0.65 : height;
    const upperHeight = hasSetback ? height * 0.35 : 0;
    const upperInset = 0.85; // upper portion is 85% of main width/depth

    const geometry = new THREE.BoxGeometry(width, mainHeight, depth);

    const roofRepeatW = Math.max(1, width / 2);
    const roofRepeatD = Math.max(1, depth / 2);
    const weatherColor = new THREE.Color(weatherFactor, weatherFactor, weatherFactor);
    const concreteDayColor = new THREE.Color(0.55 * weatherFactor, 0.53 * weatherFactor, 0.51 * weatherFactor);
    const concreteNightColor = new THREE.Color(0.25, 0.24, 0.23);

    // Shared materials
    const matConcreteDayLambert = new THREE.MeshLambertMaterial({ color: concreteDayColor });
    const matConcreteNightBasic = new THREE.MeshBasicMaterial({ color: concreteNightColor });

    // --- Day Mesh (Layer 1) ---
    const matRoofDay = new THREE.MeshLambertMaterial({
      map: this.getTexture(roofTexPath, roofRepeatW, roofRepeatD),
      color: weatherColor,
    });
    const matSideXDay = new THREE.MeshLambertMaterial({
      map: this.getTexture(facadeTexPath, depth / 2, mainHeight / 2),
      color: weatherColor,
    });
    const matSideZDay = new THREE.MeshLambertMaterial({
      map: this.getTexture(facadeTexPath, width / 2, mainHeight / 2),
      color: weatherColor,
    });
    const matBottom = new THREE.MeshLambertMaterial({ color: 0x333333 });

    // For main body with setback, roof is the setback ledge (concrete), not the textured roof
    const matMainTop = hasSetback ? matConcreteDayLambert : matRoofDay;
    const materialsDay = [matSideXDay, matSideXDay, matMainTop, matBottom, matSideZDay, matSideZDay];

    const meshDay = new THREE.Mesh(geometry, materialsDay);
    meshDay.position.set(x, mainHeight / 2, z);
    meshDay.castShadow = true;
    meshDay.receiveShadow = true;
    meshDay.layers.set(1);
    group.add(meshDay);

    // --- Night Mesh (Layer 2) ---
    const facadeNightPath = this.getNightTexturePath(facadeTexPath);
    const roofNightPath = this.getNightTexturePath(roofTexPath);

    const matRoofNight = new THREE.MeshBasicMaterial({
      map: this.getTexture(roofNightPath, roofRepeatW, roofRepeatD),
      color: 0xffffff,
    });
    const matSideXNight = new THREE.MeshBasicMaterial({
      map: this.getTexture(facadeNightPath, depth / 2, mainHeight / 2),
      color: 0xffffff,
    });
    const matSideZNight = new THREE.MeshBasicMaterial({
      map: this.getTexture(facadeNightPath, width / 2, mainHeight / 2),
      color: 0xffffff,
    });

    const matMainTopNight = hasSetback ? matConcreteNightBasic : matRoofNight;
    const materialsNight = [matSideXNight, matSideXNight, matMainTopNight, matBottom, matSideZNight, matSideZNight];

    const meshNight = new THREE.Mesh(geometry, materialsNight);
    meshNight.position.set(x, mainHeight / 2, z);
    meshNight.castShadow = true;
    meshNight.receiveShadow = true;
    meshNight.layers.set(2);
    group.add(meshNight);

    // --- Setback upper portion ---
    if (hasSetback) {
      const uw = width * upperInset;
      const ud = depth * upperInset;
      const upperGeo = new THREE.BoxGeometry(uw, upperHeight, ud);

      const matUpperSideXDay = new THREE.MeshLambertMaterial({
        map: this.getTexture(facadeTexPath, ud / 2, upperHeight / 2),
        color: weatherColor,
      });
      const matUpperSideZDay = new THREE.MeshLambertMaterial({
        map: this.getTexture(facadeTexPath, uw / 2, upperHeight / 2),
        color: weatherColor,
      });
      const upperMatDay = [matUpperSideXDay, matUpperSideXDay, matRoofDay, matConcreteDayLambert, matUpperSideZDay, matUpperSideZDay];
      const upperDay = new THREE.Mesh(upperGeo, upperMatDay);
      upperDay.position.set(x, mainHeight + upperHeight / 2, z);
      upperDay.castShadow = true;
      upperDay.receiveShadow = true;
      upperDay.layers.set(1);
      group.add(upperDay);

      const matUpperSideXNight = new THREE.MeshBasicMaterial({
        map: this.getTexture(facadeNightPath, ud / 2, upperHeight / 2),
        color: 0xffffff,
      });
      const matUpperSideZNight = new THREE.MeshBasicMaterial({
        map: this.getTexture(facadeNightPath, uw / 2, upperHeight / 2),
        color: 0xffffff,
      });
      const upperMatNight = [matUpperSideXNight, matUpperSideXNight, matRoofNight, matConcreteNightBasic, matUpperSideZNight, matUpperSideZNight];
      const upperNight = new THREE.Mesh(upperGeo, upperMatNight);
      upperNight.position.set(x, mainHeight + upperHeight / 2, z);
      upperNight.castShadow = true;
      upperNight.receiveShadow = true;
      upperNight.layers.set(2);
      group.add(upperNight);
    }

    // --- Ground plinth (foundation strip) ---
    const plinthH = Math.min(height * 0.06, 0.15);
    const plinthGeo = new THREE.BoxGeometry(width + 0.06, plinthH, depth + 0.06);
    const plinthDay = new THREE.Mesh(plinthGeo, matConcreteDayLambert);
    plinthDay.position.set(x, plinthH / 2, z);
    plinthDay.receiveShadow = true;
    plinthDay.layers.set(1);
    group.add(plinthDay);
    const plinthNight = new THREE.Mesh(plinthGeo, matConcreteNightBasic);
    plinthNight.position.set(x, plinthH / 2, z);
    plinthNight.layers.set(2);
    group.add(plinthNight);

    // --- Floor ledges / cornices ---
    const floorInterval = 2.0; // ledge every ~2 units of height
    const ledgeH = 0.04;
    const ledgeOverhang = 0.04;
    if (height > floorInterval * 1.5) {
      const ledgeGeo = new THREE.BoxGeometry(width + ledgeOverhang, ledgeH, depth + ledgeOverhang);
      const numLedges = Math.floor(height / floorInterval);
      for (let i = 1; i < numLedges; i++) {
        const ledgeY = i * floorInterval;
        if (hasSetback && ledgeY > mainHeight) {
          // Skip ledges inside the setback transition zone
          continue;
        }
        const ledgeDay = new THREE.Mesh(ledgeGeo, matConcreteDayLambert);
        ledgeDay.position.set(x, ledgeY, z);
        ledgeDay.layers.set(1);
        group.add(ledgeDay);
        const ledgeNight = new THREE.Mesh(ledgeGeo, matConcreteNightBasic);
        ledgeNight.position.set(x, ledgeY, z);
        ledgeNight.layers.set(2);
        group.add(ledgeNight);
      }
    }

    // --- Roof parapet ---
    const roofY = hasSetback ? mainHeight + upperHeight : height;
    const parapetH = Math.min(height * 0.04, 0.12);
    const parapetThickness = 0.04;
    const parapetW = hasSetback ? width * upperInset : width;
    const parapetD = hasSetback ? depth * upperInset : depth;

    const addParapetSegment = (pw: number, pd: number, px: number, pz: number) => {
      const geo = new THREE.BoxGeometry(pw, parapetH, pd);
      const dayMesh = new THREE.Mesh(geo, matConcreteDayLambert);
      dayMesh.position.set(x + px, roofY + parapetH / 2, z + pz);
      dayMesh.castShadow = true;
      dayMesh.layers.set(1);
      group.add(dayMesh);
      const nightMesh = new THREE.Mesh(geo, matConcreteNightBasic);
      nightMesh.position.set(x + px, roofY + parapetH / 2, z + pz);
      nightMesh.layers.set(2);
      group.add(nightMesh);
    };
    // Front and back parapet walls
    addParapetSegment(parapetW, parapetThickness, 0, parapetD / 2);
    addParapetSegment(parapetW, parapetThickness, 0, -parapetD / 2);
    // Left and right parapet walls
    addParapetSegment(parapetThickness, parapetD, parapetW / 2, 0);
    addParapetSegment(parapetThickness, parapetD, -parapetW / 2, 0);

    // --- Rooftop equipment (AC units, water tanks) — only for taller buildings ---
    if (height > 2.5) {
      const seed = this.hashString(facadeTexPath + width.toFixed(2) + depth.toFixed(2));
      const numEquip = 1 + (seed % 3); // 1–3 pieces of equipment
      const equipColor = new THREE.Color(0.50 * weatherFactor, 0.50 * weatherFactor, 0.52 * weatherFactor);
      const matEquipDay = new THREE.MeshLambertMaterial({ color: equipColor });
      const matEquipNight = new THREE.MeshBasicMaterial({ color: 0x1a1a1c });

      for (let i = 0; i < numEquip; i++) {
        const eSeed = this.hashString(facadeTexPath + i.toString());
        const ew = 0.08 + (eSeed % 10) / 100;
        const ed = 0.08 + ((eSeed >> 4) % 10) / 100;
        const eh = 0.06 + ((eSeed >> 8) % 8) / 100;
        // Spread equipment within inner 60% of roof area
        const ex = ((eSeed % 100) / 100 - 0.5) * parapetW * 0.6;
        const ez = (((eSeed >> 3) % 100) / 100 - 0.5) * parapetD * 0.6;
        const eGeo = new THREE.BoxGeometry(ew, eh, ed);
        const eDay = new THREE.Mesh(eGeo, matEquipDay);
        eDay.position.set(x + ex, roofY + eh / 2, z + ez);
        eDay.castShadow = true;
        eDay.layers.set(1);
        group.add(eDay);
        const eNight = new THREE.Mesh(eGeo, matEquipNight);
        eNight.position.set(x + ex, roofY + eh / 2, z + ez);
        eNight.layers.set(2);
        group.add(eNight);
      }
    }

    // --- Point Light (Night, Layer 2) ---
    let lightColor = 0xffaa00;
    let intensity = 0.6;
    let distance = 6;

    if (buildingType === BuildingType.ZONE_COMMERCIAL) {
      lightColor = 0xaaccff;
      intensity = 0.8;
      distance = 8;
    } else if (buildingType === BuildingType.ZONE_INDUSTRIAL) {
      lightColor = 0xff8800;
      intensity = 0.7;
      distance = 7;
    }

    const light = new THREE.PointLight(lightColor, intensity, distance);
    light.position.set(x, height * 0.7, z);
    light.layers.set(2);
    group.add(light);
  }

  private createRoad(group: THREE.Group, building: PlacedBuilding, neighbors?: RoadNeighbors): void {
    const def = BUILDING_DEFS[building.type];
    const roadMaterial = new THREE.MeshLambertMaterial({ color: def.color });
    const n = neighbors ?? { hasNorth: false, hasSouth: false, hasEast: false, hasWest: false };
    const count = [n.hasNorth, n.hasSouth, n.hasEast, n.hasWest].filter(Boolean).length;
    const w = def.size.w * CELL_SIZE;
    const d = def.size.d * CELL_SIZE;

    const isMultiCell = def.size.w > 1 || def.size.d > 1;

    if (count <= 1 && !isMultiCell) {
      this.addRoundedRoad(group, roadMaterial, w, d, n, count);
    } else {
      const road = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        roadMaterial,
      );
      road.rotation.x = -Math.PI / 2;
      road.position.y = 0.02;
      road.receiveShadow = true;
      group.add(road);
    }

    // Add curb barriers on non-connected edges of multi-cell roads
    if (isMultiCell) {
      this.addCurbBarriers(group, n, w, d);
    }

    // --- Add Street Lights (Layer 2) ---
    // Add lights at intersections (3+ way) or for Avenue/Highway to simulate street lamps
    const isIntersection = count >= 3;
    const isMajorRoad = building.type === BuildingType.ROAD_AVENUE || building.type === BuildingType.ROAD_HIGHWAY;

    if (isIntersection || (isMajorRoad && Math.random() > 0.5)) { // 50% chance for major roads to reduce count
      const lightColor = 0xffffcc; // Warm street light
      const intensity = 0.8;
      const distance = 10;

      const light = new THREE.PointLight(lightColor, intensity, distance);
      light.position.set(0, 4, 0); // High up like a street lamp
      light.layers.set(2); // Night only
      group.add(light);
    }



    // Road markings vary by type
    if (building.type === BuildingType.ROAD_DIRT) {
      // Dirt roads: no markings
      return;
    }

    if (building.type === BuildingType.ROAD_HIGHWAY) {
      this.addHighwayMarkings(group, n, count);
      return;
    }

    if (building.type === BuildingType.ROAD_AVENUE) {
      this.addAvenueMarkings(group, n, count);
      return;
    }

    // Street: dashed white center line (default / original behavior)
    this.addStreetMarkings(group, n, count);
  }

  private addStreetMarkings(group: THREE.Group, n: RoadNeighbors, count: number): void {
    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });

    if (count === 0) {
      this.addDashedLine(group, lineMaterial, 'x');
      this.addUTurnArc(group, lineMaterial, 'x', 1);
      this.addUTurnArc(group, lineMaterial, 'x', -1);
    } else if (count === 1) {
      if (n.hasNorth) {
        this.addDashedLine(group, lineMaterial, 'z');
        this.addUTurnArc(group, lineMaterial, 'z', 1);
      } else if (n.hasSouth) {
        this.addDashedLine(group, lineMaterial, 'z');
        this.addUTurnArc(group, lineMaterial, 'z', -1);
      } else if (n.hasEast) {
        this.addDashedLine(group, lineMaterial, 'x');
        this.addUTurnArc(group, lineMaterial, 'x', -1);
      } else {
        this.addDashedLine(group, lineMaterial, 'x');
        this.addUTurnArc(group, lineMaterial, 'x', 1);
      }
    } else if (count === 2) {
      if (n.hasNorth && n.hasSouth) {
        this.addDashedLine(group, lineMaterial, 'z');
      } else if (n.hasEast && n.hasWest) {
        this.addDashedLine(group, lineMaterial, 'x');
      } else {
        if (n.hasNorth) this.addHalfDashedLine(group, lineMaterial, 'z', -1);
        if (n.hasSouth) this.addHalfDashedLine(group, lineMaterial, 'z', 1);
        if (n.hasEast) this.addHalfDashedLine(group, lineMaterial, 'x', 1);
        if (n.hasWest) this.addHalfDashedLine(group, lineMaterial, 'x', -1);
      }
    }
  }

  private addAvenueMarkings(group: THREE.Group, n: RoadNeighbors, count: number): void {
    const yellowMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    if (count < 2) return;

    const def = BUILDING_DEFS[BuildingType.ROAD_AVENUE];
    const surfaceW = def.size.w * CELL_SIZE;
    const surfaceD = def.size.d * CELL_SIZE;
    const lineWidth = CELL_SIZE * 0.02;

    let axis: 'x' | 'z' | null = null;
    if (count === 2 && n.hasNorth && n.hasSouth) axis = 'z';
    else if (count === 2 && n.hasEast && n.hasWest) axis = 'x';

    if (axis) {
      const len = (axis === 'x' ? surfaceW : surfaceD) * 0.95;
      const crossSize = axis === 'x' ? surfaceD : surfaceW;
      const separation = CELL_SIZE * 0.04;

      // Double yellow center line
      for (const offset of [-separation, separation]) {
        const w = axis === 'x' ? len : lineWidth;
        const h = axis === 'x' ? lineWidth : len;
        const line = new THREE.Mesh(new THREE.PlaneGeometry(w, h), yellowMat);
        line.rotation.x = -Math.PI / 2;
        if (axis === 'x') {
          line.position.set(0, 0.025, offset);
        } else {
          line.position.set(offset, 0.025, 0);
        }
        group.add(line);
      }

      // White lane dividers (one per side, halfway between center and edge)
      const laneOffset = crossSize * 0.25;
      for (const side of [-1, 1]) {
        const dashSpacing = CELL_SIZE * 0.35;
        const dashLen = CELL_SIZE * 0.2;
        const numDashes = Math.floor(len / dashSpacing);
        const startOffset = -(numDashes - 1) * dashSpacing / 2;

        for (let i = 0; i < numDashes; i++) {
          const along = startOffset + i * dashSpacing;
          const across = side * laneOffset;
          const w = axis === 'x' ? dashLen : lineWidth;
          const h = axis === 'x' ? lineWidth : dashLen;
          const dash = new THREE.Mesh(new THREE.PlaneGeometry(w, h), whiteMat);
          dash.rotation.x = -Math.PI / 2;
          if (axis === 'x') {
            dash.position.set(along, 0.025, across);
          } else {
            dash.position.set(across, 0.025, along);
          }
          group.add(dash);
        }
      }

      // White edge lines (solid)
      const edgeOffset = crossSize * 0.47;
      for (const side of [-1, 1]) {
        const w = axis === 'x' ? len : lineWidth;
        const h = axis === 'x' ? lineWidth : len;
        const line = new THREE.Mesh(new THREE.PlaneGeometry(w, h), whiteMat);
        line.rotation.x = -Math.PI / 2;
        if (axis === 'x') {
          line.position.set(0, 0.025, side * edgeOffset);
        } else {
          line.position.set(side * edgeOffset, 0.025, 0);
        }
        group.add(line);
      }
    }
  }

  private addHighwayMarkings(group: THREE.Group, n: RoadNeighbors, count: number): void {
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const yellowMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
    if (count < 2) return;

    const def = BUILDING_DEFS[BuildingType.ROAD_HIGHWAY];
    const surfaceW = def.size.w * CELL_SIZE;
    const surfaceD = def.size.d * CELL_SIZE;
    const lineWidth = CELL_SIZE * 0.025;

    let axis: 'x' | 'z' | null = null;
    if (count === 2 && n.hasNorth && n.hasSouth) axis = 'z';
    else if (count === 2 && n.hasEast && n.hasWest) axis = 'x';

    if (axis) {
      const len = (axis === 'x' ? surfaceW : surfaceD) * 0.95;
      const crossSize = axis === 'x' ? surfaceD : surfaceW;

      // Solid white edge lines
      const edgeOffset = crossSize * 0.47;
      for (const side of [-1, 1]) {
        const w = axis === 'x' ? len : lineWidth;
        const h = axis === 'x' ? lineWidth : len;
        const line = new THREE.Mesh(new THREE.PlaneGeometry(w, h), whiteMat);
        line.rotation.x = -Math.PI / 2;
        if (axis === 'x') {
          line.position.set(0, 0.025, side * edgeOffset);
        } else {
          line.position.set(side * edgeOffset, 0.025, 0);
        }
        group.add(line);
      }

      // Double yellow center divider
      const separation = CELL_SIZE * 0.04;
      for (const offset of [-separation, separation]) {
        const w = axis === 'x' ? len : lineWidth;
        const h = axis === 'x' ? lineWidth : len;
        const line = new THREE.Mesh(new THREE.PlaneGeometry(w, h), yellowMat);
        line.rotation.x = -Math.PI / 2;
        if (axis === 'x') {
          line.position.set(0, 0.025, offset);
        } else {
          line.position.set(offset, 0.025, 0);
        }
        group.add(line);
      }

      // Dashed white lane dividers — 3 lanes per side means 2 dividers per side
      // Each side spans crossSize/2; lanes are evenly divided within that
      const halfCross = crossSize / 2;
      const laneWidth = halfCross / 3;
      for (const side of [-1, 1]) {
        // Dividers at 1/3 and 2/3 of each half
        for (let lane = 1; lane <= 2; lane++) {
          const across = side * (lane * laneWidth);
          const dashSpacing = CELL_SIZE * 0.4;
          const dashLen = CELL_SIZE * 0.25;
          const numDashes = Math.floor(len / dashSpacing);
          const startOffset = -(numDashes - 1) * dashSpacing / 2;

          for (let i = 0; i < numDashes; i++) {
            const along = startOffset + i * dashSpacing;
            const w = axis === 'x' ? dashLen : lineWidth;
            const h = axis === 'x' ? lineWidth : dashLen;
            const dash = new THREE.Mesh(new THREE.PlaneGeometry(w, h), whiteMat);
            dash.rotation.x = -Math.PI / 2;
            if (axis === 'x') {
              dash.position.set(along, 0.025, across);
            } else {
              dash.position.set(across, 0.025, along);
            }
            group.add(dash);
          }
        }
      }
    }
  }

  private addCurbBarriers(group: THREE.Group, n: RoadNeighbors, w: number, d: number): void {
    const curbMaterial = new THREE.MeshLambertMaterial({ color: 0x999999 });
    const curbThickness = CELL_SIZE * 0.06;
    const curbHeight = 0.06;
    const y = 0.02 + curbHeight / 2;

    if (!n.hasNorth) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(w, curbHeight, curbThickness), curbMaterial);
      curb.position.set(0, y, -d / 2 + curbThickness / 2);
      group.add(curb);
    }
    if (!n.hasSouth) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(w, curbHeight, curbThickness), curbMaterial);
      curb.position.set(0, y, d / 2 - curbThickness / 2);
      group.add(curb);
    }
    if (!n.hasWest) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(curbThickness, curbHeight, d), curbMaterial);
      curb.position.set(-w / 2 + curbThickness / 2, y, 0);
      group.add(curb);
    }
    if (!n.hasEast) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(curbThickness, curbHeight, d), curbMaterial);
      curb.position.set(w / 2 - curbThickness / 2, y, 0);
      group.add(curb);
    }
  }

  /**
   * Creates a road shape with rounded dead-end(s).
   */
  private addRoundedRoad(
    group: THREE.Group,
    material: THREE.MeshLambertMaterial,
    _w: number,
    _d: number,
    n: { hasNorth: boolean; hasSouth: boolean; hasEast: boolean; hasWest: boolean },
    count: number,
  ): void {
    const half = CELL_SIZE / 2;
    const segments = 16;
    const shape = new THREE.Shape();

    if (count === 0) {
      shape.moveTo(0, -half);
      for (let i = 0; i <= segments; i++) {
        const a = -Math.PI / 2 + (Math.PI * i) / segments;
        shape.lineTo(Math.cos(a) * half, Math.sin(a) * half);
      }
      for (let i = 0; i <= segments; i++) {
        const a = Math.PI / 2 + (Math.PI * i) / segments;
        shape.lineTo(Math.cos(a) * half, Math.sin(a) * half);
      }
    } else if (n.hasNorth) {
      shape.moveTo(-half, half);
      shape.lineTo(half, half);
      shape.lineTo(half, 0);
      for (let i = 0; i <= segments; i++) {
        const a = -(Math.PI * i) / segments;
        shape.lineTo(Math.cos(a) * half, Math.sin(a) * half);
      }
      shape.lineTo(-half, half);
    } else if (n.hasSouth) {
      shape.moveTo(half, -half);
      shape.lineTo(-half, -half);
      shape.lineTo(-half, 0);
      for (let i = 0; i <= segments; i++) {
        const a = Math.PI - (Math.PI * i) / segments;
        shape.lineTo(Math.cos(a) * half, Math.sin(a) * half);
      }
      shape.lineTo(half, -half);
    } else if (n.hasEast) {
      shape.moveTo(half, half);
      shape.lineTo(half, -half);
      shape.lineTo(0, -half);
      for (let i = 0; i <= segments; i++) {
        const a = -Math.PI / 2 - (Math.PI * i) / segments;
        shape.lineTo(Math.cos(a) * half, Math.sin(a) * half);
      }
      shape.lineTo(half, half);
    } else {
      shape.moveTo(-half, -half);
      shape.lineTo(-half, half);
      shape.lineTo(0, half);
      for (let i = 0; i <= segments; i++) {
        const a = Math.PI / 2 - (Math.PI * i) / segments;
        shape.lineTo(Math.cos(a) * half, Math.sin(a) * half);
      }
      shape.lineTo(-half, -half);
    }

    const geometry = new THREE.ShapeGeometry(shape);
    const road = new THREE.Mesh(geometry, material);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.02;
    road.receiveShadow = true;
    group.add(road);
  }

  private addDashedLine(
    group: THREE.Group,
    material: THREE.Material,
    axis: 'x' | 'z',
  ): void {
    const dashLength = CELL_SIZE * 0.2;
    const dashWidth = CELL_SIZE * 0.025;
    const spacing = CELL_SIZE * 0.35;
    const positions = [-spacing, 0, spacing];

    for (const offset of positions) {
      const w = axis === 'x' ? dashLength : dashWidth;
      const h = axis === 'x' ? dashWidth : dashLength;
      const dash = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        material,
      );
      dash.rotation.x = -Math.PI / 2;
      if (axis === 'x') {
        dash.position.set(offset, 0.025, 0);
      } else {
        dash.position.set(0, 0.025, offset);
      }
      group.add(dash);
    }
  }

  private addHalfDashedLine(
    group: THREE.Group,
    material: THREE.Material,
    axis: 'x' | 'z',
    direction: -1 | 1,
  ): void {
    const dashLength = CELL_SIZE * 0.15;
    const dashWidth = CELL_SIZE * 0.025;
    const spacing = CELL_SIZE * 0.2;
    const positions = [spacing * 0.25, spacing * 1.5];

    for (const offset of positions) {
      const pos = offset * direction;
      const w = axis === 'x' ? dashLength : dashWidth;
      const h = axis === 'x' ? dashWidth : dashLength;
      const dash = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        material,
      );
      dash.rotation.x = -Math.PI / 2;
      if (axis === 'x') {
        dash.position.set(pos, 0.025, 0);
      } else {
        dash.position.set(0, 0.025, pos);
      }
      group.add(dash);
    }
  }

  private addUTurnArc(
    group: THREE.Group,
    material: THREE.Material,
    axis: 'x' | 'z',
    direction: -1 | 1,
  ): void {
    const laneWidth = CELL_SIZE * 0.3;
    const arcRadius = laneWidth;
    const lineWidth = CELL_SIZE * 0.025;
    const segments = 10;

    const arcShift = CELL_SIZE * 0.2 * direction;
    const centerX = axis === 'x' ? arcShift : 0;
    const centerZ = axis === 'z' ? arcShift : 0;

    let startAngle: number;
    if (axis === 'z') {
      startAngle = direction > 0 ? 0 : Math.PI;
    } else {
      startAngle = direction > 0 ? -Math.PI / 2 : Math.PI / 2;
    }

    for (let i = 0; i < segments; i++) {
      const t0 = i / segments;
      const t1 = (i + 1) / segments;
      const a0 = startAngle + Math.PI * t0;
      const a1 = startAngle + Math.PI * t1;

      const x0 = centerX + Math.cos(a0) * arcRadius;
      const z0 = centerZ + Math.sin(a0) * arcRadius;
      const x1 = centerX + Math.cos(a1) * arcRadius;
      const z1 = centerZ + Math.sin(a1) * arcRadius;

      const segLen = Math.sqrt((x1 - x0) ** 2 + (z1 - z0) ** 2);
      const angle = Math.atan2(z1 - z0, x1 - x0);

      const seg = new THREE.Mesh(
        new THREE.PlaneGeometry(segLen, lineWidth),
        material,
      );
      seg.rotation.x = -Math.PI / 2;
      seg.rotation.z = -angle;
      seg.position.set((x0 + x1) / 2, 0.025, (z0 + z1) / 2);
      group.add(seg);
    }
  }

  createPreview(type: BuildingType, valid: boolean): THREE.Group {
    const def = BUILDING_DEFS[type];
    const group = new THREE.Group();

    const w = def.size.w * CELL_SIZE;
    const d = def.size.d * CELL_SIZE;
    const h = isZone(type) ? 0.3 : (def.height || 1);

    const geometry = new THREE.BoxGeometry(w * 0.85, h, d * 0.85);
    const material = new THREE.MeshLambertMaterial({
      color: valid ? 0x00ff00 : 0xff0000,
      transparent: true,
      opacity: 0.5,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = h / 2;
    group.add(mesh);

    return group;
  }

  createGhostPreview(type: BuildingType): THREE.Group {
    const def = BUILDING_DEFS[type];
    const group = new THREE.Group();

    const w = def.size.w * CELL_SIZE;
    const d = def.size.d * CELL_SIZE;
    const h = def.height || 0.1;

    const geometry = new THREE.BoxGeometry(w * 0.85, h, d * 0.85);
    const material = new THREE.MeshLambertMaterial({
      color: 0x888888,
      transparent: true,
      opacity: 0.35,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = h / 2;
    group.add(mesh);

    return group;
  }
}
