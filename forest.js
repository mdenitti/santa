import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Six reusable, deterministic spruce crowns. Needles are crossed tapered
// ribbons of geometry, not a texture on a cone. LOD changes density at distance.
const variants = new Map();
const bark = new THREE.MeshStandardMaterial({ color: 0x59483c, roughness: .96 });
const foliage = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .68, metalness: .025, side: THREE.DoubleSide });
const snow = new THREE.MeshStandardMaterial({ color: 0xe5edf2, roughness: .92 });
const warm = new THREE.MeshStandardMaterial({ color: 0xffd899, emissive: 0xffac47, emissiveIntensity: 1.4, roughness: .35 });
const ruby = new THREE.MeshStandardMaterial({ color: 0xb2383d, metalness: .65, roughness: .25 });
const gold = new THREE.MeshStandardMaterial({ color: 0xc8a35c, metalness: .78, roughness: .24 });
const bulbGeometry = new THREE.SphereGeometry(1, 6, 4);
const ornamentGeometry = new THREE.SphereGeometry(1, 8, 6);
const snowGeometry = new THREE.IcosahedronGeometry(1, 1);
const distantSnowGeometry = new THREE.IcosahedronGeometry(1, 0);
const up = new THREE.Vector3(0, 1, 0);

function rng(seed) {
    let n = seed >>> 0;
    return () => { n = (1664525 * n + 1013904223) >>> 0; return n / 4294967296; };
}

function merge(parts) {
    const geometry = mergeGeometries(parts);
    parts.forEach(g => g.dispose());
    geometry.computeBoundingSphere();
    return geometry;
}

