/**
 * What you hold, drawn in its own pass over the world so it never clips into
 * a wall you are standing against — the world's depth is cleared before the
 * hand is drawn, the way first-person games have always done it.
 */
import * as THREE from "three";
import { itemDef } from "../engine/items";
import { createLitBlockMaterial, createSpriteMaterial, type SharedUniforms } from "./materials";
import { itemModel } from "./itemModels";
import { buildModel, type ModelInstance } from "./models";

export interface HandState {
  itemId: number | null;
  /** 0..1 through an attack or place swing, or 0 at rest. */
  swing: number;
  /** 0 fully raised .. 1 lowered out of view (switching items). */
  equip: number;
  /** Walk phase and amount, for the bob. */
  walk: number;
  bob: number;
  sky: number;
  block: number;
  eating: number;
  bowPull: number;
  skinVariant: number;
  hurt: boolean;
}

export class Hand {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
  private holder = new THREE.Group();
  private current: number | null | undefined = undefined;
  private mesh: THREE.Object3D | null = null;
  private material: THREE.RawShaderMaterial | null = null;
  private arm: ModelInstance | null = null;
  private armVariant = -1;

  constructor(private shared: SharedUniforms) {
    this.scene.add(this.holder);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private rebuild(itemId: number | null, variant: number): void {
    if (this.mesh) this.holder.remove(this.mesh);
    this.material?.dispose();
    this.material = null;
    this.mesh = null;
    this.current = itemId;
    if (itemId === null) {
      if (!this.arm || this.armVariant !== variant) {
        this.arm = buildModel("player", variant);
        this.armVariant = variant;
      }
      // Just the right arm, big and close.
      const armPivot = this.arm.parts.get("rightArm")!;
      const armMesh = armPivot.children[0].clone();
      const group = new THREE.Group();
      armMesh.position.set(0, 0, 0);
      group.add(armMesh);
      group.scale.setScalar(2.2);
      this.mesh = group;
    } else {
      const model = itemModel(itemId);
      this.material = model.kind === "block" ? createLitBlockMaterial(this.shared, false) : createSpriteMaterial(this.shared, false);
      const m = new THREE.Mesh(model.geometry, this.material);
      const group = new THREE.Group();
      group.add(m);
      if (model.kind === "block") {
        m.scale.setScalar(0.4);
        m.position.set(0, -0.2, 0);
        group.rotation.set(0, Math.PI / 4, 0);
      } else {
        const def = itemDef(itemId);
        const tool = !!def?.tool || def?.use === "bow" || def?.name === "stick";
        m.scale.setScalar(0.7);
        group.rotation.set(0, -Math.PI / 2 + 0.1, tool ? 0.35 : 0.15);
      }
      this.mesh = group;
    }
    this.holder.add(this.mesh);
  }

  update(s: HandState): void {
    if (s.itemId !== this.current) this.rebuild(s.itemId, s.skinVariant);
    if (this.material) {
      this.material.uniforms.uSky.value = s.sky;
      this.material.uniforms.uBlock.value = s.block;
      this.material.uniforms.uFlash.value = 0;
    }
    if (this.arm) {
      const l = Math.max(s.sky * this.shared.uDaylight.value, s.block);
      const b = Math.max(0.15, l / (4 - 3 * l));
      this.arm.material.color.setRGB(b, s.hurt ? b * 0.6 : b, s.hurt ? b * 0.6 : b);
    }
    const empty = s.itemId === null;
    const bobX = Math.sin(s.walk * Math.PI) * s.bob * 0.06;
    const bobY = -Math.abs(Math.cos(s.walk * Math.PI) * s.bob) * 0.08;
    const sw = s.swing;
    const swingSin = Math.sin(sw * Math.PI);
    const swingRoot = Math.sin(Math.sqrt(sw) * Math.PI);
    const h = this.holder;
    h.position.set(0.56 + bobX - swingRoot * 0.2, -0.52 + bobY - s.equip * 0.6 + swingRoot * 0.08, -0.72 - swingSin * 0.15);
    h.rotation.set(-swingRoot * 0.6, -swingSin * 0.35, -swingSin * 0.2);
    if (empty) {
      h.position.set(0.5 + bobX - swingRoot * 0.25, -0.62 + bobY - s.equip * 0.6 + swingRoot * 0.1, -0.55 - swingSin * 0.2);
      h.rotation.set(1.2 - swingRoot * 0.8, -0.5 - swingSin * 0.4, 0.2);
    }
    if (s.eating > 0) {
      h.position.x -= 0.25;
      h.position.y += 0.12 + Math.abs(Math.sin(s.eating * 25)) * 0.06;
      h.rotation.y += 0.6;
    }
    if (s.bowPull > 0) {
      h.position.x -= 0.2;
      h.position.z += s.bowPull * 0.15;
      h.rotation.z += 0.3;
      h.position.x += Math.sin(s.bowPull * 40) * 0.004 * s.bowPull;
    }
  }
}
