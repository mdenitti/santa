import * as THREE from './vendor/three/build/three.module.js';
import { mergeGeometries } from './vendor/three/examples/jsm/utils/BufferGeometryUtils.js';
import { createConifer } from './forest.js';
import { createVillageLife } from './residents.js';
import { createNavigation } from './navigation.js';
import { createWinterLandscape, createWinterMagic, snowHeight } from './winter-landscape.js';
import { createStorybookDetails } from './storybook-details.js';

// The village is built in metres. Static details are merged by material so that
// thousands of shingles, lights and branches don't become thousands of draws.
export function createVillage({ scene, camera, controls, renderer, onExplore, onOverview }) {
    const root = new THREE.Group();
    root.name = 'Het winterdorp';
    scene.add(root);
    const batches = new Map();
    const colliders = [];
    const trees = [];
    const buildings = [];
    const chimneys = [];
    const roads = [];
    let seed = 1225;
    const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
    const mat = (color, roughness = .75, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    const snow = mat(0xe2edf4, .92);
    const wood = mat(0x523328);
    const darkWood = mat(0x241d20);
    const red = mat(0x942c36, .48);
    const green = mat(0x23584e);
    const gold = mat(0xc2964e, .27, .72);
    const iron = mat(0x182b34, .35, .7);
    const pine = mat(0x143d36);
    const stone = mat(0x697b88, .9);
    const warm = mat(0xffce89, .3, 0, { emissive: 0xffa344, emissiveIntensity: 1.8 });
    const bulbs = [warm, mat(0xf06357, .3, 0, { emissive: 0xf03528, emissiveIntensity: 2.1 }), mat(0x83efcb, .3, 0, { emissive: 0x40dca0, emissiveIntensity: 1.8 })];
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const sphereGeo = new THREE.SphereGeometry(1, 12, 8);
    const coneGeo = new THREE.ConeGeometry(1, 1, 12);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    function add(geo, material, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, parent = null) {
        if (parent) {
            const mesh = new THREE.Mesh(geo, material);
            mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.rotation.set(rx, ry, rz);
            mesh.castShadow = mesh.receiveShadow = true;
            parent.add(mesh);
            return mesh;
        }
        quat.setFromEuler(new THREE.Euler(rx, ry, rz));
        matrix.compose(new THREE.Vector3(x, y, z), quat, new THREE.Vector3(sx, sy, sz));
        const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(matrix);
        if (!batches.has(material)) batches.set(material, []);
        batches.get(material).push(g);
    }
    const box = (m, x, y, z, w, h, d, rz = 0, parent = null) => add(boxGeo, m, x, y, z, w, h, d, 0, 0, rz, parent);
    const ball = (m, x, y, z, r, parent = null) => add(sphereGeo, m, x, y, z, r, r, r, 0, 0, 0, parent);
    function beam(a, b, radius, material, parent = null) {
        const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
        const direction = end.clone().sub(start);
        const g = new THREE.CylinderGeometry(radius, radius, direction.length(), 6);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
        add(g, material, ...start.add(end).multiplyScalar(.5).toArray(), 1, 1, 1, 0, 0, 0, parent);
        g.dispose();
    }
    function lightString(a, b, count = 28, sag = 1.2) {
        let previous = a;
        for (let i = 1; i <= count; i++) {
            const f = i / count;
            const p = a.map((v, j) => THREE.MathUtils.lerp(v, b[j], f) - (j === 1 ? Math.sin(f * Math.PI) * sag : 0));
            beam(previous, p, .025, iron);
            ball(bulbs[i % 6 === 0 ? 1 : i % 5 === 0 ? 2 : 0], p[0], p[1] - .13, p[2], .095);
            previous = p;
        }
    }
    function label(text, x, y, z, width = 4) {
        const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 160;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#19322c'; ctx.fillRect(0, 0, 768, 160);
        ctx.strokeStyle = '#cfa66a'; ctx.lineWidth = 8; ctx.strokeRect(8, 8, 752, 144);
        ctx.fillStyle = '#ffe1aa'; ctx.font = '600 48px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 384, 82, 716);
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 160 / 768), new THREE.MeshStandardMaterial({ map: texture, roughness: .7, emissive: 0xd3a16a, emissiveIntensity: .22 }));
        mesh.position.set(x, y, z); root.add(mesh);
    }

    // Snow microstructure: a deterministic bump map, no downloaded assets.
    const texCanvas = document.createElement('canvas'); texCanvas.width = texCanvas.height = 128;
    const ctx = texCanvas.getContext('2d'), pixels = ctx.createImageData(128, 128);
    for (let i = 0; i < pixels.data.length; i += 4) { const v = 125 + random() * 100; pixels.data.set([v, v, v, 255], i); }
    ctx.putImageData(pixels, 0, 0);
    const grain = new THREE.CanvasTexture(texCanvas); grain.wrapS = grain.wrapT = THREE.RepeatWrapping; grain.repeat.set(100, 100);
    snow.bumpMap = grain; snow.bumpScale = .035;
    // Fine timber striations give facades texture at pedestrian distance.
    const timberCanvas = document.createElement('canvas'); timberCanvas.width = timberCanvas.height = 128;
    const tc = timberCanvas.getContext('2d'); tc.fillStyle = '#888'; tc.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 360; i++) {
        const v = 70 + random() * 100; tc.strokeStyle = `rgb(${v},${v},${v})`; tc.lineWidth = .3 + random();
        tc.beginPath(); const y = random() * 128; tc.moveTo(0, y); tc.bezierCurveTo(30, y + random() * 5, 80, y - random() * 5, 128, y); tc.stroke();
    }
    const timber = new THREE.CanvasTexture(timberCanvas); timber.wrapS = timber.wrapT = THREE.RepeatWrapping; timber.repeat.set(2, 3);
    wood.bumpMap = timber; wood.bumpScale = .065;
    const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 128;
    const sc = shadowCanvas.getContext('2d'), sg = sc.createRadialGradient(64, 64, 12, 64, 64, 64);
    sg.addColorStop(0, 'rgba(7,17,32,.62)'); sg.addColorStop(.45, 'rgba(7,17,32,.34)'); sg.addColorStop(1, 'rgba(7,17,32,0)');
    sc.fillStyle = sg; sc.fillRect(0, 0, 128, 128);
    const contactMaterial = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    const contactGeometry = new THREE.PlaneGeometry(1, 1);
    function contactShadow(x, z, w, d, y = .065) { add(contactGeometry, contactMaterial, x, y, z, w, d, 1, -Math.PI / 2); }
    const terrain = createWinterLandscape({ bumpMap: grain }); root.add(terrain);
    const magic = createWinterMagic(); root.add(magic.group);

    function tree(x, z, h, decorated = false) {
        const conifer = createConifer({ height: h, seed: Math.round((x + 200) * 133 + (z + 200) * 17), decorated });
        conifer.position.set(x, snowHeight(x, z), z); root.add(conifer); trees.push(conifer);
        contactShadow(x, z, h * .8, h * .8, snowHeight(x, z) + .018);
        colliders.push({ type: 'tree', x, z, radius: conifer.userData.collisionRadius });
        return conifer;
    }
    for (let i = 0; i < 96; i++) {
        const angle = random() * Math.PI * 2, radius = 92 + random() * 35;
        tree(Math.sin(angle) * radius, Math.cos(angle) * radius, 6 + random() * 8);
    }
    tree(-20, 18, 10, true);

    function wreath(x, y, z, r = .55) {
        const geo = new THREE.TorusGeometry(r, .14, 6, 20);
        add(geo, pine, x, y, z); geo.dispose();
        for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; ball(i % 2 ? gold : red, x + Math.sin(a) * r, y + Math.cos(a) * r, z + .12, .08); }
        box(red, x - .13, y - r, z + .18, .26, .17, .12, -.4);
        box(red, x + .13, y - r, z + .18, .26, .17, .12, .4);
    }
    function chalet(x, z, w, d, h, color, name, grand = false) {
        // Every home has a stable personality. This local seed keeps unrelated
        // landscape randomness unchanged when another cottage is added.
        let houseSeed = 2166136261;
        for (const letter of `${name}:${x}:${z}`) houseSeed = Math.imul(houseSeed ^ letter.charCodeAt(0), 16777619) >>> 0;
        const houseRandom = () => { houseSeed = (1664525 * houseSeed + 1013904223) >>> 0; return houseSeed / 4294967296; };
        const style = Math.floor(houseRandom() * 5);
        if (!grand) {
            w = THREE.MathUtils.clamp(w * (.73 + houseRandom() * .43), 5.1, 10.5);
            d = THREE.MathUtils.clamp(d * (.82 + houseRandom() * .27), 4.8, 7.7);
            h = THREE.MathUtils.clamp(h * (.83 + houseRandom() * .5), 3.45, 6.2);
        }
        const roofPitch = grand ? .53 + houseRandom() * .09 : .51 + houseRandom() * .28;
        const roofRise = w * .5 * Math.tan(roofPitch);
        const overhang = .48 + houseRandom() * .25;
        const ridgeOffset = grand ? 0 : (houseRandom() - .5) * w * .19;
        const roofBase = h + .42;
        const roofZ = z + (houseRandom() - .5) * .18;
        const chimneySide = houseRandom() > .5 ? 1 : -1;
        const chimneyX = x + chimneySide * w * (.21 + houseRandom() * .1);
        const chimneyZ = z - d * (.1 + houseRandom() * .24);
        const chimneyHeight = 2.8 + houseRandom() * 1.3;
        const chimneyY = h + roofRise * .45 + 1.05;
        const chimneyTop = chimneyY + chimneyHeight / 2;
        const porch = !grand && style !== 2;
        const facadeTint = new THREE.Color(color).offsetHSL((houseRandom() - .5) * .025, (houseRandom() - .5) * .06, (houseRandom() - .5) * .055);
        const facade = mat(facadeTint, .76, 0, { bumpMap: timber, bumpScale: .07, side: THREE.DoubleSide });
        const roofColors = [0x713c47, 0x3c5567, 0x395c55, 0x6d4d40, 0x654968];
        const roofMaterial = mat(roofColors[style], .66, .06);
        const shutter = mat([0x265649, 0x803e42, 0x335c73, 0x725273, 0x756035][style], .73);
        // Porch posts and the front steps are part of the pedestrian envelope.
        colliders.push({ type: 'building', x, z: z + .55, w: w / 2 + .75, d: d / 2 + 1.35 });
        buildings.push({ name, x, z, w, d, h, height: h, roofPitch, ridgeOffset, roofHeight: roofBase + roofRise + .2, style, porch });
        contactShadow(x, z, w + 4, d + 4);
        chimneys.push([chimneyX, chimneyTop + .3, chimneyZ]);
        box(stone, x, .25, z, w + .5, .7, d + .5);
        box(facade, x, h / 2 + .5, z, w, h, d);
        for (let y = .8; y < h + .4; y += .3) box(wood, x, y, z + d / 2 + .018, w, .025, .04);
        const front = z + d / 2;
        for (const side of [-1, 1]) {
            box(darkWood, x + side * (w / 2 - .12), h / 2 + .5, front + .1, .2, h, .2);
            const edgeX = side * (w / 2 + overhang);
            const run = Math.abs(edgeX - ridgeOffset);
            const roofAngle = -side * Math.atan2(roofRise, run);
            const centreX = x + (edgeX + ridgeOffset) / 2;
            const centreY = roofBase + roofRise / 2;
            const roofLength = Math.hypot(run, roofRise);
            box(roofMaterial, centreX, centreY, roofZ, roofLength, .24, d + overhang * 2, roofAngle);
            box(snow, centreX - Math.sin(roofAngle) * .17, centreY + Math.cos(roofAngle) * .17, roofZ,
                roofLength + .05, .15, d + overhang * 2 + .09, roofAngle);
            for (let k = 0; k < 17; k++) {
                const zz = roofZ - d / 2 + k * d / 16;
                const length = .12 + houseRandom() * .43;
                add(coneGeo, matIce, x + edgeX, roofBase - length / 2, zz, .04, length, .04, Math.PI);
            }
            for (let xx = 1.55; xx < w / 2 - .45; xx += 2.05) {
                const wx = x + side * xx;
                box(darkWood, wx, 2.12, front + .08, 1.1, 1.65, .2);
                box(warm, wx, 2.12, front + .21, .88, 1.4, .08);
                box(wood, wx, 2.12, front + .29, .06, 1.5, .09);
                box(wood, wx, 2.12, front + .29, .98, .06, .09);
                box(snow, wx, 1.3, front + .2, 1.26, .14, .42);
                box(shutter, wx, 1.15, front + .2, 1.16, .2, .35);
                for (const shutterSide of [-1, 1]) {
                    box(shutter, wx + shutterSide * .69, 2.12, front + .2, .28, 1.45, .12);
                    for (let slat = 0; slat < 8; slat++) box(wood, wx + shutterSide * .69, 1.53 + slat * .16, front + .29, .29, .028, .05);
                }
            }
        }
        const leftEdgeY = roofBase + roofRise * overhang / (w / 2 + overhang + ridgeOffset);
        const rightEdgeY = roofBase + roofRise * overhang / (w / 2 + overhang - ridgeOffset);
        const shape = new THREE.Shape();
        shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0);
        shape.lineTo(w / 2, rightEdgeY - h - .5);
        shape.lineTo(ridgeOffset, roofBase + roofRise - h - .5);
        shape.lineTo(-w / 2, leftEdgeY - h - .5); shape.closePath();
        const gable = new THREE.ShapeGeometry(shape);
        add(gable, facade, x, h + .5, front + .025);
        add(gable, facade, x, h + .5, z - d / 2 - .025); gable.dispose();
        beam([x - w / 2, leftEdgeY, front + .1], [x + ridgeOffset, roofBase + roofRise, front + .1], .075, darkWood);
        beam([x + w / 2, rightEdgeY, front + .1], [x + ridgeOffset, roofBase + roofRise, front + .1], .075, darkWood);
        // Round-topped doors, tiny brass hardware and a wreath at hand height.
        const doorShape = new THREE.Shape();
        doorShape.moveTo(-.58, 0); doorShape.lineTo(.58, 0); doorShape.lineTo(.58, 1.65);
        doorShape.quadraticCurveTo(.58, 2.4, 0, 2.4); doorShape.quadraticCurveTo(-.58, 2.4, -.58, 1.65); doorShape.closePath();
        const doorGeometry = new THREE.ExtrudeGeometry(doorShape, { depth: .12, bevelEnabled: true, bevelSize: .025, bevelThickness: .025, bevelSegments: 1, curveSegments: 12 });
        add(doorGeometry, shutter, x, .35, front + .13); doorGeometry.dispose();
        add(sphereGeo, warm, x, 2.12, front + .29, .24, .32, .055);
        box(gold, x, 2.12, front + .37, .035, .6, .035);
        ball(gold, x + .39, 1.4, front + .36, .065);
        wreath(x, 1.78, front + .36, .28);
        // Each cottage gets an attic feature rather than the same blank gable.
        if (style === 1 || style === 4) {
            const dx = x + (style === 1 ? -.17 : .19) * w;
            const dy = h + roofRise * .55 + .45;
            box(facade, dx, dy, front + .25, 1.25, 1.4, 1.3);
            box(darkWood, dx, dy, front + .94, .88, 1.1, .09);
            box(warm, dx, dy, front + 1.0, .66, .88, .06);
            box(gold, dx, dy, front + 1.05, .04, .92, .035);
            for (const side of [-1, 1]) {
                box(roofMaterial, dx + side * .36, dy + .82, front + .3, .94, .13, 1.7, -side * .56);
                box(snow, dx + side * .36, dy + .94, front + .3, .98, .1, 1.74, -side * .56);
            }
        } else {
            const atticX = x + ridgeOffset * .45, atticY = h + .6 + roofRise * .43;
            const ringGeometry = new THREE.TorusGeometry(.37, .07, 6, 20);
            add(ringGeometry, gold, atticX, atticY, front + .09); ringGeometry.dispose();
            add(sphereGeo, warm, atticX, atticY, front + .07, .32, .32, .055);
            box(wood, atticX, atticY, front + .15, .045, .68, .055);
            box(wood, atticX, atticY, front + .15, .68, .045, .055);
        }
        // A small pitched porch gives the streets a storybook silhouette.
        if (porch) {
            for (const side of [-1, 1]) {
                box(wood, x + side * .87, 1.65, front + 1.15, .09, 2.7, .09);
                box(roofMaterial, x + side * .48, 3.2, front + .75, 1.23, .14, 1.7, -side * .42);
                box(snow, x + side * .48, 3.32, front + .75, 1.27, .12, 1.75, -side * .42);
            }
            lightString([x - .88, 3.12, front + 1.55], [x + .88, 3.12, front + 1.55], 9, .18);
        }
        box(stone, chimneyX, chimneyY, chimneyZ, .8, chimneyHeight, .8);
        for (let i = 0; i < 9; i++) box(darkWood, chimneyX, chimneyY - chimneyHeight / 2 + i * chimneyHeight / 9, chimneyZ + .415, .81, .035, .035);
        box(gold, chimneyX, chimneyTop - .1, chimneyZ, 1.0, .13, 1.0);
        box(snow, chimneyX, chimneyTop + .06, chimneyZ, 1.06, .16, 1.06);
        label(name, x, h - .22, front + .34, grand ? 5.5 : Math.min(3.3, w * .55));
        lightString([x - w / 2 - .25, leftEdgeY, front + overhang + .08], [x + w / 2 + .25, rightEdgeY, front + overhang + .08], 22, .45);
        for (let k = 0; k < 3; k++) box(snow, x, .16 + k * .12, front + .6 + (2 - k) * .45, 1.9, .24, .65);
        for (const side of [-1, 1]) {
            for (let zz = z - d / 2 + .12; zz < z + d / 2; zz += .22) box(wood, x + side * (w / 2 + .025), Math.min(2.05, h / 2 + .5), zz, .05, Math.min(2.95, h - .2), .03);
            const edgeX = x + side * (w / 2 + overhang);
            beam([edgeX, roofBase - .02, roofZ - d / 2 - overhang], [edgeX, roofBase - .02, roofZ + d / 2 + overhang], .035, iron);
            for (let j = 0; j < 8; j++) add(sphereGeo, snow, edgeX, roofBase + .11, roofZ - d / 2 + j * d / 7, .24, .08 + houseRandom() * .06, .42);
        }
        for (let xx = x - w / 2; xx < x + w / 2; xx += .55) {
            box(stone, xx, .2, front + .13, .5, .22, .16);
            box(darkWood, xx + .22, .42, front + .13, .5, .035, .17);
        }
        if (grand) {
            for (const dx of [-w / 2 - 1.5, w / 2 + 1.5]) tree(x + dx, front + 1, 4, true);
            wreath(x + ridgeOffset * .4, h + .65 + roofRise * .25, front + .17, .62);
        }
    }
    const matIce = mat(0xb4ddeb, .12, .15);
    chalet(-34, 5, 7, 6, 4, 0x945245, 'Peperkoekhuis');
    chalet(-34, 20, 7, 6, 4, 0x3c6a63, 'De Dennenpost');
    chalet(-34, 35, 7, 6, 4, 0x9e7546, 'Sterrenbakkerij');
    chalet(-7, 30, 7, 6, 4, 0x7a424a, 'Elf & Draad');
    chalet(5, 35, 7, 6, 4, 0x42687b, 'Speelgoedmakers');
    chalet(-34, -24, 12, 10, 6, 0x963f3d, 'Het huis van Santa', true);
    chalet(30, -14, 19, 14, 7, 0x3f665a, 'Grote pakjeswerkplaats', true);
    // Additional residential streets, a market quarter and the northern square.
    const districtColors = [0x8e4b43, 0x386457, 0x8b704a, 0x3d5970, 0x725267];
    const districtNames = ['Sneeuwklokje', 'Hulst & Honing', 'De Warme Wanten', 'Dennenlicht', 'Het Sterschrift'];
    for (let i = 0; i < 5; i++) chalet(-59, -28 + i * 20, 8 + i % 2, 7, 4.2 + i % 2 * .5, districtColors[i], districtNames[i]);
    for (let i = 0; i < 5; i++) chalet(-44 + i * 22, -47, 8, 7, 4.5, districtColors[(i + 2) % 5], ['Het Noorderlicht', 'Elfenbibliotheek', 'Klokkenmaker', 'De Poolster', 'Het Wolatelier'][i]);
    for (let i = 0; i < 4; i++) chalet(57, -24 + i * 21, 8, 7, 4.5, districtColors[(i + 1) % 5], ['Rendierwacht', 'Kerstpost', 'De Suikerster', 'Lichtjesmaker'][i]);
    for (let i = 0; i < 4; i++) chalet(-37 + i * 24, 59, 8, 7, 4.2, districtColors[(i + 3) % 5], ['Het Koekjeshuis', 'De Rode Sjaal', 'Sneeuwvlok', 'De Speeldoos'][i]);
    // Glass-roofed link to the original, functioning dollhouse workshop.
    for (let x = 19; x < 21; x += .25) box(wood, x, .45, -8, .2, .3, 4);
    for (const x of [19, 20.5]) box(gold, x, 2.2, -8, .16, 4, 4.3);
    // Toy-production loading yard: timber bays, wrapped parcels and delivery carts.
    for (let i = 0; i < 7; i++) {
        const x = 23 + i * 2.2;
        box(wood, x, .2, -2.8, 1.6, .25, 1.5);
        for (let j = 0; j < 3; j++) {
            const size = .45 + random() * .4, z = -2.7 + (j - 1) * .45;
            box(i % 2 ? red : green, x + (j % 2) * .4, .35 + size / 2, z, size, size, size);
            box(gold, x + (j % 2) * .4, .36 + size / 2, z, .08, size + .03, size + .03);
        }
    }
    // Broad, softly reflective cobblestone streets with individual inset pavers.
    const roadMat = mat(0x657481, .48, .05);
    function road(x, z, w, d) {
        roads.push({ x, z, w: w / 2, d: d / 2 });
        box(roadMat, x, -.12, z, w, .2, d);
        for (let zz = z - d / 2 + .4; zz < z + d / 2; zz += .8) {
            for (let xx = x - w / 2 + .4; xx < x + w / 2; xx += .9) {
                box(stone, xx, .005 + random() * .025, zz, .82, .08, .71);
            }
        }
        for (const side of [-1, 1]) box(snow, x + side * (w / 2 + .12), .1, z, .32, .24, d);
    }
    road(-20, 6, 5.5, 79); road(-14, 25, 47, 4); road(-12, -14, 9, 4);
    road(-46, 12, 5, 92); road(45, 7, 5, 99);
    road(-1, -38, 98, 5); road(-1, 49, 98, 5);
    road(-13, 42, 68, 4); road(-1, -30, 98, 4);
    for (let i = 0; i < 5; i++) road(-53, -23.4 + i * 20, 14, 2.6);
    for (let i = 0; i < 5; i++) road(-44 + i * 22, -40.5, 2.5, 7);
    for (let i = 0; i < 4; i++) road(51, -19.4 + i * 21, 14, 2.6);
    for (let i = 0; i < 4; i++) road(-37 + i * 24, 54, 2.6, 7);
    // Branches reach cottage doors rather than ending at the main street.
    for (const z of [5, 20, 35]) road(-28, z + 4.6, 13, 2.4);
    road(-28, -17.5, 13, 3);
    road(30, 0, 7, 8); road(9, 3, 44, 4);
    const plaza = new THREE.CylinderGeometry(8, 8.3, .24, 64);
    add(plaza, roadMat, -20, -.02, 18); plaza.dispose();
    // Tree basin, benches, candy-cane bollards and lanterns.
    const ring = new THREE.TorusGeometry(2.8, .18, 8, 48);
    add(ring, snow, -20, .1, 18, 1, 1, 1, Math.PI / 2); ring.dispose();
    for (const x of [-26.5, -13.5]) {
        box(wood, x, .7, 18, .9, .18, 2.8);
        box(wood, x + (x < -20 ? -.4 : .4), 1.1, 18, .12, .75, 2.8);
        for (const z of [17, 19]) box(iron, x, .35, z, .65, .7, .12);
    }
    function lamp(x, z) {
        colliders.push({ type: 'lamp', x, z, radius: .4 });
        box(iron, x, 2.25, z, .14, 4.5, .14);
        box(gold, x, .25, z, .4, .45, .4);
        box(iron, x, 4.45, z, .72, .12, .72);
        box(warm, x, 4.9, z, .42, .75, .42);
        for (const a of [-1, 1]) for (const b of [-1, 1]) box(iron, x + a * .27, 4.9, z + b * .27, .06, .85, .06);
        add(coneGeo, iron, x, 5.5, z, .58, .48, .58, 0, Math.PI / 4);
        ball(snow, x, 5.7, z, .14);
        wreath(x, 3.6, z + .18, .35);
        // A transparent warm pool gives every lantern contact with the snow
        // without adding an expensive shadow-casting light for every bulb.
        const pool = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), poolMat);
        pool.rotation.x = -Math.PI / 2; pool.position.set(x, .08, z); root.add(pool);
    }
    const poolCanvas = document.createElement('canvas'); poolCanvas.width = poolCanvas.height = 64;
    const pc = poolCanvas.getContext('2d'), gradient = pc.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,174,75,.4)'); gradient.addColorStop(1, 'rgba(255,174,75,0)'); pc.fillStyle = gradient; pc.fillRect(0, 0, 64, 64);
    const poolMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(poolCanvas), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let z = -29; z <= 42; z += 10) {
        lamp(-23.7, z); lamp(-16.3, z);
        lightString([-23.7, 5.3, z], [-16.3, 5.3, z], 22, .8);
        if (z < 40) for (const x of [-23.7, -16.3]) lightString([x, 5.2, z], [x, 5.2, z + 10], 20, 1);
    }
    for (const x of [-7, 5, 17, 29]) { lamp(x, 5.5); lightString([x, 5.2, 5.5], [x + 12, 5.2, 5.5], 22); }
    for (const [x, z] of [[-40, 12], [-40, 29], [-8, 39], [12, 32], [42, -7], [40, -25], [-43, -28]]) tree(x, z, 6, true);

    for (const x of [-49.3, -42.7, 41.7, 48.3]) for (let z = -31; z <= 49; z += 16) {
        lamp(x, z); if (z < 45) lightString([x, 5.2, z], [x, 5.2, z + 16], 26, 1.5);
    }
    for (let x = -40; x <= 40; x += 16) {
        lamp(x, -35); lamp(x, 46);
        lightString([x, 5.2, -35], [x + 16, 5.2, -35], 26);
        lightString([x, 5.2, 46], [x + 16, 5.2, 46], 26);
    }
    for (const [x, z, h] of [[-38, -7, 8], [-9, -24, 7], [21, 17, 9], [7, 17, 7], [-29, 45, 8], [30, 39, 7], [-67, 0, 8], [68, 28, 9], [-11, 51, 7]]) tree(x, z, h, true);

    const creamMarket = mat(0xf4e7ca);
    // Christmas market: canvas awnings, pastries, toy stalls and tiny signs.
    for (let i = 0; i < 4; i++) {
        const x = -8 + i * 10, z = 13;
        colliders.push({ type: 'stall', x, z, w: 1.8, d: 1.5 });
        box(wood, x, .6, z, 3.2, 1.2, 2);
        for (const side of [-1, 1]) box(wood, x + side * 1.6, 1.65, z - .7, .1, 3.3, .1);
        for (let j = 0; j < 12; j++) box(j % 2 ? creamMarket : red, x - 1.65 + j * .3, 3.15, z, .3, .12, 2.7);
        label(['Warme chocolademelk', 'Vers uit de oven', 'Houten speelgoed', 'Kerstkransen'][i], x, 2.45, z + 1.05, 2.7);
        lightString([x - 1.6, 3, z + 1.3], [x + 1.6, 3, z + 1.3], 10, .2);
    }

    // Santa remains a separate controllable actor.

    const skin = mat(0xe8b58c, .75), cream = mat(0xf4e7ca), black = mat(0x181b22, .4);
    function character(isSanta = false) {
        const g = new THREE.Group(), coat = isSanta ? red : green;
        add(sphereGeo, coat, 0, .85, 0, .38, .5, .28, 0, 0, 0, g);
        ball(skin, 0, 1.48, 0, .25, g);
        if (isSanta) {
            add(sphereGeo, cream, 0, 1.31, .16, .26, .28, .16, 0, 0, 0, g);
            box(black, 0, .8, .01, .75, .1, .55, 0, g); box(gold, 0, .8, .3, .16, .15, .05, 0, g);
            box(cream, 0, .49, 0, .63, .1, .47, 0, g);
        }
        add(coneGeo, coat, .05, 1.88, -.02, .28, .6, .28, 0, 0, -.22, g);
        ball(cream, .12, 2.18, -.02, .09, g);
        add(sphereGeo, cream, 0, 1.63, 0, .29, .07, .27, 0, 0, 0, g);
        for (const side of [-1, 1]) {
            ball(black, side * .09, 1.52, .22, .026, g);
            box(coat, side * .4, .92, .06, .17, .53, .2, side * .18, g);
            ball(cream, side * .44, .66, .09, .12, g);
        }
        const legs = [-1, 1].map(side => {
            const leg = new THREE.Group(); leg.position.set(side * .17, .5, 0); g.add(leg);
            box(isSanta ? red : cream, 0, -.18, 0, .2, .4, .2, 0, leg);
            box(black, 0, -.4, .09, .24, .16, .38, 0, leg); return leg;
        });
        g.userData.legs = legs; return g;
    }
    const santa = character(true); root.add(santa); santa.position.set(-20, .12, 28);
    const flight = new THREE.Group(); flight.name = 'Santa, slee en acht rendieren'; root.add(flight); flight.position.set(-12, .2, 25);
    box(red, 0, .85, 0, 1.8, .65, 2.8, 0, flight);
    box(red, 0, 1.4, -1.2, 1.9, .9, .22, 0, flight);
    box(gold, 0, 1, .7, 1.9, .18, .22, 0, flight);
    box(cream, 0, 1.23, -.45, 1.4, .22, 1, 0, flight);
    for (const side of [-1, 1]) {
        box(red, side * .88, 1.2, 0, .18, .8, 2.7, 0, flight);
        beam([side, .2, -1.8], [side, .2, 1.7], .075, gold, flight);
        beam([side, .2, 1.7], [side, .7, 2.15], .075, gold, flight);
        for (const z of [-1, 1]) beam([side, .2, z], [side * .8, .8, z], .06, gold, flight);
    }
    for (let i = 0; i < 7; i++) {
        const x = (i % 3 - 1) * .46, z = -1.05 + Math.floor(i / 3) * .4;
        box(i % 2 ? green : red, x, 1.6 + (i % 2) * .35, z, .45, .5, .4, 0, flight);
        box(gold, x, 1.61 + (i % 2) * .35, z, .06, .53, .43, 0, flight);
    }
    const deerMaterial = mat(0x8b6447), antlerMaterial = mat(0xcbb48e);
    const deer = [];
    for (let i = 0; i < 8; i++) {
        const g = new THREE.Group(); g.position.set(i % 2 ? 1.2 : -1.2, 0, 4 + Math.floor(i / 2) * 2.3); flight.add(g);
        add(sphereGeo, deerMaterial, 0, 1.15, 0, .38, .45, .8, 0, 0, 0, g);
        add(sphereGeo, deerMaterial, 0, 1.65, .63, .25, .62, .3, -.3, 0, 0, g);
        add(sphereGeo, deerMaterial, 0, 2.03, .88, .24, .26, .45, 0, 0, 0, g);
        ball(i >= 6 ? bulbs[1] : black, 0, 2.02, 1.27, .12, g);
        const legs = [];
        for (const side of [-1, 1]) {
            for (const z of [-.45, .45]) {
                const l = new THREE.Group(); l.position.set(side * .25, 1, z); g.add(l);
                box(deerMaterial, 0, -.43, 0, .12, .86, .14, 0, l); box(black, 0, -.87, .03, .17, .16, .25, 0, l); legs.push(l);
            }
            beam([side * .16, 2.18, .7], [side * .4, 2.9, .5], .045, antlerMaterial, g);
            for (let j = 0; j < 3; j++) beam([side * (.25 + j * .055), 2.4 + j * .17, .64 - j * .04], [side * (.52 + j * .07), 2.62 + j * .17, .8], .03, antlerMaterial, g);
            add(sphereGeo, deerMaterial, side * .3, 2.12, .7, .22, .08, .13, 0, 0, side * .4, g);
            beam([side * .35, 1.3, -.3], [side * .35, 1.3, .4], .055, red, g);
        }
        deer.push({ g, legs });
    }
    for (const side of [-1, 1]) beam([side * .7, 1.3, .9], [side * 1.2, 1.5, 11.4], .025, gold, flight);

    // Preserve animated limb groups, but merge their rigid parts per material.
    function mergeRigidParts(group) {
        for (const child of [...group.children]) if (child.isGroup) mergeRigidParts(child);
        const byMaterial = new Map();
        for (const child of [...group.children]) {
            if (!child.isMesh) continue;
            child.updateMatrix();
            const geometry = (child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone()).applyMatrix4(child.matrix);
            if (!byMaterial.has(child.material)) byMaterial.set(child.material, []);
            byMaterial.get(child.material).push(geometry); group.remove(child);
        }
        for (const [material, geometries] of byMaterial) {
            const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
            mesh.castShadow = !!material.emissive && material.emissive.getHex() === 0; mesh.receiveShadow = true; group.add(mesh);
            geometries.forEach(g => g.dispose());
        }
    }
    mergeRigidParts(flight); mergeRigidParts(santa);
    for (const [material, geometries] of batches) {
        const merged = mergeGeometries(geometries);
        const mesh = new THREE.Mesh(merged, material); mesh.castShadow = !!material.emissive && material.emissive.getHex() === 0; mesh.receiveShadow = true; root.add(mesh);
        geometries.forEach(g => g.dispose());
    }
    const storybookDetails = createStorybookDetails({ root, buildings });
    // A few physically lit focal points supplement the emissive decorations.
    for (const [x, y, z, intensity, distance] of [[-20, 6, 18, 18, 22], [-34, 3, -17, 35, 17], [30, 4, -5, 60, 24], [-32, 3, 24, 30, 16]]) {
        const l = new THREE.PointLight(0xffba70, intensity, distance, 2); l.position.set(x, y, z); root.add(l);
    }

    // A single soft particle draw brings the homes to life without per-house
    // animations or dozens of transparent smoke meshes.
    const smokePositions = [], smokePhases = [];
    chimneys.forEach((p, index) => { for (let i = 0; i < 12; i++) { smokePositions.push(...p); smokePhases.push(i / 12 + index * .17); } });
    const smokeGeometry = new THREE.BufferGeometry();
    smokeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(smokePositions, 3));
    smokeGeometry.setAttribute('phase', new THREE.Float32BufferAttribute(smokePhases, 1));
    const smokeTime = { value: 0 };
    const smoke = new THREE.Points(smokeGeometry, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, uniforms: { time: smokeTime },
        vertexShader: `attribute float phase; uniform float time; varying float age;
            void main() { age = fract(phase + time * .08); vec3 p = position;
                p.y += age * 6.; p.x += age * age * 4.; p.z += sin(phase * 24. + age * 3.) * age;
                vec4 view = modelViewMatrix * vec4(p, 1.);
                gl_Position = projectionMatrix * view;
                gl_PointSize = clamp((.4 + age * 1.5) * 450. / -view.z, 1., 80.); }`,
        fragmentShader: `varying float age; void main() { float r = length(gl_PointCoord - .5);
            float alpha = (1. - smoothstep(.12, .5, r)) * sin(age * 3.14159) * .11;
            gl_FragColor = vec4(.53, .61, .69, alpha); }`
    }));
    smoke.frustumCulled = false; root.add(smoke);

    let mode = 'overview', yaw = Math.PI, pitch = 0, tourLookYaw = 0, tourTime = 0, tourPlaying = true;
    let velocity = 0, altitude = 16;
    const keys = new Set();
    const walker = new THREE.Vector3(-20, 1.75, 39);
    // Every pedestrian shares this complete map, including tree canopies,
    // benches, stalls, lamp posts, and the original workshop.
    colliders.push({ type: 'building', x: 12, z: -5.5, w: 9.5, d: 6.6 }, { type: 'pole', x: .5, z: .5, radius: 1.4 });
    for (const x of [-26.5, -13.5]) colliders.push({ type: 'bench', x, z: 18, w: .65, d: 1.65 });
    const navigation = createNavigation(colliders);
    const route = navigation.tour([
        [-20, 40], [-25, 27], [-27, 10], [-20, -18], [-33, -17],
        [-46, -30], [-46, 8], [-46, 42], [-20, 42], [4, 42], [30, 42],
        [45, 27], [45, 3], [30, 3], [2, 3], [-15, 12], [-14, 27]
    ]);
    const routeClear = route.validate();
    if (!routeClear) throw new Error('The village tour is obstructed');
    const lifePaths = [
        [[-25, 27], [-27, 10], [-20, 4]], [[-20, 4], [-20, -18]],
        [[-46, -30], [-46, 8], [-46, 42]], [[-42, -38], [-1, -38], [40, -38]],
        [[-42, 49], [0, 49], [40, 49]], [[45, -28], [45, 3], [45, 39]],
        [[-13, 25], [2, 25], [16, 25]], [[-20, 42], [0, 42], [30, 42]]
    ].map(path => path.flatMap((point, i) => i ? navigation.plan(path[i - 1], point).slice(1) : [point]));
    const life = createVillageLife({ parent: root, paths: lifePaths, count: 48, isWalkable: navigation.isWalkable });
    function footHeight(x, z) {
        if (Math.hypot(x + 20, z - 18) < 8 || roads.some(r => Math.abs(x - r.x) <= r.w && Math.abs(z - r.z) <= r.d)) return .1;
        return snowHeight(x, z);
    }
    const sampleRoute = fraction => { const [x, z] = route.at(fraction * route.length); return new THREE.Vector3(x, footHeight(x, z) + 1.65, z); };
    const status = document.getElementById('explore-status');
    const instructions = document.getElementById('explore-instructions');
    const tourButton = document.getElementById('btn-tour-pause');
    const flightButton = document.getElementById('btn-fly');
    function setMode(next) {
        if (next === 'overview') { onOverview(); } else { onExplore(); }
        mode = next; keys.clear(); controls.enabled = next === 'overview'; controls.autoRotate = false;
        if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
        santa.removeFromParent(); root.add(santa); santa.visible = next !== 'walk'; santa.position.set(-20, .12, 28); santa.rotation.set(0, 0, 0);
        if (next === 'walk') { tourTime = 0; tourPlaying = !matchMedia('(prefers-reduced-motion: reduce)').matches; walker.copy(sampleRoute(0)); yaw = Math.PI; pitch = 0; tourLookYaw = 0; }
        if (next === 'fly') {
            flight.position.set(-12, 16, 25); flight.rotation.set(0, Math.PI, 0); velocity = 5; altitude = 16;
            flight.add(santa); santa.position.set(0, 1.05, .1); santa.rotation.set(0, 0, 0); santa.scale.setScalar(.8);
        } else { santa.scale.setScalar(1); flight.position.set(-12, .2, 25); flight.rotation.set(0, 0, 0); }
        if (next === 'santa') yaw = Math.PI;
        document.body.dataset.exploreMode = next;
        document.querySelectorAll('[data-mode]').forEach(b => { const active = b.dataset.mode === next; b.setAttribute('aria-pressed', String(active)); });
        flightButton.textContent = next === 'fly' ? 'Terug naar plein' : 'Vlieg met de slee';
        tourButton.hidden = next !== 'walk';
        tourButton.textContent = tourPlaying ? 'Pauzeer wandeling' : 'Hervat wandeling';
        status.textContent = { overview: 'Het winterdorp · 90° N', walk: 'Te voet door het elfendorp', santa: 'Santa op het dorpsplein', fly: 'Santa’s kerstvlucht' }[next];
        instructions.textContent = { overview: 'Sleep om rond te kijken · Scroll om in te zoomen', walk: 'Automatische rondleiding · WASD / pijltjes om zelf te lopen · Sleep om te kijken · Esc: overzicht', santa: 'W/S: lopen · A/D: draaien · Shift: rennen · Esc: overzicht', fly: 'W/S: snelheid · A/D: sturen · Spatie: stijgen · Shift: dalen · Esc: overzicht' }[next];
        camera.fov = next === 'walk' ? 67 : next === 'fly' ? 58 : 46; camera.updateProjectionMatrix();
        renderer.shadowMap.needsUpdate = true;
    }
    document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode === 'fly' && mode === 'fly' ? 'santa' : b.dataset.mode)));
    tourButton.addEventListener('click', () => {
        if (!tourPlaying) {
            // Resume at the closest route point after free exploration.
            let bestDistance = Infinity;
            for (let i = 0; i < 400; i++) {
                const u = i / 400, distance = sampleRoute(u).distanceToSquared(walker);
                if (distance < bestDistance) { bestDistance = distance; tourTime = u; }
            }
            tourLookYaw = 0;
        }
        tourPlaying = !tourPlaying; tourButton.textContent = tourPlaying ? 'Pauzeer wandeling' : 'Hervat wandeling';
    });
    const movementKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'];
    window.addEventListener('keydown', e => {
        if (e.code === 'Escape' && mode !== 'overview') { setMode('overview'); return; }
        if (mode === 'overview' || !movementKeys.includes(e.code) || e.target.closest('input, textarea')) return;
        e.preventDefault(); keys.add(e.code);
        if (mode === 'walk' && !e.code.startsWith('Shift')) { tourPlaying = false; tourButton.textContent = 'Hervat wandeling'; }
    });
    window.addEventListener('keyup', e => keys.delete(e.code));
    window.addEventListener('blur', () => keys.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) keys.clear(); });
    let dragging = false, lastX = 0, lastY = 0;
    renderer.domElement.addEventListener('pointerdown', e => { if (mode !== 'walk') return; dragging = true; lastX = e.clientX; lastY = e.clientY; renderer.domElement.setPointerCapture(e.pointerId); });
    renderer.domElement.addEventListener('pointermove', e => {
        if (mode !== 'walk' || !dragging) return;
        if (tourPlaying) tourLookYaw -= (e.clientX - lastX) * .004;
        else yaw -= (e.clientX - lastX) * .004;
        pitch = THREE.MathUtils.clamp(pitch - (e.clientY - lastY) * .003, -.85, .85); lastX = e.clientX; lastY = e.clientY;
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) renderer.domElement.addEventListener(event, () => { dragging = false; });
    document.querySelectorAll('[data-key]').forEach(button => {
        button.addEventListener('pointerdown', e => { e.preventDefault(); button.setPointerCapture(e.pointerId); keys.add(button.dataset.key); if (mode === 'walk') { tourPlaying = false; tourButton.textContent = 'Hervat wandeling'; } });
        for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, () => keys.delete(button.dataset.key));
    });
    function safeMove(position, dx, dz) { navigation.move(position, dx, dz); }
    const forward = new THREE.Vector3(), target = new THREE.Vector3(), desired = new THREE.Vector3();
    let lastShadowUpdate = 0;
    function update(dt, t) {
        if (mode !== 'overview' && t - lastShadowUpdate > .25) { renderer.shadowMap.needsUpdate = true; lastShadowUpdate = t; }
        smokeTime.value = t;
        magic.update(t);
        storybookDetails.update(t);
        life.update(dt, t);
        trees.forEach(tree => tree.userData.updateLOD?.(camera));
        const turn = Number(keys.has('KeyA') || keys.has('ArrowLeft')) - Number(keys.has('KeyD') || keys.has('ArrowRight'));
        const thrust = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
        if (mode === 'walk') {
            if (tourPlaying) {
                tourTime = (tourTime + dt * 2.2 / route.length) % 1;
                const next = sampleRoute(tourTime);
                // Positions follow validated straight segments; only the gaze
                // eases around corners, never the collision path itself.
                walker.copy(next);
                const look = sampleRoute(tourTime + 1.6 / route.length).sub(walker);
                const desiredYaw = Math.atan2(look.x, look.z) + tourLookYaw;
                yaw += Math.atan2(Math.sin(desiredYaw - yaw), Math.cos(desiredYaw - yaw)) * (1 - Math.exp(-dt * 6));
            } else {
                const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 6 : 3.2;
                const length = Math.max(1, Math.hypot(thrust, turn));
                safeMove(walker, (Math.sin(yaw) * thrust + Math.cos(yaw) * turn) * speed * dt / length, (Math.cos(yaw) * thrust - Math.sin(yaw) * turn) * speed * dt / length);
            }
            walker.y = THREE.MathUtils.damp(walker.y, footHeight(walker.x, walker.z) + 1.65, 10, dt);
            camera.position.copy(walker);
            target.set(walker.x + Math.sin(yaw) * Math.cos(pitch), walker.y + Math.sin(pitch), walker.z + Math.cos(yaw) * Math.cos(pitch)); camera.lookAt(target);
        } else if (mode === 'santa') {
            yaw += turn * dt * 1.9; santa.rotation.y = yaw;
            const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 6 : 3) * thrust;
            safeMove(santa.position, Math.sin(yaw) * speed * dt, Math.cos(yaw) * speed * dt);
            santa.position.y = footHeight(santa.position.x, santa.position.z);
            santa.userData.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(t * 9 + i * Math.PI) * .5 * Math.abs(thrust); });
            target.copy(santa.position).add(new THREE.Vector3(0, 1.3, 0));
            desired.set(santa.position.x - Math.sin(yaw) * 5, santa.position.y + 3.4, santa.position.z - Math.cos(yaw) * 5);
            camera.position.lerp(desired, 1 - Math.exp(-dt * 5)); camera.lookAt(target);
        } else if (mode === 'fly') {
            flight.rotation.y += turn * dt * .9;
            velocity = THREE.MathUtils.clamp(velocity + thrust * dt * 5, 0, 20);
            const lift = Number(keys.has('Space')) - Number(keys.has('ShiftLeft') || keys.has('ShiftRight'));
            altitude = THREE.MathUtils.clamp(altitude + lift * dt * 7, 16, 48);
            forward.set(Math.sin(flight.rotation.y), 0, Math.cos(flight.rotation.y));
            flight.position.addScaledVector(forward, velocity * dt);
            const distance = Math.hypot(flight.position.x, flight.position.z);
            if (distance > 116) { flight.position.x *= 116 / distance; flight.position.z *= 116 / distance; velocity = 0; }
            // Keep both the sleigh and the leading deer above the rolling
            // forest floor; the outward landscape is no longer a flat disc.
            altitude = Math.max(altitude, snowHeight(flight.position.x, flight.position.z) + 16,
                snowHeight(flight.position.x + forward.x * 12, flight.position.z + forward.z * 12) + 16);
            flight.position.y = altitude + Math.sin(t * 1.7) * .16;
            flight.rotation.z = THREE.MathUtils.damp(flight.rotation.z, -turn * .14, 4, dt);
            deer.forEach(({ g, legs }, j) => { g.position.y = Math.sin(t * 3 + j) * .09; legs.forEach((leg, k) => { leg.rotation.x = Math.sin(t * 5 + k + j) * .35; }); });
            target.copy(flight.position).addScaledVector(forward, 5).add(new THREE.Vector3(0, 1, 0));
            desired.copy(flight.position).addScaledVector(forward, -11).add(new THREE.Vector3(0, 5, 0));
            camera.position.lerp(desired, 1 - Math.exp(-dt * 4)); camera.lookAt(target);
            status.textContent = `Santa’s kerstvlucht · ${Math.round(altitude)} m · ${Math.round(velocity * 3.6)} km/u`;
        }
    }
    return { update, setMode, navigation, route, trees, get mode() { return mode; }, getState: () => ({ mode, tourPlaying, santa: santa.getWorldPosition(new THREE.Vector3()).toArray(), flight: flight.position.toArray(), velocity, altitude, walker: walker.toArray(), buildings: buildings.length, elves: life.count, life: life.getState(), trees: trees.length, routeLength: route.length, routeClear, voxelPitch: .125, terrain: 'continuous-wind-drifts', architecture: buildings.map(b => ({ name: b.name, w: b.w, d: b.d, h: b.h, roof: b.roofPitch, style: b.style })), reindeer: deer.length }) };
}
