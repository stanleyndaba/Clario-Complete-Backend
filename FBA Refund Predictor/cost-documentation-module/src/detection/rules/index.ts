export { LostUnitsRule } from './lostUnitsRule';
export { OverchargedFeesRule } from './overchargedFeesRule';
export { DamagedStockRule } from './damagedStockRule';
export { BaseRule } from './baseRule';

import { LostUnitsRule } from './lostUnitsRule';
import { OverchargedFeesRule } from './overchargedFeesRule';
import { DamagedStockRule } from './damagedStockRule';

export const ALL_RULES = [
  new LostUnitsRule(),
  new OverchargedFeesRule(),
  new DamagedStockRule()
];

