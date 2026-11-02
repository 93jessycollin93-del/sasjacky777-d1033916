/**
 * Shaders.
 *
 * One chunk shader draws every block. Light arrives per vertex as separate
 * sky and block levels, and the shader mixes them with the time of day, so
 * dusk falling never needs a single chunk remeshed — that is what lets the
 * sun set smoothly over a few hundred chunks on a phone. Torchlight is warmed
 * slightly where it outshines the sky, which is most of what makes a cave at
 * night read as lit rather than just grey.
 *
 * Colour is kept in the same space the textures were painted in, end to end;
 * the renderer is set not to convert, so a painted #7f7f7f stone is the
 * #7f7f7f on screen at full light.
 */
import * as THREE from "three";
import { buildAtlas } from "../engine/atlas";
import { TEX } from "../engine/textures";

/**
 * A colour from a hex string, stored exactly as written. THREE.Color parses
 * hex as sRGB and converts it to linear, which this pipeline (display-space
 * end to end, see above) would then show darker than the painted value.
 * Turning colour management off globally would fix it here and quietly change
 * every other three.js scene in the app, so every colour in the game goes
 * through this instead.
 */
export function col(hex: string): THREE.Color {
  const n = parseInt(hex.replace("#", ""), 16);
  return new THREE.Color().setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, THREE.LinearSRGBColorSpace);
}

let atlasTexture: THREE.DataArrayTexture | null = null;

export function getAtlasTexture(): THREE.DataArrayTexture {
  if (atlasTexture) return atlasTexture;
  const atlas = buildAtlas();
  const tex = new THREE.DataArrayTexture(atlas.pixels as Uint8Array<ArrayBuffer>, TEX, TEX, atlas.count);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  atlasTexture = tex;
  return tex;
}

export interface SharedUniforms {
  uAtlas: { value: THREE.DataArrayTexture };
  uTime: { value: number };
  uDaylight: { value: number };
  uFogColor: { value: THREE.Color };
  uFogNear: { value: number };
  uFogFar: { value: number };
  uGamma: { value: number };
  uWave: { value: number };
  uNightVision: { value: number };
  /** A floor under all light: the Nether's and the End's dim glow where no sky reaches. */
  uAmbient: { value: number };
  /**
   * Light that moves: a torch in hand, a burning mob, a blaze, a rocket — as
   * (x, y, z, level). It lights blocks per fragment as block light would,
   * without a chunk being remeshed, which is what keeps it smooth.
   */
  uDynLights: { value: THREE.Vector4[] };
  uDynCount: { value: number };
  /** The season's colour over grass and leaves (rgb) and how strongly (a). */
  uSeason: { value: THREE.Vector4 };
}

/** How many moving lights the chunk shader takes at once: the nearest, chosen each frame. */
export const MAX_DYNAMIC_LIGHTS = 8;

export function createSharedUniforms(): SharedUniforms {
  return {
    uAtlas: { value: getAtlasTexture() },
    uTime: { value: 0 },
    uDaylight: { value: 1 },
    uFogColor: { value: new THREE.Color(0.75, 0.85, 1) },
    uFogNear: { value: 60 },
    uFogFar: { value: 90 },
    uGamma: { value: 0.35 },
    uWave: { value: 1 },
    uNightVision: { value: 0 },
    uAmbient: { value: 0 },
    uDynLights: { value: Array.from({ length: MAX_DYNAMIC_LIGHTS }, () => new THREE.Vector4()) },
    uDynCount: { value: 0 },
    uSeason: { value: new THREE.Vector4(1, 1, 1, 0) },
  };
}

