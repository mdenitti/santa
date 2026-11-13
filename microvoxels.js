import * as THREE from './vendor/three/build/three.module.js';

// A surface mesher: emit only the exposed faces of the 12.5 cm cells.
// Hidden micro-cube interiors cost no vertices, and object dimensions stay intact.
export function meshMicroVoxels(cells, { step, has, materialOptions = {}, divisions = 4 }) {
    const positions = [], normals = [], colors = [], uv = [];
    const color = new THREE.Color();
    const pitch = step / divisions;
    const faces = [
        { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
        { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
        { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
        { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
        { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
        { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] }
    ];
    for (const cell of cells) {
        for (const { n, u, v } of faces) {
            if (has(cell.x + n[0], cell.y + n[1], cell.z + n[2])) continue;
            for (let i = 0; i < divisions; i++) for (let j = 0; j < divisions; j++) {
                // Side/corner occlusion is sampled from the original occupancy.
                let occlusion = 0;
                if (divisions === 1) {
                    for (const axis of [u, v]) {
                        for (const side of [-1, 1]) {
                            if (has(cell.x + n[0] + axis[0] * side, cell.y + n[1] + axis[1] * side, cell.z + n[2] + axis[2] * side)) occlusion += 0.5;
                        }
                    }
                } else {
                    for (const axis of [u, v]) {
                        const side = axis === u ? (i < divisions / 2 ? -1 : 1) : (j < divisions / 2 ? -1 : 1);
                        if (has(cell.x + n[0] + axis[0] * side, cell.y + n[1] + axis[1] * side, cell.z + n[2] + axis[2] * side)) occlusion++;
                    }
                }
                const noise = Math.sin(cell.x * 71.3 + cell.y * 29.8 + cell.z * 131.1 + i * 5.1 + j * 7.7) * .018;
                color.setHex(cell.colorHex).multiplyScalar((1 - occlusion * .13) * (n[1] < 0 ? .71 : n[1] === 0 ? .9 : 1) + noise);
                for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) {
                    for (let k = 0; k < 3; k++) positions.push(cell[['x', 'y', 'z'][k]] * step + n[k] * step / 2 + u[k] * (-step / 2 + (i + a) * pitch) + v[k] * (-step / 2 + (j + b) * pitch));
                    normals.push(...n); colors.push(color.r, color.g, color.b); uv.push(a, b);
                }
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .83, metalness: .025, ...materialOptions });
    material.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `
            // Subtle micro-bevel shading, repeated on each exposed fine voxel.
            vec2 edgeDistance = min(vUv, 1.0 - vUv);
            float microEdge = smoothstep(0.0, 0.04, min(edgeDistance.x, edgeDistance.y));
            gl_FragColor.rgb *= mix(0.83, 1.0, microEdge);
            #include <dithering_fragment>
        `);
    };
    // vUv is enabled explicitly because these materials have no texture map.
    material.defines = { USE_UV: '' };
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.voxelPitch = pitch;
    return mesh;
}