function createGeometry(variant, detail) {
    const random = rng(8128 + variant * 989);
    const branches = [], snowcaps = [], positions = [], colors = [], fanNormalRanges = [];
    let needleCount = 0;
    const color = new THREE.Color();
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const end = new THREE.Vector3(), direction = new THREE.Vector3();
    const side = new THREE.Vector3(), cross = new THREE.Vector3();
    function cylinder(a, b, r0, r1) {
        direction.subVectors(b, a);
        const g = new THREE.CylinderGeometry(r1, r0, direction.length(), detail === 0 ? 7 : 4);
        quaternion.setFromUnitVectors(up, direction.clone().normalize());
        matrix.compose(a.clone().add(b).multiplyScalar(.5), quaternion, new THREE.Vector3(1, 1, 1));
        branches.push(g.toNonIndexed().applyMatrix4(matrix)); g.dispose();
    }
    function triangle(a, b, c, tint) {
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        for (let i = 0; i < 3; i++) colors.push(tint.r, tint.g, tint.b);
    }
    function needle(a, b, width, tint) {
        needleCount++;
        direction.subVectors(b, a).normalize();
        side.crossVectors(direction, up).normalize();
        if (side.lengthSq() < .1) side.set(1, 0, 0);
        cross.crossVectors(direction, side).normalize();
        // Two crossing ribbons give a needle thickness and highlights when the
        // camera walks around the branch; the pointed tips remain independent.
        triangle(a.clone().addScaledVector(side, width), a.clone().addScaledVector(side, -width), b, tint);
        triangle(a.clone().addScaledVector(cross, width), a.clone().addScaledVector(cross, -width), b, tint);
    }
    function spray(a, b, phase) {
        const axis = b.clone().sub(a), len = axis.length();
        const tangent = axis.clone().normalize();
        const across = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        const count = detail === 0 ? 13 : detail === 1 ? 5 : 2;
        // Overlapping serrated foliage fans retain a substantial crown in all
        // LODs. Their ridges, drooping rims and dark undersides give each twig
        // actual volume; independent fine needles fringe the close model.
        const fanWidth = len * (.38 + Math.sin(phase * 2) * .035);
        const lobes = detail === 0 ? 5 : detail === 1 ? 4 : 3;
        const outline = [a.clone()];
        for (const sign of [-1, 1]) {
            for (let i = 1; i <= lobes; i++) {
                const f = sign < 0 ? i / (lobes + 1) : 1 - i / (lobes + 1);
                const point = a.clone().addScaledVector(axis, f);
                const scallop = 1 + Math.sin(i * 2.7 + phase) * .14;
                point.addScaledVector(across, sign * fanWidth * Math.sin(Math.PI * f) * scallop);
                point.y -= .003 + len * .025 * Math.sin(Math.PI * f);
                outline.push(point);
            }
            if (sign < 0) { const tip = b.clone(); tip.y += .005; outline.push(tip); }
        }
        const upper = a.clone().addScaledVector(axis, .47); upper.y += .004 + len * .02;
        const lower = upper.clone(); lower.y -= .008 + len * .04;
        for (let i = 0; i < outline.length; i++) {
            const next = outline[(i + 1) % outline.length];
            const brightness = .85 + Math.sin(phase + i * 1.7) * .12;
            color.setRGB(.028 * brightness, .116 * brightness, .055 * brightness);
            const topStart = positions.length / 3;
            triangle(upper, next, outline[i], color);
            fanNormalRanges.push([topStart, 1]);
            color.setRGB(.021, .085, .045);
            const bottomStart = positions.length / 3;
            triangle(lower, outline[i], next, color);
            fanNormalRanges.push([bottomStart, -1, across.x, across.z]);
        }
        for (let i = 0; i < count; i++) {
            const f = (i + .2) / count;
            const center = a.clone().addScaledVector(axis, f);
            for (const sign of [-1, 1]) {
                const base = center.clone().addScaledVector(across, sign * fanWidth * Math.sin(Math.PI * f) * .85);
                base.y += .003;
                const length = (detail === 0 ? .012 : detail === 1 ? .023 : .044) * (.7 + random() * .5) * (1 - f * .35);
                const rise = Math.sin(i * 2.4 + phase) * .22 + .24;
                end.copy(base).addScaledVector(across, length * sign).addScaledVector(tangent, length * .5);
                end.y += length * rise;
                const brightness = .8 + random() * .45;
                color.setRGB(.038 * brightness, .15 * brightness, .078 * brightness);
                needle(base, end.clone(), detail === 0 ? .00065 : detail === 1 ? .0021 : .007, color);
                if (detail === 0 && i % 3 === 0) {
                    const top = base.clone().addScaledVector(tangent, length * .35); top.y += length * .9;
                    needle(base, top, .00065, color);
                }
            }
        }
        // Fine woody stem is visible between sprays in the close model.
        if (detail === 0 && len > .02 && Math.sin(phase) > .8) cylinder(a, b, .00085, .00025);
    }
    cylinder(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), .018, .001);
    // Uneven whorls, rather than stacked cones, make the outline branchy.
    const whorls = detail === 0 ? 14 : detail === 1 ? 10 : 8;
    for (let level = 0; level < whorls; level++) {
        const y = .14 + level / (whorls - 1) * .81;
        const radius = .29 * Math.pow((1 - y) / .86, .8);
        const count = detail === 0 ? 6 : 5;
        const twist = level * 2.399 + variant * .4;
        for (let k = 0; k < count; k++) {
            const a = twist + k / count * Math.PI * 2 + (random() - .5) * .15;
            const r = radius * (.84 + random() * .28);
            const radial = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
            const lateral = new THREE.Vector3(-radial.z, 0, radial.x);
            const base = new THREE.Vector3(0, y + (random() - .5) * .012, 0);
            const bend = base.clone().addScaledVector(radial, r * .5); bend.y -= .02 + r * .2;
            const tip = base.clone().addScaledVector(radial, r); tip.y -= .005 + r * .08;
            if (detail !== 2) {
                cylinder(base, bend, .0025 * (1 - y) + .0008, .0016 * (1 - y) + .00035);
                cylinder(bend, tip, .0016 * (1 - y) + .00035, .00025);
            }
            const twigs = detail === 0 ? 5 : detail === 1 ? 3 : 2;
            for (let j = 0; j < twigs; j++) {
                const f = .22 + j / twigs * .74;
                const origin = bend.clone().lerp(tip, Math.max(0, (f - .5) * 2));
                if (f < .5) origin.copy(base).lerp(bend, f * 2);
                const spread = r * (.36 - f * .21);
                for (const sign of [-1, 1]) {
                    const twigEnd = origin.clone().addScaledVector(radial, r * .18).addScaledVector(lateral, sign * spread);
                    twigEnd.y += .006 + Math.sin(j * 1.7 + k) * .022;
                    spray(origin, twigEnd, a + j);
                }
                if ((j + k + level) % 3 === 0 && level < whorls - 2) {
                    const cap = (detail === 0 ? snowGeometry : distantSnowGeometry).clone();
                    // Wind-set snow has broken lobes rather than uniform discs.
                    const capPositions = cap.getAttribute('position');
                    for (let vertex = 0; vertex < capPositions.count; vertex++) {
                        const x = capPositions.getX(vertex), z = capPositions.getZ(vertex);
                        const irregularity = 1 + Math.sin(x * 13 + z * 9 + k) * .13;
                        capPositions.setX(vertex, x * irregularity); capPositions.setZ(vertex, z * irregularity);
                    }
                    cap.computeVertexNormals();
                    quaternion.setFromAxisAngle(up, a);
                    const snowPosition = origin.clone().addScaledVector(radial, r * .05); snowPosition.y += .007;
                    matrix.compose(snowPosition, quaternion, new THREE.Vector3(r * .15, .005 + random() * .003, spread * .65));
                    snowcaps.push(cap.toNonIndexed().applyMatrix4(matrix)); cap.dispose();
                }
            }
            spray(bend.clone().lerp(tip, .7), tip, a);
            // Upright inner branchlets overlap neighbouring whorls, filling
            // the interior crown while preserving a jagged branch outline.
            const innerStart = base.clone().addScaledVector(radial, r * .08);
            const innerEnd = base.clone().addScaledVector(radial, r * .72);
            innerEnd.y += .035 + r * .08;
            spray(innerStart, innerEnd, a + 1.3);
        }
    }
    const needles = new THREE.BufferGeometry();
    needles.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    needles.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    needles.computeVertexNormals();
    // Soft, shared foliage normals avoid the broad supporting fans looking
    // like faceted plastic leaves. The needle tips retain physical normals.
    const needleNormals = needles.getAttribute('normal');
    for (const [start, sign, x = 0, z = 0] of fanNormalRanges) {
        for (let vertex = start; vertex < start + 3; vertex++) {
            if (sign > 0) needleNormals.setXYZ(vertex, 0, 1, 0);
            else needleNormals.setXYZ(vertex, x * .94, -.34, z * .94);
        }
    }
    needles.computeBoundingSphere();
    const result = { bark: merge(branches), needles, snow: merge(snowcaps), needleCount };
    if (detail > 0) {
        const parts = [result.bark, result.needles, result.snow].map((source, i) => {
            const part = source.clone();
            for (const attribute of Object.keys(part.attributes)) if (!['position', 'normal', 'color'].includes(attribute)) part.deleteAttribute(attribute);
            if (!part.getAttribute('color')) {
                const tint = i === 0 ? bark.color : snow.color;
                const array = new Float32Array(part.getAttribute('position').count * 3);
                for (let j = 0; j < array.length; j += 3) { array[j] = tint.r; array[j + 1] = tint.g; array[j + 2] = tint.b; }
                part.setAttribute('color', new THREE.BufferAttribute(array, 3));
            }
            return part;
        });
        result.combined = merge(parts);
        result.bark.dispose(); result.needles.dispose(); result.snow.dispose();
    }
    return result;
}

