import * as THREE from './vendor/three/build/three.module.js';
import { mergeGeometries } from './vendor/three/examples/jsm/utils/BufferGeometryUtils.js';

// Small, inhabited moments are intentionally kept inside existing building / bench
// envelopes. All rigid details share material batches; no new shadow lights.
export function createStorybookDetails({ root, buildings }) {
    const group = new THREE.Group();
    group.name = 'Kleine verhalen in het winterdorp';
    root.add(group);
    const batches = new Map();
    const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .78, ...extra });
    const m = {
        pine: material(0x173b31), needle: material(0x31584c), wood: material(0x694333),
        brass: material(0xc69a59, { metalness: .65, roughness: .35 }),
        red: material(0x8f3543), teal: material(0x3d7569), blue: material(0x426581),
        biscuit: material(0xb8824d), paper: material(0xf2dcb3), ivory: material(0xead8b8),
        snow: material(0xd4e4eb), iron: material(0x26343b, { metalness: .45 }),
        star: material(0xffd695, { emissive: 0xffb35c, emissiveIntensity: .9, roughness: .6 }),
        flame: material(0xffdb93, { emissive: 0xffb557, emissiveIntensity: 2.2 }),
    };
    const geometry = {
        box: new THREE.BoxGeometry(1, 1, 1),
        sphere: new THREE.SphereGeometry(1, 8, 6),
        tube: new THREE.CylinderGeometry(1, 1, 1, 6),
        twig: new THREE.CylinderGeometry(0, 1, 1, 3, 1, true),
        cone: new THREE.ConeGeometry(1, 1, 5),
        ring: new THREE.TorusGeometry(1, .12, 5, 12),
    };
    const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3(), scale = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3();
    function add(g, mat, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
        quaternion.setFromEuler(new THREE.Euler(rx, ry, rz));
        matrix.compose(position.set(x, y, z), quaternion, scale.set(sx, sy, sz));
        const part = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(matrix);
        if (!batches.has(mat)) batches.set(mat, []);
        batches.get(mat).push(part);
    }
    const box = (mat, x, y, z, w, h, d, rz = 0) => add(geometry.box, mat, x, y, z, w, h, d, 0, 0, rz);
    const ball = (mat, x, y, z, r) => add(geometry.sphere, mat, x, y, z, r, r, r);
    function beam(a, b, radius, mat, fine = false) {
        direction.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const length = direction.length();
        quaternion.setFromUnitVectors(up, direction.normalize());
        matrix.compose(position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), quaternion, scale.set(radius, length, radius));
        const part = (fine ? geometry.twig : geometry.tube).toNonIndexed().applyMatrix4(matrix);
        if (!batches.has(mat)) batches.set(mat, []);
        batches.get(mat).push(part);
    }
    let seed = 242512;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const colors = [m.red, m.teal, m.blue, m.biscuit];
    const starShape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
        const angle = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? .43 : 1;
        if (i === 0) starShape.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
        else starShape.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
    }
    starShape.closePath();
    geometry.star = new THREE.ExtrudeGeometry(starShape, { depth: .09, bevelEnabled: false });
    const sparks = [];
    function star(x, y, z, radius, cordTop = y + .5, twist = 0) {
        beam([x, y + radius * .9, z], [x, cordTop, z], .009, m.brass);
        add(geometry.star, m.star, x, y, z, radius, radius, radius, 0, twist);
        // A folded-paper spine catches the light; tiny brass seams define points.
        for (let i = 0; i < 5; i++) {
            const angle = Math.PI / 2 + i * Math.PI * 2 / 5;
            beam([x, y, z + radius * .105], [x + Math.cos(angle) * radius * .87 * Math.cos(twist), y + Math.sin(angle) * radius * .87, z - Math.cos(angle) * radius * .87 * Math.sin(twist)], .007, m.brass);
        }
        ball(m.brass, x, y, z + radius * .12, .028);
        sparks.push([x, y, z + .05, random() * Math.PI * 2]);
    }
    function ribbon(x, y, z, size = .14) {
        add(geometry.sphere, m.red, x - size * .56, y, z, size * .7, size * .4, size * .22, 0, 0, -.3);
        add(geometry.sphere, m.red, x + size * .56, y, z, size * .7, size * .4, size * .22, 0, 0, .3);
        ball(m.brass, x, y, z + size * .2, size * .15);
        box(m.red, x - size * .22, y - size * .65, z, size * .27, size, size * .13, -.25);
        box(m.red, x + size * .22, y - size * .65, z, size * .27, size, size * .13, .25);
    }
    function garland(a, b, sag = .22) {
        const count = Math.max(10, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 9));
        let previous = a;
        for (let i = 0; i <= count; i++) {
            const t = i / count;
            const p = [THREE.MathUtils.lerp(a[0], b[0], t), THREE.MathUtils.lerp(a[1], b[1], t) - Math.sin(Math.PI * t) * sag, THREE.MathUtils.lerp(a[2], b[2], t)];
            if (i) beam(previous, p, .023, m.pine, true);
            for (const side of [-1, 1]) {
                const r = .1 + random() * .065;
                const tip = [p[0] + side * r, p[1] + .08 + random() * .08, p[2] + .02];
                beam(p, tip, .007, m.pine, true);
                // Individual tapered needles, not a row of chunky green beads.
                for (const t of [.36, .68]) {
                    const n = [THREE.MathUtils.lerp(p[0], tip[0], t), THREE.MathUtils.lerp(p[1], tip[1], t), p[2] + .025];
                    beam(n, [n[0] + side * .075, n[1] + .012, n[2] + .022], .004, m.needle, true);
                    beam(n, [n[0] + side * .014, n[1] + .075, n[2] + .015], .004, i % 3 ? m.pine : m.needle, true);
                }
            }
            if (i % 8 === 4) {
                ball(m.red, p[0], p[1] - .045, p[2] + .045, .045);
                ball(m.brass, p[0] + .07, p[1] - .02, p[2] + .035, .032);
            }
            if (i % 13 === 3) ball(m.flame, p[0], p[1] + .025, p[2] + .075, .025);
            previous = p;
        }
    }
    function candle(x, y, z, height = .22) {
        add(geometry.tube, m.brass, x, y + .015, z, .08, .025, .08);
        add(geometry.tube, m.ivory, x, y + height / 2, z, .045, height, .045);
        add(geometry.sphere, m.flame, x, y + height + .045, z, .022, .057, .022);
    }
    function parcel(x, y, z, w, h, d, tint, tilted = 0) {
        box(tint, x, y + h / 2, z, w, h, d, tilted);
        box(m.paper, x, y + h / 2 + .004, z, .045, h + .012, d + .015, tilted);
        box(m.paper, x, y + h / 2 + .004, z, w + .014, h + .014, .045, tilted);
        ribbon(x, y + h + .012, z + .04, Math.min(w, d) * .22);
        box(m.ivory, x + w * .23, y + h * .65, z + d / 2 + .009, w * .19, h * .23, .01, -.19);
    }
    function books(x, y, z, count = 4, factor = 1) {
        for (let i = 0; i < count; i++) {
            const h = (.25 + random() * .14) * factor, w = .065 * factor, xx = x + i * .085 * factor;
            box(colors[i % 4], xx, y + h / 2, z, w, h, .16 * factor);
            for (const yy of [.045, h - .045]) box(m.brass, xx, y + yy, z + .083 * factor, w * .78, .009 * factor, .012);
            box(m.paper, xx, y + h + .004, z - .008, w * .55, .008, .14 * factor);
        }
    }
    function toyHorse(x, y, z, s = 1) {
        box(m.biscuit, x, y + .16 * s, z, .31 * s, .12 * s, .12 * s);
        box(m.biscuit, x + .12 * s, y + .28 * s, z, .095 * s, .24 * s, .095 * s, -.24);
        box(m.biscuit, x + .18 * s, y + .37 * s, z, .19 * s, .09 * s, .1 * s);
        box(m.red, x - .015 * s, y + .23 * s, z, .15 * s, .035 * s, .15 * s);
        for (const dx of [-.11, .11]) for (const dz of [-.06, .06]) {
            beam([x + dx * s, y + .15 * s, z + dz * s], [x + dx * 1.3 * s, y + .04 * s, z + dz * s], .021 * s, m.biscuit);
        }
        for (const dz of [-.09, .09]) beam([x - .21 * s, y + .025 * s, z + dz * s], [x + .25 * s, y + .025 * s, z + dz * s], .022 * s, m.red);
        ball(m.iron, x + .21 * s, y + .39 * s, z + .054 * s, .012 * s);
    }
    function mug(x, y, z, tint = m.red, size = 1) {
        add(geometry.tube, tint, x, y + .095 * size, z, .08 * size, .19 * size, .08 * size);
        add(geometry.tube, m.wood, x, y + .191 * size, z, .066 * size, .005, .066 * size);
        add(geometry.ring, tint, x + .093 * size, y + .1 * size, z, .057 * size, .063 * size, .057 * size);
    }
    function lantern(x, y, z) {
        box(m.brass, x, y + .025, z, .23, .05, .22);
        candle(x, y + .055, z, .2);
        for (const dx of [-.09, .09]) for (const dz of [-.085, .085]) beam([x + dx, y + .035, z + dz], [x + dx, y + .35, z + dz], .013, m.brass);
        add(geometry.cone, m.brass, x, y + .4, z, .17, .13, .17, 0, Math.PI / 4);
        add(geometry.ring, m.brass, x, y + .5, z, .055, .055, .055);
    }
    buildings.forEach((house, index) => {
        const { x, z, w, d, h, porch, style } = house;
        const front = z + d / 2;
        // Detailed evergreen sprigs follow each window rather than covering the facade.
        for (const side of [-1, 1]) for (let xx = 1.55; xx < w / 2 - .45; xx += 2.05) {
            const wx = x + side * xx, wz = front + .42;
            garland([wx - .66, 3.02, wz], [wx + .66, 3.02, wz], .1);
            ribbon(wx + .58, 2.99, wz + .045, .105);
            box(m.wood, wx, 1.42, wz, .96, .055, .37);
            // Four different displays repeat by trade, not as identical windows.
            const display = (index + (side > 0 ? 1 : 0) + Math.round(xx)) % 4;
            if (display === 0) { books(wx - .3, 1.46, wz + .06, 4); candle(wx + .28, 1.46, wz + .08, .28); }
            if (display === 1) { toyHorse(wx - .08, 1.47, wz + .08); parcel(wx + .28, 1.46, wz + .06, .2, .23, .2, m.teal); }
            if (display === 2) { candle(wx - .27, 1.46, wz + .07, .33); candle(wx - .12, 1.46, wz + .1, .19); mug(wx + .22, 1.46, wz + .08, m.blue); }
            if (display === 3) {
                box(m.brass, wx, 1.47, wz + .06, .67, .035, .23);
                for (let i = 0; i < 5; i++) { const cx = wx - .24 + i * .12; add(geometry.star, m.biscuit, cx, 1.55 + (i % 2) * .03, wz + .08, .067, .067, .067); }
                candle(wx + .3, 1.47, wz + .09, .19);
            }
            if (xx < 2) star(wx + (index % 2 ? -.12 : .15), 2.57, wz, .15, 2.86, side * .1);
        }
        // Warm paper stars and fine garlands establish a readable entrance at eye level.
        if (porch) {
            garland([x - .86, 2.86, front + 1.22], [x + .86, 2.86, front + 1.22], .22);
            star(x + .52, 2.6, front + 1.24, .2, 2.91, -.15);
        } else {
            garland([x - .7, 2.92, front + .32], [x + .7, 2.92, front + .32], -.22);
            star(x - .88, 2.52, front + .42, .22, 3.13, .12);
        }
        // Roofline pendants differ in scale; they remain below each roof's label band.
        if (w > 8) for (const side of [-1, 1]) star(x + side * w * .37, h - .12, front + .62, .24, h + .41, side * .22);
        const propX = x + (index % 2 ? -1 : 1) * Math.min(w / 2 - .7, 2.5);
        const propZ = front + .67;
        if (index % 4 === 0) {
            parcel(propX, .3, propZ, .55, .4, .43, colors[index % 4]);
            parcel(propX + .13, .7, propZ - .025, .33, .27, .32, colors[(index + 1) % 4]);
            lantern(propX - .42, .31, propZ + .07);
        } else if (index % 4 === 1) {
            // A brass-slotted postbox, outgoing letters and a little snow cap.
            box(m.wood, propX, .64, propZ, .11, .7, .11);
            box(m.teal, propX, 1.15, propZ, .53, .49, .32);
            box(m.brass, propX, 1.29, propZ + .17, .31, .035, .015);
            box(m.snow, propX, 1.41, propZ, .58, .06, .38);
            box(m.paper, propX + .04, 1.26, propZ + .185, .23, .13, .014, .18);
            ball(m.red, propX + .045, 1.26, propZ + .198, .026);
        } else if (index % 4 === 2) {
            // Split logs beneath a snow-covered rack.
            for (let row = 0; row < 3; row++) for (let col = 0; col < 3 - row; col++) {
                add(geometry.tube, m.wood, propX + (col - 1 + row * .5) * .16, .41 + row * .14, propZ, .079, .48, .079, Math.PI / 2);
                add(geometry.tube, m.biscuit, propX + (col - 1 + row * .5) * .16, .41 + row * .14, propZ + .245, .062, .008, .062, Math.PI / 2);
            }
            box(m.wood, propX, .89, propZ, .72, .055, .61);
            box(m.snow, propX, .93, propZ, .75, .04, .65);
        } else {
            lantern(propX, .31, propZ);
            parcel(propX + .36, .3, propZ - .04, .31, .35, .31, m.blue);
        }
        // Small carved ivory corner marks make the timber feel hand finished.
        if (style === 0 || style === 3) for (const side of [-1, 1]) {
            for (let k = 0; k < 7; k++) {
                const y = .88 + k * .39, cx = x + side * (w / 2 - .12);
                box(m.ivory, cx, y, front + .215, .075, .075, .026, Math.PI / 4);
            }
        }
    });
    // Constellations are suspended from the already existing main-street cables.
    // Their lowest tips are over 3.6 m high, keeping the walking corridor clear.
    for (let z = -29; z <= 42; z += 10) {
        for (const side of [-1, 1]) {
            const x = -20 + side * 1.25;
            star(x, 4.02 + (side > 0 ? .25 : 0), z, side > 0 ? .27 : .36, 4.59, side * .17);
        }
    }
    // Tiny, distinct goods sit on the market counters; all stay inside the stalls.
    for (let i = 0; i < 4; i++) {
        const x = -8 + i * 10;
        garland([x - 1.53, 2.98, 14.31], [x + 1.53, 2.98, 14.31], .17);
        ribbon(x - 1.47, 2.91, 14.35, .15); ribbon(x + 1.47, 2.91, 14.35, .15);
        lantern(x + 1.23, 1.2, 13.68);
        if (i === 0) for (let j = 0; j < 4; j++) mug(x - .9 + j * .4, 1.2, 13.86, colors[j], 1.2);
        if (i === 1) {
            box(m.wood, x - .4, 1.24, 13.83, 1.65, .09, .29);
            for (let j = 0; j < 7; j++) {
                add(geometry.star, m.biscuit, x - 1.05 + j * .22, 1.39, 13.88, .12, .12, .12);
                ball(m.ivory, x - 1.05 + j * .22, 1.39, 13.9, .025);
            }
        }
        if (i === 2) { toyHorse(x - .72, 1.2, 13.78, 1.5); toyHorse(x + .05, 1.2, 13.78, 1.15); books(x + .52, 1.2, 13.83, 3, 1.2); }
        if (i === 3) {
            parcel(x - .77, 1.2, 13.73, .48, .37, .37, m.red);
            parcel(x - .2, 1.2, 13.73, .39, .48, .33, m.blue);
            star(x + .55, 2.02, 13.85, .3, 2.84);
        }
    }
    // Someone has just left their warm drink and book on the square's reading bench.
    const bx = -26.5, bz = 18.65;
    box(m.red, bx, .81, bz, .69, .045, .43);
    box(m.red, bx + .36, .61, bz, .055, .42, .43);
    for (let i = 0; i < 5; i++) box(m.ivory, bx + .37, .395, bz - .17 + i * .08, .045, .09, .022);
    for (const side of [-1, 1]) {
        box(m.blue, bx + side * .15, .87, bz, .31, .035, .36, side * .1);
        box(m.paper, bx + side * .15, .893, bz, .28, .019, .33, side * .1);
        for (let line = 0; line < 5; line++) box(m.biscuit, bx + side * .15, .914, bz - .11 + line * .048, .21, .005, .006, side * .1);
    }
    mug(bx, .8, 17.91, m.teal, 1.1);
    lantern(bx, .79, 17.22);
    // A stack for tomorrow's deliveries rests on the other bench, within its bounds.
    parcel(-13.5, .8, 18.58, .58, .35, .6, m.red);
    parcel(-13.5, 1.15, 18.58, .4, .28, .43, m.teal);
    books(-13.69, .8, 17.5, 4, 1.2);
    lantern(-13.5, .79, 17.12);

    let triangles = 0;
    for (const [mat, parts] of batches) {
        const merged = mergeGeometries(parts);
        const mesh = new THREE.Mesh(merged, mat);
        mesh.name = 'Gebundelde dorpsdetails';
        mesh.castShadow = mat !== m.star && mat !== m.flame;
        mesh.receiveShadow = true;
        group.add(mesh);
        triangles += merged.attributes.position.count / 3;
        parts.forEach(part => part.dispose());
    }
    Object.values(geometry).forEach(g => g.dispose());
    // One restrained particle pass: only the star lanterns breathe, never a blanket
    // of oversized bloom. The actual lantern geometry remains visible in daylight.
    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(sparks.flatMap(p => p.slice(0, 3)), 3));
    sparkGeometry.setAttribute('phase', new THREE.Float32BufferAttribute(sparks.map(p => p[3]), 1));
    const time = { value: 0 };
    const sparkle = new THREE.Points(sparkGeometry, new THREE.ShaderMaterial({
        uniforms: { time }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `attribute float phase; uniform float time; varying float intensity;
            void main() { vec4 p = modelViewMatrix * vec4(position, 1.);
                intensity = .1 + .18 * pow(.5 + .5 * sin(time * .65 + phase), 8.);
                gl_PointSize = clamp(110. / -p.z, 1., 13.);
                gl_Position = projectionMatrix * p; }`,
        fragmentShader: `varying float intensity; void main() {
            vec2 p = gl_PointCoord - .5; float r = length(p);
            float soft = pow(max(0., 1. - r * 2.), 3.);
            float crossGlow = exp(-abs(p.x) * 55.) * exp(-abs(p.y) * 7.) + exp(-abs(p.y) * 55.) * exp(-abs(p.x) * 7.);
            gl_FragColor = vec4(1., .72, .38, (soft + crossGlow * .18) * intensity); }`,
    }));
    sparkle.name = 'Zacht fonkelende papieren sterren';
    group.add(sparkle);
    group.userData.detailStats = { draws: batches.size + 1, triangles, stars: sparks.length, buildings: buildings.length };
    return { group, update(t) { time.value = t; } };
}
