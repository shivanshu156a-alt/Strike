import * as THREE from 'three';

export interface ArenaMap {
  sky: number;
  ground: number;
  accent: number;
  grid: number;
  ambient: number;
}

export const ARENA_GRID_SIZE = 100;
export const GRID_UNIT_SIZE = 1;

export const EMPTY_ARENA: ArenaMap = {
  sky: 0x000000,
  ground: 0x000000,
  accent: 0xffffff,
  grid: 0xffffff,
  ambient: 0xd3dfd0,
};

export function buildMap(scene: THREE.Scene, map: ArenaMap): void {
  const floorSize = ARENA_GRID_SIZE * GRID_UNIT_SIZE;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(floorSize, floorSize),
    new THREE.MeshStandardMaterial({ color: map.ground, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.05;
  scene.add(floor);

  const unitGrid = new THREE.GridHelper(floorSize, ARENA_GRID_SIZE, 0xffffff, 0xffffff);
  unitGrid.position.y = -0.04;
  scene.add(unitGrid);

  scene.add(new THREE.HemisphereLight(map.ambient, map.accent, 1.6));
  const light = new THREE.DirectionalLight(map.ambient, 1.4);
  light.position.set(-18, 34, 16);
  scene.add(light);

  scene.background = new THREE.Color(map.sky);
}
