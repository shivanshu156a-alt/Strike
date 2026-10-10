import * as THREE from 'three';

export interface ArenaMap {
  sky: number;
  ground: number;
  accent: number;
  grid: number;
  ambient: number;
}

export const EMPTY_ARENA: ArenaMap = {
  sky: 0x101519,
  ground: 0x39443c,
  accent: 0x647363,
  grid: 0xc3f47c,
  ambient: 0xd3dfd0,
};

export function buildMap(scene: THREE.Scene, map: ArenaMap): void {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(84, 84),
    new THREE.MeshStandardMaterial({ color: map.ground, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.05;
  scene.add(floor);

  const minorGrid = new THREE.GridHelper(84, 42, map.accent, map.accent);
  minorGrid.position.y = -0.04;
  scene.add(minorGrid);

  const majorGrid = new THREE.GridHelper(84, 21, map.grid, map.grid);
  majorGrid.position.y = -0.035;
  scene.add(majorGrid);

  scene.add(new THREE.HemisphereLight(map.ambient, map.accent, 1.6));
  const light = new THREE.DirectionalLight(map.ambient, 1.4);
  light.position.set(-18, 34, 16);
  scene.add(light);

  scene.background = new THREE.Color(map.sky);
}
