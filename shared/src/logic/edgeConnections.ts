import { PlacedBuilding, isRoad, BUILDING_DEFS } from '../index.js';
import { DEFAULT_GRID_SIZE } from '../constants/grid.js';
import type { EdgeConnection, EdgeDirection, WorldCityEntry, WorldPosition } from '../types/world.js';

/**
 * Calculate edge connections for a city based on its road placements.
 * Returns an array of EdgeConnection objects indicating which edges have roads
 * and at what positions along those edges.
 */
export function calculateEdgeConnections(
    buildings: PlacedBuilding[],
    gridSize: number = DEFAULT_GRID_SIZE
): EdgeConnection[] {
    const north: number[] = [];  // Roads at z = 0
    const south: number[] = [];  // Roads at z = gridSize - 1
    const west: number[] = [];   // Roads at x = 0
    const east: number[] = [];   // Roads at x = gridSize - 1

    for (const building of buildings) {
        if (!isRoad(building.type)) continue;

        const def = BUILDING_DEFS[building.type];
        const { x, z } = building.position;
        const w = def.size.w;
        const d = def.size.d;

        // Check all cells of the road for edge placement
        for (let dx = 0; dx < w; dx++) {
            for (let dz = 0; dz < d; dz++) {
                const cx = x + dx;
                const cz = z + dz;

                // North edge (z = 0)
                if (cz === 0) {
                    if (!north.includes(cx)) north.push(cx);
                }
                // South edge (z = gridSize - 1)
                if (cz === gridSize - 1) {
                    if (!south.includes(cx)) south.push(cx);
                }
                // West edge (x = 0)
                if (cx === 0) {
                    if (!west.includes(cz)) west.push(cz);
                }
                // East edge (x = gridSize - 1)
                if (cx === gridSize - 1) {
                    if (!east.includes(cz)) east.push(cz);
                }
            }
        }
    }

    const connections: EdgeConnection[] = [];
    if (north.length > 0) connections.push({ direction: 'north', positions: north.sort((a, b) => a - b) });
    if (south.length > 0) connections.push({ direction: 'south', positions: south.sort((a, b) => a - b) });
    if (west.length > 0) connections.push({ direction: 'west', positions: west.sort((a, b) => a - b) });
    if (east.length > 0) connections.push({ direction: 'east', positions: east.sort((a, b) => a - b) });

    return connections;
}

/**
 * Get the opposite direction for matching edges between adjacent cities.
 */
export function getOppositeDirection(direction: EdgeDirection): EdgeDirection {
    switch (direction) {
        case 'north': return 'south';
        case 'south': return 'north';
        case 'east': return 'west';
        case 'west': return 'east';
    }
}

/**
 * Determine the expected neighbor direction based on world positions.
 * Returns null if cities are not adjacent.
 */
export function getNeighborDirection(
    cityA: WorldPosition,
    cityB: WorldPosition
): EdgeDirection | null {
    const dx = cityB.wx - cityA.wx;
    const dz = cityB.wz - cityA.wz;

    // Cities must be exactly 1 unit apart in one direction only
    if (Math.abs(dx) + Math.abs(dz) !== 1) return null;

    if (dx === 1) return 'east';
    if (dx === -1) return 'west';
    if (dz === 1) return 'south';
    if (dz === -1) return 'north';

    return null;
}

/**
 * Check if two adjacent cities have matching road connections.
 * Returns matching positions if found, or null if no match.
 */
export function findMatchingConnections(
    cityA: WorldCityEntry,
    cityB: WorldCityEntry
): { direction: EdgeDirection; positions: number[] } | null {
    const neighborDir = getNeighborDirection(cityA.position, cityB.position);
    if (!neighborDir) return null;

    const oppositeDir = getOppositeDirection(neighborDir);

    const cityAEdge = cityA.edgeConnections?.find(e => e.direction === neighborDir);
    const cityBEdge = cityB.edgeConnections?.find(e => e.direction === oppositeDir);

    if (!cityAEdge || !cityBEdge) return null;

    // Find overlapping positions
    const matchingPositions = cityAEdge.positions.filter(pos =>
        cityBEdge.positions.includes(pos)
    );

    if (matchingPositions.length === 0) return null;

    return { direction: neighborDir, positions: matchingPositions };
}

/**
 * Find the adjacent city in a given direction from the current city.
 */
export function findAdjacentCity(
    currentPosition: WorldPosition,
    direction: EdgeDirection,
    cities: WorldCityEntry[]
): WorldCityEntry | null {
    let targetWx = currentPosition.wx;
    let targetWz = currentPosition.wz;

    switch (direction) {
        case 'north': targetWz -= 1; break;
        case 'south': targetWz += 1; break;
        case 'east': targetWx += 1; break;
        case 'west': targetWx -= 1; break;
    }

    return cities.find(c =>
        c.position.wx === targetWx && c.position.wz === targetWz
    ) || null;
}
