export interface Position {
  x: number;
  z: number;
}

export interface GridCell {
  terrain?: 'water' | 'steep';
  buildingId: string | null;
}

export type Grid = GridCell[][];
