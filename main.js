import * as THREE from './vendor/three/build/three.module.js';
import { Timer } from './vendor/three/build/three.module.js';
import { createVillage } from './village.js';
import { IntroMusic } from './intro-music.js';
import { createPartyMode } from './party-mode.js';
import { meshMicroVoxels } from './microvoxels.js';
import { createSpaceIntro, INTRO_DURATION } from './space-intro.js';
import { OrbitControls } from './vendor/three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from './vendor/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from './vendor/three/examples/jsm/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from './vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/three/examples/jsm/postprocessing/OutputPass.js';
import { initAnalytics } from './analytics.js';

initAnalytics();

/* ==========================================================================
   1. CONFIGURATIE
   ========================================================================== */

// Exact 16 basiskleuren conform de specificatie
const PALETTE = {
    NIGHT_DARK:   0x070b1e, // Diep nachtblauw
    NIGHT_MID:    0x10244d, // Horizonblauw
    SNOW:         0xeef4ff, // Poolwit sneeuw
    SNOW_SHADOW:  0xc0d2ec, // Koele schaduwsneeuw
    ICE:          0x8ecae6, // Gletsjerijs
    WOOD_DARK:    0x3d2314, // Donkere houtbalken
    WOOD_LIGHT:   0x7a4b2a, // Lichte gevelplanken
    WOOD_FLOOR:   0x9c6644, // Werkplaats plankenvloer
    CANDY_RED:    0xd62828, // Snoepstokrood
    PINE_GREEN:   0x1f6f4a, // Dennengroen
    PINE_DARK:    0x134730, // Schaduw dennengroen
    GOLD:         0xffcc00, // Decoratief goud
    WINDOW_GLOW:  0xffb347, // Warme raamgloed
    AURORA_GREEN: 0x5cffb1, // Noorderlicht smaragd
    AURORA_CYAN:  0x3ad6ff, // Noorderlicht cyaan
    AURORA_PURPLE:0xb06cff  // Noorderlicht violet
};

const CONFIG = {
    seed: 9000,
    voxelSize: 0.5,
    shadowMapSize: 2048,
    snowFlakesCount: 3500,
    starCount: 2200,
    qualityLevel: 'Hoog',
    dioramaRadiusVoxels: 42
};

// URL parameters uitlezen
const urlParams = new URLSearchParams(window.location.search);
const IS_DEBUG = urlParams.has('debug');
const SKIP_INTRO = urlParams.get('intro') === '0';
const FROZEN_T = urlParams.has('t') && Number.isFinite(Number(urlParams.get('t'))) ? Number(urlParams.get('t')) : null;
let frozenIntroActive = FROZEN_T !== null;
let frozenIntroTime = FROZEN_T;
const INITIAL_VIEW = urlParams.get('view') || 'buiten';
const INITIAL_GIFT = urlParams.get('gift') === 'open';

if (IS_DEBUG) {
    document.getElementById('debug-overlay').style.display = 'block';
}

/* ==========================================================================
   2. HELPERS
   ========================================================================== */

// Deterministische PRNG generator (Mulberry32) met vaste seed
function createPRNG(seed) {
    let s = seed >>> 0;
    return function() {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const prng = createPRNG(CONFIG.seed);

// Voxel shader injectie voor subtiele randaccenten (micro-bevel zonder extra polygonen)
function applyVoxelEdgeShader(material) {
    material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            varying vec3 vVoxelLocalPos;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vVoxelLocalPos = position;`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
            varying vec3 vVoxelLocalPos;`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `#include <dithering_fragment>
            vec3 dBox = abs(vVoxelLocalPos) * 4.0;
            float secondMax = max(min(dBox.x, dBox.y), max(min(dBox.x, dBox.z), min(dBox.y, dBox.z)));
            float edgeDarken = 1.0 - smoothstep(0.74, 0.98, secondMax) * 0.22;
            gl_FragColor.rgb *= edgeDarken;`
        );
    };
}

// Gedeelde basisgeometrie voor alle doos-voxels (12 driehoeken)
const sharedBoxGeometry = new THREE.BoxGeometry(CONFIG.voxelSize, CONFIG.voxelSize, CONFIG.voxelSize);

// Centrale VoxelBuilder helper voor instancing, culling, sub-voxels en ambient occlusion
class VoxelBuilder {
    constructor(voxelScale = 1.0) {
        this.voxels = new Map();
        this.glassVoxels = [];
        this.voxelScale = voxelScale;
    }

    _round(val) {
        return Math.round(val * 100) / 100;
    }

    add(x, y, z, colorHex, isEmissive = false, emissiveIntensity = 2.0) {
        const rx = this._round(x);
        const ry = this._round(y);
        const rz = this._round(z);
        const key = `${rx},${ry},${rz}`;
        this.voxels.set(key, {
            x: rx, y: ry, z: rz,
            colorHex,
            isEmissive,
            emissiveIntensity
        });
    }

    addGlass(x, y, z, colorHex = PALETTE.WINDOW_GLOW, opacity = 0.38, emissiveIntensity = 0.95) {
        const rx = this._round(x);
        const ry = this._round(y);
        const rz = this._round(z);
        this.glassVoxels.push({
            x: rx, y: ry, z: rz,
            colorHex,
            opacity,
            emissiveIntensity
        });
    }

    has(x, y, z) {
        const rx = this._round(x);
        const ry = this._round(y);
        const rz = this._round(z);
        return this.voxels.has(`${rx},${ry},${rz}`);
    }

    build(materialOptions = {}) {
        const group = new THREE.Group();
        if (this.voxels.size === 0 && this.glassVoxels.length === 0) return group;

        const standardVoxels = [];
        const emissiveVoxels = [];

        for (const [key, v] of this.voxels.entries()) {
            // Culling: sla volledig ingesloten voxels over (alle 6 buren aanwezig)
            const enclosed = this.has(v.x + 1, v.y, v.z) &&
                             this.has(v.x - 1, v.y, v.z) &&
                             this.has(v.x, v.y + 1, v.z) &&
                             this.has(v.x, v.y - 1, v.z) &&
                             this.has(v.x, v.y, v.z + 1) &&
                             this.has(v.x, v.y, v.z - 1);
            if (enclosed) continue;

            if (v.isEmissive) {
                emissiveVoxels.push(v);
            } else {
                standardVoxels.push(v);
            }
        }

        const dummy = new THREE.Object3D();
        const tempColor = new THREE.Color();
        const step = CONFIG.voxelSize * this.voxelScale;
        const scaleVec = new THREE.Vector3(this.voxelScale, this.voxelScale, this.voxelScale);

        if (standardVoxels.length > 0) {
            group.add(meshMicroVoxels(standardVoxels, {
                step, has: (x, y, z) => this.has(x, y, z), materialOptions,
                divisions: 4
            }));
        }

        if (emissiveVoxels.length > 0) {
            const emissiveMat = new THREE.MeshBasicMaterial();
            const emissiveMesh = new THREE.InstancedMesh(sharedBoxGeometry, emissiveMat, emissiveVoxels.length);

            for (let i = 0; i < emissiveVoxels.length; i++) {
                const v = emissiveVoxels[i];
                dummy.position.set(v.x * step, v.y * step, v.z * step);
                dummy.scale.copy(scaleVec);
                dummy.updateMatrix();
                emissiveMesh.setMatrixAt(i, dummy.matrix);

                tempColor.setHex(v.colorHex);
                tempColor.multiplyScalar(v.emissiveIntensity);
                emissiveMesh.setColorAt(i, tempColor);
            }

            emissiveMesh.instanceMatrix.needsUpdate = true;
            if (emissiveMesh.instanceColor) emissiveMesh.instanceColor.needsUpdate = true;
            group.add(emissiveMesh);
        }

        // Semi-transparante glazen voxels (voor doorkijkbare ramen)
        if (this.glassVoxels.length > 0) {
            const glassMat = new THREE.MeshStandardMaterial({
                color: PALETTE.WINDOW_GLOW,
                emissive: PALETTE.WINDOW_GLOW,
                emissiveIntensity: 0.95,
                roughness: 0.15,
                metalness: 0.05,
                transparent: true,
                opacity: 0.38,
                depthWrite: false
            });
            const glassMesh = new THREE.InstancedMesh(sharedBoxGeometry, glassMat, this.glassVoxels.length);

            for (let i = 0; i < this.glassVoxels.length; i++) {
                const gv = this.glassVoxels[i];
                dummy.position.set(gv.x * step, gv.y * step, gv.z * step);
                dummy.scale.copy(scaleVec);
                dummy.updateMatrix();
                glassMesh.setMatrixAt(i, dummy.matrix);
            }

            glassMesh.instanceMatrix.needsUpdate = true;
            group.add(glassMesh);
        }

        return group;
    }
}

// Procedurele textuurmaker voor het scherpe '90° N' bordje
function createSignTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#6e472b';
    ctx.fillRect(0, 0, 512, 256);

    ctx.fillStyle = '#f4eedb';
    ctx.fillRect(16, 16, 480, 224);

    ctx.lineWidth = 10;
    ctx.strokeStyle = '#3d2314';
    ctx.strokeRect(16, 16, 480, 224);

    ctx.fillStyle = '#070b1e';
    ctx.font = '900 115px -apple-system, BlinkMacSystemFont, "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('90° N', 256, 96);

    ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#d62828';
    ctx.fillText('NORTH POLE', 256, 184);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

/* ==========================================================================
   3. RENDERER MET SCENE EN CAMERA
   ========================================================================== */

const canvas = document.getElementById('webgl-canvas');
let renderer;
try {
    renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        powerPreference: 'high-performance'
    });
} catch (e) {
    document.getElementById('no-webgl').style.display = 'block';
    throw new Error('WebGL niet ondersteund');
}

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;

renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.NIGHT_DARK);
scene.fog = new THREE.FogExp2(0x19213b, 0.0045);

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.15, 450);
const FINAL_CAM_POS = new THREE.Vector3(100, 80, 118);
const FINAL_CAM_TARGET = new THREE.Vector3(-5, 2, 8);
camera.position.copy(FINAL_CAM_POS);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 - 0.03;
controls.minDistance = 5;
controls.maxDistance = 210;
controls.target.copy(FINAL_CAM_TARGET);

let lastUserInteractionTime = performance.now();
function recordInteraction() {
    lastUserInteractionTime = performance.now();
    controls.autoRotate = false;
}
['pointerdown', 'wheel', 'touchstart', 'keydown'].forEach(evt => {
    window.addEventListener(evt, recordInteraction, { passive: true });
});

// Postprocessing met UnrealBloomPass
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const ambientPass = new SSAOPass(scene, camera, window.innerWidth / 2, window.innerHeight / 2, 16);
ambientPass.kernelRadius = 1.6;
ambientPass.minDistance = .001;
ambientPass.maxDistance = .035;
composer.addPass(ambientPass);
const resizeAmbient = () => ambientPass.setSize(Math.ceil(window.innerWidth / 2), Math.ceil(window.innerHeight / 2));
resizeAmbient();
const spaceIntro = createSpaceIntro({ camera, renderPass, villageScene: scene });
window.__introDiagnostics = spaceIntro.diagnostics;

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.45,
    0.4,
    1.2
);
composer.addPass(bloomPass);

const outputPass = new OutputPass();
composer.addPass(outputPass);

/* ==========================================================================
   4. LICHT (HOOGSTENS 8 ECHTE LICHTEN)
   ========================================================================== */

function createLights(sceneRef, config) {
    const group = new THREE.Group();

    // 1. Koel maanlicht met zachte diffuse schaduwen
    const moonLight = new THREE.DirectionalLight(0xded9ff, 1.1);
    moonLight.position.set(45, 85, 40);
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.width = config.shadowMapSize;
    moonLight.shadow.mapSize.height = config.shadowMapSize;
    moonLight.shadow.camera.near = 10;
    moonLight.shadow.camera.far = 280;
    const sh = 120;
    moonLight.shadow.camera.left = -sh;
    moonLight.shadow.camera.right = sh;
    moonLight.shadow.camera.top = sh;
    moonLight.shadow.camera.bottom = -sh;
    moonLight.shadow.bias = -0.0004;
    moonLight.shadow.normalBias = 0.02;
    moonLight.shadow.radius = 2.4;
    group.add(moonLight);

    // 2. Rijk hemisfeer omgevingslicht dat meeademt met het noorderlicht
    const hemiLight = new THREE.HemisphereLight(0xb6d8ff, 0x342a43, 0.68);
    group.add(hemiLight);

    // 3. Warme gloed binnen in de werkplaats
    const workshopLight = new THREE.PointLight(PALETTE.WINDOW_GLOW, 2.6, 32);
    workshopLight.position.set(20 * config.voxelSize, 7 * config.voxelSize, -10 * config.voxelSize);
    group.add(workshopLight);

    // 4. Haardvuur licht dat levendig flakkert
    const fireplaceLight = new THREE.PointLight(0xff5500, 2.8, 18);
    fireplaceLight.position.set(8 * config.voxelSize, 4 * config.voxelSize, -18 * config.voxelSize);
    group.add(fireplaceLight);

    // 5. Warm lichtval uit het linker voorraam op de sneeuw
    const windowSpillLight = new THREE.PointLight(0xffa834, 2.6, 24);
    windowSpillLight.position.set(14 * config.voxelSize, 2.0 * config.voxelSize, 3.5 * config.voxelSize);
    group.add(windowSpillLight);

    // 6. Warm lichtval uit het rechter voorraam op de sneeuw
    const windowSpillLight2 = new THREE.PointLight(0xffa834, 2.2, 22);
    windowSpillLight2.position.set(33 * config.voxelSize, 2.0 * config.voxelSize, 3.5 * config.voxelSize);
    group.add(windowSpillLight2);

    // 7. Zachte diffuse opwaartse sneeuw-bounce om schaduwen te verrijken
    const ambientBounce = new THREE.DirectionalLight(0x8ecae6, 0.24);
    ambientBounce.position.set(-25, -15, 20);
    group.add(ambientBounce);

    group.userData.fireplaceLight = fireplaceLight;
    group.userData.moonLight = moonLight;
    return group;
}

const lightsGroup = createLights(scene, CONFIG);
scene.add(lightsGroup);

const animatedObjects = [];

/* ==========================================================================
   5. CREATE-FUNCTIES
   ========================================================================== */

