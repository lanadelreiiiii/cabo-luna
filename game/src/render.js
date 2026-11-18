// Cabo Luna — three.js scene: sun-soaked day over a coastal city.
// Warm directional sun + hemisphere light, blue sky gradient, soft fog,
// one shadow-casting sun. Buildings share one InstancedMesh whose facade
// texture is painted on a canvas (lit windows, not blank boxes).
import * as THREE from 'three';
import { CAMERA, resolveShadow } from './config.js';
import { gradeFor } from './visual-grades.js';
import { GARAGE, SAFEHOUSE } from './city-remembers.js';

// Canvas facade per district kind: a warm wall tint base with a grid of
// sunlit windows, drawn differently per kind so districts read apart
// at 768x480 — downtown is glassy blue-grey, old town warm with
// shutters, market has an awning stripe at the base, harbour is
// corrugated, beach pastel with balconies, hills pale stone.
function facadeTexture(kind) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 256);
  if (kind === 'harbour') {
    // Corrugated warehouse: horizontal ribs, few small windows.
    g.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 0; y < 256; y += 16) g.fillRect(0, y, 128, 3);
    g.fillStyle = '#35506e';
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        g.fillStyle = (row + col) % 2 === 0 ? '#ffd98a' : '#35506e';
        g.fillRect(10 + col * 30, 30 + row * 70, 20, 18);
      }
    }
  } else if (kind === 'market') {
    g.fillStyle = '#3d5a78';
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 4; col++) {
        g.fillStyle = (row + col) % 3 === 0 ? '#ffd98a' : '#35506e';
        g.fillRect(10 + col * 30, 12 + row * 34, 20, 18);
      }
    }
    // Awning stripe along the base: the shopfront band.
    g.fillStyle = '#d94f3d';
    g.fillRect(0, 224, 128, 32);
    g.fillStyle = '#ffd23d';
    for (let x = 0; x < 128; x += 16) g.fillRect(x, 224, 8, 32);
  } else {
    const rows = kind === 'downtown' ? 10 : 8;
    const rh = 256 / rows;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < 4; col++) {
        const x = 10 + col * 30, y = 8 + row * rh;
        g.fillStyle = (row + col) % 3 === 0 ? '#ffd98a' : (kind === 'downtown' ? '#2c4258' : '#35506e');
        g.fillRect(x, y, 20, Math.min(18, rh - 8));
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.fillRect(x, y, 20, 4);
        if (kind === 'oldtown' || kind === 'beach') {
          // Shutter / balcony bar under the window.
          g.fillStyle = 'rgba(0,0,0,0.25)';
          g.fillRect(x, y + Math.min(18, rh - 8), 20, 3);
        }
      }
    }
  }
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 0, 128, 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Paver texture for the block slabs: a pale grid + a few darker pavers
// so a 40 m slab reads as a paved yard / plaza, not an empty void.
// The material colour is white; the district tint comes from the
// per-instance colour, multiplied over this pattern.
function slabTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(0,0,0,0.10)';
  for (let x = 0; x <= 128; x += 16) { g.fillRect(x, 0, 1, 128); g.fillRect(0, x, 128, 1); }
  g.fillStyle = 'rgba(0,0,0,0.07)';
  for (let i = 0; i < 12; i++) {
    const px = (i * 37) % 8 * 16, py = (i * 53) % 8 * 16;
    g.fillRect(px, py, 16, 16);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  return tex;
}
// canvas; each sign plane samples its own slice via UV offsets, so
// ~20 named signs cost one texture and no extra material.
const SIGN_NAMES = [
  'CAFÉ LUNA', 'HELADERÍA BRISA', 'SURF SOL', 'BAR EL FARO',
  'TIENDA LUNA', 'FARMACIA SOL', 'CAFÉ ARENA', 'LIBRERÍA VELA',
  'LIBRERÍA ARENA', 'PANADERÍA SOL', 'MERCADO SOL', 'FLORERÍA ROSA',
  'CARNICERÍA MAR', 'PESCADERÍA MAR', 'BODEGA LUNA', 'TALLER BRISA',
  'TACOS DEL MAR',
];
function signAtlas() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32 * SIGN_NAMES.length;
  const g = c.getContext('2d');
  g.fillStyle = '#20242c';
  g.fillRect(0, 0, c.width, c.height);
  // Sign lettering, 26 px bold: at 20 px the shop names dissolved
  // into grey smudges at 768x480; the bigger glyphs stay readable.
  g.font = 'bold 26px sans-serif';
  g.textBaseline = 'middle';
  SIGN_NAMES.forEach((name, i) => {
    g.fillStyle = i % 2 === 0 ? '#ffd98a' : '#e8e8e8';
    g.fillText(name, 10, i * 32 + 16);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Vertical sky gradient as a big inverted sphere — reads as sunset-day
// blue at the top, warm haze at the horizon. Colours come from the
// active visual grade.
function skyDome(grade) {
  const geo = new THREE.SphereGeometry(900, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(grade.sky.top) },
      mid: { value: new THREE.Color(grade.sky.mid) },
      low: { value: new THREE.Color(grade.sky.low) },
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

export function buildScene(city, gradeName, shadowName) {
  const grade = gradeFor(gradeName);
  // Day 4F: shadow configuration (?shadow=A|B|C); A is the baseline.
  const sh = resolveShadow(shadowName);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(grade.fog.color, grade.fog.near, grade.fog.far);

  const hemi = new THREE.HemisphereLight(grade.hemi.sky, grade.hemi.ground, grade.hemi.intensity);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(grade.sun.color, grade.sun.intensity);
  sun.position.set(...grade.sun.position);
  sun.castShadow = true;
  sun.shadow.camera.left = -sh.bounds; sun.shadow.camera.right = sh.bounds;
  sun.shadow.camera.top = sh.bounds; sun.shadow.camera.bottom = -sh.bounds;
  sun.shadow.camera.far = sh.far;
  sun.shadow.mapSize.set(sh.mapSize, sh.mapSize);
  scene.add(sun);
  scene.add(skyDome(grade));

  const half = city.half, size = city.size;

  // Ground: dry warm earth. The old olive-green base read as a flat
  // green strip at the horizon past the city edge.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size + 700, size + 200),
    new THREE.MeshLambertMaterial({ color: 0xbfae8e }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-60, 0, 0);
  ground.receiveShadow = true;
  scene.add(ground);

  // Block slabs: one paved slab per block, tinted by district, so the
  // blocks read as built-up city instead of flat green lawn (the 4B
  // shots' biggest emptiness was the green between the buildings).
  const SLAB_TINTS = {
    beach: 0xdcc49a, downtown: 0x9aa0a8, oldtown: 0xc9a06a,
    market: 0xc08a6a, hills: 0xb5ac96, harbour: 0x8a9296,
  };
  {
    const slabGeo = new THREE.PlaneGeometry(city.blockSize, city.blockSize);
    const slabMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: slabTexture() });
    const slabs = new THREE.InstancedMesh(slabGeo, slabMat, city.blocks * city.blocks);
    const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion();
    const s3 = new THREE.Vector3(1, 1, 1), p3 = new THREE.Vector3();
    const col3 = new THREE.Color();
    const rotX = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    let si = 0;
    for (let bx = 0; bx < city.blocks; bx++) {
      for (let bz = 0; bz < city.blocks; bz++) {
        const cx = -half + city.roadWidth + city.blockSize / 2 + bx * city.cell;
        const cz = -half + city.roadWidth + city.blockSize / 2 + bz * city.cell;
        p3.set(cx, 0.012, cz);
        m4.compose(p3, rotX, s3);
        slabs.setMatrixAt(si, m4);
        const kind = (city.buildings.find((b) => b.blockX === bx && b.blockZ === bz) || {}).kind
          || (bx === 2 && bz === 4 ? 'oldtown' : 'oldtown');
        slabs.setColorAt(si, col3.setHex(SLAB_TINTS[kind] ?? 0xb5ac96));
        si += 1;
      }
    }
    slabs.count = si;
    slabs.receiveShadow = true;
    scene.add(slabs);
  }

  // Roads + sidewalks: instanced planes (was 14 road + 56 sidewalk
  // meshes; now 2 draw calls) so the density budget can go to props.
  {
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x4a4a52 });
    const walkMat = new THREE.MeshLambertMaterial({ color: 0xb9b2a0 });
    const roadGeo = new THREE.PlaneGeometry(size, city.roadWidth);
    const walkGeo = new THREE.PlaneGeometry(size, 2.4);
    const roads = new THREE.InstancedMesh(roadGeo, roadMat, city.roadLines.length * 2);
    const walks = new THREE.InstancedMesh(walkGeo, walkMat, city.roadLines.length * 4);
    const m4 = new THREE.Matrix4(), p3 = new THREE.Vector3(), s3 = new THREE.Vector3(1, 1, 1);
    const rotFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const rotVert = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2));
    let ri = 0, wi = 0;
    for (const line of city.roadLines) {
      p3.set(0, 0.02, line); m4.compose(p3, rotFlat, s3); roads.setMatrixAt(ri++, m4);
      p3.set(line, 0.02, 0); m4.compose(p3, rotVert, s3); roads.setMatrixAt(ri++, m4);
      for (const off of [-1, 1]) {
        p3.set(0, 0.03, line + off * (city.roadWidth / 2 + 1.2));
        m4.compose(p3, rotFlat, s3); walks.setMatrixAt(wi++, m4);
        p3.set(line + off * (city.roadWidth / 2 + 1.2), 0.03, 0);
        m4.compose(p3, rotVert, s3); walks.setMatrixAt(wi++, m4);
      }
    }
    roads.count = ri; walks.count = wi;
    roads.receiveShadow = true; walks.receiveShadow = true;
    scene.add(roads, walks);
  }

  // Road markings: centre dashes + zebra stripes + stop lines, one
  // InstancedMesh of flat white boxes — the street reads at 768x480.
  {
    const markGeo = new THREE.BoxGeometry(1, 1, 1);
    const markMat = new THREE.MeshLambertMaterial({ color: 0xe8e8e8 });
    const total = city.laneDashes.length + city.crosswalks.length + city.stopLines.length;
    const marks = new THREE.InstancedMesh(markGeo, markMat, Math.max(1, total));
    const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion();
    const p3 = new THREE.Vector3(), s3 = new THREE.Vector3();
    // Per-instance colours: the zebra stripes are dimmed to mid-grey
    // (full white blew out the whole foreground of the driving shots)
    // and narrowed a touch. Every instance gets an explicit colour —
    // setColorAt allocates a zero-filled buffer, so anything left
    // unset would render black.
    const markCol = new THREE.Color();
    let mi = 0;
    const put = (x, z, sx, sz) => {
      p3.set(x, 0.045, z); s3.set(sx, 0.02, sz);
      m4.compose(p3, q0, s3); marks.setMatrixAt(mi, m4);
      marks.setColorAt(mi, markCol.setHex(0xffffff));
      mi += 1;
    };
    const putZebra = (x, z, sx, sz) => {
      p3.set(x, 0.045, z); s3.set(sx, 0.02, sz);
      m4.compose(p3, q0, s3); marks.setMatrixAt(mi, m4);
      marks.setColorAt(mi, markCol.setHex(0x8f8f8f));
      mi += 1;
    };
    for (const d of city.laneDashes) {
      if (d.axis === 'x') put(d.x, d.z, 3, 0.25); else put(d.x, d.z, 0.25, 3);
    }
    for (const c of city.crosswalks) {
      if (c.axis === 'x') putZebra(c.x, c.z, 0.5, 2.8); else putZebra(c.x, c.z, 2.8, 0.5);
    }
    for (const s of city.stopLines) {
      if (s.axis === 'x') put(s.x, s.z, 4.5, 0.5); else put(s.x, s.z, 0.5, 4.5);
    }
    marks.count = mi;
    marks.receiveShadow = true;
    scene.add(marks);
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
    fountain.castShadow = sh.casters.fountain;
    scene.add(fountain);
  }

  // Buildings: one InstancedMesh per district kind, each with its own
  // facade texture, per-instance wall tint. Six kinds = six draw
  // calls, and the districts finally read differently.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    const byKind = new Map();
    for (const b of city.buildings) {
      if (!byKind.has(b.kind)) byKind.set(b.kind, []);
      byKind.get(b.kind).push(b);
    }
    for (const [kind, list] of byKind) {
      const boxMat = new THREE.MeshLambertMaterial({ map: facadeTexture(kind) });
      const inst = new THREE.InstancedMesh(boxGeo, boxMat, list.length);
      list.forEach((b, i) => {
        p.set(b.x, b.h / 2, b.z); s.set(b.w, b.h, b.d);
        m.compose(p, q, s);
        inst.setMatrixAt(i, m);
        inst.setColorAt(i, col.setHex(b.color));
      });
      inst.castShadow = sh.casters.buildings;
      inst.receiveShadow = true;
      scene.add(inst);
    }
    // Roofs: stepped caps for downtown, pitched pyramids for gable
    // roofs, flat inset slabs for market/harbour — the skyline stops
    // being a row of flat boxes.
    const caps = city.buildings.filter((b) => b.roof === 'cap' || b.roof === 'flat');
    const gables = city.buildings.filter((b) => b.roof === 'gable');
    if (caps.length > 0) {
      const capMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const capMesh = new THREE.InstancedMesh(boxGeo, capMat, caps.length);
      caps.forEach((b, i) => {
        const inset = b.roof === 'cap' ? 0.62 : 0.94;
        p.set(b.x, b.h + (b.roof === 'cap' ? 1.1 : 0.25), b.z);
        s.set(b.w * inset, b.roof === 'cap' ? 2.2 : 0.5, b.d * inset);
        m.compose(p, q, s);
        capMesh.setMatrixAt(i, m);
        capMesh.setColorAt(i, col.setHex(b.roofColor));
      });
      capMesh.castShadow = sh.casters.roofCaps;
      scene.add(capMesh);
    }
    if (gables.length > 0) {
      const pyrGeo = new THREE.ConeGeometry(1, 1, 4);
      const pyrMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const pyr = new THREE.InstancedMesh(pyrGeo, pyrMat, gables.length);
      const rotY = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0));
      gables.forEach((b, i) => {
        p.set(b.x, b.h + Math.min(b.w, b.d) * 0.14, b.z);
        s.set(Math.max(b.w, b.d) * 0.72, Math.min(b.w, b.d) * 0.28, Math.max(b.w, b.d) * 0.72);
        m.compose(p, rotY, s);
        pyr.setMatrixAt(i, m);
        pyr.setColorAt(i, col.setHex(b.roofColor));
      });
      pyr.castShadow = sh.casters.roofCaps;
      scene.add(pyr);
    }
  }

  // Faro de Cabo Luna — striped lighthouse tower on the beachfront.
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 3.4, city.landmark.h, 16),
    new THREE.MeshLambertMaterial({ color: 0xf2ead8 }),
  );
  tower.position.set(city.landmark.x, city.landmark.h / 2, city.landmark.z);
  tower.castShadow = sh.casters.lighthouse;
  scene.add(tower);
  const lampRoom = new THREE.Mesh(
    new THREE.CylinderGeometry(2.0, 2.0, 3, 16),
    new THREE.MeshLambertMaterial({ color: 0x2c3e50, emissive: 0xffd98a, emissiveIntensity: 0.7 }),
  );
  lampRoom.position.set(city.landmark.x, city.landmark.h + 1.5, city.landmark.z);
  scene.add(lampRoom);

  // Palms: instanced trunks + instanced canopies.
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  const s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.35, 1, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6a48 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, city.palms.length);
  // Palm crowns: squashed spheres, not cones — the old cone canopy
  // read as a pine-cone at 768x480.
  const canopyGeo = new THREE.SphereGeometry(2.2, 10, 8);
  const canopyMat = new THREE.MeshLambertMaterial({ color: 0x3f8a4a });
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, city.palms.length);
  city.palms.forEach((t, i) => {
    p.set(t.x, t.h / 2, t.z); s.set(1, t.h, 1);
    m.compose(p, q, s); trunks.setMatrixAt(i, m);
    p.set(t.x, t.h + 0.9, t.z); s.set(1.15, 0.55, 1.15);
    m.compose(p, q, s); canopies.setMatrixAt(i, m);
  });
  trunks.castShadow = sh.casters.palmTrunks;
  scene.add(trunks); scene.add(canopies);

  // Street lamps: instanced poles + glowing heads. Staggered corners
  // (city.js) and a shorter 4.6 m pole keep them out of the driving
  // camera's foreground; the head glows with the grade's lampGlow.
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 4.6, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3a40 });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, city.lamps.length);
  const headGeo = new THREE.SphereGeometry(0.22, 8, 6);
  const headMat = new THREE.MeshLambertMaterial({ color: 0xfff2c0, emissive: 0xffe9a0, emissiveIntensity: grade.lampGlow });
  const heads = new THREE.InstancedMesh(headGeo, headMat, city.lamps.length);
  city.lamps.forEach((t, i) => {
    p.set(t.x, 2.3, t.z); s.set(1, 1, 1);
    m.compose(p, q, s); poles.setMatrixAt(i, m);
    p.set(t.x, 4.7, t.z);
    m.compose(p, q, s); heads.setMatrixAt(i, m);
  });
  scene.add(poles); scene.add(heads);

  // Broadleaf trees: instanced trunks + spherical canopies, per-tree
  // green tint — the hills / old town / market blocks get shade that
  // palms alone never gave them.
  if (city.trees.length > 0) {
    const treeTrunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1, 6);
    const treeTrunkMat = new THREE.MeshLambertMaterial({ color: 0x6a4a30 });
    const treeTrunks = new THREE.InstancedMesh(treeTrunkGeo, treeTrunkMat, city.trees.length);
    const treeCanopyGeo = new THREE.SphereGeometry(1.6, 10, 8);
    const treeCanopyMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const treeCanopies = new THREE.InstancedMesh(treeCanopyGeo, treeCanopyMat, city.trees.length);
    city.trees.forEach((t, i) => {
      p.set(t.x, t.h / 2, t.z); s.set(1, t.h, 1);
      m.compose(p, q, s); treeTrunks.setMatrixAt(i, m);
      p.set(t.x, t.h + 0.9, t.z); s.set(1, 1, 1);
      m.compose(p, q, s); treeCanopies.setMatrixAt(i, m);
      treeCanopies.setColorAt(i, col.setHex(t.canopy));
    });
    treeTrunks.castShadow = sh.casters.treeTrunks;
    scene.add(treeTrunks, treeCanopies);
  }

  // Street furniture: benches (seat + back, one InstancedMesh) and
  // planters (terracotta boxes) along the sidewalks.
  if (city.benches.length > 0) {
    const benchGeo = new THREE.BoxGeometry(1, 1, 1);
    const benchMat = new THREE.MeshLambertMaterial({ color: 0x7a5a3a });
    const benchMesh = new THREE.InstancedMesh(benchGeo, benchMat, city.benches.length * 2);
    let bi = 0;
    const rotB = new THREE.Quaternion();
    for (const b of city.benches) {
      rotB.setFromEuler(new THREE.Euler(0, b.heading, 0));
      p.set(b.x, 0.45, b.z); s.set(2.2, 0.12, 0.6);
      m.compose(p, rotB, s); benchMesh.setMatrixAt(bi++, m);
      p.set(b.x, 0.75, b.z - Math.cos(b.heading) * 0.3); s.set(2.2, 0.6, 0.1);
      m.compose(p, rotB, s); benchMesh.setMatrixAt(bi++, m);
    }
    benchMesh.count = bi;
    scene.add(benchMesh);
  }
  if (city.planters.length > 0) {
    const planterGeo = new THREE.BoxGeometry(1.4, 0.7, 1.4);
    const planterMat = new THREE.MeshLambertMaterial({ color: 0xa8542f });
    const planterMesh = new THREE.InstancedMesh(planterGeo, planterMat, city.planters.length);
    city.planters.forEach((t, i) => {
      p.set(t.x, 0.35, t.z); s.set(1, 1, 1);
      m.compose(p, q, s); planterMesh.setMatrixAt(i, m);
    });
    scene.add(planterMesh);
  }

  // Shopfronts: coloured awning boxes on the block edge facing the
  // road, a dark sign board above each, and the shop's painted name
  // on a plane sampling the shared sign atlas (one texture, original
  // names only — CAFÉ LUNA, PESCADERÍA MAR, TALLER BRISA, …).
  if (city.shops.length > 0) {
    const awnGeo = new THREE.BoxGeometry(1, 1, 1);
    const awnMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const awnings = new THREE.InstancedMesh(awnGeo, awnMat, city.shops.length);
    const boardGeo = new THREE.BoxGeometry(1, 1, 1);
    const boardMat = new THREE.MeshLambertMaterial({ color: 0x20242c });
    const boards = new THREE.InstancedMesh(boardGeo, boardMat, city.shops.length);
    // These two meshes used to ship with NO matrices at all, so every
    // instance sat as a 1 m identity box at the world origin — one
    // white, one dark, half-buried at (0, 0, 0), which projects
    // inside the vista frame. Give each shop a real awning (its own
    // colour, jutting toward the road below the sign) and a real dark
    // board backing the name plane.
    {
      const awnCol = new THREE.Color();
      city.shops.forEach((shop, i) => {
        p.set(shop.x, 3.0, shop.z + 0.55); s.set(5.0, 0.3, 1.3);
        m.compose(p, q, s); awnings.setMatrixAt(i, m);
        awnings.setColorAt(i, awnCol.setHex(shop.awning));
        p.set(shop.x, 3.6, shop.z + 0.6); s.set(5.2, 0.85, 0.12);
        m.compose(p, q, s); boards.setMatrixAt(i, m);
      });
      awnings.instanceMatrix.needsUpdate = true;
      boards.instanceMatrix.needsUpdate = true;
      if (awnings.instanceColor) awnings.instanceColor.needsUpdate = true;
    }
    const atlas = signAtlas();
    const signMat = new THREE.MeshBasicMaterial({ map: atlas });
    // All name planes merged into ONE geometry (one draw call, not one
    // per shop): each quad is positioned at its board face with the UV
    // slice of its name's atlas row.
    {
      const pos = [], uv = [], idx = [];
      let vi = 0;
      for (const shop of city.shops) {
        const sIdx = SIGN_NAMES.indexOf(shop.name);
        const y0 = 1 - (sIdx + 1) / SIGN_NAMES.length;
        const y1 = 1 - sIdx / SIGN_NAMES.length;
        const cx = shop.x, cy = 3.6, cz = shop.z + 0.72;
        // Wider/taller name plane (4.2 -> 5.0 m) to match the bigger
        // atlas lettering.
        const hw = 2.5, hh = 0.34;
        pos.push(cx - hw, cy + hh, cz, cx + hw, cy + hh, cz, cx - hw, cy - hh, cz, cx + hw, cy - hh, cz);
        uv.push(0, y1, 1, y1, 0, y0, 1, y0);
        // Winding flipped: the old (0,1,2) order gave a -z normal, so
        // the signs faced INTO the block and were backface-culled
        // from the road — no sign was ever visible. The front face
        // must point +z (south, toward the road).
        idx.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3);
        vi += 4;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      scene.add(new THREE.Mesh(geo, signMat));
    }
    scene.add(awnings, boards);
  }

  // Parked cars in the kerb bays: instanced bodies + cabins + wheels,
  // reusing the vehicle geometry — the streets stop looking empty
  // even where no traffic car happens to be.
  if (city.parkedCars.length > 0) {
    const cap = city.parkedCars.length;
    const pBodies = new THREE.InstancedMesh(CAR_BODY_GEO, new THREE.MeshLambertMaterial({ color: 0xffffff }), cap);
    const pCabins = new THREE.InstancedMesh(CAR_CABIN_GEO, new THREE.MeshLambertMaterial({ color: 0x2c3e50 }), cap);
    const pWheels = new THREE.InstancedMesh(WHEEL_GEO, WHEEL_MAT, cap * 4);
    const rotP = new THREE.Quaternion();
    const wheelQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
    const wheelRot = new THREE.Quaternion();
    let pwi = 0;
    city.parkedCars.forEach((c, i) => {
      const len = c.kind === 'sport' ? 4.4 : 4.2;
      const wid = 1.95;
      rotP.setFromEuler(new THREE.Euler(0, c.heading, 0));
      p.set(c.x, 0.62, c.z); s.set(wid, 0.62, len);
      m.compose(p, rotP, s); pBodies.setMatrixAt(i, m);
      pBodies.setColorAt(i, col.setHex(c.color));
      p.set(c.x - Math.sin(c.heading) * len * 0.08, 1.18, c.z - Math.cos(c.heading) * len * 0.08);
      s.set(wid * 0.82, 0.55, len * 0.45);
      m.compose(p, rotP, s); pCabins.setMatrixAt(i, m);
      const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
      const rx = -fz, rz = fx;
      wheelRot.copy(rotP).multiply(wheelQ);
      for (const [ox, oz] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]) {
        p.set(c.x + rx * ox + fx * oz, 0.36, c.z + rz * ox + fz * oz);
        s.set(1, 1, 1);
        m.compose(p, wheelRot, s); pWheels.setMatrixAt(pwi++, m);
      }
    });
    pBodies.castShadow = sh.casters.parkedBodies;
    pWheels.count = pwi;
    scene.add(pBodies, pCabins, pWheels);
  }

  // Harbour details, Puerto Luna: crates, containers, bollards along
  // the water edge, buoys out in the bay.
  if (city.crates.length > 0) {
    const crateGeo = new THREE.BoxGeometry(1, 1, 1);
    const crateMat = new THREE.MeshLambertMaterial({ color: 0xb08a5a });
    const crateMesh = new THREE.InstancedMesh(crateGeo, crateMat, city.crates.length);
    city.crates.forEach((t, i) => {
      p.set(t.x, t.s / 2, t.z); s.set(t.s, t.s, t.s);
      m.compose(p, q, s); crateMesh.setMatrixAt(i, m);
    });
    crateMesh.castShadow = sh.casters.crates;
    scene.add(crateMesh);
  }
  if (city.containers.length > 0) {
    const contGeo = new THREE.BoxGeometry(1, 1, 1);
    const contMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const contMesh = new THREE.InstancedMesh(contGeo, contMat, city.containers.length);
    const rotC = new THREE.Quaternion();
    city.containers.forEach((t, i) => {
      rotC.setFromEuler(new THREE.Euler(0, t.heading, 0));
      p.set(t.x, 1.3, t.z); s.set(6, 2.6, 2.6);
      m.compose(p, rotC, s); contMesh.setMatrixAt(i, m);
      contMesh.setColorAt(i, col.setHex(t.color));
    });
    contMesh.castShadow = sh.casters.containers;
    scene.add(contMesh);
  }
  if (city.bollards.length > 0) {
    const bolGeo = new THREE.CylinderGeometry(0.28, 0.32, 1.0, 8);
    const bolMat = new THREE.MeshLambertMaterial({ color: 0x2c3e50 });
    const bolMesh = new THREE.InstancedMesh(bolGeo, bolMat, city.bollards.length);
    city.bollards.forEach((t, i) => {
      p.set(t.x, 0.5, t.z); s.set(1, 1, 1);
      m.compose(p, q, s); bolMesh.setMatrixAt(i, m);
    });
    scene.add(bolMesh);
  }
  if (city.buoys.length > 0) {
    const buoyGeo = new THREE.SphereGeometry(0.7, 10, 8);
    const buoyMat = new THREE.MeshLambertMaterial({ color: 0xd94f3d, emissive: 0x801010, emissiveIntensity: 0.4 });
    const buoyMesh = new THREE.InstancedMesh(buoyGeo, buoyMat, city.buoys.length);
    city.buoys.forEach((t, i) => {
      p.set(t.x, 0.1, t.z); s.set(1, 1, 1);
      m.compose(p, q, s); buoyMesh.setMatrixAt(i, m);
    });
    scene.add(buoyMesh);
  }

  // Eastern hills: large instanced domes past the city edge, so the
  // driving shots' horizon reads as terrain, not flat green void.
  // Domes, not cones — a cone apex reads as a pyramid at this scale.
  if (city.hills.length > 0) {
    const hillGeo = new THREE.SphereGeometry(1, 12, 8);
    const hillMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const hillMesh = new THREE.InstancedMesh(hillGeo, hillMat, city.hills.length);
    city.hills.forEach((t, i) => {
      p.set(t.x, -1, t.z); s.set(t.r, t.h, t.r);
      m.compose(p, q, s); hillMesh.setMatrixAt(i, m);
      hillMesh.setColorAt(i, col.setHex(t.color));
    });
    scene.add(hillMesh);
  }

  // Street-name sign posts at intersections: post + blank board.
  // (The board carries no text at this scale; shop names above carry
  // the signage, street names stay on the HUD + minimap.)
  if (city.signs.length > 0) {
    const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x3a3a40 });
    const posts = new THREE.InstancedMesh(postGeo, postMat, city.signs.length);
    const sBoardGeo = new THREE.BoxGeometry(1.6, 0.4, 0.08);
    const sBoardMat = new THREE.MeshLambertMaterial({ color: 0x2c4a6e });
    const sBoards = new THREE.InstancedMesh(sBoardGeo, sBoardMat, city.signs.length);
    city.signs.forEach((t, i) => {
      p.set(t.x, 1.3, t.z); s.set(1, 1, 1);
      m.compose(p, q, s); posts.setMatrixAt(i, m);
      p.set(t.x, 2.6, t.z);
      m.compose(p, q, s); sBoards.setMatrixAt(i, m);
    });
    scene.add(posts, sBoards);
  }

  // THE CITY REMEMBERS (Day 4D): the two escapes are marked in the
  // world, not just on the minimap — a green ground decal, four short
  // corner posts and a glowing green lamp at the garage (Taller Brisa,
  // Luna Vieja) and at the Colina Verde safehouse. Decals sit just
  // above the road so cars drive over them; nothing here collides.
  for (const site of [GARAGE, SAFEHOUSE]) {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(site.radius * 2, site.radius * 2),
      new THREE.MeshLambertMaterial({ color: 0x2f7a3d, transparent: true, opacity: 0.25 }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(site.x, 0.06, site.z);
    decal.receiveShadow = true;
    scene.add(decal);
    const postGeo = new THREE.CylinderGeometry(0.14, 0.14, 2.2, 6);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x2f7a3d });
    const posts = new THREE.InstancedMesh(postGeo, postMat, 4);
    const r = site.radius - 1;
    [[-r, -r], [r, -r], [-r, r], [r, r]].forEach(([ox, oz], i) => {
      p.set(site.x + ox, 1.1, site.z + oz); s.set(1, 1, 1);
      m.compose(p, q, s); posts.setMatrixAt(i, m);
    });
    scene.add(posts);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0x57d977, emissive: 0x2f9a4d, emissiveIntensity: 1.2 }),
    );
    lamp.position.set(site.x, 2.6, site.z);
    scene.add(lamp);
    const lampPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 2.6, 6),
      new THREE.MeshLambertMaterial({ color: 0x3a3a40 }),
    );
    lampPole.position.set(site.x, 1.3, site.z);
    scene.add(lampPole);
  }

  return { scene, sun, grade };
}

