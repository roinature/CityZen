import * as THREE from 'three';
import { BUILDING_DEFS, CELL_SIZE, BuildingType, isZone, getEffectiveSize } from '@cityzen/shared';

export class BuildingFactory {
  // Catalogue icons for infrastructure buildings
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
    [BuildingType.HEALTH_CEMETERY]: 'cemetery_facade.png',
    [BuildingType.ART_GALLERY]: 'art_gallery_facade.png',
    [BuildingType.ART_THEATER]: 'theater_facade.png',
    [BuildingType.ART_CONCERT_HALL]: 'concert_hall_facade.png',
    [BuildingType.ART_SCULPTURE_PARK]: 'sculpture_park_facade.png',
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

  createBulldozePreview(type: BuildingType): THREE.Group {
    const def = BUILDING_DEFS[type];
    const group = new THREE.Group();

    const w = def.size.w * CELL_SIZE;
    const d = def.size.d * CELL_SIZE;
    const h = isZone(type) ? 0.3 : (def.height || 1);

    const geometry = new THREE.BoxGeometry(w * 0.85, h, d * 0.85);
    const material = new THREE.MeshLambertMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.45,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = h / 2;
    group.add(mesh);

    return group;
  }

  createGhostPreview(type: BuildingType, orientation?: import('@cityzen/shared').RoadOrientation): THREE.Group {
    const def = BUILDING_DEFS[type];
    const group = new THREE.Group();

    const { w: effW, d: effD } = getEffectiveSize(type, orientation);
    const w = effW * CELL_SIZE;
    const d = effD * CELL_SIZE;
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