function createGround(builder, config) {
    const group = new THREE.Group();
    const R = config.dioramaRadiusVoxels;

    function getSnowHeight(vx, vz) {
        const distPole = Math.hypot(vx, vz);
        if (distPole < 7) return 0;
        // Onder de werkplaats verlagen naar -1 zodat houten vloer op y=0 geen z-fighting heeft
        if (vx >= 5 && vx <= 43 && vz >= -23 && vz <= 3) return -1;

        const dune1 = Math.sin(vx * 0.11) * Math.cos(vz * 0.13) * 1.8;
        const dune2 = Math.cos(vx * 0.05 + vz * 0.07) * 1.2;
        const edgeFall = Math.max(0, (distPole - 22) * 0.08);
        const h = Math.round(dune1 + dune2 - edgeFall);
        return Math.max(0, Math.min(3, h));
    }

    // Voetafdrukken van elfen in de sneeuw tussen werkplaatsdeur en poolpaal
    const footprintCoords = new Set([
        '23,2', '22,2', '21,3', '19,3', '18,3', '16,4', '15,4',
        '13,4', '11,5', '9,5', '7,5', '5,5', '3,4', '2,4', '1,3'
    ]);

    for (let vx = -R; vx <= R; vx++) {
        for (let vz = -R; vz <= R; vz++) {
            const dist = Math.hypot(vx, vz);
            if (dist > R) continue;

            const topY = getSnowHeight(vx, vz);

            // Afstand tot warme werkplaatsramen en deurdrempel voor gezellige lichtval op de sneeuw
            const distWinFront1 = Math.hypot(vx - 14, vz - 2);
            const distWinFront2 = Math.hypot(vx - 33, vz - 2);
            const distWinSide = Math.hypot(vx - 5, vz - (-10.5));
            const distDoor = Math.hypot(vx - 23.5, vz - 2);
            const minWinDist = Math.min(distWinFront1, distWinFront2, distWinSide * 1.15, distDoor * 1.05);

            for (let vy = -2; vy <= topY; vy++) {
                let col = PALETTE.SNOW;
                if (vy < topY) {
                    col = (vy === -2) ? PALETTE.ICE : PALETTE.SNOW_SHADOW;
                } else if (vy === topY) {
                    if (minWinDist < 6.4 && vz >= 1) {
                        // Warme gouden lichtval uit ramen en deurdrempel op de maagdelijke sneeuw
                        col = (minWinDist < 2.6) ? PALETTE.WINDOW_GLOW :
                              (minWinDist < 4.5) ? 0xffd89e : 0xffedd0;
                    } else if (minWinDist < 4.6 && vx < 6 && vz >= -15 && vz <= -6) {
                        col = (minWinDist < 2.6) ? PALETTE.WINDOW_GLOW : 0xffe2ba;
                    } else if (footprintCoords.has(`${vx},${vz}`)) {
                        col = PALETTE.SNOW_SHADOW;
                    }
                }
                builder.add(vx, vy, vz, col);
            }
        }
    }

    group.add(builder.build());

    // Naadloos buitenste sneeuwvlak dat doorloopt in de mist
    const outerRadius = R * config.voxelSize - 0.2;
    const ringGeo = new THREE.RingGeometry(outerRadius, 240, 64);
    const ringMat = new THREE.MeshStandardMaterial({
        color: PALETTE.SNOW,
        roughness: 0.95,
        metalness: 0.0
    });
    const outerMesh = new THREE.Mesh(ringGeo, ringMat);
    outerMesh.rotation.x = -Math.PI / 2;
    outerMesh.position.y = -0.5 * config.voxelSize;
    outerMesh.receiveShadow = true;
    group.add(outerMesh);

    return group;
}

