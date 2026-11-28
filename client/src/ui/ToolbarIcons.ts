import { BuildingType, ZoneDensity } from '@cityzen/shared';

function svg(body: string, viewBox = '0 0 24 24'): string {
  return `<svg class="toolbar-svg" viewBox="${viewBox}" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Tool icons (Pointer, Bulldoze) */
export const TOOL_ICONS = {
  pointer: svg('<path d="M5 3.5L18.5 11.5L12.2 13.1L9.4 19.5L5 3.5Z" fill="currentColor" fill-opacity="0.18"/>'),
  bulldoze: svg(
    '<path d="M3 16h11v-4.5L11.5 8H6v3.5H3V16Z"/>' +
    '<path d="M14 14h3.5l2.5-4.5v6.5h-2.5"/>' +
    '<rect x="3" y="16" width="11" height="3" rx="1.5"/>' +
    '<path d="M8 8V6"/>',
  ),
} as const;

/** Level-1 build category icons */
export const CATEGORY_ICONS: Record<string, string> = {
  Roads: svg(
    '<path d="M8 3L5 21M16 3l3 18"/>' +
    '<path d="M12 5v2.5M12 10.5v3M12 16.5V19"/>',
  ),
  Zones: svg(
    '<rect x="3" y="3" width="8" height="8" rx="1.5" fill="#66BB6A" fill-opacity="0.35" stroke="#66BB6A"/>' +
    '<rect x="13" y="3" width="8" height="8" rx="1.5" fill="#42A5F5" fill-opacity="0.35" stroke="#42A5F5"/>' +
    '<rect x="3" y="13" width="18" height="8" rx="1.5" fill="#FFA726" fill-opacity="0.35" stroke="#FFA726"/>',
  ),
  Parks: svg(
    '<path d="M12 3L6.5 11h3.2L5.5 17h13l-4.2-6h3.2L12 3Z" fill="currentColor" fill-opacity="0.16"/>' +
    '<path d="M12 17v4"/>',
  ),
  Waterfront: svg(
    '<circle cx="12" cy="5.5" r="2"/>' +
    '<path d="M12 7.5V19M8.5 10.5h7"/>' +
    '<path d="M5.5 15c0 3 2.9 5 6.5 5s6.5-2 6.5-5"/>',
  ),
  Services: svg(
    '<path d="M3 20h18M5 20V10h14v10"/>' +
    '<path d="M3.5 10L12 4l8.5 6"/>' +
    '<path d="M9 20v-6h6v6M12 10v10"/>',
  ),
};

/** Level-2 service subcategory icons (by InfraCategory.id) */
export const SERVICE_CATEGORY_ICONS: Record<string, string> = {
  energy: svg('<path d="M13 2L5 13h6l-1 9 9-12h-6l0-8Z" fill="currentColor" fill-opacity="0.2"/>'),
  water: svg('<path d="M12 3C12 3 6 10.2 6 14.5a6 6 0 0 0 12 0C18 10.2 12 3 12 3Z" fill="currentColor" fill-opacity="0.2"/>'),
  sewage: svg(
    '<path d="M4 9h10a4 4 0 0 1 4 4v5"/>' +
    '<path d="M4 13h8a2 2 0 0 1 2 2v3"/>' +
    '<path d="M4 7v8M12 18h8"/>',
  ),
  police: svg('<path d="M12 3l7 3v5.5c0 4.5-3 7.8-7 9.5-4-1.7-7-5-7-9.5V6l7-3Z" fill="currentColor" fill-opacity="0.18"/><path d="M12 8.5l1 2.2 2.4.2-1.8 1.6.5 2.3-2.1-1.2-2.1 1.2.5-2.3-1.8-1.6 2.4-.2 1-2.2Z"/>'),
  fire: svg('<path d="M12 3c2 3.5 5 5.6 5 10a5 5 0 0 1-10 0c0-2 .9-4 2.2-5.5 0 1.8.8 2.8 1.8 3.2-.4-2.8 0-5.2 1-7.7Z" fill="currentColor" fill-opacity="0.2"/>'),
  health: svg('<rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" fill-opacity="0.14"/><path d="M12 8v8M8 12h8"/>'),
  education: svg('<path d="M2 10l10-5 10 5-10 5-10-5Z" fill="currentColor" fill-opacity="0.18"/><path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 10v6"/>'),
  government: svg('<path d="M3 20h18M4 10h16M5 10l7-5 7 5M7 10v10M12 10v10M17 10v10"/>'),
  tourism: svg('<circle cx="12" cy="11" r="6.5"/><circle cx="12" cy="11" r="1.5"/><path d="M12 4.5v13M5.5 11h13M7.5 20l4.5-9 4.5 9"/>'),
  transport: svg(
    '<rect x="4" y="5" width="16" height="12" rx="2.5" fill="currentColor" fill-opacity="0.15"/>' +
    '<path d="M4 11h16M7 17v2.5M17 17v2.5"/>' +
    '<circle cx="8" cy="14" r="1" fill="currentColor"/><circle cx="16" cy="14" r="1" fill="currentColor"/>',
  ),
  waterfront: CATEGORY_ICONS.Waterfront,
  art_culture: svg(
    '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2.5-.8 2.5-2 0-.6-.2-1.1-.5-1.5-.3-.4-.1-1 .5-1h1.5a5 5 0 0 0 5-5c0-4.7-4-8.5-9-8.5Z" fill="currentColor" fill-opacity="0.14"/>' +
    '<circle cx="8" cy="10" r="1" fill="currentColor"/><circle cx="11.5" cy="7.5" r="1" fill="currentColor"/><circle cx="15.5" cy="9.5" r="1" fill="currentColor"/>',
  ),
};

/** Zone density level icons (Level 3 for Zones) */
export function getDensityIcon(density: ZoneDensity): string {
  switch (density) {
    case ZoneDensity.LOW:
      return svg(
        '<path d="M4 19h16"/>' +
        '<path d="M7 19v-6.5L12 8.5l5 4V19" fill="currentColor" fill-opacity="0.22"/>' +
        '<rect x="10.5" y="14.5" width="3" height="4.5"/>',
      );
    case ZoneDensity.MEDIUM:
      return svg(
        '<path d="M3 19h18"/>' +
        '<rect x="5" y="9" width="6" height="10" rx="0.8" fill="currentColor" fill-opacity="0.22"/>' +
        '<rect x="13" y="6" width="6" height="13" rx="0.8" fill="currentColor" fill-opacity="0.22"/>' +
        '<path d="M7.5 12h1M7.5 15h1M15.5 9h1M15.5 12h1M15.5 15h1"/>',
      );
    case ZoneDensity.HIGH:
      return svg(
        '<path d="M3 19h18"/>' +
        '<rect x="4" y="11" width="4.5" height="8" rx="0.5" fill="currentColor" fill-opacity="0.2"/>' +
        '<rect x="9.5" y="4" width="5" height="15" rx="0.6" fill="currentColor" fill-opacity="0.32"/>' +
        '<rect x="15.5" y="8" width="4.5" height="11" rx="0.5" fill="currentColor" fill-opacity="0.2"/>' +
        '<path d="M12 4V2.5M11.5 7.5h1M11.5 10.5h1M11.5 13.5h1"/>',
      );
  }
}

/** Custom SVG icons for buildings that lack facade textures or read clearer as symbols */
const BUILDING_SVG_ICONS: Partial<Record<BuildingType, string>> = {
  // Zones
  [BuildingType.ZONE_RESIDENTIAL]: svg(
    '<path d="M4 11.5L12 5l8 6.5"/>' +
    '<path d="M6.5 10v9h11v-9" fill="currentColor" fill-opacity="0.25"/>' +
    '<rect x="10" y="13.5" width="4" height="5.5"/>',
  ),
  [BuildingType.ZONE_COMMERCIAL]: svg(
    '<path d="M4 9l1.5-4h13L20 9"/>' +
    '<path d="M4 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 6 0"/>' +
    '<path d="M5.5 11.5V19h13v-7.5" fill="currentColor" fill-opacity="0.25"/>' +
    '<rect x="9.5" y="14" width="5" height="5"/>',
  ),
  [BuildingType.ZONE_INDUSTRIAL]: svg(
    '<path d="M3 19V11l5 3v-3l5 3V8h4v11H3Z" fill="currentColor" fill-opacity="0.25"/>' +
    '<path d="M17 8l1-4h2l1 4M7 19v-2M11 19v-2"/>',
  ),

  // Roads
  [BuildingType.ROAD_DIRT]: svg(
    '<path d="M7 3c1 5-1 13 0 18M17 3c-1 5 1 13 0 18"/>' +
    '<circle cx="11" cy="8" r="0.8" fill="currentColor"/><circle cx="13" cy="13" r="0.8" fill="currentColor"/><circle cx="11" cy="17" r="0.8" fill="currentColor"/>',
  ),
  [BuildingType.ROAD_STREET]: svg(
    '<path d="M7 3v18M17 3v18"/>' +
    '<path d="M12 5v3M12 10.5v3M12 16v3"/>',
  ),
  [BuildingType.ROAD_AVENUE]: svg(
    '<path d="M4.5 3v18M19.5 3v18"/>' +
    '<path d="M12 3v18" stroke-width="2.2"/>' +
    '<path d="M8.2 6v2.5M8.2 12v2.5M15.8 6v2.5M15.8 12v2.5"/>',
  ),
  [BuildingType.ROAD_HIGHWAY]: svg(
    '<path d="M4 21L8.5 3M20 21L15.5 3"/>' +
    '<path d="M12 4v3M12 10v3.5M12 16.5V20" stroke-width="2.2"/>' +
    '<path d="M2.5 13h19"/>',
  ),
  [BuildingType.ROAD_ROUNDABOUT]: svg(
    '<circle cx="12" cy="12" r="5.5"/>' +
    '<circle cx="12" cy="12" r="2" fill="currentColor" fill-opacity="0.25"/>' +
    '<path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  ),

  // Parks & Parking
  [BuildingType.PARK]: CATEGORY_ICONS.Parks,
  [BuildingType.PARKING]: svg(
    '<rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" fill-opacity="0.16"/>' +
    '<path d="M9.5 17V7h3.5a3 3 0 0 1 0 6H9.5"/>',
  ),

  // Utility conduits & stations without facade textures
  [BuildingType.UTILITY_POWER_LINE]: svg(
    '<path d="M12 3v18M8 7h8M6 12h12"/>' +
    '<path d="M9 21l3-9 3 9M8 7l4-4 4 4"/>',
  ),
  [BuildingType.UTILITY_WATER_PIPE]: svg(
    '<path d="M3 10h18M3 14h18"/>' +
    '<path d="M8 8v8M16 8v8"/>' +
    '<circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  ),
  [BuildingType.UTILITY_SEWAGE_PIPE]: svg(
    '<path d="M3 9h11a4 4 0 0 1 4 4v6"/>' +
    '<path d="M3 13h11v6"/>' +
    '<path d="M6 7v8"/>',
  ),
  [BuildingType.ENERGY_SUBSTATION]: svg(
    '<rect x="4" y="8" width="16" height="11" rx="1.5" fill="currentColor" fill-opacity="0.18"/>' +
    '<path d="M8 8V5M16 8V5M12.5 10.5l-2.5 3.5h3l-1.5 3"/>',
  ),
  [BuildingType.SEWAGE_PUMP_STATION]: svg(
    '<rect x="4" y="9" width="16" height="10" rx="1.5" fill="currentColor" fill-opacity="0.18"/>' +
    '<path d="M8 9V6h8v3M9 14h6M12 11.5v5"/>',
  ),
};

export function getBuildingSvgIcon(type: BuildingType): string | null {
  return BUILDING_SVG_ICONS[type] ?? null;
}
