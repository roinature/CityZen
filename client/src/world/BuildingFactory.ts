import * as THREE from 'three';
import { type PlacedBuilding, BUILDING_DEFS, CELL_SIZE, BuildingType, isZone, isRoad, ZONE_LEVELS, type ZoneType } from '@cityzen/shared';

export interface RoadNeighbors {
  hasNorth: boolean;
  hasSouth: boolean;
  hasEast: boolean;
  hasWest: boolean;
}

export class BuildingFactory {
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

  private textureLoader = new THREE.TextureLoader();
  private textures: Record<string, THREE.Texture> = {};

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

      // Map textures based on zone type
      let facadeTexPath = '/textures/buildings/residential_facade.png';
      let roofTexPath = '/textures/buildings/residential_roof.png';

      if (building.type === BuildingType.ZONE_COMMERCIAL) {
        facadeTexPath = '/textures/buildings/commercial_facade.png';
        roofTexPath = '/textures/buildings/commercial_roof.png';
      } else if (building.type === BuildingType.ZONE_INDUSTRIAL) {
        facadeTexPath = '/textures/buildings/industrial_facade.png';
        roofTexPath = '/textures/buildings/industrial_roof.png';
      }

      // Scale textures
      // Facade: repeat horizontally based on width, vertically based on height
      const roofRepeatW = Math.max(1, bw / 2);
      const roofRepeatD = Math.max(1, bd / 2);

      const matRoof = new THREE.MeshLambertMaterial({
        map: this.getTexture(roofTexPath, roofRepeatW, roofRepeatD)
      });

      // We use specialized materials for sides to handle specific aspect ratios
      // SideX (Right/Left) uses depth as width
      const matSideX = new THREE.MeshLambertMaterial({ map: this.getTexture(facadeTexPath, bd / 2, h / 2) });
      // SideZ (Front/Back) uses width as width
      const matSideZ = new THREE.MeshLambertMaterial({ map: this.getTexture(facadeTexPath, bw / 2, h / 2) });
      const matBottom = new THREE.MeshLambertMaterial({ color: 0x333333 });

      const materials = [
        matSideX, // Right
        matSideX, // Left
        matRoof,  // Top
        matBottom,// Bottom
        matSideZ, // Front
        matSideZ  // Back
      ];

      const mesh = new THREE.Mesh(geometry, materials);
      mesh.position.y = h / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
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
}
