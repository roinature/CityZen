import * as THREE from 'three';
import { type PlacedBuilding, BUILDING_DEFS, CELL_SIZE, BuildingType, isZone, isRoad, ZONE_LEVELS, type ZoneType } from '@cityzen/shared';

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

  createBuilding(building: PlacedBuilding, neighbors?: RoadNeighbors): THREE.Group {
    const def = BUILDING_DEFS[building.type];
    const group = new THREE.Group();

    const w = def.size.w * CELL_SIZE;
    const d = def.size.d * CELL_SIZE;

    if (building.type === BuildingType.PARK) {
      this.createPark(group, w, d);
    } else if (isRoad(building.type)) {
      this.createRoad(group, building, neighbors);
    } else if (isZone(building.type)) {
      this.createZone(group, building);
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
    [BuildingType.POLICE_STATION]: 'police_station_facade.png',
    [BuildingType.POLICE_HQ]: 'police_hq_facade.png',
    [BuildingType.POLICE_JAIL]: 'police_jail_facade.png',
    [BuildingType.POLICE_ACADEMY]: 'police_academy_facade.png',
    [BuildingType.HEALTH_CLINIC]: 'clinic_facade.png',
    [BuildingType.HEALTH_HOSPITAL]: 'hospital_facade.png',
    [BuildingType.HEALTH_RESEARCH_CENTER]: 'research_center_facade.png',
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

    let bodyMesh: THREE.Mesh;
    if (texturePath) {
      // Create textured building
      const geometry = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
      const facadeTexPath = `/textures/buildings/${texturePath}`;

      // Create materials for each face
      const matSideX = new THREE.MeshStandardMaterial({
        map: this.getTexture(facadeTexPath, bodyD / 2, bodyH / 2),
        emissiveMap: this.getTexture(facadeTexPath, bodyD / 2, bodyH / 2),
        emissive: new THREE.Color(0xffff00),
        emissiveIntensity: 0 // Will be updated by LightingSetup
      });
      const matSideZ = new THREE.MeshStandardMaterial({
        map: this.getTexture(facadeTexPath, bodyW / 2, bodyH / 2),
        emissiveMap: this.getTexture(facadeTexPath, bodyW / 2, bodyH / 2),
        emissive: new THREE.Color(0xffff00),
        emissiveIntensity: 0
      });
      const matTop = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.7) });
      const matBottom = new THREE.MeshStandardMaterial({ color: 0x333333 });

      const materials = [
        matSideX, // Right
        matSideX, // Left
        matTop,   // Top
        matBottom,// Bottom
        matSideZ, // Front
        matSideZ  // Back
      ];

      bodyMesh = new THREE.Mesh(geometry, materials);
    } else {
      // Fallback to colored building
      bodyMesh = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW, bodyH, bodyD),
        new THREE.MeshLambertMaterial({ color: color }),
      );
    }

    bodyMesh.position.y = bodyH / 2;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

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
  }

  private createZone(group: THREE.Group, building: PlacedBuilding): void {
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
    } else {
      // Developed: building geometry with textures
      const levelDef = ZONE_LEVELS[building.type as ZoneType][level - 1];
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

      console.log('Night/Day paths:', { facadeTexPath, facadeNightPath, roofTexPath, roofNightPath });

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
