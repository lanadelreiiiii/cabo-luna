// Cabo Luna — three.js scene: sun-soaked day over a coastal city.
// Warm directional sun + hemisphere light, blue sky gradient, soft fog,
// one shadow-casting sun. Buildings share one InstancedMesh whose facade
// texture is painted on a canvas (lit windows, not blank boxes).
import * as THREE from 'three';
import { CAMERA } from './config.js';

// Canvas facade: warm wall tint base with a grid of sunlit windows.
function facadeTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#3d5a78';
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 10 + col * 30, y = 12 + row * 30;
      g.fillStyle = (row + col) % 3 === 0 ? '#ffd98a' : '#35506e';
      g.fillRect(x, y, 20, 18);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(x, y, 20, 4);
    }
  }
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 0, 128, 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Vertical sky gradient as a big inverted sphere — reads as sunset-day
// blue at the top, warm haze at the horizon.
function skyDome() {
  const geo = new THREE.SphereGeometry(900, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x3f7fd0) },
      mid: { value: new THREE.Color(0x9cc8e8) },
      low: { value: new THREE.Color(0xffd9a0) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 low; void main(){ float h = normalize(vP).y; vec3 c = h > 0.25 ? mix(mid, top, smoothstep(0.25, 0.8, h)) : mix(low, mid, smoothstep(-0.05, 0.25, h)); gl_FragColor = vec4(c, 1.0); }',
  });
  return new THREE.Mesh(geo, mat);
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

export function buildScene(city) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xa8c8e0, 220, 700);

  const hemi = new THREE.HemisphereLight(0xcfe5ff, 0x9a7f56, 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe7b8, 2.8);
  sun.position.set(180, 220, 90);
  sun.castShadow = true;
  sun.shadow.camera.left = -200; sun.shadow.camera.right = 200;
  sun.shadow.camera.top = 200; sun.shadow.camera.bottom = -200;
  sun.shadow.camera.far = 700;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);
  scene.add(skyDome());

  const half = city.half, size = city.size;

  // Ground: city grass-concrete base, then roads, sidewalks, sand, ocean.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size + 700, size + 200),
    new THREE.MeshLambertMaterial({ color: 0x8a9a6a }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-60, 0, 0);
  ground.receiveShadow = true;
  scene.add(ground);

  const roadMat = new THREE.MeshLambertMaterial({ color: 0x4a4a52 });
  const walkMat = new THREE.MeshLambertMaterial({ color: 0xb9b2a0 });
  for (const line of city.roadLines) {
    for (const horizontal of [true, false]) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(size, city.roadWidth), roadMat);
      road.rotation.x = -Math.PI / 2;
      if (horizontal) { road.position.set(0, 0.02, line); }
      else { road.rotation.z = Math.PI / 2; road.position.set(line, 0.02, 0); }
      road.receiveShadow = true;
      scene.add(road);
      // Sidewalks: pale strips hugging each road edge.
      for (const off of [-1, 1]) {
        const walk = new THREE.Mesh(new THREE.PlaneGeometry(size, 2.4), walkMat);
        walk.rotation.x = -Math.PI / 2;
        if (horizontal) { walk.position.set(0, 0.03, line + off * (city.roadWidth / 2 + 1.2)); }
        else { walk.rotation.z = Math.PI / 2; walk.position.set(line + off * (city.roadWidth / 2 + 1.2), 0.03, 0); }
        walk.receiveShadow = true;
        scene.add(walk);
      }
    }
  }

  // Beach sand + ocean on the west edge.
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(26, size + 40),
    new THREE.MeshLambertMaterial({ color: 0xe8d5a4 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(-half - 13, 0.04, 0);
  sand.receiveShadow = true;
  scene.add(sand);
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(320, size + 400),
    new THREE.MeshLambertMaterial({ color: 0x2e7fb8 }),
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(-half - 26 - 160, 0.01, 0);
  scene.add(ocean);

  // Plaza court.
  for (const p of city.plazas) {
    const court = new THREE.Mesh(
      new THREE.PlaneGeometry(p.size, p.size),
      new THREE.MeshLambertMaterial({ color: 0xd8cba8 }),
    );
    court.rotation.x = -Math.PI / 2;
    court.position.set(p.x, 0.05, p.z);
    court.receiveShadow = true;
    scene.add(court);
    const fountain = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3.4, 1.1, 20),
      new THREE.MeshLambertMaterial({ color: 0x9db8c4 }),
    );
    fountain.position.set(p.x, 0.55, p.z);
    fountain.castShadow = true;
    scene.add(fountain);
  }

  // Buildings: one InstancedMesh, window facade texture, per-instance tint.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const boxMat = new THREE.MeshLambertMaterial({ map: facadeTexture() });
  const inst = new THREE.InstancedMesh(boxGeo, boxMat, city.buildings.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  const s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  city.buildings.forEach((b, i) => {
    p.set(b.x, b.h / 2, b.z); s.set(b.w, b.h, b.d);
    m.compose(p, q, s);
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, col.setHex(b.color));
  });
  inst.castShadow = true;
  inst.receiveShadow = true;
  scene.add(inst);

  // Faro de Cabo Luna — striped lighthouse tower on the beachfront.
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 3.4, city.landmark.h, 16),
    new THREE.MeshLambertMaterial({ color: 0xf2ead8 }),
  );
  tower.position.set(city.landmark.x, city.landmark.h / 2, city.landmark.z);
  tower.castShadow = true;
  scene.add(tower);
  const lampRoom = new THREE.Mesh(
    new THREE.CylinderGeometry(2.0, 2.0, 3, 16),
    new THREE.MeshLambertMaterial({ color: 0x2c3e50, emissive: 0xffd98a, emissiveIntensity: 0.7 }),
  );
  lampRoom.position.set(city.landmark.x, city.landmark.h + 1.5, city.landmark.z);
  scene.add(lampRoom);

  // Palms: instanced trunks + instanced canopies.
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.35, 1, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6a48 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, city.palms.length);
  const canopyGeo = new THREE.ConeGeometry(2.2, 2.4, 7);
  const canopyMat = new THREE.MeshLambertMaterial({ color: 0x3f8a4a });
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, city.palms.length);
  city.palms.forEach((t, i) => {
    p.set(t.x, t.h / 2, t.z); s.set(1, t.h, 1);
    m.compose(p, q, s); trunks.setMatrixAt(i, m);
    p.set(t.x, t.h + 1.1, t.z); s.set(1, 1, 1);
    m.compose(p, q, s); canopies.setMatrixAt(i, m);
  });
  trunks.castShadow = true;
  scene.add(trunks); scene.add(canopies);

  // Street lamps: instanced poles + glowing heads.
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3a40 });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, city.lamps.length);
  const headGeo = new THREE.SphereGeometry(0.28, 8, 6);
  const headMat = new THREE.MeshLambertMaterial({ color: 0xfff2c0, emissive: 0xffe9a0, emissiveIntensity: 0.5 });
  const heads = new THREE.InstancedMesh(headGeo, headMat, city.lamps.length);
  city.lamps.forEach((t, i) => {
    p.set(t.x, 2.5, t.z); s.set(1, 1, 1);
    m.compose(p, q, s); poles.setMatrixAt(i, m);
    p.set(t.x, 5.1, t.z);
    m.compose(p, q, s); heads.setMatrixAt(i, m);
  });
  scene.add(poles); scene.add(heads);

  return { scene, sun };
}

