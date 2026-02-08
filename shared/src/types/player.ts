export interface Player {
  id: string;
  name: string;
  joinedAt: number;
}

export interface PlayerProfile {
  id: string;
  name: string;
  ownedCityId: string | null;
  createdAt: number;
}
