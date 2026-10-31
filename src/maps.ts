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
  sky: 0x0a131d,
  ground: 0x18232b,
  accent: 0x91b7c3,
  grid: 0x36505d,
  ambient: 0xc9d8d8,
};

export function buildMap(scene: THREE.Scene, map: ArenaMap): void {
  const floorSize = ARENA_GRID_SIZE * GRID_UNIT_SIZE;
  const sky = map.sky || 0x0a131d;
  const ground = map.ground || 0x18232b;
  const gridColor = map.grid || 0x36505d;
  const accent = map.accent || 0x718895;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(floorSize, floorSize),
    new THREE.MeshStandardMaterial({ color: ground, roughness: 0.92, metalness: 0.04 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.05;
  floor.receiveShadow = true;
  scene.add(floor);

  const unitGrid = new THREE.GridHelper(floorSize, ARENA_GRID_SIZE / 2, accent, gridColor);
  unitGrid.position.y = -0.04;
  const gridMaterials = Array.isArray(unitGrid.material) ? unitGrid.material : [unitGrid.material];
  gridMaterials.forEach((material) => {
    material.transparent = true;
    material.opacity = 0.34;
    material.depthWrite = false;
  });
  scene.add(unitGrid);

  scene.add(new THREE.HemisphereLight(map.ambient || 0xb9d5e2, ground, 1.45));
  const light = new THREE.DirectionalLight(map.ambient || 0xffe2b0, 2.1);
  light.position.set(-18, 34, 16);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.left = -35;
  light.shadow.camera.right = 35;
  light.shadow.camera.top = 35;
  light.shadow.camera.bottom = -35;
  light.shadow.bias = -0.0004;
  scene.add(light);

  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, 48, 115);

  // Low profile corner pylons give the otherwise open arena a readable silhouette.
  const pylonMaterial = new THREE.MeshStandardMaterial({
    color: accent,
    roughness: 0.48,
    metalness: 0.28,
    emissive: accent,
    emissiveIntensity: 0.08,
  });
  const pylonGeometry = new THREE.CylinderGeometry(0.32, 0.48, 4.8, 6);
  const inset = floorSize / 2 - 3;
  for (const x of [-inset, inset]) {
    for (const z of [-inset, inset]) {
      const pylon = new THREE.Mesh(pylonGeometry, pylonMaterial);
      pylon.position.set(x, 2.35, z);
      pylon.castShadow = true;
      pylon.receiveShadow = true;
      scene.add(pylon);
    }
  }
}
