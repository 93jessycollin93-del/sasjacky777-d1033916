/**
 * Draws the world for one frame.
 *
 * The game hands over a FrameState — where the camera is, what time it is,
 * which entities exist and how far between ticks we are — and this turns it
 * into a picture. Nothing in here changes the game; that separation is what
 * lets the same renderer show a single-player world, a hosted one, or a
 * guest's copy that only ever receives snapshots.
 */
import * as THREE from "three";
import { B, block, Face, FACE_DIRS, modelBoxes } from "../engine/blocks";
import { buildAtlas, layerOf } from "../engine/atlas";
import type { ChunkMesh } from "../engine/mesher";
import type { Entity } from "../engine/entities";
import { EndCrystal, FireworkRocket, ItemEntity, ItemFrame, PrimedTnt, FallingBlock, Projectile, XpOrb } from "../engine/entities";
import { Mob } from "../engine/mobs";
import { Boat, Vehicle } from "../engine/vehicles";
import { PROFESSIONS } from "../engine/villages";
import type { World } from "../engine/world";
import { itemId } from "../engine/items";
import { ChunkMeshes } from "./chunkMeshes";
import { Hand, type HandState } from "./hand";
import { col, createChunkMaterial, createCrackMaterial, createLitBlockMaterial, createSharedUniforms, createSpriteMaterial, type ChunkPass, type SharedUniforms } from "./materials";
import { buildModel, ItemView, nameTag, pose, type ModelInstance } from "./models";
import { Particles } from "./particles";
import { Sky, skyState } from "./sky";
import type { SkyObjects } from "../space/sky";
import { Weather } from "./weather";
import { blockGeometry, itemModel, spriteGeometry } from "./itemModels";
import { GAME_NAME } from "../edition";
import { CREATURES, isDino } from "../engine/creatures";
import { SPECIES } from "../engine/critters";
import { trainerById, trainerTitle } from "../engine/trainers";
import { Car } from "../engine/cars";
import { buildCar, poseCar, type CarView } from "./carModels";
import { seedFromString } from "../engine/rng";
import { TRAINER_CLASS_ORDER } from "./skins";
import { isInfectedMob } from "../engine/infected";

export interface RemotePlayerView {
  id: string;
  name: string;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  walk: number; speed: number;
  swing: number;
  sneaking: boolean;
  heldItem: number | null;
  variant: number;
  hurt: boolean;
  dead: boolean;
  /** Under invisibility: only the held item shows, as in the original. */
  invisible?: boolean;
  sitting?: boolean;
  gliding?: boolean;
  /** At a car's wheel: drawn a little smaller, so they fit under its roof. */
  inCar?: boolean;
}

export interface FrameState {
  dt: number;
  alpha: number;
  camera: { x: number; y: number; z: number; yaw: number; pitch: number; fov: number };
  /** 0 first person, 1 behind, 2 in front. */
  perspective: 0 | 1 | 2;
  /** How far behind a third-person camera sits (a car wants more room than a player). */
  cameraDistance?: number;
  bob: { walk: number; amount: number };
  hurtTilt: number;
  time: number;
  rain: number;
  thunder: number;
  lightning: number;
  snowing: boolean;
  renderDistance: number;
  underwater: boolean;
  inLava: boolean;
  nightVision: boolean;
  /** Blinded: a dark fog a few blocks out. */
  blind?: boolean;
  entities: Iterable<Entity>;
  localPlayer: RemotePlayerView;
  remotePlayers: RemotePlayerView[];
  target: { x: number; y: number; z: number } | null;
  crack: number;
  hand: HandState;
  showHand: boolean;
  clouds: boolean;
  wave: boolean;
  /**
   * Outside the overworld: no sun, moon or clouds, a fog of this colour
   * (0xRRGGBB) closing in far sooner, and light never below `ambient`.
   */
  /** Outside the overworld: the fog colour, the light floor, how much open sky lights, and whether it is open void (the End) or a cavern. */
  dimension?: { fog: number; ambient: number; sky?: number; open?: boolean };
  /** Lights that move (see materials.ts uDynLights), as [x, y, z, level], nearest first. */
  dynamicLights?: [number, number, number, number][];
  /** The season's tint over grass and leaves: [r, g, b, amount]. */
  season?: [number, number, number, number];
  /** A blood moon: the sky and the fog run red. */
  bloodMoon?: boolean;
  /** The real sky over the player (space/sky.ts); absent keeps the old clockwork one. */
  celestial?: SkyObjects | null;
  /** A mode's world border (a square of half-width `radius`), drawn as a striped wall when near. */
  border?: { x: number; z: number; radius: number } | null;
  /** A mission's marks: glowing columns where something is to be done. */
  markers?: { x: number; y: number; z: number; color: string; r: number }[];
}

const WATER_FOG = col("#1f4f9a");
const LAVA_FOG = col("#c2410c");

interface EntityView {
  entity: Entity;
  object: THREE.Object3D;
  model?: ModelInstance;
  item?: ItemView;
  lit?: THREE.RawShaderMaterial;
  nameTag?: THREE.Sprite;
  /** What a creature's tag says, so it is redrawn only when that changes. */
  tagText?: string;
  /** The model a mob was built from: its kind, or a critter's species. */
  modelKey?: string;
  /** The skin a mob's model was built with, so a change (a villager's new trade) rebuilds it. */
  variant?: number;
  /** An end crystal's spinning cage and its beam to the dragon. */
  crystal?: { cage: THREE.Object3D; core: THREE.Object3D; beam: THREE.Mesh };
  /** Materials this view owns (an item frame's board, shaded by its own light). */
  mats?: THREE.MeshBasicMaterial[];
  /** A car, and whoever the city put at its wheel. */
  car?: CarView;
  driver?: ModelInstance;
}

