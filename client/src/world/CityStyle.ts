export type CityStyleId = 'classic' | 'mediterranean' | 'nordic' | 'autumn';

export interface CityStyle {
  label: string;
  asphalt: number;
  dirt: number;
  walk: number;
  kerb: number;
  concrete: number;
  lawn: number;
  paint: number;
  centreLine: number;
  downtown: number[];
  apartments: number[];
  shops: number[];
  houses: number[];
  industry: number[];
  flatRoof: number;
  houseRoofs: number[];
  leaves: number[];
  pines: number[];
}

/** Default colours follow citygen's palette (MIT, see THIRD_PARTY_NOTICES.md). */
const CLASSIC: CityStyle = {
  label: 'Classic',
  asphalt: 0x383d46,
  dirt: 0x8a7052,
  walk: 0xb6bec8,
  kerb: 0x949ca6,
  concrete: 0xa4acb6,
  lawn: 0x769a50,
  paint: 0xe9e8e0,
  centreLine: 0xe3b138,
  downtown: [0xc9d3dc, 0xa9b8c6, 0xd8d2c4, 0x8e9fb1, 0xe3e0d8, 0xb7c4cf],
  apartments: [0xd4c6b6, 0xc99c82, 0xb87e66, 0xc7c2b8, 0xb58d72, 0xdfd4c3],
  shops: [0xd69672, 0xc97b5a, 0xe2c396, 0xb88464, 0xd9b398, 0xa87154],
  houses: [0xf2ede4, 0xe8d9c0, 0xd6e0e6, 0xf0e0d0, 0xe3d3c3, 0xcfd8c8],
  industry: [0x9aa0a6, 0xb3a58f, 0x8f9a8c, 0xa7a39b],
  flatRoof: 0x4f545c,
  houseRoofs: [0x4f545c, 0x6d5f58, 0x7a5548, 0x4f5a66],
  leaves: [0x3d7a3a, 0x4c8c42, 0x2f6832],
  pines: [0x2c5e38, 0x245030],
};

export const CITY_STYLES: Record<CityStyleId, CityStyle> = {
  classic: CLASSIC,
  mediterranean: {
    ...CLASSIC,
    label: 'Mediterranean',
    asphalt: 0x55514d,
    walk: 0xd6c9b0,
    kerb: 0xb5a78c,
    concrete: 0xc9b999,
    downtown: [0xf1e4cf, 0xe9d3b0, 0xf6efe2, 0xe0c29a, 0xd8dfe0],
    apartments: [0xf6ead6, 0xefcfa6, 0xe8b98f, 0xf3dcc2, 0xe9a98a],
    shops: [0xe8935f, 0xf0bd7c, 0xe4cf9c, 0xdd7f5a, 0xf1dcb8],
    houses: [0xfbf6ec, 0xf6e7cd, 0xf3d7b6, 0xfaf1e0],
    flatRoof: 0xa8876a,
    houseRoofs: [0xb85c3c, 0xc46d45, 0xa95035],
    leaves: [0x869a4e, 0x97a65c, 0x748c4a],
    pines: [0x50724a, 0x5c7d4a],
  },
  nordic: {
    ...CLASSIC,
    label: 'Nordic',
    walk: 0xc3c6c8,
    kerb: 0xa2a7aa,
    concrete: 0xb0b5b8,
    downtown: [0xdfe5e8, 0x9fb0bd, 0x7c91a3, 0xc8d1d6, 0x5f7486],
    apartments: [0xcfd6d8, 0xb9574a, 0xd9b25f, 0x7f9aa8, 0xe8e6e0],
    shops: [0xa8443a, 0xd9a441, 0x3f6f86, 0xc96b4a, 0xe5e0d4],
    houses: [0xa63d33, 0xe6c667, 0x3f6d7d, 0xf1eee6, 0x7f8f6a],
    flatRoof: 0x3f464d,
    houseRoofs: [0x33383e, 0x41484f, 0x574b46],
    leaves: [0x6b9560, 0x7aa36b, 0x5b8557],
    pines: [0x35604b, 0x2f5645],
  },
  autumn: {
    ...CLASSIC,
    label: 'Autumn',
    lawn: 0x9aa05a,
    leaves: [0xd58a35, 0xc9603a, 0xe0b24a, 0xa9752f],
    pines: [0x55724a, 0x4b6845],
  },
};