// Player: a simple sun-lit figure — body capsule, head, cap — so the
// third-person camera always has something to follow.
export function createPlayerMesh(scene, shadowName) {
  const sh = resolveShadow(shadowName);
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.42, 0.85, 4, 10),
    new THREE.MeshLambertMaterial({ color: 0xd94f3d }),
  );
  body.position.y = 1.0; body.castShadow = sh.casters.playerBody;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 12, 10),
    new THREE.MeshLambertMaterial({ color: 0xe8b98a }),
  );
  head.position.y = 1.95; head.castShadow = sh.casters.playerHead;
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 0.1, 12),
    new THREE.MeshLambertMaterial({ color: 0x2c4a6e }),
  );
  cap.position.y = 2.18;
  group.add(body, head, cap);
  scene.add(group);
  return group;
}

// Third-person follow camera: orbit yaw/pitch around the focus.
// camOpts overrides distance/height (driving uses a longer chase cam)
// and lookHeight (driving looks at the car's lower body, not the
// 1.4 m on-foot target, so the whole car sits higher in frame).
// camOpts.smooth is a persistent {ready,x,y,z,tx,ty,tz} state object:
// when present, the camera eases toward the computed pose each frame
// instead of snapping (see smoothPose in camera.js); a fixed shotCam
// always bypasses smoothing so staged shots are exact.
export function updateCamera(camera, playerState, shotCam, camOpts) {
  const dist = camOpts?.distance ?? CAMERA.distance;
  const h = camOpts?.height ?? CAMERA.height;
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
    tx = playerState.x; ty = playerState.y + (camOpts?.lookHeight ?? 1.4); tz = playerState.z;
  }
  const s = camOpts?.smooth;
  if (s && !shotCam) {
    const f = CAMERA.smoothFactor;
    if (!s.ready) {
      s.x = cx; s.y = cy; s.z = cz; s.tx = tx; s.ty = ty; s.tz = tz; s.ready = true;
    } else {
      s.x += (cx - s.x) * f; s.y += (cy - s.y) * f; s.z += (cz - s.z) * f;
      s.tx += (tx - s.tx) * f; s.ty += (ty - s.ty) * f; s.tz += (tz - s.tz) * f;
      cx = s.x; cy = s.y; cz = s.z; tx = s.tx; ty = s.ty; tz = s.tz;
    }
  }
  camera.position.set(cx, cy, cz);
  camera.lookAt(tx, ty, tz);
}

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

