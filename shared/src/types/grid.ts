export interface Position {
  x: number;
  z: number;
}

export interface GridCell {
  buildingId: string | null;
}

export type Grid = GridCell[][];
