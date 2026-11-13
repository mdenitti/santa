import * as THREE from 'three';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function hash(x, z) {
    const n = Math.sin(x * 127.1 + z * 311.7 + 1225) * 43758.5453;
    return n - Math.floor(n);
}
function noise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export function snowHeight(x, z) {
    // The inhabited centre remains level for streets and doors. Beyond it, the
    // snow is one continuous wind-eroded surface, never a ring of snowballs.
    const outskirts = smooth(66, 115, Math.max(Math.abs(x) * .97, Math.abs(z) * 1.04));
    const broad = noise(x * .013 + 17, z * .013 - 23);
    const medium = noise(x * .041, z * .041 + 7);
    const fine = noise(x * .11 + 31, z * .085);
    const drift = Math.pow(broad, 1.8) * 15 + medium * 3.8 + fine * .8;
    const wind = Math.sin(x * .09 + z * .037 + medium * 4) * .22;
    return -.28 + (noise(x * .07, z * .07) - .5) * .11 + outskirts * (drift + wind);
}

export function createWinterLandscape({ bumpMap } = {}) {
    const geometry = new THREE.PlaneGeometry(560, 560, 224, 224);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.getAttribute('position'), colors = [];
    const color = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), z = position.getZ(i), y = snowHeight(x, z);
        position.setY(i, y);
        // Cool lilac in hollows, brighter wind-polished ridges.
        const variation = noise(x * .032 + 11, z * .032);
        color.setRGB(.70 + variation * .12, .79 + variation * .10, .89 + variation * .08);
        colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({ color: 0xe5e9fa, vertexColors: true, roughness: .94,
        bumpMap, bumpScale: .045, metalness: .015 });
    const mesh = new THREE.Mesh(geometry, material); mesh.name = 'Doorlopend door de wind gevormd sneeuwlandschap';
    mesh.receiveShadow = true;
    mesh.userData.continuousSnow = true;
    return mesh;
}

export function createWinterMagic() {
    const group = new THREE.Group(); group.name = 'Sterrenglans tussen de huisjes';
    let seed = 901225;
    const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
    const positions = [], phases = [], tints = [];
    // Soft local golden fireflies gather around the square and market. These
    // are distinct from white snowfall and stay out of the viewer's face.
    for (let i = 0; i < 155; i++) {
        const a = random() * Math.PI * 2, radius = 5 + random() * 35;
        positions.push(-13 + Math.cos(a) * radius, 1.2 + random() * 6, 16 + Math.sin(a) * radius * .65);
        phases.push(random() * Math.PI * 2);
        const cyan = i % 8 === 0;
        tints.push(cyan ? .48 : 1, cyan ? .92 : .71, cyan ? 1 : .28);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('phase', new THREE.Float32BufferAttribute(phases, 1));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(tints, 3));
    const time = { value: 0 };
    const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { time },
        vertexShader: `attribute float phase; varying vec3 tint; varying float pulse; uniform float time;
            void main() { vec3 p = position; p.x += sin(time*.22+phase)*.7; p.y += sin(time*.5+phase)*.35;
                p.z += cos(time*.16+phase)*.5; tint=color; pulse=.35+.65*pow(sin(time*.65+phase)*.5+.5,2.);
                vec4 view=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*view;
                gl_PointSize=clamp(160./-view.z,1.2,7.); }`,
        fragmentShader: `varying vec3 tint; varying float pulse;
            void main() { vec2 p=gl_PointCoord-.5; float r=length(p);
                float halo=exp(-r*r*24.); float core=exp(-r*r*180.);
                gl_FragColor=vec4(tint*(.7+core),halo*pulse*.6); }`, vertexColors: true
    });
    const points = new THREE.Points(geometry, material); points.frustumCulled = false; group.add(points);
    return { group, update: t => { time.value = t; } };
}