function getVariant(seed) {
    const id = Math.abs(Math.trunc(seed)) % 6;
    if (!variants.has(id)) variants.set(id, [0, 1, 2].map(detail => createGeometry(id, detail)));
    return variants.get(id);
}

function mesh(geometry, material) {
    const result = new THREE.Mesh(geometry, material);
    result.castShadow = result.receiveShadow = true;
    return result;
}

export function createConifer({ height = 8, seed = 1, decorated = false } = {}) {
    const root = new THREE.Group(); root.name = 'Fijnvertakte spar met dennennaalden';
    const model = new THREE.Group(); model.scale.setScalar(height); root.add(model);
    const lod = new THREE.LOD(); model.add(lod);
    const geometries = getVariant(seed);
    geometries.forEach((g, index) => {
        const level = new THREE.Group();
        level.name = ['Individuele naalden', 'Dennentakken', 'Bos op afstand'][index];
        if (index === 0) level.add(mesh(g.bark, bark), mesh(g.needles, foliage), mesh(g.snow, snow));
        else level.add(mesh(g.combined, foliage));
        // LOD distances are world-space; tree scale does not change them.
        lod.addLevel(level, [0, 20, 45][index]);
    });
    if (decorated) {
        const parts = [], ornaments = [[], []];
        const random = rng(seed + 121225), matrix = new THREE.Matrix4();
        const rotation = new THREE.Quaternion();
        for (let i = 0; i < 135; i++) {
            const y = .18 + i / 135 * .74;
            const a = i / 135 * Math.PI * 2 * 6;
            const r = .275 * Math.pow((1 - y) / .86, .8);
            const point = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
            const radius = .005 + random() * .001;
            matrix.compose(point, rotation, new THREE.Vector3(radius, radius, radius));
            parts.push(bulbGeometry.toNonIndexed().applyMatrix4(matrix));
        }
        for (let i = 0; i < 40; i++) {
            const y = .21 + random() * .65, a = random() * Math.PI * 2;
            const r = .275 * Math.pow((1 - y) / .86, .8);
            const radius = .009;
            matrix.compose(new THREE.Vector3(Math.cos(a) * r, y - .012, Math.sin(a) * r), rotation, new THREE.Vector3(radius, radius, radius));
            ornaments[i % 2].push(ornamentGeometry.toNonIndexed().applyMatrix4(matrix));
        }
        const lights = mesh(merge(parts), warm); lights.castShadow = false; model.add(lights);
        model.add(mesh(merge(ornaments[0]), ruby), mesh(merge(ornaments[1]), gold));
        const starShape = new THREE.Shape();
        for (let i = 0; i < 10; i++) {
            const a = i / 10 * Math.PI * 2, r = i % 2 ? .016 : .038;
            const x = Math.sin(a) * r, y = Math.cos(a) * r;
            if (i === 0) starShape.moveTo(x, y); else starShape.lineTo(x, y);
        }
        starShape.closePath();
        const star = mesh(new THREE.ExtrudeGeometry(starShape, { depth: .006, bevelEnabled: true, bevelSize: .001, bevelThickness: .001, bevelSegments: 1 }), warm);
        star.position.set(0, 1.025, 0); star.castShadow = false; model.add(star);
    }
    root.userData.collisionRadius = height * .32 + .38;
    root.userData.trunkRadius = height * .018 + .32;
    root.userData.needleCount = geometries[0].needleCount;
    root.userData.lodTriangles = geometries.map(g => (g.combined ? g.combined.getAttribute('position').count : g.bark.getAttribute('position').count + g.needles.getAttribute('position').count + g.snow.getAttribute('position').count) / 3);
    root.userData.updateLOD = camera => lod.update(camera);
    root.userData.conifer = true;
    return root;
}