export class WorldRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private readonly backdrop = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1000);
  readonly shared: SharedUniforms;
  readonly chunks: ChunkMeshes;
  readonly particles: Particles;
  private sky = new Sky();
  private weather: Weather;
  private hand: Hand;
  private selection: THREE.LineSegments;
  private crack: THREE.Mesh;
  private crackMat: THREE.RawShaderMaterial;
  private views = new Map<number, EntityView>();
  private players = new Map<string, EntityView & { variant: number }>();
  private localModel: ModelInstance | null = null;
  private localVariant = -1;
  private time = 0;
  private flash = 0;
  private width = 1;
  private height = 1;
  private lastTarget = "";
  contextLost = false;
  private lastFrameState: FrameState | null = null;
  private cameraPull = 4;
  private borderWall: THREE.Group | null = null;
  private borderKey = "";
  private markerViews: { column: THREE.Mesh; ring: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
  private markerKey = "";

  constructor(readonly canvas: HTMLCanvasElement, private world: World, pixelRatio: number) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: false, alpha: false });
    this.renderer.setPixelRatio(pixelRatio);
    // Display space end to end — see materials.ts.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    // Every texture is a layer of one array; a device that holds fewer layers than the
    // atlas has would draw the world in the wrong textures, so it is refused in words instead.
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
    const needed = buildAtlas().count;
    if (maxLayers && needed > maxLayers) {
      this.renderer.dispose();
      throw new Error(`This device's graphics hold ${maxLayers} texture layers and ${GAME_NAME} needs ${needed}.`);
    }
    this.renderer.autoClear = false;
    this.renderer.sortObjects = true;
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.contextLost = true; });
    canvas.addEventListener("webglcontextrestored", () => { this.contextLost = false; });

    this.shared = createSharedUniforms();
    const materials: Record<ChunkPass, THREE.Material> = {
      opaque: createChunkMaterial(this.shared, "opaque"),
      cutout: createChunkMaterial(this.shared, "cutout"),
      translucent: createChunkMaterial(this.shared, "translucent"),
    };
    this.chunks = new ChunkMeshes(materials);
    this.particles = new Particles(this.shared, world);
    this.weather = new Weather(world);
    this.hand = new Hand(this.shared);

    // The sky is its own pass, drawn first: three.js draws transparent objects (sun, moon, stars)
    // after all opaque ones whatever their renderOrder, which put the stars over the terrain.
    this.backdrop.add(this.sky.group);
    this.scene.add(this.sky.clouds, this.chunks.group, this.particles.points, this.weather.group);
    // Counted across every pass of a frame, for the debug screen.
    this.renderer.info.autoReset = false;

    const edges = new THREE.BufferGeometry();
    edges.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(24 * 3 * 4), 3));
    this.selection = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
    this.selection.visible = false;
    this.selection.frustumCulled = false;
    this.selection.renderOrder = 6;
    this.scene.add(this.selection);

    this.crackMat = createCrackMaterial(this.shared);
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), this.crackMat);
    this.crack.visible = false;
    this.crack.renderOrder = 5;
    this.scene.add(this.crack);
  }

  /** Swaps in another dimension's world: every chunk mesh of the old one goes. */
  setWorld(world: World): void {
    this.world = world;
    this.particles.world = world;
    this.particles.clear();
    this.weather.world = world;
    this.chunks.clear();
    for (const id of [...this.views.keys()]) this.dropView(id);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.hand.resize(this.width / this.height);
    this.particles.setViewportHeight(this.height * pixelRatio, this.camera.fov);
  }

  setChunk(id: number, cx: number, cz: number, mesh: ChunkMesh): void {
    this.chunks.set(id, cx, cz, mesh);
  }

  removeChunk(id: number): void {
    this.chunks.remove(id);
  }

  private updateSelection(target: FrameState["target"]): void {
    if (!target) { this.selection.visible = false; this.lastTarget = ""; return; }
    const id = this.world.blockAt(target.x, target.y, target.z);
    const meta = this.world.getMeta(target.x, target.y, target.z);
    const key = `${target.x},${target.y},${target.z},${id},${meta}`;
    this.selection.visible = id !== 0;
    if (key === this.lastTarget) return;
    this.lastTarget = key;
    const def = block(id);
    const boxes = def.shape === "cross" || def.shape === "crop" ? [[2, 0, 2, 14, 13, 14] as const] : modelBoxes(def, meta);
    const pos = this.selection.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    let i = 0;
    const e = 0.002;
    for (const b of boxes.slice(0, 4)) {
      const x0 = target.x + b[0] / 16 - e, y0 = target.y + b[1] / 16 - e, z0 = target.z + b[2] / 16 - e;
      const x1 = target.x + b[3] / 16 + e, y1 = target.y + b[4] / 16 + e, z1 = target.z + b[5] / 16 + e;
      const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
      for (const [a, bb] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) {
        arr.set(c[a], i); arr.set(c[bb], i + 3); i += 6;
      }
    }
    arr.fill(0, i);
    pos.needsUpdate = true;
    this.selection.geometry.setDrawRange(0, i / 3);
  }

  /** This frame's moving lights, so entities are lit by the torch in a player's hand as the blocks are. */
  private dyn: [number, number, number, number][] = [];

  private lightAt(x: number, y: number, z: number): [number, number] {
    const l = this.world.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
    let blk = l < 0 ? 0 : (l & 15) / 15;
    for (const [lx, ly, lz, level] of this.dyn) blk = Math.max(blk, Math.min(1, Math.max(0, (level - Math.hypot(x - lx, y - ly, z - lz)) / 15)));
    if (l < 0) return [1, blk];
    return [(l >> 4) / 15, blk];
  }

  private brightness(x: number, y: number, z: number): number {
    const [s, b] = this.lightAt(x, y, z);
    const l = Math.max(s * this.shared.uDaylight.value, b, this.shared.uNightVision.value, this.shared.uAmbient.value);
    // The same curve and gamma lift the block shader applies, so a mob is as bright as the ground it stands on.
    const lin = l / (4 - 3 * l);
    return Math.max(0.12, lin + (Math.sqrt(lin) - lin) * this.shared.uGamma.value) * 1.05;
  }

  private viewFor(e: Entity): EntityView {
    let v = this.views.get(e.id);
    // A villager who takes up a trade changes clothes: rebuild its model.
    // So does a critter that evolves, or is swapped for another in a battle: its species is its model.
    if (v && v.entity === e && (!(e instanceof Mob) || (v.variant === skinVariant(e) && v.modelKey === modelKey(e))) && (!(e instanceof ItemFrame) || v.variant === (e.item?.id ?? 0))
      // A car resprayed, blown up, or given a driver is built again.
      && (!(e instanceof Car) || (v.car?.color === e.color && v.car.model === e.model && v.car.wrecked === (e.wrecked > 0) && !!v.driver === e.npc))) return v;
    if (v) this.dropView(e.id);
    const object = new THREE.Group();
    v = { entity: e, object };
    if (e instanceof Mob) {
      v.variant = skinVariant(e);
      v.modelKey = modelKey(e);
      v.model = buildModel(v.modelKey, v.variant);
      if (e.kind === "enderman" && e.carried) {
        // The block it carries, held out between its hands.
        v.lit = createLitBlockMaterial(this.shared);
        const held = new THREE.Mesh(blockGeometry(e.carried, 0), v.lit);
        held.scale.setScalar(0.5);
        held.position.set(-0.25, 1.55, -0.75);
        v.model.parts.get("__scale")!.add(held);
      }
      object.add(v.model.root);
    } else if (e instanceof ItemFrame) {
      // A thin wooden board with a lighter backing, and the item laid on it (rebuilt when the item changes).
      v.variant = e.item?.id ?? 0;
      const [rim, back] = frameGeometry();
      v.mats = [new THREE.MeshBasicMaterial({ color: col("#6e4c26") }), new THREE.MeshBasicMaterial({ color: col("#b08a52") })];
      const board = new THREE.Group();
      board.add(new THREE.Mesh(rim, v.mats[0]), new THREE.Mesh(back, v.mats[1]));
      object.add(board);
      if (e.item) {
        v.item = new ItemView(this.shared, e.item.id, 1, 0.9);
        v.item.root.position.z = 0.06;
        board.add(v.item.root);
      }
      const [nx, ny, nz] = FACE_DIRS[e.face];
      board.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(nx, ny, nz));
    } else if (e instanceof FireworkRocket) {
      v.item = new ItemView(this.shared, itemId("firework_rocket"), 1, 0.7);
      object.add(v.item.root);
    } else if (e instanceof EndCrystal) {
      v.crystal = crystalView();
      object.add(v.crystal.cage, v.crystal.core);
      this.scene.add(v.crystal.beam);
      if (e.showBase) {
        v.lit = createLitBlockMaterial(this.shared);
        const base = new THREE.Mesh(blockGeometry(B.BEDROCK, 0), v.lit);
        base.scale.set(0.75, 0.25, 0.75);
        base.position.set(-0.375, 0, -0.375);
        object.add(base);
      }
    } else if (e instanceof Car) {
      v.car = buildCar(e.model, e.color, e.wrecked > 0);
      object.add(v.car.root);
      if (e.npc) {
        v.driver = buildModel("citizen", e.id % 24);
        v.car.body.add(v.driver.root);
      }
    } else if (e instanceof Vehicle) {
      v.model = buildModel(e instanceof Boat ? "boat" : "minecart", e instanceof Boat ? e.wood : 0);
      if (e.kind === "tnt_minecart") {
        // The TNT sits in the cart, drawn as the block itself.
        v.lit = createLitBlockMaterial(this.shared);
        const tnt = new THREE.Mesh(blockGeometry(B.TNT, 0), v.lit);
        tnt.scale.setScalar(0.62);
        tnt.position.set(-0.31, 0.12, -0.31);
        v.model.parts.get("__scale")!.add(tnt);
      }
      object.add(v.model.root);
    } else if (e instanceof ItemEntity) {
      v.item = new ItemView(this.shared, e.stack.id, e.stack.count);
      object.add(v.item.root);
    } else if (e instanceof FallingBlock || e instanceof PrimedTnt) {
      v.lit = createLitBlockMaterial(this.shared);
      const id = e instanceof FallingBlock ? e.blockId : block(87).id;
      const m = new THREE.Mesh(blockGeometry(id, e instanceof FallingBlock ? e.meta : 0), v.lit);
      object.add(m);
    } else if (e instanceof Projectile) {
      if (e.kind === "arrow") {
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.5), new THREE.MeshBasicMaterial({ color: col("#6b4a26") }));
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.08), new THREE.MeshBasicMaterial({ color: col("#9a9a9a") }));
        tip.position.z = 0.27;
        const fl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.01, 0.12), new THREE.MeshBasicMaterial({ color: col("#eeeeee") }));
        fl.position.z = -0.22;
        const g = new THREE.Group();
        g.add(shaft, tip, fl);
        object.add(g);
      } else if (e.kind === "shulker_bullet") {
        // A pale knot of light, two crossed cubes spinning as it goes (one shared mesh set: bullets come in volleys).
        const [core, rim] = bulletMeshes();
        const g = new THREE.Group();
        const a = new THREE.Mesh(core.geometry, core.material);
        const b2 = new THREE.Mesh(rim.geometry, rim.material);
        a.rotation.set(0.6, 0.6, 0);
        g.add(a, b2);
        object.add(g);
      } else if (e.kind === "fireball" || e.kind === "small_fireball" || e.kind === "dragon_fireball") {
        // A ball of fire: the fire charge's picture, facing the camera, big for a ghast's; the dragon's, bigger.
        v.item = new ItemView(this.shared, itemId(e.kind === "dragon_fireball" ? "chorus_fruit" : "fire_charge"), 1, e.kind === "fireball" ? 3 : e.kind === "dragon_fireball" ? 3.5 : 1);
        object.add(v.item.root);
      } else {
        // A thrown bottle shows the potion it holds.
        const id = e.kind === "potion" ? e.item || itemId("splash_water_bottle") : e.kind === "xp_bottle" ? itemId("experience_bottle") : itemIdFor(e.kind);
        v.item = new ItemView(this.shared, id, 1, 0.7);
        object.add(v.item.root);
      }
    } else if (e instanceof XpOrb) {
      v.lit = createSpriteMaterial(this.shared);
      v.lit.uniforms.uTint.value = col("#b6ff4a");
      v.lit.uniforms.uSky.value = 1;
      v.lit.uniforms.uBlock.value = 1;
      const m = new THREE.Mesh(spriteGeometry("particle_spark"), v.lit);
      m.scale.setScalar(0.25 + Math.min(0.2, e.value / 50));
      object.add(m);
    }
    this.scene.add(object);
    this.views.set(e.id, v);
    return v;
  }

  /** A tamed creature's name, level and owner, floating over it. */
  private creatureTag(v: EntityView, e: Mob, x: number, y: number, z: number): void {
    const text = e.owner ? `${CREATURES[e.kind as keyof typeof CREATURES].name} · Lv ${e.level}${e.ownerName ? ` · ${e.ownerName}` : ""}` : "";
    if (text !== v.tagText) {
      if (v.nameTag) { this.scene.remove(v.nameTag); v.nameTag.material.map?.dispose(); v.nameTag.material.dispose(); v.nameTag = undefined; }
      v.tagText = text;
      if (text) { v.nameTag = nameTag(text); this.scene.add(v.nameTag); }
    }
    if (v.nameTag) v.nameTag.position.set(x, y + e.body.height + 0.6, z);
  }

  /** What a citizen just said, over their head while they say it. */
  private quipTag(v: EntityView, e: Mob, x: number, y: number, z: number, cam: THREE.Vector3): void {
    const text = e.quipTicks > 0 && e.quip ? e.quip : "";
    if (text !== v.tagText) {
      if (v.nameTag) { this.scene.remove(v.nameTag); v.nameTag.material.map?.dispose(); v.nameTag.material.dispose(); v.nameTag = undefined; }
      v.tagText = text;
      if (text) { v.nameTag = nameTag(text); this.scene.add(v.nameTag); }
    }
    if (v.nameTag) {
      v.nameTag.position.set(x, y + e.body.height + 0.5, z);
      // Near enough to read, not so near it fills the screen (someone shouting in your ear).
      const d = cam.distanceTo(v.nameTag.position);
      v.nameTag.visible = d > 2.5 && d < 40;
    }
  }

  /** A critter's name and level (and whose it is), or a trainer's title, floating over them when near. */
  private critterTag(v: EntityView, e: Mob, x: number, y: number, z: number, cam: THREE.Vector3): void {
    // Near enough to read, but not so near it fills the screen (a partner at its trainer's side).
    const d = Math.hypot(x - cam.x, z - cam.z);
    const near = d < 12 && d > 3.2;
    let text = "";
    if (near && e.kind === "critter") {
      const s = SPECIES[e.species];
      // A trainer's critter out for a battle is the trainer's, whoever's machine put it there: no owner's name on it.
      text = `${e.shiny ? "✦ " : ""}${s?.name ?? e.species} · Lv ${e.level}${e.owner && e.ownerName && e.partnerUid !== "foe" ? ` · ${e.ownerName}` : ""}`;
    } else if (near && e.kind === "trainer" && e.trainerId) {
      const t = trainerById(e.trainerId);
      text = t ? trainerTitle(t) : "";
    }
    if (text !== v.tagText) {
      if (v.nameTag) { this.scene.remove(v.nameTag); v.nameTag.material.map?.dispose(); v.nameTag.material.dispose(); v.nameTag = undefined; }
      v.tagText = text;
      if (text) { v.nameTag = nameTag(text); this.scene.add(v.nameTag); }
    }
    if (v.nameTag) v.nameTag.position.set(x, y + e.body.height * (e.kind === "critter" ? 1.15 : 1) + 0.5, z);
  }

  private dropView(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    this.scene.remove(v.object);
    if (v.nameTag && v.entity) { this.scene.remove(v.nameTag); v.nameTag.material.map?.dispose(); v.nameTag.material.dispose(); }
    v.item?.dispose();
    v.lit?.dispose();
    v.model?.material.dispose();
    v.model?.wool?.dispose();
    v.model?.gel?.dispose();
    for (const m of v.mats ?? []) m.dispose();
    if (v.car) { for (const s of v.car.shaded) s.mat.dispose(); for (const m of v.car.lamps) m.dispose(); v.car.glass.dispose(); v.car.siren?.forEach((m) => m.dispose()); }
    v.driver?.material.dispose();
    if (v.crystal) this.scene.remove(v.crystal.beam);
    this.views.delete(id);
  }

  private updateEntities(frame: FrameState): void {
    const seen = new Set<number>();
    const a = frame.alpha;
    const camPos = this.camera.position;
    const maxDist = frame.renderDistance * 16 + 16;
    for (const e of frame.entities) {
      if (e.removed) continue;
      const x = e.prevX + (e.x - e.prevX) * a, y = e.prevY + (e.y - e.prevY) * a, z = e.prevZ + (e.z - e.prevZ) * a;
      if (Math.abs(x - camPos.x) > maxDist || Math.abs(z - camPos.z) > maxDist) continue;
      seen.add(e.id);
      const v = this.viewFor(e);
      const bright = this.brightness(x, y + e.body.height * 0.6, z);
      if (v.model && e instanceof Mob) {
        let yaw = e.prevYaw + angleDelta(e.prevYaw, e.yaw) * a;
        const speed = Math.hypot(e.x - e.prevX, e.z - e.prevZ);
        const walk = e.prevWalkDist + (e.walkDist - e.prevWalkDist) * a;
        if (e.kind === "creeper" && e.fuse > 0) yaw += 0;
        // Blazes and magma cubes glow with their own heat.
        const glowing = e.kind === "blaze" || e.kind === "magma_cube";
        if (e.kind === "blaze" && Math.random() < 0.1) this.particles.emit(Math.random() < 0.5 ? "smoke" : "flame", x, y + 1, z, 1, 0, 0.4);
        pose(v.model, v.modelKey ?? e.kind, {
          x, y, z, yaw, pitch: 0, walk, speed, light: glowing || (e.kind === "critter" && GLOWING_CRITTERS.has(e.species)) ? Math.max(bright, 0.95) : bright, hurt: e.hurtTime > 0, death: e.deathTime > 0 ? e.deathTime + a : 0,
          time: this.time, baby: e.baby, swell: e.kind === "creeper" ? e.fuse / 30 : 0,
          flash: e.kind === "creeper" && e.fuse > 0 && Math.floor(this.time * 8) % 2 === 0,
          woolColor: e.woolColor, sheared: e.sheared, onGround: e.body.onGround,
          // A piglin holds out the gold it is admiring.
          armsForward: e.kind === "zombie" || (e.kind === "skeleton" && e.targetId !== null) || (e.kind === "piglin" && e.admiring > 0)
            || ((e.kind === "infected" || e.kind === "brute" || e.kind === "bloater" || e.kind === "shambler") && e.targetId !== null)
            || e.kind === "crawler",
          size: modelScale(e), squish: e.squish,
          swing: e.kind === "iron_golem" ? Math.max(0, e.attackCooldown - 12) / 8 : 0,
          screaming: e.kind === "enderman" && e.scream > 0, carrying: e.kind === "enderman" && e.carried > 0,
          // The dragon noses down in a dive and up in a climb, and folds its wings on its perch.
          bank: e.kind === "ender_dragon" ? Math.max(-0.6, Math.min(0.6, -Math.atan2(e.y - e.prevY, Math.hypot(e.x - e.prevX, e.z - e.prevZ) + 0.05))) : 0,
          attach: e.attach, peek: e.peek, headYaw: e.kind === "shulker" ? e.headYaw : 0,
          // A wolf sits when told; it holds its tail low when angry (screaming) and wags it when tame (carrying).
          sitting: e.kind === "wolf" && e.sitting,
          ...(e.kind === "wolf" ? { screaming: e.anger > 0, carrying: !!e.owner } : {}),
          // A creature bites as its cooldown restarts; lies down when knocked out; shows its saddle.
          ...(isDino(e.kind) ? { swing: Math.max(0, e.attackCooldown - 14) / 6, saddled: e.saddled, asleep: e.unconscious } : {}),
        });
        if (isDino(e.kind)) this.creatureTag(v, e, x, y, z);
        if (e.kind === "critter" || e.kind === "trainer") this.critterTag(v, e, x, y, z, camPos);
        if (e.kind === "citizen" || e.kind === "cop") this.quipTag(v, e, x, y, z, camPos);
        if (e.kind === "ender_dragon") {
          // It is perched when its phase says so; the flag doubles as "wings folded".
          if (e.dragon?.phase === "perch") pose(v.model, e.kind, { x, y, z, yaw, pitch: 0, walk, speed, light: bright, hurt: e.hurtTime > 0, death: 0, time: this.time, swing: 0, size: 4, onGround: true });
          if (e.dying && Math.random() < 0.3) this.particles.emit("end_rod", x + (Math.random() - 0.5) * 6, y + 1.5 + (Math.random() - 0.5) * 3, z + (Math.random() - 0.5) * 6, 2, 0, 0.6);
        }
        if (v.lit && e.kind === "enderman") {
          const [s, b] = this.lightAt(x, y + 2, z);
          v.lit.uniforms.uSky.value = s; v.lit.uniforms.uBlock.value = b;
        }
        v.model.root.visible = !e.hasEffect("invisibility");
        v.object.position.set(0, 0, 0);
        continue;
      }
      if (v.car && e instanceof Car) {
        const yaw = e.prevYaw + angleDelta(e.prevYaw, e.yaw) * a;
        const turn = angleDelta(e.prevYaw, e.yaw);
        const roll = e.prevWalkDist + (e.walkDist - e.prevWalkDist) * a;
        poseCar(v.car, {
          x, y, z, yaw, light: bright, roll: roll * 3.3, steer: e.steer, lean: Math.max(-0.08, Math.min(0.08, turn * 1.2)),
          rock: e.hurtTime > 0 ? Math.sin((e.hurtTime - a) * 1.2) * e.hurtTime * 0.006 : 0, time: this.time, siren: e.siren,
          night: this.shared.uDaylight.value < 0.45,
        });
        if (v.driver) {
          v.driver.root.position.copy(v.car.seat);
          pose(v.driver, "citizen", { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, walk: 0, speed: 0, light: bright, hurt: false, death: 0, swing: 0, time: this.time, sitting: true, size: 0.85 });
          v.driver.root.position.copy(v.car.seat);
          v.driver.root.rotation.set(0, 0, 0);
        }
        v.object.position.set(0, 0, 0);
        continue;
      }
      if (v.model && e instanceof Vehicle) {
        const yaw = e.prevYaw + angleDelta(e.prevYaw, e.yaw) * a;
        const rock = e.hurtTime > 0 ? Math.sin((e.hurtTime - a) * 1.2) * e.hurtTime * 0.012 : 0;
        pose(v.model, e.kind, {
          x, y, z, yaw, pitch: 0, walk: e instanceof Boat ? e.paddle : 0, speed: 0, light: bright, hurt: false, death: 0,
          swing: 0, time: this.time, size: 2, rock,
        });
        if (v.lit) {
          const [s, b] = this.lightAt(x, y + 0.5, z);
          v.lit.uniforms.uSky.value = s; v.lit.uniforms.uBlock.value = b;
        }
        v.object.position.set(0, 0, 0);
        continue;
      }
      v.object.position.set(x, y, z);
      if (v.crystal && e instanceof EndCrystal) {
        // It turns and bobs; its beam stretches from its heart to whatever it heals.
        const t = this.time + e.id;
        const bob = 0.75 + Math.sin(t * 2) * 0.2;
        v.crystal.cage.position.y = bob; v.crystal.core.position.y = bob;
        v.crystal.cage.rotation.set(t * 1.3, t * 1.7, 0.6);
        v.crystal.core.rotation.set(0.6, -t * 2.1, t * 1.1);
        const beam = v.crystal.beam;
        if (e.beam) {
          const from = new THREE.Vector3(x, y + bob, z), to = new THREE.Vector3(e.beam.x, e.beam.y, e.beam.z);
          const len = from.distanceTo(to);
          beam.visible = len > 0.5;
          beam.position.copy(from).add(to).multiplyScalar(0.5);
          beam.scale.set(1, len, 1);
          beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize());
        } else beam.visible = false;
        if (v.lit) {
          const [s, b] = this.lightAt(x, y + 0.2, z);
          v.lit.uniforms.uSky.value = s; v.lit.uniforms.uBlock.value = b;
        }
        continue;
      }
      if (e instanceof ItemFrame) {
        // The body sits against the block; the board is drawn at its middle, flush with the face.
        const flat = e.face === Face.Up || e.face === Face.Down;
        v.object.position.set(x, flat ? (e.face === Face.Up ? e.by + 0.03 : e.by + 0.97) : y + 0.375, z);
        const [s, b] = this.lightAt(e.bx + 0.5, e.by + 0.5, e.bz + 0.5);
        v.item?.setLight(s, b);
        if (v.item) v.item.root.rotation.set(0, 0, -e.turn * Math.PI / 4);
        const shade = Math.max(0.15, s * this.shared.uDaylight.value, b);
        if (v.mats) { v.mats[0].color.set("#6e4c26").multiplyScalar(shade); v.mats[1].color.set("#b08a52").multiplyScalar(shade); }
        continue;
      }
      // A rocket leaves a trail of sparks as it climbs.
      if (e instanceof FireworkRocket && Math.random() < 0.85) this.particles.emit("firework_trail", x, y - 0.15, z, 1, 0, 0.05);
      if (v.item && e instanceof ItemEntity) {
        const [s, b] = this.lightAt(x, y + 0.2, z);
        v.item.setLight(s, b);
        v.item.root.position.y = 0.12 + Math.sin(this.time * 2.5 + e.bob) * 0.06;
        v.item.root.rotation.y = this.time * 1.6 + e.bob;
      } else if (v.item) {
        const [s, b] = this.lightAt(x, y, z);
        v.item.setLight(s, b);
        v.item.root.lookAt(camPos);
      } else if (e instanceof Projectile) {
        if (e.kind === "shulker_bullet") v.object.rotation.set(this.time * 5, this.time * 7, 0);
        else v.object.rotation.set(-e.pitch, e.yaw, 0, "YXZ");
      } else if (v.lit && (e instanceof FallingBlock || e instanceof PrimedTnt)) {
        const [s, b] = this.lightAt(x, y + 0.5, z);
        v.lit.uniforms.uSky.value = s;
        v.lit.uniforms.uBlock.value = b;
        if (e instanceof PrimedTnt) {
          v.lit.uniforms.uFlash.value = Math.floor(e.fuse / 5) % 2 === 0 ? 0.6 : 0;
          const sc = e.fuse < 10 ? 1 + (1 - e.fuse / 10) * 0.2 : 1;
          v.object.scale.setScalar(sc);
        }
      } else if (e instanceof XpOrb) {
        v.object.position.y += 0.15 + Math.sin(this.time * 4 + e.id) * 0.05;
        v.object.lookAt(camPos);
      }
    }
    for (const id of [...this.views.keys()]) if (!seen.has(id)) this.dropView(id);
  }

  private playerView(p: RemotePlayerView, existing: (EntityView & { variant: number }) | undefined): EntityView & { variant: number } {
    if (existing && existing.variant === p.variant) return existing;
    if (existing) this.scene.remove(existing.object);
    const model = buildModel("player", p.variant);
    const object = new THREE.Group();
    object.add(model.root);
    const tag = nameTag(p.name);
    tag.position.set(0, 2.25, 0);
    object.add(tag);
    this.scene.add(object);
    return { entity: null as unknown as Entity, object, model, nameTag: tag, variant: p.variant };
  }

  private held = new Map<string, { id: number | null; mesh: THREE.Object3D | null; mat: THREE.RawShaderMaterial | null }>();

  private attachHeld(key: string, model: ModelInstance, itemId: number | null, sky: number, blk: number): void {
    let h = this.held.get(key);
    if (!h) { h = { id: undefined as unknown as null, mesh: null, mat: null }; this.held.set(key, h); }
    const arm = model.parts.get("rightArm");
    if (!arm) return;
    if (h.id !== itemId) {
      if (h.mesh) arm.remove(h.mesh);
      h.mat?.dispose();
      h.mesh = null; h.mat = null; h.id = itemId;
      if (itemId !== null) {
        const m = itemModel(itemId);
        h.mat = m.kind === "block" ? createLitBlockMaterial(this.shared) : createSpriteMaterial(this.shared);
        const mesh = new THREE.Mesh(m.geometry, h.mat);
        mesh.scale.setScalar(m.kind === "block" ? 0.3 : 0.5);
        mesh.position.set(0, -0.62, -0.12);
        mesh.rotation.set(m.kind === "block" ? 0 : -Math.PI / 2 + 0.3, m.kind === "block" ? Math.PI / 4 : Math.PI / 2, 0);
        arm.add(mesh);
        h.mesh = mesh;
      }
    }
    if (h.mat) { h.mat.uniforms.uSky.value = sky; h.mat.uniforms.uBlock.value = blk; }
  }

  private updatePlayers(frame: FrameState): void {
    const seen = new Set<string>();
    for (const p of frame.remotePlayers) {
      if (p.dead) continue;
      seen.add(p.id);
      const v = this.playerView(p, this.players.get(p.id));
      this.players.set(p.id, v);
      pose(v.model!, "player", {
        x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, walk: p.walk, speed: p.speed,
        light: this.brightness(p.x, p.y + 1.6, p.z), hurt: p.hurt, death: 0, swing: p.swing, time: this.time, sneaking: p.sneaking,
        sitting: p.sitting, gliding: p.gliding, size: p.inCar ? 0.85 : 1,
      });
      const [s, b] = this.lightAt(p.x, p.y + 1, p.z);
      this.attachHeld(p.id, v.model!, p.heldItem, s, b);
      if (v.nameTag) { v.nameTag.position.y = p.sneaking ? 2.0 : 2.25; v.nameTag.visible = !p.invisible; }
      setBodyVisible(v.model!, !p.invisible);
    }
    for (const [id, v] of this.players) {
      if (!seen.has(id)) { this.scene.remove(v.object); this.players.delete(id); this.held.delete(id); }
    }
    // The local player's own body, for third person.
    const lp = frame.localPlayer;
    // Backed against a wall the camera sits inside your own head: show the view, not the skull.
    if (frame.perspective !== 0 && !lp.dead && this.cameraPull >= 1.2) {
      if (!this.localModel || this.localVariant !== lp.variant) {
        if (this.localModel) this.scene.remove(this.localModel.root);
        this.localModel = buildModel("player", lp.variant);
        this.localVariant = lp.variant;
        this.held.delete("__local");
        this.scene.add(this.localModel.root);
      }
      this.localModel.root.visible = true;
      pose(this.localModel, "player", {
        x: lp.x, y: lp.y, z: lp.z, yaw: lp.yaw, pitch: lp.pitch, walk: lp.walk, speed: lp.speed,
        light: this.brightness(lp.x, lp.y + 1.6, lp.z), hurt: lp.hurt, death: 0, swing: lp.swing, time: this.time, sneaking: lp.sneaking,
        sitting: lp.sitting, gliding: lp.gliding, size: lp.inCar ? 0.85 : 1,
      });
      const [s, b] = this.lightAt(lp.x, lp.y + 1, lp.z);
      this.attachHeld("__local", this.localModel, lp.heldItem, s, b);
    } else if (this.localModel) {
      this.localModel.root.visible = false;
    }
  }

  render(frame: FrameState): void {
    if (this.contextLost) return;
    this.lastFrameState = frame;
    this.time += frame.dt;
    const sky = skyState(frame.time, frame.rain, frame.thunder, frame.dimension ? null : frame.celestial);
    if (frame.lightning > 0) this.flash = 1;
    this.flash = Math.max(0, this.flash - frame.dt * 4);
    const u = this.shared;
    const dim = frame.dimension;
    u.uTime.value = this.time;
    // Without a sky there is no sky light to scale; full "daylight" also keeps the moonlight tint off.
    u.uDaylight.value = dim ? dim.sky ?? 1 : Math.min(1, sky.daylight + this.flash * 0.8);
    u.uAmbient.value = dim ? dim.ambient : 0;
    u.uNightVision.value = frame.nightVision ? 0.9 : 0;
    u.uWave.value = frame.wave ? 1 : 0;
    this.dyn = frame.dynamicLights ?? [];
    this.dyn.forEach(([x, y, z, level], i) => u.uDynLights.value[i].set(x, y, z, level));
    u.uDynCount.value = this.dyn.length;
    const season = frame.season ?? [1, 1, 1, 0];
    u.uSeason.value.set(season[0], season[1], season[2], season[3]);

    // Camera.
    const c = frame.camera;
    const cam = this.camera;
    if (cam.fov !== c.fov) { cam.fov = c.fov; cam.updateProjectionMatrix(); this.particles.setViewportHeight(this.height * this.renderer.getPixelRatio(), c.fov); }
    const renderFar = frame.renderDistance * 16;
    cam.far = Math.max(64, renderFar + 64);
    cam.updateProjectionMatrix();
    cam.rotation.order = "YXZ";
    let yaw = c.yaw, pitch = c.pitch;
    let cx = c.x, cy = c.y, cz = c.z;
    if (frame.perspective === 0) {
      const w = frame.bob.walk * Math.PI, amt = frame.bob.amount;
      const side = Math.sin(w) * amt * 0.5, up = -Math.abs(Math.cos(w) * amt);
      cx += Math.cos(yaw) * side * 0.1; cz -= Math.sin(yaw) * side * 0.1;
      cy += up * 0.1;
      cam.rotation.set(pitch + Math.abs(Math.cos(w - 0.2) * amt) * 0.02, yaw, Math.sin(w) * amt * 0.05 + frame.hurtTilt * 0.25);
    } else {
      // Third person: pull back along the view, stopping short of walls.
      const back = frame.perspective === 1 ? 1 : -1;
      if (back < 0) { yaw += Math.PI; pitch = -pitch; }
      const dx = Math.sin(yaw) * Math.cos(pitch), dy = -Math.sin(pitch), dz = Math.cos(yaw) * Math.cos(pitch);
      const reach = frame.cameraDistance ?? 4;
      let dist = reach;
      for (let t = 0.5; t <= reach; t += 0.25) {
        const id = this.world.blockAt(Math.floor(cx + dx * t), Math.floor(cy + dy * t), Math.floor(cz + dz * t));
        if (id && block(id).opaque) { dist = Math.max(0.5, t - 0.3); break; }
      }
      cx += dx * dist; cy += dy * dist; cz += dz * dist;
      this.cameraPull = dist;
      cam.rotation.set(pitch, yaw, 0);
    }
    cam.position.set(cx, cy, cz);
    cam.updateMatrixWorld();

    // Fog and sky colour.
    let fogColor = dim ? new THREE.Color(((dim.fog >> 16) & 255) / 255, ((dim.fog >> 8) & 255) / 255, (dim.fog & 255) / 255) : sky.horizon.clone();
    const closeFog = dim && !dim.open;
    let near = closeFog ? Math.min(renderFar * 0.3, 40) : renderFar * 0.72, far = closeFog ? Math.min(renderFar * 0.95, 110) : renderFar * 0.98;
    if (frame.underwater) { fogColor = WATER_FOG.clone().multiplyScalar(0.3 + sky.daylight * 0.7); near = 2; far = 24; }
    if (frame.inLava) { fogColor = LAVA_FOG.clone(); near = 0.2; far = 2.5; }
    if (frame.blind) { fogColor = new THREE.Color(0.02, 0.02, 0.02); near = 1; far = 6; }
    // A blood moon: the night's haze turns red, and closes in a little.
    else if (frame.bloodMoon && !frame.underwater && !frame.inLava) { fogColor = fogColor.clone().lerp(new THREE.Color(0.45, 0.02, 0.02), 0.75); near *= 0.6; far *= 0.8; }
    if (frame.rain > 0 && !frame.underwater) { near *= 1 - frame.rain * 0.4; }
    u.uFogColor.value.copy(fogColor);
    u.uFogNear.value = near;
    u.uFogFar.value = far;
    this.sky.cloudsVisible = frame.clouds && !frame.underwater && !dim;
    this.sky.group.visible = !dim;
    this.sky.update(cam, sky, this.time * 20, renderFar, this.renderer.getPixelRatio());
    this.renderer.setClearColor(fogColor);

    this.updateSelection(frame.target);
    if (frame.crack >= 0 && frame.target) {
      this.crack.visible = true;
      this.crack.position.set(frame.target.x + 0.5, frame.target.y + 0.5, frame.target.z + 0.5);
      this.crackMat.uniforms.uLayer.value = layerOf(`destroy_stage_${Math.min(9, frame.crack)}`);
    } else this.crack.visible = false;

    this.updateBorder(frame.border ?? null, c.x, c.z);
    this.updateMarkers(frame.markers ?? []);
    this.updateEntities(frame);
    this.updatePlayers(frame);
    this.particles.update(frame.dt, dim ? dim.sky ?? 0 : sky.daylight, dim?.ambient ?? 0);
    const bright = this.brightness(c.x, c.y, c.z);
    this.weather.update(frame.dt, cam.position, frame.rain, frame.snowing, this.time, bright);

    this.renderer.info.reset();
    this.renderer.clear();
    this.renderer.render(this.backdrop, cam);
    this.renderer.render(this.scene, cam);
    if (frame.showHand && frame.perspective === 0) {
      this.hand.update(frame.hand);
      this.renderer.clearDepth();
      this.renderer.render(this.hand.scene, this.hand.camera);
    }
  }

  /**
   * The border as the original draws it: four walls of drifting stripes that
   * only show as you come near, so a shrinking border is seen coming rather
   * than learned about from the damage.
   */
  /**
   * A mission's marks, drawn the way the city games draw them: a column of
   * light rising from the spot, see-through and glowing whatever the time of
   * day, with a ring turning at the top so it catches the eye from afar.
   */
  private updateMarkers(markers: { x: number; y: number; z: number; color: string; r: number }[]): void {
    const key = markers.map((m) => `${m.color}:${m.r}`).join("|");
    if (key !== this.markerKey) {
      this.markerKey = key;
      for (const v of this.markerViews) { this.scene.remove(v.column, v.ring); v.column.geometry.dispose(); v.ring.geometry.dispose(); v.mat.dispose(); }
      this.markerViews = markers.map((m) => {
        const mat = new THREE.MeshBasicMaterial({ color: col(m.color), transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
        const column = new THREE.Mesh(new THREE.CylinderGeometry(m.r * 0.6, m.r * 0.6, 5, 24, 1, true), mat);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(m.r * 0.6, 0.08, 6, 32), mat);
        ring.rotation.x = Math.PI / 2;
        this.scene.add(column, ring);
        return { column, ring, mat };
      });
    }
    markers.forEach((m, i) => {
      const v = this.markerViews[i];
      if (!v) return;
      v.column.position.set(m.x, m.y + 2.5, m.z);
      v.ring.position.set(m.x, m.y + 0.2 + ((this.time * 0.8) % 1) * 4.6, m.z);
      v.mat.opacity = 0.28 + Math.sin(this.time * 4) * 0.08;
    });
  }

  private updateBorder(border: FrameState["border"], x: number, z: number): void {
    const key = border ? `${border.x},${border.z},${border.radius}` : "";
    if (key !== this.borderKey) {
      this.borderKey = key;
      if (this.borderWall) {
        this.scene.remove(this.borderWall);
        const mat = (this.borderWall.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.dispose();
        this.borderWall.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      }
      this.borderWall = border ? borderWalls(border.x, border.z, border.radius) : null;
      if (this.borderWall) this.scene.add(this.borderWall);
    }
    const wall = this.borderWall;
    if (!wall || !border) return;
    const inside = border.radius - Math.max(Math.abs(x - border.x), Math.abs(z - border.z));
    const near = Math.max(0, Math.min(1, 1 - inside / 32));
    wall.visible = near > 0;
    const mat = (wall.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    mat.opacity = 0.2 + near * 0.45;
    if (mat.map) mat.map.offset.x = (this.time * 0.25) % 1;
  }

  stats(): { chunks: number; quads: number; calls: number; triangles: number } {
    const info = this.renderer.info.render;
    return { chunks: this.chunks.count, quads: this.chunks.quads, calls: info.calls, triangles: info.triangles };
  }

  /**
   * The drawing buffer is not preserved (that costs every frame), so it is
   * already blank by the time a key handler runs: draw the last frame again
   * and read it in the same task.
   */
  screenshot(type = "image/png", quality?: number): string {
    if (this.lastFrameState) this.render({ ...this.lastFrameState, dt: 0 });
    return this.canvas.toDataURL(type, quality);
  }

  dispose(): void {
    for (const id of [...this.views.keys()]) this.dropView(id);
    this.chunks.clear();
    this.renderer.dispose();
  }
}

let borderTexture: THREE.CanvasTexture | null = null;

/** Diagonal cyan stripes on nothing, tiled every two blocks. */
function borderStripes(): THREE.CanvasTexture {
  if (borderTexture) return borderTexture;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 32;
  const g = cv.getContext("2d")!;
  g.strokeStyle = "rgba(60,190,255,1)";
  g.lineWidth = 5;
  for (let i = -32; i <= 64; i += 16) { g.beginPath(); g.moveTo(i, 32); g.lineTo(i + 32, 0); g.stroke(); }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.NoColorSpace;
  return (borderTexture = t);
}

function borderWalls(cx: number, cz: number, r: number): THREE.Group {
  const lo = -64, hi = 320, h = hi - lo;
  const tex = borderStripes().clone();
  tex.needsUpdate = true;
  tex.repeat.set(r, h / 2);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, fog: false });
  const group = new THREE.Group();
  const sides: [number, number, number][] = [[cx, cz - r, 0], [cx, cz + r, Math.PI], [cx - r, cz, Math.PI / 2], [cx + r, cz, -Math.PI / 2]];
  for (const [x, z, rot] of sides) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, h), mat);
    m.position.set(x, lo + h / 2, z);
    m.rotation.y = rot;
    m.renderOrder = 4;
    m.frustumCulled = false;
    group.add(m);
  }
  return group;
}

