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
