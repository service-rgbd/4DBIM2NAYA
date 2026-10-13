import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// web-ifc (6 Mo) is served pre-built from /wasm to keep it out of the webpack bundle
let webIfcPromise = null;
function loadWebIfc() {
  if (window.WebIFC) return Promise.resolve(window.WebIFC);
  webIfcPromise = webIfcPromise || new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/wasm/web-ifc-api-iife.js";
    s.onload = () => resolve(window.WebIFC);
    s.onerror = () => { webIfcPromise = null; reject(new Error("Moteur web-ifc indisponible")); };
    document.head.appendChild(s);
  });
  return webIfcPromise;
}

const HIGHLIGHT = new THREE.MeshLambertMaterial({ color: 0xfacc15, emissive: 0x6b4f00, side: THREE.DoubleSide });

/** Three.js + web-ifc viewer: real IFC geometry, picking by STEP expressID, colour overrides, isolation, section. */
export class IfcEngine {
  constructor(container) {
    this.container = container;
    this.meshes = new Map();
    this.matCache = new Map();
    this.overrides = new Map();
    this.selected = new Set();
    this.isolated = null;
    this.filter = null;
    this.known = null;
    this.ghostUnplanned = true;
    this.onPick = () => {};
    const w = container.clientWidth || 800, h = container.clientHeight || 500;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f172a);
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.05, 5000);
    this.camera.position.set(20, 15, 20);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(30, 50, 20);
    this.scene.add(dir);
    this.grid = new THREE.GridHelper(100, 50, 0x334155, 0x1e293b);
    this.scene.add(this.grid);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.section = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    this.raycaster = new THREE.Raycaster();
    this._down = null;
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => { this._down = [e.clientX, e.clientY]; });
    el.addEventListener("pointerup", (e) => this._click(e));
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    const loop = () => { this._raf = requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); };
    loop();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _mat(hex, opacity = 1) {
    const key = `${hex}-${opacity}`;
    if (!this.matCache.has(key)) {
      this.matCache.set(key, new THREE.MeshLambertMaterial({ color: hex, transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: opacity >= 1 }));
    }
    return this.matCache.get(key);
  }

  async load(buffer, onProgress = () => {}) {
    const { IfcAPI } = await loadWebIfc();
    const ifc = new IfcAPI();
    ifc.SetWasmPath("/wasm/", true);
    await ifc.Init(undefined, true);
    const modelID = ifc.OpenModel(new Uint8Array(buffer), { COORDINATE_TO_ORIGIN: true });
    if (modelID < 0) throw new Error("web-ifc n'a pas pu ouvrir le fichier");
    let count = 0;
    ifc.StreamAllMeshes(modelID, (flat) => {
      const placed = flat.geometries;
      for (let i = 0; i < placed.size(); i++) {
        const pg = placed.get(i);
        const geom = ifc.GetGeometry(modelID, pg.geometryExpressID);
        const v = ifc.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
        const idx = ifc.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
        const pos = new Float32Array(v.length / 2), nor = new Float32Array(v.length / 2);
        for (let j = 0, k = 0; j < v.length; j += 6, k += 3) {
          pos[k] = v[j]; pos[k + 1] = v[j + 1]; pos[k + 2] = v[j + 2];
          nor[k] = v[j + 3]; nor[k + 1] = v[j + 4]; nor[k + 2] = v[j + 5];
        }
        const bg = new THREE.BufferGeometry();
        bg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        bg.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
        bg.setIndex(new THREE.BufferAttribute(idx, 1));
        const c = pg.color;
        const base = this._mat(new THREE.Color(c.x, c.y, c.z).getHex(), Math.round(c.w * 100) / 100);
        const mesh = new THREE.Mesh(bg, base);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.fromArray(pg.flatTransformation);
        mesh.userData = { expressID: flat.expressID, base };
        this.group.add(mesh);
        if (!this.meshes.has(flat.expressID)) this.meshes.set(flat.expressID, []);
        this.meshes.get(flat.expressID).push(mesh);
        geom.delete();
      }
      count += 1;
      if (count % 50 === 0) onProgress(count);
    });
    ifc.CloseModel(modelID);
    this.box = new THREE.Box3().setFromObject(this.group);
    this.grid.position.y = this.box.min.y - 0.01;
    this.fit();
    this.refresh();
    return { meshCount: this.meshes.size };
  }

  fit(ids) {
    let box = this.box;
    if (ids?.length) {
      box = new THREE.Box3();
      ids.forEach((id) => (this.meshes.get(id) || []).forEach((m) => box.expandByObject(m)));
      if (box.isEmpty()) box = this.box;
    }
    if (!box || box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(size * 0.7, size * 0.55, size * 0.7));
    this.camera.near = size / 500;
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
  }

  _click(e) {
    if (!this._down || Math.hypot(e.clientX - this._down[0], e.clientY - this._down[1]) > 4) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(p, this.camera);
    const hits = this.raycaster.intersectObjects(this.group.children.filter((m) => m.visible && m.userData.pickable !== false), false);
    const hit = hits.find((h) => !this.renderer.clippingPlanes.length || this.section.distanceToPoint(h.point) >= 0);
    this.onPick(hit ? hit.object.userData.expressID : null, e.ctrlKey || e.metaKey || e.shiftKey);
  }

  setSection(enabled, ratio) {
    if (!this.box) return;
    const { min, max } = this.box;
    this.section.constant = min.y + (max.y - min.y) * ratio;
    this.renderer.clippingPlanes = enabled ? [this.section] : [];
  }

  /** Recomputes visibility and materials for every mesh from the current state. */
  refresh() {
    for (const [id, list] of this.meshes) {
      const known = !this.known || this.known.has(id);
      const ov = this.overrides.get(id);
      let visible = known && (!this.isolated || this.isolated.has(id)) && (!this.filter || this.filter(id));
      let mat = list[0].userData.base;
      if (!known) { visible = !this.isolated; mat = this._mat(0x64748b, 0.08); }
      else if (this.selected.has(id)) mat = HIGHLIGHT;
      else if (ov) {
        if (ov.hide) visible = false;
        mat = ov.ghost ? this._mat(0xcbd5e1, 0.1) : this._mat(ov.hex, ov.opacity ?? 1);
      }
      list.forEach((m) => { m.visible = visible; m.material = mat; m.userData.pickable = known; });
    }
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this.group.traverse((o) => o.geometry && o.geometry.dispose());
    this.matCache.forEach((m) => m.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
