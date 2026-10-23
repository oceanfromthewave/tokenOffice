import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workerSprite, type Facing, type Pose } from './pixels.ts';

const newLooks = ['seoa', 'harin', 'serin'] as const;
const poses: Pose[] = ['idle', 'type1', 'type2', 'walk1', 'walk2'];
const facings: Facing[] = ['down', 'up', 'left', 'right'];

test('the three new characters render complete, palette-valid sprites in every pose and direction', () => {
  for (const look of newLooks) for (const pose of poses) for (const facing of facings) {
    const sprite = workerSprite(look, pose, facing);
    assert.equal(sprite.grid.length, 23, `${look} ${pose} ${facing} height`);
    assert.ok(sprite.grid.every(row => row.length === 16), `${look} ${pose} ${facing} width`);
    for (const key of sprite.grid.flat().filter(pixel => pixel !== '.')) {
      assert.ok(sprite.palette[key], `${look} ${pose} ${facing} has a color for ${key}`);
    }
  }
});