function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Snowballs and eggs in flight look like the item that was thrown. */
/** Which skin a mob wears: a villager's robe follows its trade. */
function skinVariant(e: Mob): number {
  if (e.kind === "villager") return e.profession === "none" ? 0 : PROFESSIONS.indexOf(e.profession) + 1;
  // A ghast about to spit opens its eyes and mouth.
  if (e.kind === "ghast") return e.fuse > 10 ? 1 : 0;
  // An enderman's stare, and the block in its arms (drawn with the model, so a new one rebuilds it).
  if (e.kind === "enderman") return (e.scream > 0 ? 1 : 0) | (e.carried << 1);
  if (e.kind === "shulker") return e.shellColor;
  // A wolf's collar when tame; red eyes when angry.
  if (e.kind === "wolf") return (e.owner ? 1 : 0) | (e.anger > 0 ? 2 : 0);
  if (e.kind === "tribute") return e.id % 24;
  if (e.kind === "citizen") return e.id % 64;
  if (e.kind === "cop") return e.id % 16;
  if (isDino(e.kind)) return e.id % 4;
  if (isInfectedMob(e.kind)) return e.id % 8;
  if (e.kind === "critter") return e.shiny ? 1 : 0;
  // A trainer dressed for their calling, their face their own.
  if (e.kind === "trainer") {
    const t = e.trainerId ? trainerById(e.trainerId) : null;
    const cls = Math.max(0, TRAINER_CLASS_ORDER.indexOf(t?.cls ?? "youngster"));
    return (cls << 6) | (seedFromString(e.trainerId ?? String(e.id)) & 63);
  }
  return 0;
}

