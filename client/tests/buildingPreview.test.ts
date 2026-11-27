import { registerHooks } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BuildingType, INFRA_CATEGORIES, ZoneDensity, type PlacedBuilding } from '@cityzen/shared';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.includes('/client/src/')) {
      return nextResolve(specifier.slice(0, -3) + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});

const { BuildingFactory } = await import('../src/world/BuildingFactory.ts');
const { CityBuildings } = await import('../src/world/CityBuildings.ts');
const { CITY_STYLES } = await import('../src/world/CityStyle.ts');
const { indexRoads } = await import('../src/world/RoadSurface.ts');

test('BuildingFactory.createPreview builds multi-part non-shadow 3D models for all service buildings', () => {
  const factory = new BuildingFactory();
  const allServices = INFRA_CATEGORIES.flatMap(c => c.types);

  for (const type of [...allServices, BuildingType.PARK, BuildingType.PARKING, BuildingType.ROAD_ROUNDABOUT]) {
    for (const valid of [true, false]) {
      const preview = factory.createPreview(type, valid, CITY_STYLES.classic);
      let meshCount = 0;
      const box = new THREE.Box3().setFromObject(preview);

      preview.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          meshCount++;
          assert.equal(child.castShadow, false, `${type} preview must not cast shadows`);
          assert.equal(child.receiveShadow, false, `${type} preview must not receive shadows`);
        }
      });

      // Must contain actual building parts + depth prepass + footprint frame (far more than a single placeholder cube)
      assert.ok(meshCount >= 7, `Expected rich 3D preview for ${type}, got ${meshCount} meshes`);
      // Scaled to city world coordinates (not raw legacy def.height=5..8 monoliths)
      const height = box.max.y - box.min.y;
      assert.ok(height > 0.05 && height < 4.2, `Expected realistic world-scale height for ${type}, got ${height}`);
    }
  }
});

test('pipeline and power-line previews align geometry with build direction and neighbor junctions', () => {
  const factory = new BuildingFactory();

  // Model child[0] holds the 3D conduit geometry (child[1..5] are the 1x1 footprint pad/frame)
  const ewPipe = factory.createGhostPreview(
    BuildingType.UTILITY_WATER_PIPE,
    'EW',
    CITY_STYLES.classic,
    true,
    { n: false, s: false, e: true, w: true, flowDir: 'E' },
  );
  const nsPipe = factory.createGhostPreview(
    BuildingType.UTILITY_WATER_PIPE,
    'NS',
    CITY_STYLES.classic,
    true,
    { n: true, s: true, e: false, w: false, flowDir: 'S' },
  );

  const ewModelBox = new THREE.Box3().setFromObject(ewPipe.children[0]);
  const nsModelBox = new THREE.Box3().setFromObject(nsPipe.children[0]);

  // EW pipe spans full cell along X and stays narrow along Z; NS pipe spans full cell along Z and stays narrow along X
  assert.ok((ewModelBox.max.x - ewModelBox.min.x) > (ewModelBox.max.z - ewModelBox.min.z) * 2.5);
  assert.ok((nsModelBox.max.z - nsModelBox.min.z) > (nsModelBox.max.x - nsModelBox.min.x) * 2.5);

  // L-elbow (North + East) extends to -Z and +X edges while staying centered near 0 on +Z and -X
  const elbow = factory.createGhostPreview(
    BuildingType.UTILITY_SEWAGE_PIPE,
    'EW',
    CITY_STYLES.classic,
    true,
    { n: true, s: false, e: true, w: false, flowDir: 'E' },
  );
  const elbowBox = new THREE.Box3().setFromObject(elbow.children[0]);
  assert.ok(elbowBox.max.x > Math.abs(elbowBox.min.x) * 2, 'Expected L-elbow arm extending East (+X)');
  assert.ok(Math.abs(elbowBox.min.z) > elbowBox.max.z * 2, 'Expected L-elbow arm extending North (-Z)');
});

test('CityBuildings.setPreviewClearance hides overlapping zoned buildings and restores them when cleared', () => {
  const cityBuildings = new CityBuildings();
  const placed: PlacedBuilding[] = [
    {
      id: 'z1',
      type: BuildingType.ZONE_RESIDENTIAL,
      position: { x: 5, z: 5 },
      placedBy: 'p1',
      placedAt: 0,
      density: ZoneDensity.MEDIUM,
      developmentLevel: 2,
    },
    {
      id: 'z2',
      type: BuildingType.ZONE_COMMERCIAL,
      position: { x: 9, z: 9 },
      placedBy: 'p1',
      placedAt: 0,
      density: ZoneDensity.MEDIUM,
      developmentLevel: 2,
    },
  ];

  cityBuildings.rebuild(placed, indexRoads(placed), { style: CITY_STYLES.classic, skyline: 1 });
  const walls = cityBuildings.group.getObjectByName('walls') as THREE.InstancedMesh;
  assert.ok(walls, 'Expected instanced walls mesh');
  assert.equal(walls.count, 2);

  const m0 = new THREE.Matrix4();
  const m1 = new THREE.Matrix4();
  const scale = new THREE.Vector3();

  // Hovering a 3x3 service building at (4, 4)..(6, 6) clears z1 at (5, 5) while leaving z2 at (9, 9) untouched
  cityBuildings.setPreviewClearance({ x: 4, z: 4, w: 3, d: 3 });
  walls.getMatrixAt(0, m0);
  walls.getMatrixAt(1, m1);
  assert.equal(scale.setFromMatrixScale(m0).y, 0);
  assert.ok(scale.setFromMatrixScale(m1).y > 0);

  // Clearing hover restores z1 immediately
  cityBuildings.setPreviewClearance(null);
  walls.getMatrixAt(0, m0);
  assert.ok(scale.setFromMatrixScale(m0).y > 0);
});