function createSky(sceneRef, config) {
    const group = new THREE.Group();
    const skyGeo = new THREE.SphereGeometry(260, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
        uniforms: { introReveal: { value: 1 } },
        transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: `
            varying vec3 vWorldPosition;
            void main() {
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPos.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        fragmentShader: `
            uniform float introReveal;
            varying vec3 vWorldPosition;
            void main() {
                vec3 dir = normalize(vWorldPosition);
                float h = max(0.0, dir.y);
                vec3 horizonCol = vec3(0.027, 0.043, 0.118);
                vec3 zenithCol  = vec3(0.012, 0.019, 0.055);
                vec3 col = mix(horizonCol, zenithCol, pow(h, 0.6));
                gl_FragColor = vec4(col, introReveal);
            }
        `
    });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    group.add(skyMesh);
    return group;
}

function createStars(config) {
    const group = new THREE.Group();
    const count = config.starCount;

    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const theta = prng() * Math.PI * 2;
        const phi = Math.acos(0.05 + prng() * 0.95);
        const r = 210 + (prng() - 0.5) * 30;

        positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi);
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

        phases[i] = prng() * Math.PI * 2;
        speeds[i] = 1.0 + prng() * 3.0;
        sizes[i] = 2.0 + prng() * 3.5;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const starMaterial = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 } },
        vertexShader: `
            uniform float uTime;
            attribute float aPhase;
            attribute float aSpeed;
            attribute float aSize;
            varying float vTwinkle;

            void main() {
                float twinkle = sin(uTime * aSpeed + aPhase) * 0.5 + 0.5;
                vTwinkle = twinkle;
                vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = aSize * (0.5 + 0.7 * twinkle);
                gl_Position = projectionMatrix * mvPos;
            }
        `,
        fragmentShader: `
            varying float vTwinkle;
            void main() {
                vec2 coord = gl_PointCoord - vec2(0.5);
                float dist = length(coord);
                if (dist > 0.5) discard;
                float alpha = smoothstep(0.5, 0.05, dist);
                vec3 starColor = mix(vec3(0.9, 0.95, 1.0), vec3(0.4, 0.85, 1.0), vTwinkle * 0.35);
                gl_FragColor = vec4(starColor, alpha * (0.4 + 0.6 * vTwinkle));
            }
        `
    });

    const starPoints = new THREE.Points(geometry, starMaterial);
    group.add(starPoints);

    // Vallende ster extra
    const shootGeo = new THREE.BufferGeometry();
    const shootPos = new Float32Array(6);
    shootGeo.setAttribute('position', new THREE.BufferAttribute(shootPos, 3));
    const shootMat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending
    });
    const shootLine = new THREE.Line(shootGeo, shootMat);
    group.add(shootLine);

    let shootTimer = 4.0;
    let isShooting = false;
    let shootP = 0;
    const shootOrigin = new THREE.Vector3();
    const shootDir = new THREE.Vector3();

    group.userData.update = (dt, t) => {
        starMaterial.uniforms.uTime.value = t;

        shootTimer -= dt;
        if (shootTimer <= 0 && !isShooting) {
            isShooting = true;
            shootP = 0;
            shootOrigin.set((prng() - 0.5) * 120, 80 + prng() * 40, -80 - prng() * 40);
            shootDir.set(30 + prng() * 20, -25 - prng() * 15, 20 + prng() * 20);
            shootMat.opacity = 1.0;
        }

        if (isShooting) {
            shootP += dt * 1.8;
            const curHead = shootOrigin.clone().addScaledVector(shootDir, shootP);
            const curTail = shootOrigin.clone().addScaledVector(shootDir, Math.max(0, shootP - 0.25));
            const arr = shootGeo.attributes.position.array;
            arr[0] = curHead.x; arr[1] = curHead.y; arr[2] = curHead.z;
            arr[3] = curTail.x; arr[4] = curTail.y; arr[5] = curTail.z;
            shootGeo.attributes.position.needsUpdate = true;
            shootMat.opacity = Math.max(0, 1.0 - shootP);

            if (shootP >= 1.0) {
                isShooting = false;
                shootTimer = 7.0 + prng() * 8.0;
            }
        }
    };

    return group;
}

function createAurora(config) {
    const group = new THREE.Group();

    const auroraMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, introReveal: { value: 1 } },
        vertexShader: `
            uniform float uTime;
            varying vec2 vUv;
            varying vec3 vWorldPos;

            void main() {
                vUv = uv;
                vec3 pos = position;

                float wave1 = sin(pos.x * 0.04 + uTime * 0.3) * 4.5;
                float wave2 = cos(pos.x * 0.08 - uTime * 0.2) * 2.5;
                pos.z += (wave1 + wave2) * smoothstep(0.0, 1.0, uv.y);
                pos.y += (sin(pos.x * .047 + uTime * .13) * 7.0 + cos(pos.x * .105 - uTime * .17) * 3.0) * (.4 + uv.y);

                vec4 worldPos = modelMatrix * vec4(pos, 1.0);
                vWorldPos = worldPos.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float introReveal;
            varying vec2 vUv;

            void main() {
                float rays1 = sin(vUv.x * 70.0 + sin(vUv.x * 130.0 + uTime * 0.4) * 2.5 + uTime * 0.6);
                float rays2 = cos(vUv.x * 45.0 - uTime * 0.5);
                float beam = pow(abs(rays1 * 0.7 + rays2 * 0.3), 2.2) * 0.6 + 0.4;

                vec3 colGreen  = vec3(0.12, 0.95, 0.45);
                vec3 colCyan   = vec3(0.12, 0.70, 0.83);
                vec3 colPurple = vec3(0.50, 0.22, 0.85);

                vec3 color = mix(colGreen, colCyan, smoothstep(0.25, 0.65, vUv.y));
                color = mix(color, colPurple, smoothstep(0.70, 0.95, vUv.y));

                float envelope = smoothstep(0.0, 0.16, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
                float edges = smoothstep(0.0, 0.16, vUv.x) * (1.0 - smoothstep(0.84, 1.0, vUv.x));
                float alpha = envelope * edges * beam * 0.38;

                gl_FragColor = vec4(color * (0.65 + beam * 0.2), alpha * introReveal);
            }
        `
    });

    const curtainConfigs = [
        { width: 140, height: 38, radius: 85,  y: 40, rot: -0.25 },
        { width: 160, height: 42, radius: 105, y: 46, rot: 0.15 },
        { width: 150, height: 35, radius: 125, y: 52, rot: 0.45 }
    ];

    curtainConfigs.forEach(cfg => {
        const geo = new THREE.PlaneGeometry(cfg.width, cfg.height, 48, 12);
        const posAttr = geo.attributes.position;
        for (let i = 0; i < posAttr.count; i++) {
            const x = posAttr.getX(i);
            const angle = (x / cfg.width) * 1.4;
            const r = cfg.radius;
            posAttr.setX(i, Math.sin(angle) * r);
            posAttr.setZ(i, (1.0 - Math.cos(angle)) * r * 0.5);
        }
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, auroraMat);
        mesh.renderOrder = 4;
        mesh.position.set(-15, cfg.y + 25, -115);
        mesh.rotation.y = cfg.rot;
        group.add(mesh);
    });

    group.userData.update = (dt, t) => {
        auroraMat.uniforms.uTime.value = t;
    };

    return group;
}

function createSnow(config) {
    const group = new THREE.Group();
    const count = config.snowFlakesCount;

    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);

    const BOX_W = 180;
    const BOX_H = 45;

    for (let i = 0; i < count; i++) {
        positions[i * 3 + 0] = (prng() - 0.5) * BOX_W;
        positions[i * 3 + 1] = prng() * BOX_H;
        positions[i * 3 + 2] = (prng() - 0.5) * BOX_W;

        speeds[i] = 3.5 + prng() * 4.5;
        sizes[i] = 1.0 + prng() * 1.7;
        phases[i] = prng() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    const snowMaterial = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 } },
        vertexShader: `
            uniform float uTime;
            attribute float aSpeed;
            attribute float aSize;
            attribute float aPhase;

            void main() {
                vec3 pos = position;

                pos.y = mod(pos.y - uTime * aSpeed, 45.0);

                pos.x += sin(uTime * 0.7 + aPhase + pos.y * 0.12) * 1.5 + uTime * 0.8;
                pos.x = mod(pos.x + 90.0, 180.0) - 90.0;

                pos.z += cos(uTime * 0.5 + aPhase + pos.y * 0.08) * 1.2;
                pos.z = mod(pos.z + 90.0, 180.0) - 90.0;

                vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
                float sz = aSize * (150.0 / -mvPos.z);
                gl_PointSize = clamp(sz, 1.0, 24.0);
                gl_Position = projectionMatrix * mvPos;
            }
        `,
        fragmentShader: `
            void main() {
                vec2 coord = gl_PointCoord - vec2(0.5);
                float dist = length(coord);
                if (dist > 0.5) discard;
                float alpha = smoothstep(0.5, 0.1, dist) * 0.75;
                gl_FragColor = vec4(0.93, 0.96, 1.0, alpha);
            }
        `
    });

    const snowPoints = new THREE.Points(geometry, snowMaterial);
    group.add(snowPoints);
    group.userData.mesh = snowPoints;

    group.userData.update = (dt, t) => {
        snowMaterial.uniforms.uTime.value = t;
    };

    return group;
}

function createPole(builder, config) {
    const group = new THREE.Group();
    const poleHeight = 28;

    for (let y = 0; y < poleHeight; y++) {
        for (let x = -1; x <= 0; x++) {
            for (let z = -1; z <= 0; z++) {
                const stripe = (y + x + z) % 4;
                const isRed = (stripe === 0 || stripe === 1 || stripe === -1);
                const col = isRed ? PALETTE.CANDY_RED : PALETTE.SNOW;
                builder.add(x, y, z, col);
            }
        }
    }

    for (let x = -1; x <= 0; x++) {
        for (let z = -1; z <= 0; z++) {
            builder.add(x, poleHeight, z, PALETTE.GOLD, true, 1.8);
        }
    }
    builder.add(-0.5, poleHeight + 1, -0.5, PALETTE.GOLD, true, 2.5);

    group.add(builder.build());

    // Het bordje '90° N' haarscherp leesbaar vanuit het eindshot en de intro
    const signTexture = createSignTexture();
    const signMat = new THREE.MeshStandardMaterial({
        map: signTexture,
        roughness: 0.6,
        metalness: 0.0,
        emissive: 0xffffff,
        emissiveMap: signTexture,
        emissiveIntensity: 0.65
    });

    const signW = 3.6;
    const signH = 1.8;
    const signGeo = new THREE.PlaneGeometry(signW, signH);

    const signHolder = new THREE.Group();
    signHolder.position.set(1.4, 18.5 * config.voxelSize, 1.4);
    signHolder.rotation.y = Math.PI * 0.25;

    // Houten dwarsbalkje dat het bordje aan de paal verbindt
    const armGeo = new THREE.BoxGeometry(signW + 0.5, 0.25, 0.12);
    const armMat = new THREE.MeshStandardMaterial({ color: PALETTE.WOOD_DARK, roughness: 0.85 });
    const armMesh = new THREE.Mesh(armGeo, armMat);
    signHolder.add(armMesh);

    const signFront = new THREE.Mesh(signGeo, signMat);
    signFront.position.z = 0.08;
    signHolder.add(signFront);

    const signBack = new THREE.Mesh(signGeo, signMat);
    signBack.position.z = -0.08;
    signBack.rotation.y = Math.PI;
    signHolder.add(signBack);

    group.add(signHolder);
    return group;
}

function createTree(builder, variant = 0, config) {
    const group = new THREE.Group();
    const layersCount = 5 + (variant % 3);

    for (let y = 0; y < 4; y++) {
        builder.add(0, y, 0, PALETTE.WOOD_DARK);
        builder.add(1, y, 0, PALETTE.WOOD_DARK);
    }

    const lightsData = [];
    const lightColors = [PALETTE.CANDY_RED, PALETTE.GOLD, PALETTE.AURORA_CYAN, PALETTE.AURORA_GREEN];

    let curY = 4;
    for (let l = 0; l < layersCount; l++) {
        const maxR = Math.max(1.5, 7.5 - l * 0.95);
        const layerH = 3;

        for (let dy = 0; dy < layerH; dy++) {
            const y = curY + dy;
            const r = maxR - dy * 0.5;

            for (let x = -Math.ceil(r); x <= Math.ceil(r); x++) {
                for (let z = -Math.ceil(r); z <= Math.ceil(r); z++) {
                    const d = Math.hypot(x, z);
                    if (d <= r) {
                        const isTop = (dy === layerH - 1) && (d >= r - 1.2);
                        const col = isTop ? PALETTE.SNOW : (d > r - 0.9 ? PALETTE.PINE_GREEN : PALETTE.PINE_DARK);
                        builder.add(x, y, z, col);

                        if (d >= r - 0.75 && (x * 7 + z * 11 + l * 5 + variant) % 4 === 0) {
                            lightsData.push({
                                pos: new THREE.Vector3(x * config.voxelSize, y * config.voxelSize, z * config.voxelSize),
                                color: lightColors[(x * 3 + z * 7 + l) % lightColors.length],
                                phase: prng() * Math.PI * 2,
                                speed: 1.6 + prng() * 2.2
                            });
                        }
                    }
                }
            }
        }
        curY += 2;
    }

    builder.add(0, curY, 0, PALETTE.GOLD, true, 2.8);
    builder.add(0, curY + 1, 0, PALETTE.GOLD, true, 3.5);

    group.add(builder.build());

    if (lightsData.length > 0) {
        const lightBoxGeo = new THREE.BoxGeometry(config.voxelSize * 0.45, config.voxelSize * 0.45, config.voxelSize * 0.45);
        const lightMat = new THREE.MeshBasicMaterial();
        const lightMesh = new THREE.InstancedMesh(lightBoxGeo, lightMat, lightsData.length);

        const dummy = new THREE.Object3D();
        for (let i = 0; i < lightsData.length; i++) {
            dummy.position.copy(lightsData[i].pos);
            dummy.updateMatrix();
            lightMesh.setMatrixAt(i, dummy.matrix);
        }
        lightMesh.instanceMatrix.needsUpdate = true;
        group.add(lightMesh);

        const tempCol = new THREE.Color();
        group.userData.update = (dt, t) => {
            for (let i = 0; i < lightsData.length; i++) {
                const ld = lightsData[i];
                const blink = Math.sin(t * ld.speed + ld.phase);
                const intensity = (blink > 0.05) ? 2.8 : 0.2;
                tempCol.setHex(ld.color).multiplyScalar(intensity);
                lightMesh.setColorAt(i, tempCol);
            }
            if (lightMesh.instanceColor) lightMesh.instanceColor.needsUpdate = true;
        };
    }

    return group;
}

function createElf(role = 'hammering', config) {
    const group = new THREE.Group();
    const vs = config.voxelSize;

    const torsoGroup = new THREE.Group();
    // Gebruik sub-voxels (scale 0.5) voor verfijnde definitie en voxel-esthetiek
    const b = new VoxelBuilder(0.5);

    const coatColor = (role === 'painting') ? PALETTE.CANDY_RED :
                      (role === 'checking') ? PALETTE.WOOD_DARK :
                      (role === 'wrapping') ? 0x24633f : PALETTE.PINE_GREEN;
    const hatColor = (role === 'painting') ? PALETTE.PINE_GREEN : PALETTE.CANDY_RED;

    // 1. Schoenen en benen (y = 0..2)
    // Linkerlaars
    b.add(-1, 0, 0, 0x1f1f1f);
    b.add(-1, 0, -1, 0x1f1f1f);
    b.add(-1, 0, 1, 0x1f1f1f);
    b.add(-1, 0.5, 1.4, PALETTE.GOLD, true, 1.6); // Krulbelletje op neus
    b.add(-1, 1, 0, PALETTE.PINE_DARK);
    b.add(-1, 2, 0, PALETTE.PINE_DARK);

    // Rechterlaars
    b.add(2, 0, 0, 0x1f1f1f);
    b.add(2, 0, -1, 0x1f1f1f);
    b.add(2, 0, 1, 0x1f1f1f);
    b.add(2, 0.5, 1.4, PALETTE.GOLD, true, 1.6);
    b.add(2, 1, 0, PALETTE.PINE_DARK);
    b.add(2, 2, 0, PALETTE.PINE_DARK);

    // 2. Jas / Tunic (y = 3..7)
    for (let x = -1; x <= 2; x++) {
        for (let z = -1; z <= 1; z++) {
            b.add(x, 3, z, PALETTE.SNOW); // Witte bontzoom
            b.add(x, 4, z, coatColor);    // Jas onderpand
            const isBuckle = (x === 0 || x === 1) && (z === 1);
            b.add(x, 5, z, isBuckle ? PALETTE.GOLD : PALETTE.WOOD_DARK, isBuckle, 2.2); // Riem & gesp
            b.add(x, 6, z, coatColor);    // Borstkas
            b.add(x, 7, z, PALETTE.SNOW); // Witte bontkraag
        }
    }
    // Gouden knopen op de jas van het elfje
    b.add(0.5, 4.3, 1.05, PALETTE.GOLD, true, 1.8);
    b.add(0.5, 6.2, 1.05, PALETTE.GOLD, true, 1.8);

    // Specifieke kledingdetails per rol
    if (role === 'hammering') {
        // Lederen werkschort met gereedschapszakje
        b.add(0, 4, 1.02, 0x5a361e);
        b.add(1, 4, 1.02, 0x5a361e);
        b.add(0, 6, 1.02, 0x5a361e);
        b.add(1, 6, 1.02, 0x5a361e);
        b.add(0.5, 4.3, 1.08, PALETTE.GOLD, true, 1.5); // Koperen nagelzakje
    } else if (role === 'wrapping') {
        // Klossen met cadeau-lint aan de heupriem
        b.add(-1.3, 5, 0.5, PALETTE.CANDY_RED, true, 1.5);
        b.add(-1.3, 5, -0.3, PALETTE.GOLD, true, 1.5);
        b.add(2.3, 5, 0.2, PALETTE.WOOD_LIGHT); // Opgerolde rol inpakpapier
    }

    // 3. Hoofd, gezicht en puntoren (y = 8..9)
    const skinTone = 0xffd1b3;
    for (let x = -0.5; x <= 1.5; x++) {
        for (let z = -0.5; z <= 0.5; z++) {
            b.add(x, 8, z, skinTone);
            b.add(x, 9, z, skinTone);
        }
    }
    b.add(0, 9, 1, PALETTE.NIGHT_DARK);   // Linkeroog
    b.add(1, 9, 1, PALETTE.NIGHT_DARK);   // Rechteroog
    b.add(0, 9.6, 1.02, PALETTE.WOOD_DARK); // Linker wenkbrauw
    b.add(1, 9.6, 1.02, PALETTE.WOOD_DARK); // Rechter wenkbrauw
    b.add(-1, 8.5, 0.8, 0xff9999);        // Rozige blos links
    b.add(2, 8.5, 0.8, 0xff9999);         // Rozige blos rechts
    b.add(0.5, 8.5, 1.1, 0xf7b08b);       // Neusje
    b.add(0.5, 8.1, 1.05, 0xd06060);      // Vrolijke glimlach
    b.add(-1.5, 9, 0, skinTone);          // Linker punt-oor
    b.add(2.5, 9, 0, skinTone);           // Rechter punt-oor
    b.add(-1.2, 9, 0.2, 0xffb59e);        // Oorschelp diepte links
    b.add(2.2, 9, 0.2, 0xffb59e);         // Oorschelp diepte rechts

    // 4. Muts met vouw en belletje (y = 10..13)
    for (let x = -1; x <= 2; x++) {
        for (let z = -1; z <= 1; z++) {
            b.add(x, 10, z, PALETTE.SNOW); // Witte pluche mutsrand
        }
    }
    for (let x = -0.5; x <= 1.5; x++) {
        for (let z = -0.5; z <= 0.5; z++) {
            b.add(x, 11, z, hatColor);
        }
    }
    b.add(0.5, 12, -0.6, hatColor);       // Muts knik naar achter
    b.add(0.5, 12.5, -1.3, PALETTE.GOLD, true, 2.8); // Gouden belletje aan tip

    torsoGroup.add(b.build());
    group.add(torsoGroup);

    // Rechterarm met 2 gewrichten
    const rightShoulder = new THREE.Group();
    rightShoulder.position.set(1.8 * vs, 3.4 * vs, 0);

    const armMat = new THREE.MeshStandardMaterial({ color: coatColor, roughness: 0.82 });
    const upperArmGeo = new THREE.BoxGeometry(0.35 * vs, 0.9 * vs, 0.35 * vs);
    const upperArm = new THREE.Mesh(upperArmGeo, armMat);
    upperArm.position.y = -0.45 * vs;
    rightShoulder.add(upperArm);

    const rightElbow = new THREE.Group();
    rightElbow.position.set(0, -0.9 * vs, 0);

    const lowerArmGeo = new THREE.BoxGeometry(0.3 * vs, 0.8 * vs, 0.3 * vs);
    const lowerArm = new THREE.Mesh(lowerArmGeo, armMat);
    lowerArm.position.y = -0.4 * vs;
    rightElbow.add(lowerArm);

    // Zachte pluche bontmanchet aan de mouw
    const cuffGeo = new THREE.BoxGeometry(0.38 * vs, 0.2 * vs, 0.38 * vs);
    const cuffMat = new THREE.MeshStandardMaterial({ color: PALETTE.SNOW, roughness: 0.9 });
    const rightCuff = new THREE.Mesh(cuffGeo, cuffMat);
    rightCuff.position.y = -0.72 * vs;
    rightElbow.add(rightCuff);

    // Voxel handje
    const handMat = new THREE.MeshStandardMaterial({ color: skinTone, roughness: 0.85 });
    const handGeo = new THREE.BoxGeometry(0.24 * vs, 0.24 * vs, 0.24 * vs);
    const rightHand = new THREE.Mesh(handGeo, handMat);
    rightHand.position.set(0, -0.85 * vs, 0.05 * vs);
    rightElbow.add(rightHand);

    let tool = null;
    let sparks = null;
    let toyRef = null;

    if (role === 'hammering') {
        const hammerGroup = new THREE.Group();
        const handleGeo = new THREE.BoxGeometry(0.14 * vs, 1.3 * vs, 0.14 * vs);
        const handleMat = new THREE.MeshStandardMaterial({ color: PALETTE.WOOD_LIGHT });
        const handle = new THREE.Mesh(handleGeo, handleMat);
        handle.position.y = -0.65 * vs;
        hammerGroup.add(handle);

        const gripGeo = new THREE.BoxGeometry(0.18 * vs, 0.45 * vs, 0.18 * vs);
        const gripMat = new THREE.MeshStandardMaterial({ color: PALETTE.WOOD_DARK });
        const grip = new THREE.Mesh(gripGeo, gripMat);
        grip.position.y = -0.35 * vs;
        hammerGroup.add(grip);

        const headGeo = new THREE.BoxGeometry(0.65 * vs, 0.38 * vs, 0.42 * vs);
        const headMat = new THREE.MeshStandardMaterial({ color: 0x99aabb, roughness: 0.35, metalness: 0.7 });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.set(0, -1.3 * vs, 0);
        hammerGroup.add(head);

        hammerGroup.position.set(0, -0.85 * vs, 0.2 * vs);
        rightElbow.add(hammerGroup);
        tool = hammerGroup;

        const sparkCount = 22;
        const sparkGeo = new THREE.BufferGeometry();
        const sparkPos = new Float32Array(sparkCount * 3);
        sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
        const sparkMat = new THREE.PointsMaterial({
            color: 0xffcc44,
            size: 0.18,
            transparent: true,
            opacity: 0.0,
            blending: THREE.AdditiveBlending
        });
        sparks = new THREE.Points(sparkGeo, sparkMat);
        group.add(sparks);
    } else if (role === 'painting') {
        const brushGroup = new THREE.Group();
        const brushShaft = new THREE.Mesh(
            new THREE.BoxGeometry(0.12 * vs, 1.2 * vs, 0.12 * vs),
            new THREE.MeshStandardMaterial({ color: PALETTE.WOOD_LIGHT })
        );
        brushShaft.position.y = -0.6 * vs;
        const ferrule = new THREE.Mesh(
            new THREE.BoxGeometry(0.16 * vs, 0.25 * vs, 0.16 * vs),
            new THREE.MeshStandardMaterial({ color: PALETTE.GOLD, metalness: 0.8, roughness: 0.3 })
        );
        ferrule.position.y = -1.15 * vs;
        const bristles = new THREE.Mesh(
            new THREE.BoxGeometry(0.14 * vs, 0.35 * vs, 0.14 * vs),
            new THREE.MeshStandardMaterial({ color: PALETTE.GOLD, emissive: PALETTE.GOLD, emissiveIntensity: 1.2 })
        );
        bristles.position.y = -1.4 * vs;
        brushGroup.add(brushShaft, ferrule, bristles);
        brushGroup.position.set(0, -0.85 * vs, 0.2 * vs);
        rightElbow.add(brushGroup);

        // Verfpalet met 5 rijke verfklodders als enkele instanced mesh
        const paletteMesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.85 * vs, 0.08 * vs, 0.65 * vs),
            new THREE.MeshStandardMaterial({ color: PALETTE.WOOD_LIGHT })
        );
        const dotColors = [PALETTE.CANDY_RED, PALETTE.PINE_GREEN, PALETTE.GOLD, PALETTE.AURORA_CYAN, PALETTE.SNOW];
        const dotOffsets = [[-0.25, -0.15], [-0.1, 0.15], [0.1, 0.18], [0.25, -0.05], [0.0, -0.18]];
        const dotsMesh = new THREE.InstancedMesh(
            new THREE.BoxGeometry(0.14 * vs, 0.05 * vs, 0.14 * vs),
            new THREE.MeshStandardMaterial({ roughness: 0.3 }),
            5
        );
        const dDummy = new THREE.Object3D();
        for (let dIdx = 0; dIdx < 5; dIdx++) {
            dDummy.position.set(dotOffsets[dIdx][0] * vs, 0.05 * vs, dotOffsets[dIdx][1] * vs);
            dDummy.updateMatrix();
            dotsMesh.setMatrixAt(dIdx, dDummy.matrix);
            dotsMesh.setColorAt(dIdx, new THREE.Color(dotColors[dIdx]));
        }
        dotsMesh.instanceMatrix.needsUpdate = true;
        dotsMesh.instanceColor.needsUpdate = true;
        paletteMesh.add(dotsMesh);
        paletteMesh.position.set(0.6 * vs, 2.5 * vs, 1.4 * vs);
        group.add(paletteMesh);
    } else if (role === 'wrapping') {
        // Schaartje en lint
        const scissors = new THREE.Mesh(
            new THREE.BoxGeometry(0.1 * vs, 0.7 * vs, 0.35 * vs),
            new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8 })
        );
        scissors.position.set(0, -0.85 * vs, 0.2 * vs);
        rightElbow.add(scissors);
    } else if (role === 'carrying') {
        // Twee gestapelde cadeautjes in armen met 3D kruislint
        const carryGifts = new THREE.Group();
        const bGift = new THREE.Mesh(
            new THREE.BoxGeometry(1.2 * vs, 0.7 * vs, 1.0 * vs),
            new THREE.MeshStandardMaterial({ color: PALETTE.CANDY_RED })
        );
        const bRibbon = new THREE.Mesh(
            new THREE.BoxGeometry(1.25 * vs, 0.72 * vs, 0.2 * vs),
            new THREE.MeshStandardMaterial({ color: PALETTE.GOLD, metalness: 0.4 })
        );
        bGift.add(bRibbon);

        const tGift = new THREE.Mesh(
            new THREE.BoxGeometry(0.85 * vs, 0.55 * vs, 0.85 * vs),
            new THREE.MeshStandardMaterial({ color: PALETTE.PINE_GREEN })
        );
        const tRibbon = new THREE.Mesh(
            new THREE.BoxGeometry(0.88 * vs, 0.58 * vs, 0.18 * vs),
            new THREE.MeshStandardMaterial({ color: PALETTE.CANDY_RED })
        );
        tGift.add(tRibbon);
        tGift.position.y = 0.62 * vs;

        carryGifts.add(bGift, tGift);
        carryGifts.position.set(0.5 * vs, 2.8 * vs, 1.0 * vs);
        group.add(carryGifts);
    } else if (role === 'checking') {
        const quillGroup = new THREE.Group();
        const quillGeo = new THREE.BoxGeometry(0.12 * vs, 1.1 * vs, 0.12 * vs);
        const quillMat = new THREE.MeshStandardMaterial({ color: PALETTE.SNOW });
        const quill = new THREE.Mesh(quillGeo, quillMat);
        const nib = new THREE.Mesh(
            new THREE.BoxGeometry(0.08 * vs, 0.25 * vs, 0.08 * vs),
            new THREE.MeshBasicMaterial({ color: 0x111122 })
        );
        nib.position.y = -0.55 * vs;
        quillGroup.add(quill, nib);
        quillGroup.position.set(0, -0.8 * vs, 0.2 * vs);
        rightElbow.add(quillGroup);

        // Perkamenten lijst ("Nice List") met inktlijnen als enkele instanced mesh
        const scrollGroup = new THREE.Group();
        const scrollGeo = new THREE.BoxGeometry(0.7 * vs, 1.6 * vs, 0.06 * vs);
        const scrollMat = new THREE.MeshStandardMaterial({ color: 0xfff8dc, roughness: 0.9 });
        const scroll = new THREE.Mesh(scrollGeo, scrollMat);
        const inkMesh = new THREE.InstancedMesh(
            new THREE.BoxGeometry(0.48 * vs, 0.06 * vs, 0.02 * vs),
            new THREE.MeshBasicMaterial({ color: 0x3d2314 }),
            5
        );
        const inkDummy = new THREE.Object3D();
        for (let line = 0; line < 5; line++) {
            inkDummy.position.set(0, (0.5 - line * 0.24) * vs, 0.04 * vs);
            inkDummy.updateMatrix();
            inkMesh.setMatrixAt(line, inkDummy.matrix);
        }
        inkMesh.instanceMatrix.needsUpdate = true;
        scroll.add(inkMesh);
        scrollGroup.add(scroll);
        scrollGroup.position.set(-0.6 * vs, 2.4 * vs, 0.9 * vs);
        scrollGroup.rotation.x = -0.35;
        group.add(scrollGroup);
    }

    rightShoulder.add(rightElbow);
    group.add(rightShoulder);

    // Linkerarm met 2 gewrichten
    const leftShoulder = new THREE.Group();
    leftShoulder.position.set(-0.8 * vs, 3.4 * vs, 0);
    const leftArm = new THREE.Mesh(upperArmGeo, armMat);
    leftArm.position.y = -0.45 * vs;
    leftShoulder.add(leftArm);

    const leftElbow = new THREE.Group();
    leftElbow.position.set(0, -0.9 * vs, 0);
    const lowerLeftArm = new THREE.Mesh(lowerArmGeo, armMat);
    lowerLeftArm.position.y = -0.4 * vs;
    leftElbow.add(lowerLeftArm);

    const leftCuff = new THREE.Mesh(cuffGeo, cuffMat);
    leftCuff.position.y = -0.72 * vs;
    leftElbow.add(leftCuff);

    const leftHand = new THREE.Mesh(handGeo, handMat);
    leftHand.position.set(0, -0.85 * vs, 0.05 * vs);
    leftElbow.add(leftHand);

    leftShoulder.add(leftElbow);
    group.add(leftShoulder);

    group.userData.update = (dt, t) => {
        if (role === 'hammering') {
            const cycle = (t * 3.2) % (Math.PI * 2);
            rightShoulder.rotation.x = -0.4 + Math.sin(cycle) * 0.9;
            rightElbow.rotation.x = -0.6 - Math.max(0, Math.sin(cycle)) * 1.1;

            const isImpact = Math.sin(cycle) > 0.94;
            if (sparks) {
                sparks.material.opacity = isImpact ? 1.0 : Math.max(0, sparks.material.opacity - dt * 6);
                if (isImpact) {
                    const posAttr = sparks.geometry.attributes.position;
                    for (let i = 0; i < 22; i++) {
                        posAttr.setXYZ(
                            i,
                            1.2 * vs + (Math.random() - 0.5) * 0.6,
                            2.0 * vs + Math.random() * 0.8,
                            1.2 * vs + (Math.random() - 0.5) * 0.6
                        );
                    }
                    posAttr.needsUpdate = true;
                }
            }
            if (toyRef) {
                toyRef.scale.y = isImpact ? 0.75 : THREE.MathUtils.lerp(toyRef.scale.y, 1.0, 0.2);
            }
        } else if (role === 'painting') {
            const stroke = Math.sin(t * 3.5);
            rightShoulder.rotation.x = -0.5 + stroke * 0.35;
            rightElbow.rotation.y = stroke * 0.45;
            torsoGroup.rotation.y = stroke * 0.12;
        } else if (role === 'wrapping') {
            const fold = Math.sin(t * 2.8);
            rightShoulder.rotation.x = -0.4 + fold * 0.4;
            leftShoulder.rotation.x = -0.4 - fold * 0.4;
            rightElbow.rotation.z = fold * 0.3;
            leftElbow.rotation.z = -fold * 0.3;
        } else if (role === 'carrying') {
            const walk = Math.sin(t * 4.0);
            group.position.x += Math.cos(t * 0.8) * 0.02;
            torsoGroup.rotation.y = (Math.cos(t * 0.8) > 0) ? 0 : Math.PI;
            torsoGroup.position.y = Math.abs(walk) * 0.08;
            rightShoulder.rotation.x = -1.2;
            leftShoulder.rotation.x = -1.2;
        } else if (role === 'checking') {
            const nod = Math.sin(t * 2.0);
            const tick = Math.sin(t * 6.0);
            torsoGroup.rotation.x = nod * 0.12;
            rightElbow.rotation.x = -0.8 + tick * 0.3;
        }
    };

    group.userData.setToyRef = (ref) => { toyRef = ref; };
    return group;
}

function createWorkshop(config) {
    const workshop = new THREE.Group();
    const vs = config.voxelSize;

    const W = 36;
    const D = 24;
    const wallH = 12;

    // 1. Statische vloer en wanden
    const staticBuilder = new VoxelBuilder();

    for (let x = 0; x < W; x++) {
        for (let z = 0; z < D; z++) {
            staticBuilder.add(x, 0, z, PALETTE.WOOD_FLOOR);
        }
    }

    for (let x = 0; x < W; x++) {
        for (let y = 1; y <= wallH; y++) {
            const isBeam = (x % 6 === 0 || y === wallH);
            staticBuilder.add(x, y, 0, isBeam ? PALETTE.WOOD_DARK : PALETTE.WOOD_LIGHT);
        }
    }

    for (let z = 1; z < D; z++) {
        for (let y = 1; y <= wallH; y++) {
            const isWindowZ = (z >= 8 && z <= 15) && (y >= 4 && y <= 8);
            if (isWindowZ) {
                const isBorderOrBar = (z === 8 || z === 15 || z === 11 || z === 12 || y === 4 || y === 8 || y === 6);
                if (isBorderOrBar) {
                    staticBuilder.add(0, y, z, PALETTE.WOOD_DARK);
                    staticBuilder.add(W - 1, y, z, PALETTE.WOOD_DARK);
                } else {
                    staticBuilder.addGlass(0, y, z, PALETTE.WINDOW_GLOW, 0.38, 0.95);
                    staticBuilder.addGlass(W - 1, y, z, PALETTE.WINDOW_GLOW, 0.38, 0.95);
                }
            } else {
                const isBeam = (z % 6 === 0 || y === wallH);
                staticBuilder.add(0, y, z, isBeam ? PALETTE.WOOD_DARK : PALETTE.WOOD_LIGHT);
                staticBuilder.add(W - 1, y, z, isBeam ? PALETTE.WOOD_DARK : PALETTE.WOOD_LIGHT);
            }
        }
    }

    // Open haard met gelaagd metselwerk en schoorsteenmantel
    for (let fx = 4; fx <= 10; fx++) {
        for (let fy = 1; fy <= 9; fy++) {
            for (let fz = 0; fz <= 3; fz++) {
                const isFireCavity = (fx >= 6 && fx <= 8) && (fy >= 1 && fy <= 5) && (fz >= 1);
                if (!isFireCavity) {
                    const stoneColor = ((fx + fy + fz) % 3 === 0) ? 0x666677 : ((fx + fy) % 2 === 0 ? 0x555566 : 0x48485a);
                    staticBuilder.add(fx, fy, fz, (fx === 4 || fx === 10 || fy === 9) ? PALETTE.WOOD_DARK : stoneColor);
                }
            }
        }
    }
    // Zware houten schoorsteenmantel
    for (let mx = 3; mx <= 11; mx++) {
        staticBuilder.add(mx, 7, 3, PALETTE.WOOD_DARK);
        staticBuilder.add(mx, 7, 4, PALETTE.WOOD_DARK);
    }

    // Feestelijke dennengroen guirlande langs de schouw met hulstbessen en lichtjes
    for (let gx = 3; gx <= 11; gx++) {
        staticBuilder.add(gx, 6.9, 4.2, PALETTE.PINE_GREEN);
        if (gx % 2 === 0) {
            staticBuilder.add(gx, 6.7, 4.3, PALETTE.CANDY_RED); // Hulstbes
        } else {
            staticBuilder.add(gx, 7.0, 4.3, PALETTE.GOLD, true, 2.0); // Kerstlampje
        }
    }

    // Schouwgarnituur: kandelaar en festieve klok op de mantel
    staticBuilder.add(4.5, 8.0, 3.5, PALETTE.GOLD); // Kandelaar
    staticBuilder.add(4.5, 8.6, 3.5, PALETTE.SNOW); // Witte kaars
    staticBuilder.add(4.5, 9.1, 3.5, PALETTE.WINDOW_GLOW, true, 3.2); // Kaarsvlam
    staticBuilder.add(7.0, 8.0, 3.5, PALETTE.WOOD_DARK); // Klokhuis
    staticBuilder.add(7.0, 8.5, 3.6, PALETTE.GOLD, true, 2.2); // Wijzerplaat
    staticBuilder.add(9.5, 8.0, 3.5, PALETTE.GOLD);
    staticBuilder.add(9.5, 8.6, 3.5, PALETTE.SNOW);
    staticBuilder.add(9.5, 9.1, 3.5, PALETTE.WINDOW_GLOW, true, 3.2);

    // Drie gedetailleerde 3D kerstsokken aan koperen haakhaakjes
    // Sok 1: Candy-cane rood-wit gestreept met hiel en vooruitstekende teen
    staticBuilder.add(5, 7.0, 4.2, PALETTE.GOLD, true, 1.6); // Haakhaak
    staticBuilder.add(5, 6.6, 4.2, PALETTE.SNOW); // Pluizige omslag
    staticBuilder.add(5, 6.1, 4.1, PALETTE.CANDY_RED);
    staticBuilder.add(5, 5.6, 4.1, PALETTE.SNOW);
    staticBuilder.add(5, 5.2, 4.1, PALETTE.CANDY_RED);
    staticBuilder.add(5, 4.8, 4.0, PALETTE.CANDY_RED); // Hiel
    staticBuilder.add(5, 4.8, 4.4, PALETTE.CANDY_RED); // Voet
    staticBuilder.add(5, 4.8, 4.8, PALETTE.SNOW);      // Teen

    // Sok 2: Dennengroen met gouden hiel en teen
    staticBuilder.add(7, 7.0, 4.2, PALETTE.GOLD, true, 1.6);
    staticBuilder.add(7, 6.6, 4.2, PALETTE.SNOW);
    staticBuilder.add(7, 6.1, 4.1, PALETTE.PINE_GREEN);
    staticBuilder.add(7, 5.6, 4.1, PALETTE.PINE_GREEN);
    staticBuilder.add(7, 5.2, 4.1, PALETTE.PINE_GREEN);
    staticBuilder.add(7, 4.8, 4.0, PALETTE.GOLD); // Hiel
    staticBuilder.add(7, 4.8, 4.4, PALETTE.PINE_GREEN);
    staticBuilder.add(7, 4.8, 4.8, PALETTE.GOLD); // Teen

    // Sok 3: Goudfluwelen sok met snoepstokrode accenten
    staticBuilder.add(9, 7.0, 4.2, PALETTE.GOLD, true, 1.6);
    staticBuilder.add(9, 6.6, 4.2, PALETTE.SNOW);
    staticBuilder.add(9, 6.1, 4.1, PALETTE.GOLD);
    staticBuilder.add(9, 5.6, 4.1, PALETTE.GOLD);
    staticBuilder.add(9, 5.2, 4.1, PALETTE.GOLD);
    staticBuilder.add(9, 4.8, 4.0, PALETTE.CANDY_RED);
    staticBuilder.add(9, 4.8, 4.4, PALETTE.GOLD);
    staticBuilder.add(9, 4.8, 4.8, PALETTE.CANDY_RED);

    // Smeedijzeren haardrooster en gloeiend asbed
    staticBuilder.add(5.8, 0.8, 1.2, 0x1f1f22); // Poot linksachter
    staticBuilder.add(8.2, 0.8, 1.2, 0x1f1f22); // Poot rechtsachter
    staticBuilder.add(5.8, 0.8, 2.4, 0x1f1f22); // Poot linksvoor
    staticBuilder.add(8.2, 0.8, 2.4, 0x1f1f22); // Poot rechtsvoor
    for (let rx = 5.8; rx <= 8.2; rx += 0.8) {
        staticBuilder.add(rx, 1.1, 2.4, 0x2b2b30); // Rooster dwarsbalk
    }
    // Gloeiend houtskoolbed onder het rooster
    staticBuilder.add(6.5, 0.5, 1.5, 0x881100, true, 2.2);
    staticBuilder.add(7.0, 0.5, 1.8, 0xdd3300, true, 2.8);
    staticBuilder.add(7.5, 0.5, 1.5, PALETTE.CANDY_RED, true, 2.5);
    staticBuilder.add(7.0, 0.5, 1.2, 0x550a00, true, 1.8);

    // Authentieke houtblokken (donkere schors en lichter kernhout)
    // Onderste achterblok
    staticBuilder.add(6.2, 1.2, 1.3, PALETTE.WOOD_DARK);
    staticBuilder.add(7.0, 1.2, 1.3, PALETTE.WOOD_LIGHT);
    staticBuilder.add(7.8, 1.2, 1.3, PALETTE.WOOD_DARK);
    // Voorste dwarsblok met gloeiende brandende insnijding
    staticBuilder.add(6.4, 1.3, 2.0, PALETTE.WOOD_DARK);
    staticBuilder.add(7.1, 1.3, 2.0, 0xff5500, true, 2.6);
    staticBuilder.add(7.8, 1.3, 2.0, PALETTE.WOOD_DARK);
    // Bovenste gekanteld houtblok
    staticBuilder.add(6.6, 1.8, 1.7, PALETTE.WOOD_LIGHT);
    staticBuilder.add(7.3, 1.9, 1.6, PALETTE.WOOD_DARK);

    // Dansende vlammenkernen
    staticBuilder.add(6.8, 2.2, 1.6, PALETTE.CANDY_RED, true, 3.2);
    staticBuilder.add(7.2, 2.2, 1.6, 0xff5500, true, 3.5);
    staticBuilder.add(7.0, 2.8, 1.6, PALETTE.GOLD, true, 3.8);
    staticBuilder.add(7.0, 3.4, 1.6, 0xffe066, true, 3.0);

    // Smeedijzeren haardset (pook en tang in staander)
    staticBuilder.add(3.5, 1.0, 2.5, 0x222228);
    staticBuilder.add(3.5, 2.0, 2.5, 0x222228);
    staticBuilder.add(3.5, 3.0, 2.5, 0x222228);
    staticBuilder.add(3.5, 3.8, 2.5, PALETTE.GOLD); // Handvat
    staticBuilder.add(3.8, 2.5, 2.6, 0x33333a); // Pookhaak

    // Rustieke houtmand met gekloofde berkentakken
    for (let lx = 11.5; lx <= 13.5; lx += 0.8) {
        for (let lz = 1.2; lz <= 2.6; lz += 0.8) {
            staticBuilder.add(lx, 1.0, lz, PALETTE.WOOD_LIGHT);
            staticBuilder.add(lx, 1.6, lz, PALETTE.WOOD_DARK);
        }
    }
    staticBuilder.add(12.5, 2.2, 1.8, PALETTE.WOOD_LIGHT); // Bovenop liggend rond blok

    // Schoorsteen
    for (let cy = wallH; cy <= wallH + 10; cy++) {
        for (let cx = 6; cx <= 8; cx++) {
            for (let cz = 1; cz <= 3; cz++) {
                staticBuilder.add(cx, cy, cz, 0x555566);
            }
        }
    }

    workshop.add(staticBuilder.build());

    // Schoorsteenrook deeltjes
    const smokeCount = 30;
    const smokeGeo = new THREE.BufferGeometry();
    const smokePos = new Float32Array(smokeCount * 3);
    const smokeSizes = new Float32Array(smokeCount);
    const smokePhases = new Float32Array(smokeCount);
    for (let i = 0; i < smokeCount; i++) {
        smokePhases[i] = (i / smokeCount) * 4.0;
        smokeSizes[i] = 1.0 + Math.random() * 2.0;
    }
    smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
    smokeGeo.setAttribute('aPhase', new THREE.BufferAttribute(smokePhases, 1));
    smokeGeo.setAttribute('aSize', new THREE.BufferAttribute(smokeSizes, 1));

    const smokeMat = new THREE.PointsMaterial({
        color: 0xcccccc,
        size: 0.6,
        transparent: true,
        opacity: 0.45,
        depthWrite: false
    });
    const smokePoints = new THREE.Points(smokeGeo, smokeMat);
    smokePoints.position.set(7 * vs, (wallH + 11) * vs, 2 * vs);
    workshop.add(smokePoints);

    // 2. Voorgevel
    const frontWallGroup = new THREE.Group();
    const frontBuilder = new VoxelBuilder();
    for (let x = 1; x < W - 1; x++) {
        for (let y = 1; y <= wallH; y++) {
            const isDoor = (x >= 16 && x <= 19) && (y <= 8);
            const isWindowFront = ((x >= 5 && x <= 11) || (x >= 24 && x <= 30)) && (y >= 4 && y <= 8);

            if (isDoor) {
                frontBuilder.add(x, y, D - 1, (x === 16 || x === 19 || y === 8) ? PALETTE.WOOD_DARK : PALETTE.CANDY_RED);
            } else if (isWindowFront) {
                const midX = (x <= 11) ? 8 : 27;
                const isBorderOrBar = (x === 5 || x === 11 || x === 24 || x === 30 || x === midX || y === 4 || y === 8 || y === 6);
                if (isBorderOrBar) {
                    frontBuilder.add(x, y, D - 1, PALETTE.WOOD_DARK);
                } else {
                    frontBuilder.addGlass(x, y, D - 1, PALETTE.WINDOW_GLOW, 0.38, 0.95);
                }
            } else {
                const isBeam = (x % 6 === 0 || y === wallH);
                frontBuilder.add(x, y, D - 1, isBeam ? PALETTE.WOOD_DARK : PALETTE.WOOD_LIGHT);
            }
        }
    }
    frontWallGroup.add(frontBuilder.build());
    workshop.add(frontWallGroup);

    // 3. Volledig dekkend zadeldak in lagen
    const roofGroup = new THREE.Group();
    const roofLayers = [];
    const roofHeight = 11;

    for (let rLevel = 0; rLevel < roofHeight; rLevel++) {
        const layerGroup = new THREE.Group();
        const layerBuilder = new VoxelBuilder();
        const y = wallH + rLevel;
        const zMin = Math.round(rLevel * 1.1);
        const zMax = Math.round(D - 1 - rLevel * 1.1);

        if (zMin <= zMax) {
            for (let x = -1; x <= W; x++) {
                // Dakbedekking op de hellingen
                for (let z = zMin; z <= zMin + 1 && z <= zMax; z++) {
                    layerBuilder.add(x, y, z, PALETTE.SNOW);
                }
                for (let z = zMax - 1; z <= zMax && z >= zMin; z++) {
                    layerBuilder.add(x, y, z, PALETTE.SNOW);
                }
                // Puntgevels aan de zijkanten vullen
                if (x === -1 || x === 0 || x === W - 1 || x === W) {
                    for (let z = zMin; z <= zMax; z++) {
                        layerBuilder.add(x, y, z, PALETTE.WOOD_LIGHT);
                    }
                }
                // Lichtslinger langs dakrand
                if (rLevel === 0 && (x % 2 === 0)) {
                    const lightCol = (x % 4 === 0) ? PALETTE.CANDY_RED : PALETTE.GOLD;
                    layerBuilder.add(x, y - 1, D, lightCol, true, 2.5);
                    layerBuilder.add(x, y - 1, -1, lightCol, true, 2.5);
                }
            }
        }

        layerGroup.add(layerBuilder.build());
        roofLayers.push(layerGroup);
        roofGroup.add(layerGroup);
    }
    workshop.add(roofGroup);

    // 4. Interieur werkbanken met stevige poten, gereedschapsbord en planken
    const interiorBuilder = new VoxelBuilder();

    // Linker werkbank (bij elf 1)
    for (let bx = 6; bx <= 12; bx++) {
        for (let bz = 14; bz <= 16; bz++) {
            const isLeg = (bx === 6 || bx === 12) && (bz === 14 || bz === 16);
            if (isLeg) {
                interiorBuilder.add(bx, 1, bz, PALETTE.WOOD_DARK);
            }
            interiorBuilder.add(bx, 2, bz, ((bx + bz) % 2 === 0) ? PALETTE.WOOD_LIGHT : PALETTE.WOOD_FLOOR);
        }
    }
    // Zware gietijzeren bankvijs op de voorhoek
    interiorBuilder.add(6, 2.5, 16.2, 0x8899aa);
    interiorBuilder.add(6, 2.2, 16.5, 0x555566);
    interiorBuilder.add(5.7, 2.2, 16.5, PALETTE.GOLD); // Draaihendel

    // Houtschaafsel en gekrulde houtkrullen op de werkbank
    interiorBuilder.add(7.8, 2.2, 14.8, 0xf5deb3);
    interiorBuilder.add(8.2, 2.3, 14.4, 0xecd5a8);
    interiorBuilder.add(10.2, 2.2, 14.6, 0xf5deb3);
    interiorBuilder.add(10.5, 2.3, 15.2, 0xecd5a8);

    // Ambachtelijke houtschaaf (beukenhout met stalen mes)
    interiorBuilder.add(7.2, 2.3, 15.5, PALETTE.WOOD_DARK);
    interiorBuilder.add(7.2, 2.6, 15.5, 0xaabbcc);

    // Open houten gereedschapskist met handvat en steekbeitel
    interiorBuilder.add(11.5, 2.3, 15.2, PALETTE.WOOD_DARK);
    interiorBuilder.add(11.5, 2.8, 15.2, PALETTE.WOOD_LIGHT); // Handvat greep
    interiorBuilder.add(11.8, 2.4, 15.5, 0x99aabb); // Beitelblad
    interiorBuilder.add(11.2, 2.3, 15.6, PALETTE.GOLD, true, 1.4); // Messing spijkertjes

    // Koperen stallantaarn op de hoekpost van de werkbank
    interiorBuilder.add(6, 2.8, 14, PALETTE.GOLD);
    interiorBuilder.add(6, 3.2, 14, PALETTE.WINDOW_GLOW, true, 2.8); // Gloeiende vlam
    interiorBuilder.add(6, 3.6, 14, PALETTE.GOLD); // Lantaarnkap

    // Gereedschapsbord aan de achterwand
    for (let wx = 8; wx <= 12; wx++) {
        for (let wy = 4; wy <= 6; wy++) {
            interiorBuilder.add(wx, wy, 1, PALETTE.WOOD_LIGHT);
        }
    }
    interiorBuilder.add(8.5, 5, 1.3, 0x99aabb); // Zaagblad
    interiorBuilder.add(8.5, 6, 1.3, PALETTE.WOOD_DARK); // Zaaghandvat
    interiorBuilder.add(10.0, 5, 1.3, 0x778899); // Steeksleutel
    interiorBuilder.add(10.0, 6, 1.3, 0x8899aa);
    interiorBuilder.add(11.5, 5.5, 1.3, PALETTE.CANDY_RED); // Klauwhamer handvat
    interiorBuilder.add(11.5, 6.0, 1.3, 0x8899aa); // Hamerkop
    // Houten opvouwbare duimstok
    interiorBuilder.add(9.5, 4.2, 1.25, PALETTE.GOLD);
    interiorBuilder.add(10.5, 4.2, 1.25, PALETTE.GOLD);

    // Rechter werkbank (bij elf 2)
    for (let bx = 22; bx <= 28; bx++) {
        for (let bz = 14; bz <= 16; bz++) {
            const isLeg = (bx === 22 || bx === 28) && (bz === 14 || bz === 16);
            if (isLeg) {
                interiorBuilder.add(bx, 1, bz, PALETTE.WOOD_DARK);
            }
            interiorBuilder.add(bx, 2, bz, ((bx + bz) % 2 === 0) ? PALETTE.WOOD_LIGHT : PALETTE.WOOD_FLOOR);
        }
    }

    // Keramische verfpotjes met vloeibare verf en kwast
    interiorBuilder.add(23.0, 2.3, 15.5, 0x3a3a40); // Potje 1 donkergrijs
    interiorBuilder.add(23.0, 2.6, 15.5, PALETTE.CANDY_RED, true, 1.6); // Rode lak
    interiorBuilder.add(24.0, 2.3, 15.5, 0x3a3a40); // Potje 2
    interiorBuilder.add(24.0, 2.6, 15.5, PALETTE.PINE_GREEN, true, 1.6); // Groene lak
    interiorBuilder.add(25.0, 2.3, 15.5, 0x3a3a40); // Potje 3
    interiorBuilder.add(25.0, 2.6, 15.5, PALETTE.GOLD, true, 2.0); // Gouden lak
    // Rustende penseel over het verfpotje
    interiorBuilder.add(23.3, 2.7, 15.2, PALETTE.WOOD_LIGHT);
    interiorBuilder.add(23.6, 2.7, 15.0, PALETTE.GOLD);

    // Half-geschilderd houten speelgoedvliegtuigje op de verftafel
    interiorBuilder.add(27.0, 2.3, 15.0, PALETTE.CANDY_RED);
    interiorBuilder.add(27.0, 2.6, 15.0, PALETTE.WOOD_LIGHT); // Nog blanke vleugel
    interiorBuilder.add(27.6, 2.3, 15.0, PALETTE.GOLD); // Propellerneus

    // Magazijnrekken met speelgoed en cadeaus
    for (let rx = 16; rx <= 30; rx++) {
        interiorBuilder.add(rx, 3, 2, PALETTE.WOOD_DARK);
        interiorBuilder.add(rx, 6, 2, PALETTE.WOOD_DARK);
        if (rx % 3 === 0) {
            interiorBuilder.add(rx, 4, 2, PALETTE.CANDY_RED);
            interiorBuilder.add(rx, 7, 2, PALETTE.GOLD);
        } else if (rx % 3 === 1) {
            interiorBuilder.add(rx, 4, 2, PALETTE.PINE_GREEN);
            interiorBuilder.add(rx, 7, 2, PALETTE.AURORA_CYAN);
        }
    }

    // Schattig miniatuur hobbelpaard op de plank
    interiorBuilder.add(19.0, 3.3, 2.0, PALETTE.CANDY_RED); // Schommellat
    interiorBuilder.add(19.8, 3.3, 2.0, PALETTE.CANDY_RED);
    interiorBuilder.add(19.4, 3.7, 2.0, PALETTE.WOOD_LIGHT); // Paardenlijf
    interiorBuilder.add(19.6, 4.2, 2.0, PALETTE.WOOD_LIGHT); // Hals & kop
    interiorBuilder.add(19.3, 3.9, 2.0, PALETTE.GOLD); // Zadeltje

    // Houten speelgoed alfabet-blokjes (A, B, C)
    interiorBuilder.add(23.0, 3.3, 2.0, PALETTE.CANDY_RED);
    interiorBuilder.add(23.6, 3.3, 2.0, PALETTE.GOLD);
    interiorBuilder.add(23.3, 3.8, 2.0, PALETTE.PINE_GREEN);

    // Klassieke notenkraker figuur
    interiorBuilder.add(27.5, 3.3, 2.0, PALETTE.WOOD_DARK); // Laarzen
    interiorBuilder.add(27.5, 3.8, 2.0, PALETTE.CANDY_RED); // Uniformjas
    interiorBuilder.add(27.5, 4.3, 2.0, 0xffd1b3); // Gezicht met snor
    interiorBuilder.add(27.5, 4.8, 2.0, PALETTE.NIGHT_DARK); // Hoge hoed

    // Kerstkrans met rode strik aan de binnenwand
    interiorBuilder.add(17, 8, 1, PALETTE.PINE_GREEN);
    interiorBuilder.add(18, 8, 1, PALETTE.PINE_GREEN);
    interiorBuilder.add(17, 9, 1, PALETTE.PINE_GREEN);
    interiorBuilder.add(18, 9, 1, PALETTE.PINE_GREEN);
    interiorBuilder.add(17.5, 7.5, 1.2, PALETTE.CANDY_RED, true, 1.6);

    workshop.add(interiorBuilder.build());

    // 5. Lopende band met 3 gedetailleerde stadia
    const conveyorGroup = new THREE.Group();
    const beltBuilder = new VoxelBuilder();
    for (let cx = 8; cx <= 28; cx++) {
        for (let cz = 8; cz <= 10; cz++) {
            beltBuilder.add(cx, 1.8, cz, 0x2b2b2b);
            if (cx % 5 === 0) beltBuilder.add(cx, 1, cz, PALETTE.WOOD_DARK);
        }
    }
    conveyorGroup.add(beltBuilder.build());

    // Stadium 1: Ruw gebeiteld houten speelgoed (blok met cockpit-insnijding en houten asgaten)
    const itemStage1 = new THREE.Group();
    const blockMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.05 * vs, 0.70 * vs, 0.65 * vs),
        new THREE.MeshStandardMaterial({ color: PALETTE.WOOD_LIGHT, roughness: 0.9 })
    );
    const blockNose = new THREE.Mesh(
        new THREE.BoxGeometry(0.35 * vs, 0.50 * vs, 0.55 * vs),
        new THREE.MeshStandardMaterial({ color: PALETTE.WOOD_FLOOR, roughness: 0.95 })
    );
    blockNose.position.set(0.42 * vs, -0.05 * vs, 0);
    const blockAxleFront = new THREE.Mesh(
        new THREE.BoxGeometry(0.12 * vs, 0.12 * vs, 0.78 * vs),
        new THREE.MeshStandardMaterial({ color: PALETTE.WOOD_DARK })
    );
    blockAxleFront.position.set(0.28 * vs, -0.22 * vs, 0);
    const blockAxleBack = new THREE.Mesh(
        new THREE.BoxGeometry(0.12 * vs, 0.12 * vs, 0.78 * vs),
        new THREE.MeshStandardMaterial({ color: PALETTE.WOOD_DARK })
    );
    blockAxleBack.position.set(-0.28 * vs, -0.22 * vs, 0);
    itemStage1.add(blockMesh, blockNose, blockAxleFront, blockAxleBack);

    // Stadium 2: Gedetailleerde houten stoomlocomotief met cabine, schoorsteen, 4 wielen, koepel en koevanger
    const itemStage2 = new THREE.Group();
    const trainBody = new THREE.Mesh(new THREE.BoxGeometry(1.3 * vs, 0.75 * vs, 0.7 * vs), new THREE.MeshStandardMaterial({ color: PALETTE.PINE_GREEN }));
    const trainCabin = new THREE.Mesh(new THREE.BoxGeometry(0.6 * vs, 1.05 * vs, 0.72 * vs), new THREE.MeshStandardMaterial({ color: PALETTE.CANDY_RED }));
    trainCabin.position.set(-0.35 * vs, 0.25 * vs, 0);
    const trainStack = new THREE.Mesh(new THREE.BoxGeometry(0.25 * vs, 0.5 * vs, 0.25 * vs), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    trainStack.position.set(0.35 * vs, 0.5 * vs, 0);
    const trainDome = new THREE.Mesh(new THREE.BoxGeometry(0.22 * vs, 0.3 * vs, 0.22 * vs), new THREE.MeshStandardMaterial({ color: PALETTE.GOLD, metalness: 0.5 }));
    trainDome.position.set(0.05 * vs, 0.45 * vs, 0);
    // Koplamp
    const trainLamp = new THREE.Mesh(new THREE.BoxGeometry(0.18 * vs, 0.18 * vs, 0.18 * vs), new THREE.MeshStandardMaterial({ color: PALETTE.GOLD, emissive: PALETTE.GOLD, emissiveIntensity: 2.0 }));
    trainLamp.position.set(0.68 * vs, 0.1 * vs, 0);
    // Koevanger (rooster) aan voorzijde
    const cowCatcher = new THREE.Mesh(new THREE.BoxGeometry(0.25 * vs, 0.32 * vs, 0.65 * vs), new THREE.MeshStandardMaterial({ color: PALETTE.CANDY_RED }));
    cowCatcher.position.set(0.65 * vs, -0.2 * vs, 0);
    // 4 Wielen met gouden asdoppen als gecombineerde instanced meshes
    const wheelMat = new THREE.MeshStandardMaterial({ color: PALETTE.CANDY_RED, metalness: 0.3 });
    const wheelCapMat = new THREE.MeshStandardMaterial({ color: PALETTE.GOLD, metalness: 0.8 });
    const wheelsMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.32 * vs, 0.32 * vs, 0.08 * vs), wheelMat, 4);
    const capsMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12 * vs, 0.12 * vs, 0.12 * vs), wheelCapMat, 4);
    const wDummy = new THREE.Object3D();
    let wIdx = 0;
    [-0.35, 0.35].forEach((wx) => {
        [-0.38, 0.38].forEach((wz) => {
            wDummy.position.set(wx * vs, -0.28 * vs, wz * vs);
            wDummy.updateMatrix();
            wheelsMesh.setMatrixAt(wIdx, wDummy.matrix);
            capsMesh.setMatrixAt(wIdx, wDummy.matrix);
            wIdx++;
        });
    });
    wheelsMesh.instanceMatrix.needsUpdate = true;
    capsMesh.instanceMatrix.needsUpdate = true;
    itemStage2.add(wheelsMesh, capsMesh);
    itemStage2.add(trainBody, trainCabin, trainStack, trainDome, trainLamp, cowCatcher);

    // Stadium 3: Voltooid geschenk met 3D kruislint rondom alle 6 zijden, dubbele strik en feestelijk label
    const itemStage3 = new THREE.Group();
    const giftBox = new THREE.Mesh(new THREE.BoxGeometry(0.95 * vs, 0.95 * vs, 0.95 * vs), new THREE.MeshStandardMaterial({ color: PALETTE.CANDY_RED }));
    const ribbonH = new THREE.Mesh(new THREE.BoxGeometry(1.02 * vs, 0.18 * vs, 1.02 * vs), new THREE.MeshStandardMaterial({ color: PALETTE.GOLD, metalness: 0.3 }));
    const ribbonV = new THREE.Mesh(new THREE.BoxGeometry(0.18 * vs, 1.02 * vs, 1.02 * vs), new THREE.MeshStandardMaterial({ color: PALETTE.GOLD, metalness: 0.3 }));
    const ribbonBow = new THREE.Mesh(new THREE.BoxGeometry(0.42 * vs, 0.35 * vs, 0.42 * vs), new THREE.MeshStandardMaterial({ color: PALETTE.GOLD, emissive: PALETTE.GOLD, emissiveIntensity: 0.7 }));
    ribbonBow.position.y = 0.58 * vs;
    const giftTag = new THREE.Mesh(new THREE.BoxGeometry(0.24 * vs, 0.12 * vs, 0.04 * vs), new THREE.MeshStandardMaterial({ color: 0xfff8dc }));
    giftTag.position.set(0.32 * vs, 0.48 * vs, 0.48 * vs);
    giftTag.rotation.z = 0.3;
    itemStage3.add(giftBox, ribbonH, ribbonV, ribbonBow, giftTag);

    conveyorGroup.add(itemStage1, itemStage2, itemStage3);
    workshop.add(conveyorGroup);

    // 6. Vijf elfen
    const elf1 = createElf('hammering', config);
    elf1.position.set(9 * vs, 0, 13 * vs);

    // Speelgoedtreintje op de werkbank van elf 1 dat meedeint met de hamerslagen
    const benchToy = new THREE.Group();
    const bToyBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.95 * vs, 0.65 * vs, 0.6 * vs),
        new THREE.MeshStandardMaterial({ color: PALETTE.PINE_GREEN, roughness: 0.7 })
    );
    const bToyCabin = new THREE.Mesh(
        new THREE.BoxGeometry(0.48 * vs, 0.9 * vs, 0.62 * vs),
        new THREE.MeshStandardMaterial({ color: PALETTE.GOLD, roughness: 0.5 })
    );
    bToyCabin.position.set(-0.25 * vs, 0.2 * vs, 0);
    const bToyStack = new THREE.Mesh(
        new THREE.BoxGeometry(0.2 * vs, 0.45 * vs, 0.2 * vs),
        new THREE.MeshStandardMaterial({ color: PALETTE.CANDY_RED })
    );
    bToyStack.position.set(0.25 * vs, 0.4 * vs, 0);
    benchToy.add(bToyBody, bToyCabin, bToyStack);
    benchToy.position.set(9 * vs, 2.6 * vs, 15 * vs);
    workshop.add(benchToy);
    elf1.userData.setToyRef(benchToy);

    const elf2 = createElf('painting', config);
    elf2.position.set(25 * vs, 0, 13 * vs);

    const elf3 = createElf('wrapping', config);
    elf3.position.set(29 * vs, 0, 9 * vs);
    elf3.rotation.y = -Math.PI / 2;

    const elf4 = createElf('carrying', config);
    elf4.position.set(18 * vs, 0, 6 * vs);

    const elf5 = createElf('checking', config);
    elf5.position.set(4 * vs, 0, 8 * vs);
    elf5.rotation.y = Math.PI / 3;

    workshop.add(elf1, elf2, elf3, elf4, elf5);
    animatedObjects.push(elf1, elf2, elf3, elf4, elf5);

    let openProgress = 0.0;
    let targetProgress = 0.0;

    workshop.userData.setOpenTarget = (target) => {
        targetProgress = target;
    };

    workshop.userData.setOpenImmediate = (target) => {
        targetProgress = target;
        openProgress = target;
    };

    workshop.userData.getOpenProgress = () => openProgress;

    workshop.userData.update = (dt, t) => {
        if (Math.abs(openProgress - targetProgress) > 0.001) {
            openProgress = THREE.MathUtils.lerp(openProgress, targetProgress, dt * 2.5);
            renderer.shadowMap.needsUpdate = true;
        }

        for (let k = 0; k < roofLayers.length; k++) {
            const stagger = Math.max(0, openProgress - k * 0.07);
            roofLayers[k].position.y = (k * 0.5 + 1.2) * 6.5 * stagger;
            roofLayers[k].position.z = -1.2 * stagger;
        }

        frontWallGroup.position.y = -wallH * vs * openProgress * 1.05;

        const beltLen = 16 * vs;
        const startX = 10 * vs;
        const speed = 2.2 * vs;

        itemStage1.position.set(startX + ((t * speed) % beltLen), 2.4 * vs, 9 * vs);
        itemStage2.position.set(startX + ((t * speed + beltLen / 3) % beltLen), 2.4 * vs, 9 * vs);
        itemStage3.position.set(startX + ((t * speed + (beltLen * 2) / 3) % beltLen), 2.4 * vs, 9 * vs);

        // Schoorsteenrook updaten
        const posArr = smokeGeo.attributes.position.array;
        for (let i = 0; i < smokeCount; i++) {
            const life = ((t * 1.5 + smokePhases[i]) % 4.0) / 4.0;
            posArr[i * 3 + 0] = Math.sin(t * 1.5 + i) * 0.8 + life * 2.5; // Winddrift
            posArr[i * 3 + 1] = life * 7.0; // Opstijgen
            posArr[i * 3 + 2] = Math.cos(t * 1.2 + i) * 0.6;
        }
        smokeGeo.attributes.position.needsUpdate = true;

        if (lightsGroup.userData.fireplaceLight) {
            lightsGroup.userData.fireplaceLight.intensity = 2.2 + Math.sin(t * 14.0) * 0.5 + (Math.random() - 0.5) * 0.3;
        }
    };

    const hitboxGeo = new THREE.BoxGeometry(W * vs, wallH * vs * 1.5, D * vs);
    const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
    const workshopHitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    workshopHitbox.position.set((W / 2) * vs, (wallH / 2) * vs, (D / 2) * vs);
    workshopHitbox.name = 'workshopHitbox';
    workshop.add(workshopHitbox);

    workshop.position.set(6 * vs, 0, -22 * vs);
    return workshop;
}

function createGift(builder, config) {
    const group = new THREE.Group();
    const vs = config.voxelSize;

    const boxGroup = new THREE.Group();
    const boxBuilder = new VoxelBuilder();
    const S = 6;
    const H = 5;

    for (let x = 0; x < S; x++) {
        for (let z = 0; z < S; z++) {
            for (let y = 0; y < H; y++) {
                const isRibbon = (x === 2 || x === 3 || z === 2 || z === 3);
                boxBuilder.add(x, y, z, isRibbon ? PALETTE.GOLD : PALETTE.CANDY_RED);
            }
        }
    }
    boxGroup.add(boxBuilder.build());
    group.add(boxGroup);

    const lidHinge = new THREE.Group();
    lidHinge.position.set(0, H * vs, 0);

    const lidBuilder = new VoxelBuilder();
    for (let x = -0.5; x <= S - 0.5; x++) {
        for (let z = 0; z <= S; z++) {
            const isRibbon = (x >= 2 && x <= 3) || (z >= 2 && z <= 3);
            lidBuilder.add(x, 0, z, isRibbon ? PALETTE.GOLD : PALETTE.CANDY_RED);
        }
    }
    lidBuilder.add(2.5, 1, 2.5, PALETTE.GOLD, true, 2.4);
    lidBuilder.add(2.5, 2, 2.5, PALETTE.GOLD, true, 3.2);

    lidHinge.add(lidBuilder.build());
    group.add(lidHinge);

    const surprise = new THREE.Group();
    const surpriseBuilder = new VoxelBuilder();
    surpriseBuilder.add(0, 0, 0, PALETTE.GOLD, true, 3.5);
    surpriseBuilder.add(1, 0, 0, PALETTE.GOLD, true, 2.8);
    surpriseBuilder.add(-1, 0, 0, PALETTE.GOLD, true, 2.8);
    surpriseBuilder.add(0, 1, 0, PALETTE.GOLD, true, 2.8);
    surpriseBuilder.add(0, -1, 0, PALETTE.GOLD, true, 2.8);
    surprise.add(surpriseBuilder.build());
    surprise.position.set((S / 2) * vs, 1 * vs, (S / 2) * vs);
    surprise.visible = false;
    group.add(surprise);

    const confettiCount = 50;
    const confettiGeo = new THREE.BoxGeometry(0.18 * vs, 0.18 * vs, 0.18 * vs);
    const confettiMat = new THREE.MeshBasicMaterial();
    const confettiMesh = new THREE.InstancedMesh(confettiGeo, confettiMat, confettiCount);
    confettiMesh.visible = false;

    const confettiVels = [];
    const confettiPos = [];
    const dummy = new THREE.Object3D();
    const confettiCols = [PALETTE.GOLD, PALETTE.CANDY_RED, PALETTE.AURORA_CYAN, PALETTE.AURORA_GREEN, PALETTE.AURORA_PURPLE];

    for (let i = 0; i < confettiCount; i++) {
        confettiMesh.setColorAt(i, new THREE.Color(confettiCols[i % confettiCols.length]));
        confettiPos.push(new THREE.Vector3((S / 2) * vs, H * vs, (S / 2) * vs));
        confettiVels.push(new THREE.Vector3(
            (prng() - 0.5) * 4.0,
            2.5 + prng() * 4.5,
            (prng() - 0.5) * 4.0
        ));
    }
    confettiMesh.instanceColor.needsUpdate = true;
    group.add(confettiMesh);

    let isOpen = false;
    let openProgress = 0.0;
    let isHovered = false;

    group.userData.toggleOpen = (immediate = false) => {
        isOpen = !isOpen;
        if (isOpen) {
            surprise.visible = true;
            confettiMesh.visible = true;
            for (let i = 0; i < confettiCount; i++) {
                confettiPos[i].set((S / 2) * vs, H * vs, (S / 2) * vs);
                confettiVels[i].set(
                    (prng() - 0.5) * 5.0,
                    3.5 + prng() * 5.0,
                    (prng() - 0.5) * 5.0
                );
            }
        }
        if (immediate) openProgress = isOpen ? 1.0 : 0.0;
        renderer.shadowMap.needsUpdate = true;
        return isOpen;
    };

    group.userData.setHover = (h) => {
        isHovered = h;
    };

    group.userData.isOpen = () => isOpen;

    group.userData.update = (dt, t) => {
        const targetP = isOpen ? 1.0 : 0.0;
        openProgress = THREE.MathUtils.lerp(openProgress, targetP, dt * 5.0);

        const bounce = Math.sin(openProgress * Math.PI) * 0.25;
        lidHinge.rotation.x = -openProgress * 2.1 - bounce;

        if (openProgress > 0.05) {
            surprise.visible = true;
            surprise.position.y = (1.0 + openProgress * 4.5) * vs;
            surprise.rotation.y = t * 2.2;
        } else {
            surprise.visible = false;
        }

        if (isOpen && confettiMesh.visible) {
            for (let i = 0; i < confettiCount; i++) {
                confettiPos[i].addScaledVector(confettiVels[i], dt);
                confettiVels[i].y -= 9.8 * dt;
                dummy.position.copy(confettiPos[i]);
                dummy.rotation.x += dt * 3;
                dummy.rotation.y += dt * 4;
                dummy.updateMatrix();
                confettiMesh.setMatrixAt(i, dummy.matrix);
            }
            confettiMesh.instanceMatrix.needsUpdate = true;
        }

        if (isHovered && !isOpen) {
            group.rotation.z = Math.sin(t * 14.0) * 0.06;
        } else if (!isOpen) {
            group.rotation.z = 0;
        }
    };

    const hitboxGeo = new THREE.BoxGeometry(S * vs * 1.2, H * vs * 1.5, S * vs * 1.2);
    const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
    const giftHitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    giftHitbox.position.set((S / 2) * vs, (H / 2) * vs, (S / 2) * vs);
    giftHitbox.name = 'giftHitbox';
    group.add(giftHitbox);

    group.position.set(2.5 * vs, 0, 2.5 * vs);
    return group;
}

// Extra: Sneeuwman
function createSnowman(config) {
    const group = new THREE.Group();
    const vs = config.voxelSize;
    const builder = new VoxelBuilder();

    // Onderste bol
    for (let x = -2; x <= 2; x++) {
        for (let y = 0; y <= 3; y++) {
            for (let z = -2; z <= 2; z++) {
                if (Math.hypot(x, y - 1.5, z) <= 2.2) builder.add(x, y, z, PALETTE.SNOW);
            }
        }
    }
    // Middelste bol
    for (let x = -1.5; x <= 1.5; x++) {
        for (let y = 3; y <= 6; y++) {
            for (let z = -1.5; z <= 1.5; z++) {
                if (Math.hypot(x, y - 4.5, z) <= 1.7) builder.add(x, y, z, PALETTE.SNOW);
            }
        }
    }
    // Hoofd
    for (let x = -1; x <= 1; x++) {
        for (let y = 6; y <= 8; y++) {
            for (let z = -1; z <= 1; z++) {
                if (Math.hypot(x, y - 7, z) <= 1.3) builder.add(x, y, z, PALETTE.SNOW);
            }
        }
    }
    // Rode sjaal
    builder.add(0, 6, 1.2, PALETTE.CANDY_RED);
    builder.add(1, 6, 1.2, PALETTE.CANDY_RED);
    builder.add(0.5, 5, 1.4, PALETTE.CANDY_RED);

    // Wortelneus en kooloogjes
    builder.add(0, 7, 1.3, PALETTE.WINDOW_GLOW, true, 2.0);
    builder.add(-0.4, 7.5, 1.1, PALETTE.NIGHT_DARK);
    builder.add(0.4, 7.5, 1.1, PALETTE.NIGHT_DARK);

    // Hoge hoed
    for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
            builder.add(x, 8.5, z, PALETTE.WOOD_DARK);
        }
    }
    builder.add(0, 9.5, 0, PALETTE.WOOD_DARK);

    group.add(builder.build());
    group.position.set(-8 * vs, 0, 6 * vs);
    return group;
}

// Extra: Slee met rendier
function createSleigh(config) {
    const group = new THREE.Group();
    const vs = config.voxelSize;
    const builder = new VoxelBuilder();

    // Slee glijders en kuip
    for (let z = 0; z <= 8; z++) {
        builder.add(-2, 0.5, z, PALETTE.GOLD);
        builder.add(2, 0.5, z, PALETTE.GOLD);
    }
    for (let x = -2; x <= 2; x++) {
        for (let z = 1; z <= 7; z++) {
            builder.add(x, 1.5, z, PALETTE.CANDY_RED);
            if (z === 1 || x === -2 || x === 2) {
                builder.add(x, 2.5, z, PALETTE.CANDY_RED);
            }
        }
    }

    // Rendier met gloeiende rode neus (Rudolph)
    const rZ = 13;
    // Poten
    builder.add(-1, 0.5, rZ, PALETTE.WOOD_LIGHT);
    builder.add(1, 0.5, rZ, PALETTE.WOOD_LIGHT);
    builder.add(-1, 0.5, rZ + 3, PALETTE.WOOD_LIGHT);
    builder.add(1, 0.5, rZ + 3, PALETTE.WOOD_LIGHT);
    // Lichaam
    for (let rx = -1; rx <= 1; rx++) {
        for (let rz = rZ; rz <= rZ + 4; rz++) {
            builder.add(rx, 2, rz, PALETTE.WOOD_DARK);
            builder.add(rx, 3, rz, PALETTE.WOOD_DARK);
        }
    }
    // Hals en kop
    builder.add(0, 4, rZ + 4, PALETTE.WOOD_DARK);
    builder.add(0, 5, rZ + 4, PALETTE.WOOD_DARK);
    builder.add(0, 5, rZ + 5, PALETTE.WOOD_DARK);
    // Gewei
    builder.add(-1, 6, rZ + 4, PALETTE.WOOD_LIGHT);
    builder.add(1, 6, rZ + 4, PALETTE.WOOD_LIGHT);
    // Gloeiende rode neus
    builder.add(0, 4.8, rZ + 5.8, PALETTE.CANDY_RED, true, 3.5);

    group.add(builder.build());
    group.position.set(-16 * vs, 0, -14 * vs);
    return group;
}

/* ==========================================================================
   SCENE SCENARIO OPBOUWEN
   ========================================================================== */

const sky = createSky(scene, CONFIG);
scene.add(sky);

const stars = createStars(CONFIG);
scene.add(stars);
animatedObjects.push(stars);

const aurora = createAurora(CONFIG);
scene.add(aurora);
animatedObjects.push(aurora);

// Continuous snow terrain is provided by the village, with no coarse
// diorama blocks or hidden height steps on pedestrian streets.

const poleBuilder = new VoxelBuilder();
const pole = createPole(poleBuilder, CONFIG);
scene.add(pole);

// All trees now come from the detailed conifer forest in village.js.

// Werkplaats
const workshop = createWorkshop(CONFIG);
scene.add(workshop);
animatedObjects.push(workshop);

// Cadeau
const giftBuilder = new VoxelBuilder();
const gift = createGift(giftBuilder, CONFIG);
scene.add(gift);
animatedObjects.push(gift);

// Sneeuwman en Slee
const snowman = createSnowman(CONFIG);
scene.add(snowman);

const sleigh = createSleigh(CONFIG);
scene.add(sleigh);

// Sneeuw
const snow = createSnow(CONFIG);
scene.add(snow);
animatedObjects.push(snow);

/* ==========================================================================
   6. INTERACTIE & EVENT LISTENERS
   ========================================================================== */

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDownPos = { x: 0, y: 0 };

let cameraState = (SKIP_INTRO || INITIAL_VIEW === 'binnen') ?
                  (INITIAL_VIEW === 'binnen' ? 'binnen' : 'buiten') : 'intro';
let transitionProgress = 0.0;
const CAM_TRANSITION_DURATION = 2.5;

const outsideCamPos = new THREE.Vector3().copy(FINAL_CAM_POS);
const outsideCamTarget = new THREE.Vector3().copy(FINAL_CAM_TARGET);
const insideCamPos = new THREE.Vector3(24 * CONFIG.voxelSize, 14 * CONFIG.voxelSize, 5 * CONFIG.voxelSize);
const insideCamTarget = new THREE.Vector3(16 * CONFIG.voxelSize, 3.5 * CONFIG.voxelSize, -12 * CONFIG.voxelSize);

function toggleInsideOutsideView() {
    if (village.mode !== 'overview') village.setMode('overview');
    if (cameraState === 'buiten') {
        cameraState = 'naar_binnen';
        transitionProgress = 0.0;
        workshop.userData.setOpenTarget(1.0);
        outsideCamPos.copy(camera.position);
        outsideCamTarget.copy(controls.target);
        document.getElementById('btn-toggle-view').textContent = 'Terug naar buiten';
    } else if (cameraState === 'binnen') {
        cameraState = 'naar_buiten';
        transitionProgress = 0.0;
        workshop.userData.setOpenTarget(0.0);
        insideCamPos.copy(camera.position);
        insideCamTarget.copy(controls.target);
        document.getElementById('btn-toggle-view').textContent = 'Kijk binnen';
    }
}

document.getElementById('btn-toggle-view').addEventListener('click', toggleInsideOutsideView);

window.addEventListener('keydown', (e) => {
    if (village.mode !== 'overview') return;
    if (e.key === 'w' || e.key === 'W') {
        toggleInsideOutsideView();
    } else if (e.key === ' ' || e.key === 'Escape') {
        if (cameraState === 'intro' || frozenIntroActive) skipIntro();
    }
});

window.addEventListener('pointerdown', (e) => {
    pointerDownPos.x = e.clientX;
    pointerDownPos.y = e.clientY;
});

window.addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

    if (cameraState === 'intro' || village.mode !== 'overview') return;

    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects([gift, workshop], true);

    let hitGift = false;
    let hitWorkshop = false;

    for (const hit of intersects) {
        if (hit.object.name === 'giftHitbox' || hit.object.parent === gift) {
            hitGift = true;
            break;
        }
        if (hit.object.name === 'workshopHitbox' || hit.object.parent === workshop) {
            hitWorkshop = true;
            break;
        }
    }

    gift.userData.setHover(hitGift);
    if (hitGift || (hitWorkshop && cameraState === 'buiten')) {
        document.body.style.cursor = 'pointer';
    } else {
        document.body.style.cursor = 'default';
    }
});

window.addEventListener('pointerup', (e) => {
    if (village.mode !== 'overview') return;
    if (e.target && (e.target.closest('#hud-controls') || e.target.closest('.interactive-ui') || e.target.tagName === 'BUTTON')) {
        return;
    }
    const dx = Math.abs(e.clientX - pointerDownPos.x);
    const dy = Math.abs(e.clientY - pointerDownPos.y);

    // Strikte 5-pixel tolerantie: slepen met OrbitControls triggert nooit een klik
    if (dx < 5 && dy < 5) {
        if (cameraState === 'intro' || frozenIntroActive) {
            skipIntro();
            return;
        }

        raycaster.setFromCamera(pointer, camera);
        const intersects = raycaster.intersectObjects([gift, workshop], true);

        for (const hit of intersects) {
            if (hit.object.name === 'giftHitbox' || hit.object.parent === gift) {
                gift.userData.toggleOpen();
                break;
            }
            if (hit.object.name === 'workshopHitbox' || hit.object.parent === workshop) {
                toggleInsideOutsideView();
                break;
            }
        }
    }
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    resizeAmbient();
    bloomPass.resolution.set(window.innerWidth, window.innerHeight);
    renderer.shadowMap.needsUpdate = true;
});

window.__debugInfo = {
    calls: 0,
    triangles: 0,
    fps: 60,
    quality: CONFIG.qualityLevel
};

/* ==========================================================================
   7. INTRO FLY-BY MET CATMULLROMCURVE3
   ========================================================================== */

const introCamCurve = spaceIntro.cameraCurve;
const introTargetCurve = spaceIntro.targetCurve;
function applyIntro(tSeconds) {
    const result = spaceIntro.apply(tSeconds);
    controls.target.copy(result.target);
    const t = spaceIntro.diagnostics.time;
    document.getElementById('intro-title').style.opacity =
        String(THREE.MathUtils.smoothstep(t, 17, 19) * (1 - THREE.MathUtils.smoothstep(t, 21, 23)));
    if (result.complete && cameraState === 'intro') skipIntro();
}

/* ==========================================================================
   PROCEDURELE WEB AUDIO API SYNTHESE VOOR DE INTRO FLY-BY
   ========================================================================== */

const soundManager = new IntroMusic();
window.__soundManager = soundManager;

function skipIntro() {
    frozenIntroActive = false;
    spaceIntro.leave();
    cameraState = 'buiten';
    camera.position.copy(FINAL_CAM_POS);
    controls.target.copy(FINAL_CAM_TARGET);
    camera.fov = 46;
    camera.updateProjectionMatrix();
    document.body.classList.add('intro-finished');
    document.getElementById('intro-title').style.opacity = '0';
    soundManager.fadeOut();
}

// Variabelen beschikbaar maken op window voor geautomatiseerde controle
window.camera = camera;
window.controls = controls;
window.gift = gift;
window.workshop = workshop;
window.introCamCurve = introCamCurve;
window.introTargetCurve = introTargetCurve;
window.toggleInsideOutsideView = toggleInsideOutsideView;
window.getCameraState = () => cameraState;
window.applyIntro = applyIntro;
// Deterministic timeline seeking for visual regression and scene authoring.
window.seekIntro = seconds => {
    if (!Number.isFinite(seconds)) throw new TypeError('Intro time must be finite');
    frozenIntroTime = THREE.MathUtils.clamp(seconds, 0, INTRO_DURATION);
    frozenIntroActive = true; cameraState = 'intro';
    document.body.classList.remove('intro-finished');
    soundManager.pauseForSeek(frozenIntroTime);
    applyIntro(frozenIntroTime);
};
window.getIntroTime = () => introTime;

const village = createVillage({ scene, camera, controls, renderer,
    onExplore() {
        skipIntro();
        controls.enabled = false;
        workshop.userData.setOpenTarget(0);
        document.getElementById('btn-toggle-view').textContent = 'Kijk binnen';
    },
    onOverview() {
        skipIntro(); controls.enabled = true;
        workshop.userData.setOpenTarget(0);
        document.getElementById('btn-toggle-view').textContent = 'Kijk binnen';
    }
});
window.village = village;
spaceIntro.configure({ sky, stars, aurora, snow });
const party = createPartyMode({ scene, navigation: village.navigation, sound: soundManager,
    onStreet() {
        village.setMode('overview');
        controls.autoRotate = false;
        camera.position.set(12, 8, -18);
        controls.target.set(0, 4, -42);
        controls.update();
        recordInteraction();
    }
});
window.party = party;
new ResizeObserver(([entry]) => {
    document.documentElement.style.setProperty('--explore-panel-height', `${entry.target.getBoundingClientRect().height}px`);
}).observe(document.getElementById('explore-panel'));

// Prefers reduced motion controle
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if ((prefersReducedMotion || SKIP_INTRO) && FROZEN_T === null) {
    skipIntro();
}

if (INITIAL_VIEW === 'binnen') {
    spaceIntro.leave();
    cameraState = 'binnen';
    workshop.userData.setOpenImmediate(1.0);
    camera.position.copy(insideCamPos);
    controls.target.copy(insideCamTarget);
    document.body.classList.add('intro-finished');
    document.getElementById('btn-toggle-view').textContent = 'Terug naar buiten';
    soundManager.fadeOut(0.01);
}

if (INITIAL_GIFT) {
    gift.userData.toggleOpen(true);
}

if (SKIP_INTRO || FROZEN_T !== null || INITIAL_VIEW === 'binnen' || prefersReducedMotion) {
    const fo = document.getElementById('fade-overlay');
    if (fo) fo.style.display = 'none';
}

document.getElementById('btn-skip-intro').addEventListener('click', skipIntro);
document.getElementById('btn-replay-intro').addEventListener('click', () => {
    village.setMode('overview');
    frozenIntroActive = false;
    cameraState = 'intro';
    introTime = 0.0;
    timer.reset();
    applyIntro(0);
    document.body.classList.remove('intro-finished');
    soundManager.resetIntro();
});

document.getElementById('btn-toggle-sound').addEventListener('click', () => {
    soundManager.toggleSound();
});

function unlockAudioOnGesture(event) {
    if (event.target instanceof Element && event.target.closest('#btn-toggle-sound')) return;
    soundManager.tryResume();
}
['pointerdown', 'touchstart', 'keydown', 'click'].forEach(evt => {
    window.addEventListener(evt, unlockAudioOnGesture, { passive: true });
});

/* ==========================================================================
   8. ANIMATE (DE CENTRALE RENDER-LUS)
   ========================================================================== */

const timer = new Timer();
timer.connect(document);

let lastFpsUpdate = 0;
let framesCount = 0;
let introTime = 0.0;
let isCompiled = false;

// Tellers voor adaptieve kwaliteit
let frameTimeAccum = 0;
let frameTimeCount = 0;
let lastQualityCheck = 0;

function animate(timestamp) {
    timer.update(timestamp);
    const frameDelta = Math.max(0, timer.getDelta());
    const dt = Math.min(frameDelta, 0.1);
    const t = timer.getElapsed();

    // Intro regie
    if (village.mode !== 'overview') {
        village.update(dt, t);
    } else if (frozenIntroActive) {
        applyIntro(frozenIntroTime);
    } else if (cameraState === 'intro') {
        introTime += frameDelta;
        applyIntro(introTime);
        soundManager.update(introTime, true);
    } else if (cameraState === 'naar_binnen') {
        transitionProgress += dt / CAM_TRANSITION_DURATION;
        const p = THREE.MathUtils.smoothstep(transitionProgress, 0.0, 1.0);
        camera.position.lerpVectors(outsideCamPos, insideCamPos, p);
        controls.target.lerpVectors(outsideCamTarget, insideCamTarget, p);
        if (transitionProgress >= 1.0) cameraState = 'binnen';
    } else if (cameraState === 'naar_buiten') {
        transitionProgress += dt / CAM_TRANSITION_DURATION;
        const p = THREE.MathUtils.smoothstep(transitionProgress, 0.0, 1.0);
        camera.position.lerpVectors(insideCamPos, outsideCamPos, p);
        controls.target.lerpVectors(insideCamTarget, outsideCamTarget, p);
        if (transitionProgress >= 1.0) cameraState = 'buiten';
    } else {
        if (performance.now() - lastUserInteractionTime > 20000) {
            controls.autoRotate = true;
            controls.autoRotateSpeed = 0.5;
        }
        controls.update();
    }

    if (village.mode === 'overview') village.update(dt, t);

    // Update actieve objecten
    for (let i = 0; i < animatedObjects.length; i++) {
        const obj = animatedObjects[i];
        if (obj.userData.update) {
            obj.userData.update(dt, obj === aurora && cameraState === 'intro' ? spaceIntro.diagnostics.time : t);
        }
    }

    party.update(dt, t, cameraState === 'intro' || frozenIntroActive);

    renderer.info.reset();
    // Keep contact shading local: orbital views use the same village,
    // but their kilometre-scale depth range is unsuitable for SSAO.
    ambientPass.enabled = spaceIntro.diagnostics.localAtmosphere > .85 && CONFIG.qualityLevel !== 'Laag';
    composer.render();

    const calls = renderer.info.render.calls;
    const triangles = renderer.info.render.triangles;

    // Adaptieve kwaliteitscontrole (na de eerste 5 seconden)
    if (t > 5.0) {
        frameTimeAccum += dt * 1000;
        frameTimeCount++;
        if (t - lastQualityCheck >= 2.0) {
            const avgMs = frameTimeAccum / frameTimeCount;
            frameTimeAccum = 0;
            frameTimeCount = 0;
            lastQualityCheck = t;

            // Indien gemiddelde frametijd boven 22 ms ligt: trap één niveau omlaag
            if (avgMs > 22.0) {
                if (CONFIG.qualityLevel === 'Hoog') {
                    CONFIG.qualityLevel = 'Midden';
                    renderer.setPixelRatio(1.0);
                    composer.setPixelRatio(1.0);
                    resizeAmbient();
                    const sm = snow.userData.mesh;
                    if (sm) sm.geometry.setDrawRange(0, Math.floor(CONFIG.snowFlakesCount * 0.65));
                    lightsGroup.userData.moonLight.shadow.mapSize.set(1024, 1024);
                    renderer.shadowMap.needsUpdate = true;
                } else if (CONFIG.qualityLevel === 'Midden') {
                    CONFIG.qualityLevel = 'Laag';
                    renderer.setPixelRatio(0.75);
                    composer.setPixelRatio(0.75);
                    resizeAmbient();
                    const sm = snow.userData.mesh;
                    if (sm) sm.geometry.setDrawRange(0, Math.floor(CONFIG.snowFlakesCount * 0.35));
                    lightsGroup.userData.moonLight.shadow.mapSize.set(512, 512);
                    renderer.shadowMap.needsUpdate = true;
                }
            }
        }
    }

    framesCount++;
    if (timestamp - lastFpsUpdate >= 500) {
        const currentFps = Math.round((framesCount * 1000) / (timestamp - lastFpsUpdate));
        framesCount = 0;
        lastFpsUpdate = timestamp;

        if (IS_DEBUG) {
            document.getElementById('dbg-fps').textContent = currentFps;
            document.getElementById('dbg-calls').textContent = calls;
            document.getElementById('dbg-triangles').textContent = triangles;
            document.getElementById('dbg-quality').textContent = CONFIG.qualityLevel;
        }

        window.__debugInfo.calls = calls;
        window.__debugInfo.triangles = triangles;
        window.__debugInfo.fps = currentFps;
        window.__debugInfo.quality = CONFIG.qualityLevel;
    }
}

// Shaders vooraf compileren en fade-in na voltooien
async function init() {
    soundManager.init();
    await spaceIntro.ready;
    try {
        await renderer.compileAsync(scene, camera);
    } catch (e) {
        // Terugval op synchrone compilatie
        renderer.compile(scene, camera);
    }
    // Precompile the orbital materials while they are actually visible.
    // A hidden globe is skipped by compileAsync and left early frames blank.
    if (cameraState === 'intro' || frozenIntroActive) {
        applyIntro(frozenIntroActive ? frozenIntroTime : 0);
        await renderer.compileAsync(scene, camera);
    }
    ambientPass.enabled = spaceIntro.diagnostics.localAtmosphere > .85 && CONFIG.qualityLevel !== 'Laag';
    renderer.shadowMap.needsUpdate = true;
    composer.render();
    document.getElementById('fade-overlay').style.opacity = '0';
    timer.reset();
    renderer.setAnimationLoop(animate);
}

init();