// ---- Vehicles + pedestrians -----------------------------------------
// One shared geometry/material set for all cars; bodies are per-car
// meshes (colour varies), wheels and headlights are InstancedMeshes so
// 18 cars still cost ~3 draw calls for wheels + lights.
const CAR_BODY_GEO = new THREE.BoxGeometry(1, 1, 1);
const CAR_CABIN_GEO = new THREE.BoxGeometry(1, 1, 1);
const WHEEL_GEO = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10);
const LIGHT_GEO = new THREE.BoxGeometry(0.32, 0.16, 0.12);
const WHEEL_MAT = new THREE.MeshLambertMaterial({ color: 0x1c1c20 });
const LIGHT_MAT = new THREE.MeshLambertMaterial({
  color: 0xfff2c0, emissive: 0xffe9a0, emissiveIntensity: 0.9,
});
const PED_BODY_GEO = new THREE.CapsuleGeometry(0.32, 0.7, 4, 8);
const PED_HEAD_GEO = new THREE.SphereGeometry(0.22, 10, 8);
const PED_HEAD_MAT = new THREE.MeshLambertMaterial({ color: 0xe8b98a });

export function createVehicleRig(scene, cars, peds, shadowName) {
  // Day 4F: per-car shadow casting follows the active config — B/C
  // drop the cabin + roof panel, whose shadows sit inside the body
  // shadow at 768x480 (the roof panel is 0.08 m thick on top of the
  // cabin; the cabin's shadow is a ~1 m sliver past the body's).
  const sh = resolveShadow(shadowName);
  // Bodies are keyed by car id and created lazily: world.reset() builds
  // fresh car objects, so sync() must match the current list, not the
  // list this rig was first built from. Wheels/lights are InstancedMesh
  // capacity for the initial fleet size; the fleet size never grows.
  const bodies = new Map();
  function bodyFor(car) {
    let entry = bodies.get(car.id);
    if (entry) { entry.car = car; return entry; }
    const group = new THREE.Group();
    const isPolice = car.kind === 'police';
    const bodyMat = new THREE.MeshLambertMaterial({ color: car.color });
    const body = new THREE.Mesh(CAR_BODY_GEO, bodyMat);
    body.scale.set(car.width, 0.62, car.length);
    body.position.y = 0.62;
    body.castShadow = sh.casters.carBody;
    // Patrol cars read as police at a glance: black body, white cabin
    // (doors + roof), and a roof light bar. No text anywhere.
    const cabin = new THREE.Mesh(CAR_CABIN_GEO, new THREE.MeshLambertMaterial({
      color: isPolice ? 0xe8e8e8 : 0x2c3e50,
    }));
    cabin.scale.set(car.width * 0.82, 0.55, car.length * 0.45);
    cabin.position.set(0, 1.18, -car.length * 0.08);
    cabin.castShadow = sh.casters.carCabin;
    group.add(body, cabin);
    // Roof rework (Day 4C): the old cabin was one big dark slab on the
    // roof, and from the chase camera it read as a small "+" / crosshair
    // sitting on the car. Now civilian cars get a body-coloured roof
    // panel over the cabin's middle, so the dark glass reads as two
    // separate bands (windshield + rear window) — a car roof, not a
    // mark. Sport cars also get a rear spoiler. Police keep the white
    // cabin + light bar (their livery, not a roof mark).
    let roofPanel = null, spoiler = null;
    if (!isPolice) {
      roofPanel = new THREE.Mesh(CAR_CABIN_GEO, bodyMat);
      roofPanel.scale.set(car.width * 0.62, 0.08, car.length * 0.22);
      roofPanel.position.set(0, 1.49, -car.length * 0.08);
      roofPanel.castShadow = sh.casters.carRoofPanel;
      group.add(roofPanel);
      if (car.kind === 'sport') {
        spoiler = new THREE.Mesh(CAR_CABIN_GEO, bodyMat);
        spoiler.scale.set(car.width * 0.85, 0.07, 0.35);
        spoiler.position.set(0, 1.02, -car.length / 2 + 0.18);
        group.add(spoiler);
      }
    }
    let lightBar = null;
    if (isPolice) {
      // Bigger, taller light bar so it reads at 768x480 from 25+ m:
      // 0.62 m halves on a 1.4 m base, hot side much brighter than dim.
      const barGeo = new THREE.BoxGeometry(0.62, 0.26, 0.5);
      const redMat = new THREE.MeshLambertMaterial({ color: 0xaa1111, emissive: 0xff2020, emissiveIntensity: 3.2 });
      const blueMat = new THREE.MeshLambertMaterial({ color: 0x1111aa, emissive: 0x2040ff, emissiveIntensity: 0.8 });
      const red = new THREE.Mesh(barGeo, redMat);
      red.position.set(-0.38, 1.62, -car.length * 0.08);
      const blue = new THREE.Mesh(barGeo, blueMat);
      blue.position.set(0.38, 1.62, -car.length * 0.08);
      const barBase = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.1, 0.6),
        new THREE.MeshLambertMaterial({ color: 0x14161c }),
      );
      barBase.position.set(0, 1.48, -car.length * 0.08);
      group.add(barBase, red, blue);
      lightBar = { redMat, blueMat };
    }
    scene.add(group);
    entry = { car, group, body, cabin, lightBar, roofPanel, spoiler };
    bodies.set(car.id, entry);
    return entry;
  }
  for (const car of cars) bodyFor(car);
  // Wheels/lights capacity covers the initial fleet plus the patrol
  // units, which spawn later and are created lazily by sync().
  const fleetCap = cars.length + 4;
  const wheels = new THREE.InstancedMesh(WHEEL_GEO, WHEEL_MAT, Math.max(1, fleetCap * 4));
  wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(wheels);
  const lights = new THREE.InstancedMesh(LIGHT_GEO, LIGHT_MAT, Math.max(1, fleetCap * 2));
  lights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(lights);

  const pedBodies = new THREE.InstancedMesh(PED_BODY_GEO, new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, peds.length));
  pedBodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const pedHeads = new THREE.InstancedMesh(PED_HEAD_GEO, PED_HEAD_MAT, Math.max(1, peds.length));
  pedHeads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(pedBodies, pedHeads);
  const pedColor = new THREE.Color();

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1);
  const wheelQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));

  function sync(carList, pedList, simTime = 0) {
    const seen = new Set();
    // Light-bar flash: alternating red/blue from sim time, so a still
    // frame always shows one side hot and the other dimly lit.
    const phase = Math.floor(simTime * 4) % 2;
    for (const car of carList) {
      const { group, body, cabin, lightBar, roofPanel, spoiler } = bodyFor(car);
      // Size follows the current car: ids are reused across resets and
      // a sedan may take over a sport's id.
      body.scale.set(car.width, 0.62, car.length);
      cabin.scale.set(car.width * 0.82, 0.55, car.length * 0.45);
      cabin.position.set(0, 1.18, -car.length * 0.08);
      if (roofPanel) {
        roofPanel.scale.set(car.width * 0.62, 0.08, car.length * 0.22);
        roofPanel.position.set(0, 1.49, -car.length * 0.08);
      }
      if (spoiler) {
        spoiler.scale.set(car.width * 0.85, 0.07, 0.35);
        spoiler.position.set(0, 1.02, -car.length / 2 + 0.18);
        // Ids are reused across resets: a sedan may inherit a sport
        // car's entry, so the spoiler shows only for sport cars.
        spoiler.visible = car.kind === 'sport';
      }
      group.position.set(car.x, 0, car.z);
      group.rotation.set(car.pitch, car.heading, car.roll);
      group.visible = true;
      if (lightBar) {
        lightBar.redMat.emissiveIntensity = phase === 0 ? 3.2 : 0.8;
        lightBar.blueMat.emissiveIntensity = phase === 0 ? 0.8 : 3.2;
      }
      seen.add(car.id);
    }
    for (const [id, { group }] of bodies) {
      if (!seen.has(id)) group.visible = false;
    }
    let wi = 0, li = 0;
    for (const car of carList) {
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      const rx = -fz, rz = fx;
      const wheelSpots = [
        [-0.85, 1.35, 1], [0.85, 1.35, 1], [-0.85, -1.35, 0], [0.85, -1.35, 0],
      ];
      for (const [ox, oz, front] of wheelSpots) {
        const wx = car.x + rx * ox + fx * oz;
        const wz = car.z + rz * ox + fz * oz;
        // Front wheels yaw with the steer angle.
        e.set(0, car.heading + (front ? car.steer * 0.7 : 0), 0);
        q.setFromEuler(e).multiply(wheelQ);
        pos.set(wx, 0.36, wz);
        m.compose(pos, q, scl);
        wheels.setMatrixAt(wi++, m);
      }
      for (const ox of [-0.6, 0.6]) {
        const lx = car.x + rx * ox + fx * (car.length / 2 - 0.05);
        const lz = car.z + rz * ox + fz * (car.length / 2 - 0.05);
        e.set(0, car.heading, 0);
        q.setFromEuler(e);
        pos.set(lx, 0.62, lz);
        m.compose(pos, q, scl);
        lights.setMatrixAt(li++, m);
      }
    }
    wheels.count = wi;
    wheels.instanceMatrix.needsUpdate = true;
    lights.count = li;
    lights.instanceMatrix.needsUpdate = true;
    pedList.forEach((p, i) => {
      pedBodies.setColorAt(i, pedColor.setHex(p.shirt));
      e.set(0, p.heading, 0);
      q.setFromEuler(e);
      pos.set(p.x, 0.85, p.z);
      m.compose(pos, q, scl);
      pedBodies.setMatrixAt(i, m);
      pos.set(p.x, 1.62, p.z);
      m.compose(pos, q, scl);
      pedHeads.setMatrixAt(i, m);
    });
    pedBodies.count = pedList.length;
    pedHeads.count = pedList.length;
    if (pedBodies.instanceColor) pedBodies.instanceColor.needsUpdate = true;
    pedBodies.instanceMatrix.needsUpdate = true;
    pedHeads.instanceMatrix.needsUpdate = true;
  }
  return { sync, bodies };
}

