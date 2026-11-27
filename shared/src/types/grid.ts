export type UtilityLayer = 'surface' | 'power' | 'water' | 'sewage';

export interface Position {
  x: number;
  z: number;
}

export interface GridCell {
  terrain?: 'water' | 'steep';
  buildingId: string | null;
  powerLineId?: string | null;
  waterPipeId?: string | null;
  sewagePipeId?: string | null;
}

export type Grid = GridCell[][];
