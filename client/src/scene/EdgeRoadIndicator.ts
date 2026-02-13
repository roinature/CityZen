import * as THREE from 'three';
import {
    type PlacedBuilding,
    type WorldState,
    type WorldCityEntry,
    type EdgeDirection,
    calculateEdgeConnections,
    findAdjacentCity,
    getOppositeDirection,
    CELL_SIZE,
    DEFAULT_GRID_SIZE,
} from '@cityzen/shared';

/**
 * Renders arrow indicators at edge road cells.
 *  - Green arrows for edges connected to a neighbor city with matching roads.
 *  - Orange arrows for unconnected edge roads (no neighbor or no matching road).
 *  - Cyan inward arrows for neighbor city roads the current city could connect to.
 */
export class EdgeRoadIndicator {
    private scene: THREE.Scene;
    private group: THREE.Group = new THREE.Group();

    private connectedMaterial: THREE.MeshStandardMaterial;
    private unconnectedMaterial: THREE.MeshStandardMaterial;
    private neighborMaterial: THREE.MeshStandardMaterial;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.group.name = 'edge-road-indicators';
        this.scene.add(this.group);

        this.connectedMaterial = new THREE.MeshStandardMaterial({
            color: 0x4caf50,
            emissive: 0x4caf50,
            emissiveIntensity: 0.8,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
        });

        this.unconnectedMaterial = new THREE.MeshStandardMaterial({
            color: 0xff9800,
            emissive: 0xff9800,
            emissiveIntensity: 0.6,
            transparent: true,
            opacity: 0.75,
            side: THREE.DoubleSide,
        });

