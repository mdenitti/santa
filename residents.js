import * as THREE from './vendor/three/build/three.module.js';
import { mergeGeometries } from './vendor/three/examples/jsm/utils/BufferGeometryUtils.js';

// A whole village of articulated characters in ten instanced draws. Facial
// features, clothing, parcels and carts are geometry, rather than billboard art.
export function createVillageLife({ parent, paths = [], count = 40, isWalkable = () => true, festive = false } = {}) {
    if (!parent) throw new Error('createVillageLife needs a parent Group');
    const group = new THREE.Group(); group.name = 'Dorpsbewoners'; parent.add(group);
    const time = { value: 0 };
    const geometries = [];
    const skinTones = [0xf5ceac, 0xc98d63, 0x855537, 0xe0ad83, 0x573a2f];
    const coats = [0x287365, 0xa33143, 0x385e91, 0xad793e, 0x7752a0, 0x405c3a, 0x784347, 0x287d85, 0x995c32, 0x5e7098];
    const scarves = [0xf2bf68, 0xc7e6db, 0xdf6158, 0xd7b4ef, 0xa8d4e6];
    const hairColors = [0x30221b, 0xf0d3a3, 0xb45d2a, 0xd9d1c8, 0x171a20];
    const palette = { cream: 0xf5e9d3, black: 0x182026, gold: 0xc99b51, wood: 0x684737, white: 0xfff8ed };
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const unitSphere = new THREE.SphereGeometry(1, 12, 8);
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 10);
    const cone = new THREE.ConeGeometry(1, 1, 16);
    const color = new THREE.Color(), q = new THREE.Quaternion(), matrix = new THREE.Matrix4();
    const position = new THREE.Vector3(), scale = new THREE.Vector3();
    const variantCount = Math.min(10, count);

    function makeVariant(v) {
        const parts = [], coat = coats[v], skin = skinTones[v % skinTones.length];
        const hair = hairColors[(v * 3) % hairColors.length], scarf = scarves[v % scarves.length];
        const broad = [.94, 1.14, .86, 1.05, .88][v % 5];
        const role = festive ? (v >= 4 ? 'dancer' : 'celebrant') : v === 6 ? 'cart' : v >= 7 ? 'conversation' : v % 2 ? 'courier' : 'gift';
        function part(geo, hex, x, y, z, sx, sy, sz, limb = 0, pivot = [0, 0, 0], rx = 0, ry = 0, rz = 0) {
            const g = geo.index ? geo.toNonIndexed() : geo.clone();
            q.setFromEuler(new THREE.Euler(rx, ry, rz)); matrix.compose(position.set(x, y, z), q, scale.set(sx, sy, sz)); g.applyMatrix4(matrix);
            const n = g.getAttribute('position').count;
            const colors = new Float32Array(n * 3), ids = new Float32Array(n), pivots = new Float32Array(n * 3);
            color.setHex(hex);
            for (let i = 0; i < n; i++) { color.toArray(colors, i * 3); ids[i] = limb; pivots.set(pivot, i * 3); }
            g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            g.setAttribute('lifePart', new THREE.BufferAttribute(ids, 1));
            g.setAttribute('lifePivot', new THREE.BufferAttribute(pivots, 3)); parts.push(g);
        }
        const box = (hex, x, y, z, sx, sy, sz, limb = 0, pivot, rz = 0) => part(unitBox, hex, x, y, z, sx, sy, sz, limb, pivot, 0, 0, rz);
        const ball = (hex, x, y, z, sx, sy = sx, sz = sx, limb = 0, pivot) => part(unitSphere, hex, x, y, z, sx, sy, sz, limb, pivot);
        // Coat silhouette, fitted waist, collars, embroidery and five buttons.
        ball(coat, 0, .91, 0, .35 * broad, .45, .245);
        part(cylinder, coat, 0, .7, 0, .33 * broad, .3, .26);
        box(palette.black, 0, .78, .015, .65 * broad, .075, .49);
        box(palette.gold, 0, .78, .273, .14, .12, .025);
        box(palette.cream, 0, .51, .005, .62 * broad, .055, .48);
        for (let i = 0; i < 4; i++) ball(palette.gold, .02, .91 + i * .085, .244, .024);
        for (const side of [-1, 1]) {
            box(palette.cream, side * .105, 1.24, .2, .13, .24, .05, 0, undefined, side * .36);
            box(scarf, side * .16, .6, .26, .055, .05, .025);
        }
        // Different head proportions, pronounced elf ears, eyes, eyebrows and noses.
        ball(skin, 0, 1.53, .01, v % 3 === 1 ? .275 : .24, v % 3 === 2 ? .3 : .26, .225);
        for (const side of [-1, 1]) {
            part(cone, skin, side * .29, 1.56, 0, .075, .24, .07, 0, [0, 0, 0], 0, 0, -side * 1.1);
            ball(palette.white, side * .083, 1.55, .213, .044, .05, .022);
            ball(palette.black, side * .079, 1.55, .236, .018, .024, .012);
            box(hair, side * .09, 1.625, .21, .095, .019, .027, 0, undefined, side * -.13);
            ball(v % 2 ? 0xd78e7f : 0xb96f64, side * .15, 1.47, .18, .049, .028, .025);
        }
        ball(skin, 0, 1.51, .25, .055, .06, .08);
        box(0x9d5d53, 0, 1.405, .219, .075, .014, .014);
        // Hair curls, braids and beards deliberately differ between phenotypes.
        for (let j = 0; j < 8; j++) {
            const a = j / 8 * Math.PI * 2;
            ball(hair, Math.sin(a) * .2, 1.7 + (j % 2) * .025, Math.cos(a) * .16, .07);
        }
        if (v % 3 === 0) {
            for (const side of [-1, 1]) for (let j = 0; j < 4; j++) ball(hair, side * .23, 1.49 - j * .08, -.05, .065 - j * .006);
        } else if (v % 3 === 1) {
            ball(hair, 0, 1.35, .13, .19, .14, .1);
            for (const side of [-1, 1]) ball(hair, side * .055, 1.43, .23, .075, .03, .03);
        }
        if (v % 4 === 0) {
            // Tiny round spectacles, with an actual bridge.
            const frame = new THREE.TorusGeometry(.06, .009, 5, 14);
            for (const side of [-1, 1]) part(frame, palette.gold, side * .083, 1.55, .247, 1, 1, 1);
            box(palette.gold, 0, 1.55, .25, .045, .01, .01); frame.dispose();
        }
        // Three headwear families: bent pointed hats, knit caps, wide berets.
        if (v % 3 === 0) {
            part(cone, coat, .04, 1.99, -.03, .27, .55, .24, 0, [0, 0, 0], 0, 0, -.26);
            ball(palette.cream, .115, 2.255, -.03, .075);
            part(cylinder, palette.cream, 0, 1.76, 0, .25, .07, .23);
        } else if (v % 3 === 1) {
            ball(coat, 0, 1.86, -.015, .27, .22, .24);
            part(cylinder, scarf, 0, 1.77, 0, .27, .09, .24);
            ball(scarf, .035, 2.065, -.015, .09);
            for (let j = 0; j < 11; j++) box(palette.cream, -.22 + j * .044, 1.77, .225, .012, .055, .012);
        } else {
            ball(coat, .035, 1.85, -.015, .33, .12, .29);
            part(cylinder, palette.cream, 0, 1.76, 0, .25, .05, .22);
            ball(palette.gold, .18, 1.94, .02, .04);
        }
        part(cylinder, scarf, 0, 1.3, .015, .21, .1, .2);
        box(scarf, -.12, 1.12, .266, .14, .36, .055);
        for (let j = 0; j < 4; j++) box(palette.cream, -.17 + j * .033, .916, .27, .013, .08, .035);

        for (const side of [-1, 1]) {
            const limb = side < 0 ? 1 : 2, p = [side * .15, .52, 0];
            part(cylinder, v % 2 ? 0x748976 : palette.cream, side * .15, .32, 0, .095, .4, .09, limb, p);
            for (let j = 0; j < 3; j++) part(cylinder, coat, side * .15, .18 + j * .1, 0, .097, .025, .093, limb, p);
            ball(palette.black, side * .15, .085, .055, .13, .085, .2, limb, p);
            ball(palette.black, side * .15, .12, .25, .075, .075, .12, limb, p);
            ball(palette.gold, side * .15, .18, .31, .025, .025, .025, limb, p);
            const arm = side < 0 ? 3 : 4, shoulder = [side * .31 * broad, 1.19, 0];
            part(cylinder, coat, side * .37 * broad, .98, .015, .095, .43, .1, arm, shoulder, 0, 0, side * .18);
            part(cylinder, palette.cream, side * .41 * broad, .79, .02, .11, .07, .11, arm, shoulder);
            ball(skin, side * .42 * broad, .72, .03, .105, .11, .1, arm, shoulder);
        }
        if (role === 'gift') {
            const parcel = v % 4 ? 0xb04d45 : 0x2d7683;
            box(parcel, 0, .88, .48, .49, .43, .4);
            box(palette.gold, 0, .885, .48, .055, .45, .42);
            box(palette.gold, 0, .885, .48, .51, .055, .42);
            for (const side of [-1, 1]) ball(palette.gold, side * .065, 1.12, .48, .08, .035, .05);
        } else if (role === 'courier') {
            box(0x815831, -.26, .88, -.23, .31, .38, .22);
            box(palette.gold, -.26, .93, -.355, .08, .07, .025);
            box(0x815831, -.2, 1.08, -.04, .055, .57, .055, 0, undefined, -.6);
            if (v === 3) {
                box(palette.cream, .47, .91, .26, .25, .32, .025, 4, [.31 * broad, 1.19, 0]);
                for (let i = 0; i < 3; i++) box(0x827c69, .47, .96 - i * .06, .279, .16, .012, .006, 4, [.31 * broad, 1.19, 0]);
            }
        } else if (role === 'cart') {
            box(palette.wood, 0, .3, -1.05, 1.1, .12, 1.3);
            for (const side of [-1, 1]) {
                box(palette.wood, side * .52, .52, -1.05, .1, .42, 1.3);
                box(palette.wood, side * .39, .65, -.35, .055, .055, .7);
                for (const z of [-1.5, -.65]) {
                    const wheel = new THREE.TorusGeometry(.19, .045, 6, 12);
                    part(wheel, palette.black, side * .58, .2, z, 1, 1, 1, 0, [0, 0, 0], 0, Math.PI / 2);
                    wheel.dispose();
                }
            }
            for (let i = 0; i < 5; i++) {
                const x = (i % 2 - .5) * .43, z = -1.45 + Math.floor(i / 2) * .38;
                box(coats[i], x, .65 + i % 2 * .16, z, .36, .42, .35);
                box(palette.gold, x, .66 + i % 2 * .16, z, .04, .44, .37);
            }
        } else if (v === 8) {
            // The baker brings a tray of warm pastries to the conversation.
            box(palette.gold, 0, .88, .43, .66, .035, .35);
            for (let i = 0; i < 4; i++) ball(0xd49c54, (i % 2 - .5) * .26, .94, .33 + Math.floor(i / 2) * .2, .11, .06, .08);
            box(palette.cream, 0, .88, .25, .4, .55, .03);
        }
        const result = mergeGeometries(parts); parts.forEach(g => g.dispose()); geometries.push(result);
        return { geometry: result, role, height: .62 + (v % 4) * .055, broad };
    }

    const vertexDeclarations = `
        attribute float lifePart;
        attribute vec3 lifePivot;
        attribute vec3 lifeActivity;
        uniform float uLifeTime;
    `;
    const deformation = `
        float pace = uLifeTime * (4.1 + lifeActivity.y * .25) + lifeActivity.x;
        float swing = sin(pace + (lifePart == 2.0 || lifePart == 3.0 ? 3.14159265 : 0.0));
        float activity = lifeActivity.z;
        if (lifePart > .5) {
            vec3 local = transformed - lifePivot;
            float angle = swing * (lifePart < 2.5 ? .38 : .22) * step(.5, activity);
            if (lifePart > 2.5 && activity > 1.5) angle = -.48 + sin(pace * .65) * .27;
            if (lifePart > 2.5 && activity > 2.5) angle = -.95 + sin(pace * .7) * .5;
            float c = cos(angle), s = sin(angle);
            local.yz = mat2(c, -s, s, c) * local.yz;
            transformed = local + lifePivot;
        }
        if (activity > 2.5) { transformed.x += sin(pace * .5) * .045; transformed.y += abs(sin(pace)) * .04; }
    `;
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .86 });
    const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    function animateShader(shader) {
        shader.uniforms.uLifeTime = time;
        shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${vertexDeclarations}`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>\n${deformation}`);
    }
    material.onBeforeCompile = animateShader; depthMaterial.onBeforeCompile = animateShader;
    material.customProgramCacheKey = () => 'village-life-v2'; depthMaterial.customProgramCacheKey = () => 'village-life-depth-v2';

    const defaults = [
        [[-20, 39], [-20, 30], [-25, 25], [-26, 18], [-25, 10], [-20, 5], [-20, -12]],
        [[-33, 25], [-25, 25], [-15, 25], [-8, 25], [5, 25]],
        [[-16, 3], [-8, 3], [0, 3], [8, 3], [18, 3], [29, 3]]
    ];
    const validPaths = (paths.length ? paths : defaults).filter(p => p.length >= 2).map(points => {
        const segments = []; let length = 0;
        for (let i = 1; i < points.length; i++) {
            const [x, z] = points[i - 1], [nx, nz] = points[i], d = Math.hypot(nx - x, nz - z);
            if (d > 0) { segments.push({ x, z, nx, nz, d, start: length }); length += d; }
        }
        return { segments, length };
    }).filter(p => p.length > .1);
    if (!validPaths.length) throw new Error('Village life needs a nonempty walkable path');
    function sample(path, distance) {
        const loop = ((distance % (path.length * 2)) + path.length * 2) % (path.length * 2);
        const backwards = loop > path.length;
        const d = backwards ? path.length * 2 - loop : loop;
        const s = path.segments.find(segment => d <= segment.start + segment.d) || path.segments.at(-1);
        const f = THREE.MathUtils.clamp((d - s.start) / s.d, 0, 1);
        const dx = (s.nx - s.x) / s.d * (backwards ? -1 : 1), dz = (s.nz - s.z) / s.d * (backwards ? -1 : 1);
        return { x: THREE.MathUtils.lerp(s.x, s.nx, f), z: THREE.MathUtils.lerp(s.z, s.nz, f), yaw: Math.atan2(dx, dz), dx, dz };
    }

    const actors = [], meshes = [];
    const dummy = new THREE.Object3D();
    for (let v = 0; v < variantCount; v++) {
        const variant = makeVariant(v), n = Math.floor((count - 1 - v) / variantCount) + 1;
        const mesh = new THREE.InstancedMesh(variant.geometry, material, n);
        mesh.name = `Elfen · ${variant.role} · ${v + 1}`; mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.customDepthMaterial = depthMaterial; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const activities = new Float32Array(n * 3);
        variant.geometry.setAttribute('lifeActivity', new THREE.InstancedBufferAttribute(activities, 3));
        for (let j = 0; j < n; j++) {
            const id = j * variantCount + v, path = validPaths[id % validPaths.length];
            const station = variant.role === 'conversation' || variant.role === 'dancer';
            const d = (id * 11.73 + v * 2.3) % path.length;
            const initial = sample(path, d);
            const actor = { id, variant: v, mesh, slot: j, role: variant.role, path, distance: d,
                x: initial.x, z: initial.z, yaw: initial.yaw, speed: .54 + (id % 7) * .055,
                scale: variant.height * (1 + (j % 3 - 1) * .05), station, phase: id * 1.37, lane: (j % 2 ? 1 : -1) * .36,
                traveled: 0, blocked: false };
            activities.set([actor.phase, v, station ? (festive ? 3 : v === 8 ? 0 : 2) : 1], j * 3); actors.push(actor);
        }
        group.add(mesh); meshes.push(mesh);
    }
    function update(dt, t) {
        time.value = t;
        for (const a of actors) {
            const moving = !a.station && Math.sin(t * .055 + a.phase) > -.9;
            const nextDistance = a.distance + (moving ? Math.min(dt, .2) * a.speed : 0);
            const p = sample(a.path, nextDistance);
            // Keep a narrow lane on the supplied streets. Fall back to their
            // centreline if the margin meets a tree, stall or building collider.
            let x = p.x + p.dz * a.lane, z = p.z - p.dx * a.lane;
            if (!isWalkable(x, z, .24)) { x = p.x; z = p.z; }
            a.blocked = !isWalkable(x, z, .24);
            if (!a.blocked) {
                a.traveled += Math.hypot(x - a.x, z - a.z); a.x = x; a.z = z; a.distance = nextDistance;
                const targetYaw = a.station ? p.yaw + (a.id % 2 ? -.65 : .65) : p.yaw;
                a.yaw += Math.atan2(Math.sin(targetYaw - a.yaw), Math.cos(targetYaw - a.yaw)) * (1 - Math.exp(-Math.max(dt, .001) * 7));
            }
            dummy.position.set(a.x, .1 + (moving ? Math.sin(t * (4.1 + a.variant * .25) + a.phase) * .017 : 0), a.z);
            dummy.rotation.set(0, a.yaw, 0); dummy.scale.setScalar(a.scale); dummy.updateMatrix(); a.mesh.setMatrixAt(a.slot, dummy.matrix);
            const activity = a.mesh.geometry.getAttribute('lifeActivity'); activity.setZ(a.slot, a.station ? (festive ? 3 : a.variant === 8 ? 0 : 2) : moving && !a.blocked ? 1 : 0); activity.needsUpdate = true;
        }
        meshes.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
    }
    update(0, 0);
    unitBox.dispose(); unitSphere.dispose(); cylinder.dispose(); cone.dispose();
    return {
        group, count, update,
        getState: () => ({ count, variants: variantCount, skinTones: skinTones.length, coatColors: coats.length,
            roles: [...new Set(actors.map(a => a.role))], moving: actors.filter(a => !a.station).length,
            talking: actors.filter(a => a.role === 'conversation').length, dancing: actors.filter(a => a.role === 'dancer').length, blocked: actors.filter(a => a.blocked).length,
            positions: actors.map(a => [a.x, a.z]), distanceWalked: actors.reduce((sum, a) => sum + a.traveled, 0) }),
        dispose() { group.removeFromParent(); geometries.forEach(g => g.dispose()); material.dispose(); depthMaterial.dispose(); }
    };
}