// Player: a simple sun-lit figure — body capsule, head, cap — so the
// third-person camera always has something to follow.
export function createPlayerMesh(scene) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.42, 0.85, 4, 10),
    new THREE.MeshLambertMaterial({ color: 0xd94f3d }),
  );
  body.position.y = 1.0; body.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 12, 10),
    new THREE.MeshLambertMaterial({ color: 0xe8b98a }),
  );
  head.position.y = 1.95; head.castShadow = true;
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 0.1, 12),
    new THREE.MeshLambertMaterial({ color: 0x2c4a6e }),
  );
  cap.position.y = 2.18;
  group.add(body, head, cap);
  scene.add(group);
  return group;
}

// Third-person follow camera: orbit yaw/pitch around the player.
export function updateCamera(camera, playerState, shotCam) {
  const dist = CAMERA.distance, h = CAMERA.height;
  const yaw = playerState.yaw, pitch = playerState.pitch;
  let cx, cy, cz, tx, ty, tz;
  if (shotCam) {
    cx = shotCam.x; cy = shotCam.y; cz = shotCam.z;
    tx = shotCam.tx; ty = shotCam.ty; tz = shotCam.tz;
  } else {
    const cd = dist * Math.cos(pitch);
    cx = playerState.x + Math.sin(yaw) * cd;
    cy = playerState.y + h + dist * Math.sin(pitch);
    cz = playerState.z + Math.cos(yaw) * cd;
    tx = playerState.x; ty = playerState.y + 1.4; tz = playerState.z;
  }
  camera.position.set(cx, cy, cz);
  camera.lookAt(tx, ty, tz);
}

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
