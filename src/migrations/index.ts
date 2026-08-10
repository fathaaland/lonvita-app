import * as migration_20260810_142000_initial from './20260810_142000_initial';

export const migrations = [
  {
    up: migration_20260810_142000_initial.up,
    down: migration_20260810_142000_initial.down,
    name: '20260810_142000_initial'
  },
];