const CHUNK_VERTEX = /* glsl */ `
precision highp float;
precision highp int;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
uniform float uWave;
in vec3 position;
in vec4 aTex;
in vec4 aLight;
in vec4 aColor;
out vec3 vUv;
out vec2 vLight;
out float vShade;
out vec4 vTint;
out float vDist;
out vec3 vWorld;
void main() {
  vec3 p = position;
  int flags = int(aLight.w + 0.5);
  float layer = aTex.z + aTex.w * 256.0;
  if (uWave > 0.5 && (flags & 5) != 0) {
    bool moves = (flags & 1) != 0 || aTex.y < 0.5;
    if (moves) {
      vec4 wp = modelMatrix * vec4(p, 1.0);
      float amp = (flags & 1) != 0 ? 0.35 : 0.9;
      p.x += sin(uTime * 1.7 + wp.x * 0.55 + wp.z * 0.35) * amp;
      p.z += cos(uTime * 1.4 + wp.z * 0.6 + wp.x * 0.25) * amp;
    }
  }
  if ((flags & 2) != 0) layer += mod(floor(uTime * 8.0), 16.0);
  vUv = vec3(aTex.x / 16.0, aTex.y / 16.0, layer);
  vLight = aLight.xy / 255.0;
  vShade = aLight.z / 255.0;
  vTint = vec4(aColor.rgb / 255.0, aColor.a);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDist = length(mv.xyz);
  vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
  gl_Position = projectionMatrix * mv;
}`;

const LIGHTING = /* glsl */ `
uniform float uDaylight;
uniform float uGamma;
uniform float uNightVision;
uniform float uAmbient;
vec3 applyLight(vec3 col, float sky, float blk, float shade) {
  float s = sky * uDaylight;
  float l = max(max(max(s, blk), uNightVision), uAmbient);
  float b = l / (4.0 - 3.0 * l);
  b = mix(b, sqrt(b), uGamma);
  b = max(b, 0.025);
  float warm = clamp((blk - s) * 1.5, 0.0, 1.0);
  vec3 lightCol = mix(vec3(1.0), vec3(1.0, 0.84, 0.64), warm * 0.55);
  // Moonlight is a little blue.
  lightCol *= mix(vec3(0.78, 0.84, 1.0), vec3(1.0), clamp(uDaylight * 1.4, 0.0, 1.0) + warm);
  return col * b * shade * lightCol;
}`;

const CHUNK_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uAlphaTest;
uniform float uTranslucent;
in vec3 vUv;
in vec2 vLight;
in float vShade;
in vec4 vTint;
in float vDist;
in vec3 vWorld;
uniform vec4 uDynLights[${MAX_DYNAMIC_LIGHTS}];
uniform int uDynCount;
uniform vec4 uSeason;
out vec4 outColor;
${LIGHTING}
void main() {
  vec4 tex = texture(uAtlas, vUv);
  if (uAlphaTest > 0.0 && tex.a < uAlphaTest) discard;
  float tintAmount = vTint.a < 0.5 ? 0.0 : (vTint.a < 1.5 ? 1.0 : 1.0 - tex.a);
  vec3 tint = vTint.rgb;
  // The season turns grass and leaves (not water, which is drawn in the translucent pass).
  if (uSeason.a > 0.0 && uTranslucent < 0.5) {
    float lum = dot(tint, vec3(0.3, 0.59, 0.11));
    tint = mix(tint, uSeason.rgb * (0.55 + lum), uSeason.a);
  }
  vec3 col = tex.rgb * mix(vec3(1.0), tint, tintAmount);
  // Moving light falls off a level a block, as block light does.
  float blk = vLight.y;
  for (int i = 0; i < ${MAX_DYNAMIC_LIGHTS}; i++) {
    if (i >= uDynCount) break;
    vec4 L = uDynLights[i];
    blk = max(blk, clamp((L.w - distance(vWorld, L.xyz)) / 15.0, 0.0, 1.0));
  }
  col = applyLight(col, vLight.x, blk, vShade);
  float fog = smoothstep(uFogNear, uFogFar, vDist);
  col = mix(col, uFogColor, fog);
  outColor = vec4(col, uTranslucent > 0.5 ? tex.a : 1.0);
}`;

export type ChunkPass = "opaque" | "cutout" | "translucent";

export function createChunkMaterial(shared: SharedUniforms, pass: ChunkPass): THREE.RawShaderMaterial {
  const m = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: CHUNK_VERTEX,
    fragmentShader: CHUNK_FRAGMENT,
    uniforms: {
      ...shared,
      uAlphaTest: { value: pass === "cutout" ? 0.5 : pass === "translucent" ? 0.02 : 0 },
      uTranslucent: { value: pass === "translucent" ? 1 : 0 },
    },
    transparent: pass === "translucent",
    depthWrite: pass !== "translucent",
    // The mesher already emits both windings where a face must be seen from
    // behind (water from below, plants); double-siding here would draw
    // translucent faces twice and double their opacity.
    side: THREE.FrontSide,
  });
  return m;
}

/** Flat textured quads and small cubes lit by a single brightness (held items, drops, entities' items). */
const SPRITE_VERTEX = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
in vec2 uv;
in float aLayer;
in float aShade;
out vec3 vUv;
out float vShade;
out float vDist;
void main() {
  vUv = vec3(uv, aLayer);
  vShade = aShade;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const SPRITE_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uSky;
uniform float uBlock;
uniform vec3 uTint;
uniform float uFlash;
uniform float uFog;
in vec3 vUv;
in float vShade;
in float vDist;
out vec4 outColor;
${LIGHTING}
void main() {
  vec4 tex = texture(uAtlas, vUv);
  if (tex.a < 0.5) discard;
  vec3 col = applyLight(tex.rgb * uTint, uSky, uBlock, vShade);
  col = mix(col, vec3(1.0), uFlash);
  if (uFog > 0.5) col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vDist));
  outColor = vec4(col, 1.0);
}`;