        this.neighborMaterial = new THREE.MeshStandardMaterial({
            color: 0x00bcd4,
            emissive: 0x00bcd4,
            emissiveIntensity: 0.7,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
        });
    }

    /**
     * Recalculate and render edge road indicators.
     * Colors depend on whether the neighboring city has matching roads.
     */
    update(
        buildings: PlacedBuilding[],
        worldState: WorldState | null,
        cityId: string,
    ): void {
        this.clearMeshes();

        const connections = calculateEdgeConnections(buildings);

        // Find current city in world state to determine world position
        const currentCity = worldState?.cities.find(c => c.cityId === cityId) ?? null;

        // Own edge roads: green (connected) / orange (unconnected)
        for (const conn of connections) {
            const connected = this.isEdgeConnected(
                conn.direction,
                conn.positions,
                currentCity,
                worldState,
            );

            const material = connected ? this.connectedMaterial : this.unconnectedMaterial;

            for (const pos of conn.positions) {
                this.addArrow(conn.direction, pos, material);
            }
        }

        // Neighbor roads: cyan inward arrows where neighbors have roads we don't
        this.addNeighborIndicators(connections, currentCity, worldState);
    }

    /**
     * Remove all indicator meshes from the scene.
     */
    clear(): void {
        this.clearMeshes();
    }

    dispose(): void {
        this.clearMeshes();
        this.connectedMaterial.dispose();
        this.unconnectedMaterial.dispose();
        this.neighborMaterial.dispose();
        this.scene.remove(this.group);
    }

    // --- Private ---

    /**
     * Check if a neighbor city has matching road positions on the opposite edge.
     */
    private isEdgeConnected(
        direction: EdgeDirection,
        positions: number[],
        currentCity: WorldCityEntry | null,
        worldState: WorldState | null,
    ): boolean {
        if (!currentCity || !worldState) return false;

        const neighbor = findAdjacentCity(currentCity.position, direction, worldState.cities);
        if (!neighbor) return false;

        // Check if the neighbor has roads on the opposite edge at matching positions
        const oppositeDir = getOppositeDirection(direction);
        const neighborEdge = neighbor.edgeConnections?.find(e => e.direction === oppositeDir);
        if (!neighborEdge) return false;

        // At least one position must match
        return positions.some(p => neighborEdge.positions.includes(p));
    }

    private clearMeshes(): void {
        while (this.group.children.length > 0) {
            const child = this.group.children[0];
            this.group.remove(child);
            if (child instanceof THREE.Mesh) {
                child.geometry.dispose();
            }
        }
    }

    /**
     * Show inward-pointing cyan arrows where neighbor cities have edge roads
     * that the current city does not yet have a road at.
     */
    private addNeighborIndicators(
        ownConnections: { direction: EdgeDirection; positions: number[] }[],
        currentCity: WorldCityEntry | null,
        worldState: WorldState | null,
    ): void {
        if (!currentCity || !worldState) return;

        const directions: EdgeDirection[] = ['north', 'south', 'east', 'west'];

        for (const dir of directions) {
            const neighbor = findAdjacentCity(currentCity.position, dir, worldState.cities);
            if (!neighbor) continue;

            const oppositeDir = getOppositeDirection(dir);
            const neighborEdge = neighbor.edgeConnections?.find(e => e.direction === oppositeDir);
            if (!neighborEdge) continue;

            // Positions where the current city already has roads on this edge
            const ownPositions = ownConnections.find(c => c.direction === dir)?.positions ?? [];

            for (const pos of neighborEdge.positions) {
                // Only show if the current city does NOT have a road here
                if (!ownPositions.includes(pos)) {
                    this.addInwardArrow(dir, pos, this.neighborMaterial);
                }
            }
        }
    }

    /**
     * Place a small arrow on the ground at an edge cell, pointing inward (toward city center).
     */
    private addInwardArrow(
        direction: EdgeDirection,
        positionAlongEdge: number,
        material: THREE.MeshStandardMaterial,
    ): void {
        const gridMax = DEFAULT_GRID_SIZE - 1;
        let worldX: number;
        let worldZ: number;
        let rotY: number;

        // Same positions as addArrow, but rotation is flipped by PI (pointing inward)
        switch (direction) {
            case 'north':
                worldX = positionAlongEdge * CELL_SIZE + CELL_SIZE / 2;
                worldZ = 0 * CELL_SIZE + CELL_SIZE / 2;
                rotY = 0; // flipped from Math.PI
                break;
            case 'south':
                worldX = positionAlongEdge * CELL_SIZE + CELL_SIZE / 2;
                worldZ = gridMax * CELL_SIZE + CELL_SIZE / 2;
                rotY = Math.PI; // flipped from 0
                break;
            case 'west':
                worldX = 0 * CELL_SIZE + CELL_SIZE / 2;
                worldZ = positionAlongEdge * CELL_SIZE + CELL_SIZE / 2;
                rotY = -Math.PI / 2; // flipped from Math.PI / 2
                break;
            case 'east':
                worldX = gridMax * CELL_SIZE + CELL_SIZE / 2;
                worldZ = positionAlongEdge * CELL_SIZE + CELL_SIZE / 2;
                rotY = Math.PI / 2; // flipped from -Math.PI / 2
                break;
            default:
                return;
        }

        const arrow = this.createArrowMesh(material);
        arrow.position.set(worldX, 0.05, worldZ);
        arrow.rotation.y = rotY;
        this.group.add(arrow);
    }

    /**
     * Place a small arrow on the ground at an edge cell, pointing outward.
     *
     * Grid coordinate system:
     *   x increases to the east, z increases to the south.
     *   north edge → z = 0, south edge → z = gridSize-1
     *   west  edge → x = 0, east  edge → x = gridSize-1
     */
    private addArrow(
        direction: string,
        positionAlongEdge: number,
        material: THREE.MeshStandardMaterial,
    ): void {
        const gridMax = DEFAULT_GRID_SIZE - 1;
        let worldX: number;
        let worldZ: number;
        let rotY: number;

        switch (direction) {
            case 'north':
                worldX = positionAlongEdge * CELL_SIZE + CELL_SIZE / 2;
                worldZ = 0 * CELL_SIZE + CELL_SIZE / 2;
                rotY = Math.PI;
                break;
            case 'south':
                worldX = positionAlongEdge * CELL_SIZE + CELL_SIZE / 2;
                worldZ = gridMax * CELL_SIZE + CELL_SIZE / 2;
                rotY = 0;
                break;
            case 'west':
                worldX = 0 * CELL_SIZE + CELL_SIZE / 2;
                worldZ = positionAlongEdge * CELL_SIZE + CELL_SIZE / 2;
                rotY = Math.PI / 2;
                break;
            case 'east':
                worldX = gridMax * CELL_SIZE + CELL_SIZE / 2;
                worldZ = positionAlongEdge * CELL_SIZE + CELL_SIZE / 2;
                rotY = -Math.PI / 2;
                break;
            default:
                return;
        }

        const arrow = this.createArrowMesh(material);
        arrow.position.set(worldX, 0.05, worldZ);
        arrow.rotation.y = rotY;
        this.group.add(arrow);
    }

    /**
     * Create a flat arrow shape (triangle head + rectangular stem) on the XZ plane.
     * Points in +Z by default.
     */
    private createArrowMesh(material: THREE.MeshStandardMaterial): THREE.Mesh {
        const shape = new THREE.Shape();
        const s = CELL_SIZE;

        const stemW = s * 0.15;
        const stemH = s * 0.3;
        const headW = s * 0.35;
        const headH = s * 0.25;

        shape.moveTo(-stemW / 2, 0);
        shape.lineTo(-stemW / 2, stemH);
        shape.lineTo(-headW / 2, stemH);
        shape.lineTo(0, stemH + headH);
        shape.lineTo(headW / 2, stemH);
        shape.lineTo(stemW / 2, stemH);
        shape.lineTo(stemW / 2, 0);
        shape.closePath();

        const geometry = new THREE.ShapeGeometry(shape);
        geometry.rotateX(-Math.PI / 2);

        return new THREE.Mesh(geometry, material);
    }
}