/** The model a mob is drawn from: its kind's, or its species' for a critter. */
function modelKey(e: Mob): string {
  return e.kind === "critter" ? `critter_${e.species}` : e.kind;
}

/** Critters made of light: drawn bright in the dark. */
const GLOWING_CRITTERS = new Set(["wisplet", "lanternwisp", "lumoth", "jellispark", "emberkit", "cinderlynx", "pyrolion"]);

/** How much bigger than its model a mob is drawn: a ghast is four blocks across, a hoglin is modelled at half size. */
function modelScale(e: Mob): number {
  switch (e.kind) {
    case "ghast": return 4;
    case "ender_dragon": return 4;
    case "hoglin": return 2;
    case "bear": return 2;
    case "shulker": return 2;
    case "wither_skeleton": return 1.2;
    case "brute": return 1.35;
    case "bloater": return 1.15;
    case "critter": return SPECIES[e.species]?.scale ?? 1;
    default: return isDino(e.kind) ? CREATURES[e.kind].scale : e.size;
  }
}

/** Hides a player model's own boxes but keeps whatever it holds in its hand. */
function setBodyVisible(model: ModelInstance, on: boolean): void {
  model.root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material === model.material) o.visible = on;
  });
}

let frameParts: [THREE.BufferGeometry, THREE.BufferGeometry] | null = null;
/** An item frame's board: a rim of dark wood and a paler back (geometry shared by every frame). */
function frameGeometry(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  return (frameParts ??= [new THREE.BoxGeometry(0.75, 0.75, 0.05), new THREE.BoxGeometry(0.6, 0.6, 0.02).translate(0, 0, 0.026)]);
}

let bullet: [THREE.Mesh, THREE.Mesh] | null = null;
function bulletMeshes(): [THREE.Mesh, THREE.Mesh] {
  return (bullet ??= [
    new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshBasicMaterial({ color: col("#f4ecff") })),
    new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: col("#c9a8e8") })),
  ]);
}

function itemIdFor(kind: string): number {
  return itemId(kind);
}

/** An end crystal: a pink heart in two turning cages, and a beam for when it heals the dragon. */
function crystalView(): { cage: THREE.Object3D; core: THREE.Object3D; beam: THREE.Mesh } {
  const cage = new THREE.Group();
  for (const size of [0.9, 0.7]) {
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size)), new THREE.LineBasicMaterial({ color: col("#e8f4ff") }));
    edges.rotation.set(size, size * 2, 0);
    cage.add(edges);
  }
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshBasicMaterial({ color: col("#ff5ad8") }));
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 1, 6, 1, true),
    new THREE.MeshBasicMaterial({ color: col("#ff9ae8"), transparent: true, opacity: 0.75, depthWrite: false }),
  );
  beam.visible = false;
  return { cage, core, beam };
}