export function createSpriteMaterial(shared: SharedUniforms, fog = true): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: SPRITE_VERTEX,
    fragmentShader: SPRITE_FRAGMENT,
    uniforms: {
      uAtlas: shared.uAtlas, uFogColor: shared.uFogColor, uFogNear: shared.uFogNear, uFogFar: shared.uFogFar,
      uDaylight: shared.uDaylight, uGamma: shared.uGamma, uNightVision: shared.uNightVision, uAmbient: shared.uAmbient,
      uSky: { value: 1 }, uBlock: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) }, uFlash: { value: 0 },
      uFog: { value: fog ? 1 : 0 },
    },
    side: THREE.DoubleSide,
  });
}

/** Chunk-format geometry drawn with light supplied per object instead of per vertex. */
const LIT_CHUNK_VERTEX = CHUNK_VERTEX;
const LIT_CHUNK_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uSky;
uniform float uBlock;
uniform float uFlash;
uniform float uFog;
in vec3 vUv;
in vec2 vLight;
in float vShade;
in vec4 vTint;
in float vDist;
out vec4 outColor;
${LIGHTING}
void main() {
  vec4 tex = texture(uAtlas, vUv);
  if (tex.a < 0.5) discard;
  float tintAmount = vTint.a < 0.5 ? 0.0 : (vTint.a < 1.5 ? 1.0 : 1.0 - tex.a);
  vec3 col = tex.rgb * mix(vec3(1.0), vTint.rgb, tintAmount);
  col = applyLight(col, uSky, uBlock, vShade);
  col = mix(col, vec3(1.0), uFlash);
  if (uFog > 0.5) col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vDist));
  outColor = vec4(col, 1.0);
}`;

export function createLitBlockMaterial(shared: SharedUniforms, fog = true): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: LIT_CHUNK_VERTEX,
    fragmentShader: LIT_CHUNK_FRAGMENT,
    uniforms: {
      uAtlas: shared.uAtlas, uFogColor: shared.uFogColor, uFogNear: shared.uFogNear, uFogFar: shared.uFogFar,
      uDaylight: shared.uDaylight, uGamma: shared.uGamma, uNightVision: shared.uNightVision, uAmbient: shared.uAmbient, uTime: shared.uTime,
      uWave: { value: 0 }, uSky: { value: 1 }, uBlock: { value: 0 }, uFlash: { value: 0 }, uFog: { value: fog ? 1 : 0 },
    },
    side: THREE.DoubleSide,
  });
}

/** The crack overlay drawn over a block being mined. */
export function createCrackMaterial(shared: SharedUniforms): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: /* glsl */ `
      precision highp float;
      uniform mat4 modelViewMatrix;
      uniform mat4 projectionMatrix;
      in vec3 position;
      in vec2 uv;
      out vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      precision highp sampler2DArray;
      uniform sampler2DArray uAtlas;
      uniform float uLayer;
      in vec2 vUv;
      out vec4 outColor;
      void main() {
        vec4 t = texture(uAtlas, vec3(vUv, uLayer));
        if (t.a < 0.1) discard;
        outColor = vec4(0.0, 0.0, 0.0, t.a * 0.7);
      }`,
    uniforms: { uAtlas: shared.uAtlas, uLayer: { value: 0 } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}
