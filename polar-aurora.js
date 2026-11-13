import * as THREE from 'three';

// Thin, folded curtains follow the curvature of the polar cap. Three ribbons
// remain cheap to draw and leave the village visible through the centre.
export function createPolarAurora(earthRadius) {
    const group = new THREE.Group();
    group.name = 'Poollicht zichtbaar vanuit de ruimte';
    const uniforms = { time: { value: 0 }, reveal: { value: 1 } };
    const material = new THREE.ShaderMaterial({
        uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        vertexShader: `uniform float time; varying vec2 vUv;
            void main(){vUv=uv;vec3 p=position;
                float a=uv.x*6.283185;
                float fold=sin(a*9.+time*.24)*5.+sin(a*19.-time*.17)*2.8;
                p.xz+=normalize(p.xz)*fold*(.25+uv.y);
                p.y+=sin(a*6.+time*.21)*4.*uv.y;
                gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
        fragmentShader: `uniform float time;uniform float reveal;varying vec2 vUv;
            void main(){float a=vUv.x*6.283185;
                float folds=sin(a*27.+sin(a*9.-time*.16)*2.+time*.23);
                float threads=pow(.5+.5*sin(a*210.+sin(a*13.)*3.-time*.32),3.);
                float rays=.28+.44*pow(.5+.5*folds,2.)+.28*threads;
                float foot=smoothstep(0.,.09,vUv.y);
                float top=1.-smoothstep(.24,.98,vUv.y);
                float base=exp(-pow((vUv.y-.13)*12.,2.));
                vec3 green=vec3(.08,1.,.48),cyan=vec3(.12,.65,1.),violet=vec3(.64,.22,.85);
                vec3 col=mix(green,cyan,smoothstep(.18,.62,vUv.y));
                col=mix(col,violet,smoothstep(.57,.96,vUv.y));
                float breaks=.48+.52*smoothstep(-.7,.7,sin(a*3.+time*.06));
                float alpha=(rays*.65+base*.3)*foot*top*breaks*reveal;
                gl_FragColor=vec4(col*(.85+base*.35),alpha);
            }`
    });
    for (let layer = 0; layer < 3; layer++) {
        const positions = [], uv = [], indices = [];
        const segments = 320, rows = 12;
        for (let j = 0; j <= rows; j++) {
            const v = j / rows;
            for (let i = 0; i <= segments; i++) {
                const u = i / segments, a = u * Math.PI * 2;
                const radius = 228 + layer * 34 + Math.sin(a * 5 + layer) * 15 + Math.sin(a * 11) * 6;
                const x = Math.cos(a) * radius, z = Math.sin(a) * radius * .88;
                const surface = Math.sqrt(earthRadius ** 2 - x * x - z * z) - earthRadius;
                const height = 60 + layer * 10 + Math.sin(a * 4 + layer) * 15;
                positions.push(x, surface + 22 + v * height, z);
                uv.push(u, v);
                if (j < rows && i < segments) {
                    const k = j * (segments + 1) + i;
                    indices.push(k, k + 1, k + segments + 1, k + 1, k + segments + 2, k + segments + 1);
                }
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geometry.setIndex(indices);
        const ribbon = new THREE.Mesh(geometry, material);
        // Draw after the transparent snowfield; depth still occludes the rear
        // curtains where they pass behind the opaque Earth.
        ribbon.renderOrder = 3;
        group.add(ribbon);
    }
    return { group, update(t, opacity) { uniforms.time.value = t; uniforms.reveal.value = opacity; group.visible = opacity > .001; } };
}
