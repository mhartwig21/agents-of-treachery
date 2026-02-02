export type Power = 'england' | 'france' | 'germany' | 'italy' | 'austria' | 'russia' | 'turkey';

export type UnitType = 'army' | 'fleet';

export type TerritoryType = 'land' | 'sea' | 'coast';

export type OrderType = 'hold' | 'move' | 'support' | 'convoy';

export interface Unit {
  type: UnitType;
  power: Power;
  territory: string;
}

export interface Order {
  type: OrderType;
  unit: string; // territory id
  target?: string; // for move/support/convoy
  supportTarget?: string; // what the supported unit is doing
}

export interface Territory {
  id: string;
  name: string;
  type: TerritoryType;
  supplyCenter: boolean;
  owner?: Power;
  path: string; // SVG path data
  labelX: number;
  labelY: number;
  neighbors: string[];
}

export interface GameState {
  phase: 'spring' | 'fall' | 'retreat' | 'build';
  year: number;
  units: Unit[];
  orders: Order[];
  supplyCenters: Record<string, Power | undefined>;
}
