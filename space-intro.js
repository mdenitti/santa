import * as THREE from './vendor/three/build/three.module.js';
import { createPolarAurora } from './polar-aurora.js';

// One coordinate system from orbit to the street. The globe is deliberately
// storybook scale: the real village, including its lights, is legible in orbit.
export const SPACE_INTRO_DURATION = 16;
export const INTRO_DURATION = 32;
const RADIUS = 950;
const smooth = (a, b, t) => THREE.MathUtils.smoothstep(t, a, b);

export function createSpaceIntro({ camera, renderPass, villageScene, mobile = false }) {
    const orbital = new THREE.Group();
    orbital.name = 'Aarde onder het winterdorp';
    orbital.visible = false;
    villageScene.add(orbital);
    const night = new THREE.Color(0x01030b);
    const originalBackground = villageScene.background.clone();
    const originalFog = villageScene.fog;
    const fog = new THREE.FogExp2(originalFog.color, 0);
    const sun = new THREE.Vector3(-1, -.31, .48).normalize();
    const diagnostics = { duration: INTRO_DURATION, spaceDuration: SPACE_INTRO_DURATION, time: 0,
        phase: 'idle', globeVisible: false, cloudOpacity: 0, surface: 'loading', camera: [],
        continuousWorld: true, villageVisible: false, polarSunlight: Math.max(0, sun.y),
        villageAnchor: [], localAtmosphere: 0, orbitalAurora: 1, localAurora: .25 };
    const placeholder = new THREE.DataTexture(new Uint8Array([28, 54, 86, 255]), 1, 1);
    placeholder.needsUpdate = true;
    const surface = { value: placeholder };
    const nightLights = { value: placeholder };
    const vertex = `varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld;
        void main(){vUv=uv; vNormal=normalize(mat3(modelMatrix)*normal);
        vec4 world=modelMatrix*vec4(position,1.);vWorld=world.xyz;
        gl_Position=projectionMatrix*viewMatrix*world;}`;
    const earthMaterial = new THREE.ShaderMaterial({
        uniforms: { surface, nightLights, sunDirection: { value: sun } },
        vertexShader: vertex,
        fragmentShader: `uniform sampler2D surface; uniform sampler2D nightLights; uniform vec3 sunDirection;
            varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld;
            void main(){
                vec3 n=normalize(vNormal); vec3 albedo=texture2D(surface,vUv).rgb;
                // A soft terminator with the North Pole entirely in polar night.
                float sunlight=dot(n,sunDirection);
                float day=smoothstep(-.07,.16,sunlight);
                vec3 dark=albedo*vec3(.023,.041,.075)+vec3(.001,.002,.004);
                vec3 lit=albedo*(.12+max(0.,sunlight)*1.85);
                vec3 color=mix(dark,lit,day);
                vec3 cities=texture2D(nightLights,vUv).rgb;
                color+=cities*vec3(1.15,.64,.27)*(1.-smoothstep(-.15,.1,sunlight));
                vec3 view=normalize(cameraPosition-vWorld);
                float rim=pow(1.-max(0.,dot(n,view)),4.);
                color+=vec3(.018,.075,.18)*rim*(.24+day*.7);
                gl_FragColor=vec4(color,1.);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`
    });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, mobile ? 64 : 160, mobile ? 48 : 100), earthMaterial);
    earth.position.y = -RADIUS; earth.rotation.y = -1.5; orbital.add(earth);
    const earthReady = new Promise(resolve => {
        new THREE.TextureLoader().load(new URL('./assets/earth-atmos-2048.jpg', import.meta.url).href, texture => {
            texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
            surface.value = texture; diagnostics.surface = 'bundled-earth-texture'; resolve();
        }, undefined, () => { diagnostics.surface = 'unavailable'; resolve(); });
    });
    const nightReady = new Promise(resolve => {
        new THREE.TextureLoader().load(new URL('./assets/earth-lights-2048.png', import.meta.url).href, texture => {
            texture.colorSpace = THREE.SRGBColorSpace; nightLights.value = texture; resolve();
        }, undefined, resolve);
    });
    const cloudsReady = new Promise(resolve => {
        new THREE.TextureLoader().load(new URL('./assets/earth-clouds-1024.png', import.meta.url).href, texture => {
            texture.colorSpace = THREE.SRGBColorSpace;
            const clouds = new THREE.Mesh(new THREE.SphereGeometry(RADIUS + 4, mobile ? 48 : 128, mobile ? 32 : 80), new THREE.ShaderMaterial({
                uniforms: { cloudMap: { value: texture }, sunDirection: { value: sun } }, vertexShader: vertex,
                fragmentShader: `uniform sampler2D cloudMap;uniform vec3 sunDirection;
                    varying vec2 vUv;varying vec3 vNormal;
                    void main(){vec3 n=normalize(vNormal);vec4 tex=texture2D(cloudMap,vUv);
                    float day=smoothstep(-.07,.16,dot(n,sunDirection));
                    vec3 color=mix(vec3(.014,.026,.045),vec3(.8,.87,.95)*max(.2,dot(n,sunDirection)),day);
                    float polarClear=1.-smoothstep(.91,.985,n.y);
                    gl_FragColor=vec4(color,tex.a*.75*polarClear);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment> }`,
                transparent: true, depthWrite: false
            }));
            clouds.position.copy(earth.position); clouds.rotation.copy(earth.rotation); orbital.add(clouds); resolve();
        }, undefined, resolve);
    });
    const ready = Promise.all([earthReady, nightReady, cloudsReady]);
    // A very thin atmospheric limb, shaded by the same sun as the surface.
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(RADIUS * 1.009, mobile ? 48 : 128, mobile ? 32 : 80), new THREE.ShaderMaterial({
        uniforms: { sunDirection: { value: sun } }, vertexShader: vertex,
        fragmentShader: `varying vec3 vNormal;varying vec3 vWorld;uniform vec3 sunDirection;
            void main(){vec3 n=normalize(vNormal);vec3 v=normalize(cameraPosition-vWorld);
            float rim=pow(1.-max(0.,dot(n,v)),5.5);
            float light=smoothstep(-.35,.25,dot(n,sunDirection));
            gl_FragColor=vec4(vec3(.12,.4,.92),rim*(.1+.4*light));}`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    atmosphere.position.y = -RADIUS; orbital.add(atmosphere);

    const polarAurora = createPolarAurora(RADIUS);
    orbital.add(polarAurora.group);

    let seed = 951225;
    const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
    const positions = [], sizes = [];
    const starCount = mobile ? 800 : 2400;
    for (let i = 0; i < starCount; i++) {
        const a = random() * Math.PI * 2, y = random() * 2 - 1, r = Math.sqrt(1 - y * y);
        positions.push(Math.cos(a) * r * 7000, y * 7000, Math.sin(a) * r * 7000);
        sizes.push(random() < .025 ? 2 : .6 + random());
    }
    const starsGeometry = new THREE.BufferGeometry();
    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    starsGeometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    const starFade = { value: 1 };
    orbital.add(new THREE.Points(starsGeometry, new THREE.ShaderMaterial({
        uniforms: { fade: starFade }, transparent: true, depthWrite: false,
        vertexShader: `attribute float size;void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=size;}`,
        fragmentShader: `uniform float fade;void main(){float a=1.-smoothstep(.1,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(.65,.76,1.,a*fade*.65);}`
    })));

    const caption = document.createElement('div'); caption.id = 'orbital-caption'; caption.hidden = true;
    Object.assign(caption.style, { position: 'fixed', left: '50%', bottom: mobile ? 'max(14%, 78px)' : '12%', transform: 'translateX(-50%)',
        width: 'min(92%, 680px)', padding: '0 16px', boxSizing: 'border-box', textAlign: 'center', pointerEvents: 'none', zIndex: '21', color: '#e8e5df', textShadow: '0 2px 18px #000', fontFamily: 'Georgia,serif' });
    caption.innerHTML = `<span style="font:10px system-ui;letter-spacing:${mobile ? '.22em' : '.3em'};color:#b1bdd1">ERGENS, HEEL VER IN HET NOORDEN</span><div id="orbital-location" style="font-size:clamp(20px,4.5vw,38px);margin-top:10px">Waar de kerstlichtjes nooit doven</div>`;
    document.body.append(caption);
    const marker = document.createElement('div'); marker.id = 'orbital-village-marker'; marker.hidden = true;
    Object.assign(marker.style, { position: 'fixed', pointerEvents: 'none', zIndex: '20', color: '#f9d6a1',
        font: '10px system-ui', letterSpacing: mobile ? '.12em' : '.18em', textShadow: '0 2px 8px #000', whiteSpace: 'nowrap', transform: 'translate(20px,-50%)' });
    marker.innerHTML = '<span style="display:inline-block;width:26px;height:1px;background:#d4b281;vertical-align:middle;margin-right:10px"></span>90° N · HET WINTERDORP';
    document.body.append(marker);

    const vectors = list => list.map(p => new THREE.Vector3(...p));
    const cameraCurve = new THREE.CatmullRomCurve3(vectors([
        [320,1100,2050], [240,950,1730], [100,560,810], [45,255,280],
        [12,95,112], [-16,24,75], [-43,13,28], [-6,22,62], [100,80,118]
    ]), false, 'centripetal');
    const targetCurve = new THREE.CatmullRomCurve3(vectors([
        [0,-530,0], [0,-330,0], [0,-60,0], [0,0,0],
        [-12,15,-12], [-15,57,-115], [-23,4,16], [-12,4,15], [-5,2,8]
    ]), false, 'centripetal');
    const look = new THREE.Vector3(), projectedVillage = new THREE.Vector3();
    const terrainBlend = { value: 0 };
    let local = null;
    function configure(objects) {
        local = objects;
        // The outer snowfield follows the globe during the descent. Its inner
        // 120 metres (all streets and navigation) are untouched.
        villageScene.traverse(object => {
            if (!object.userData.continuousSnow) return;
            object.material.transparent = true;
            object.material.onBeforeCompile = shader => {
                shader.uniforms.orbitBlend = terrainBlend;
                shader.vertexShader = 'uniform float orbitBlend;varying float snowRadius;\n' + shader.vertexShader;
                shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
                    snowRadius=length(position.xz);
                    transformed.y-=orbitBlend*smoothstep(120.,230.,snowRadius)*snowRadius*snowRadius/${2 * RADIUS}.;`);
                shader.fragmentShader = 'uniform float orbitBlend;varying float snowRadius;\n' + shader.fragmentShader;
                shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
                    float edge=smoothstep(145.,248.,snowRadius)*orbitBlend;
                    diffuseColor.a=1.-edge;
                    outgoingLight*=1.-orbitBlend*.45;
                    outgoingLight=mix(outgoingLight,vec3(.012,.023,.041),smoothstep(110.,230.,snowRadius)*orbitBlend);
                    #include <opaque_fragment>`);
            };
            object.material.customProgramCacheKey = () => 'orbital-snow-blend-v2';
            object.material.needsUpdate = true;
        });
    }
    function restoreLocal() {
        if (!local) return;
        local.sky.visible = local.stars.visible = local.aurora.visible = local.snow.visible = true;
        local.sky.children[0].material.uniforms.introReveal.value = 1;
        local.aurora.children[0].material.uniforms.introReveal.value = 1;
    }
    function leave() {
        orbital.visible = false; terrainBlend.value = 0;
        villageScene.background = originalBackground; villageScene.fog = originalFog;
        if (renderPass) renderPass.scene = villageScene; restoreLocal();
        camera.near = .15; camera.far = 450; camera.updateProjectionMatrix();
        caption.hidden = marker.hidden = true;
        document.body.dataset.introStage = 'village';
        diagnostics.globeVisible = false; diagnostics.villageVisible = true;
        diagnostics.phase = diagnostics.time >= INTRO_DURATION ? 'complete' : 'village';
        diagnostics.localAtmosphere = 1;
        diagnostics.orbitalAurora = 0; diagnostics.localAurora = 1;
    }
    function apply(time) {
        const t = THREE.MathUtils.clamp(time, 0, INTRO_DURATION);
        // Uniform time spacing preserves tangent direction and avoids a stop at
        // each shot. No scene switch, camera teleport or full-screen transition.
        const u = t / INTRO_DURATION;
        cameraCurve.getPoint(u, camera.position); targetCurve.getPoint(u, look);
        camera.lookAt(look);
        camera.fov = 46; camera.near = THREE.MathUtils.lerp(1, .15, smooth(8, 16, t));
        camera.far = THREE.MathUtils.lerp(12000, 450, smooth(14, 19, t));
        camera.updateProjectionMatrix(); camera.updateMatrixWorld();
        const atmosphereReveal = smooth(13, 19, t);
        orbital.visible = t < 19; starFade.value = 1 - atmosphereReveal;
        const orbitalReveal = 1 - smooth(13, 19, t);
        const localReveal = .25 + .75 * smooth(7, 14, t);
        polarAurora.update(t, orbitalReveal);
        diagnostics.orbitalAurora = orbitalReveal; diagnostics.localAurora = localReveal;
        terrainBlend.value = 1 - smooth(15, 19, t);
        fog.density = originalFog.density * atmosphereReveal;
        villageScene.fog = fog;
        villageScene.background = night.clone().lerp(originalBackground, atmosphereReveal);
        if (renderPass) renderPass.scene = villageScene;
        if (local) {
            local.sky.visible = t >= 13;
            local.sky.children[0].material.uniforms.introReveal.value = atmosphereReveal;
            local.stars.visible = t >= 16;
            local.aurora.visible = true;
            local.aurora.children[0].material.uniforms.introReveal.value = localReveal;
            local.snow.visible = t >= 18;
        }
        caption.hidden = t >= 16;
        caption.style.opacity = String(smooth(0, 1.5, t) * (1 - smooth(11, 15, t)));
        caption.querySelector('#orbital-location').textContent = t < 7 ? 'Waar de kerstlichtjes nooit doven' : 'Een dorp, verscholen in de poolnacht';
        projectedVillage.set(-5, 4, 8).project(camera);
        marker.hidden = t > 11 || Math.abs(projectedVillage.x) > .8 || Math.abs(projectedVillage.y) > .8;
        const px = (projectedVillage.x * .5 + .5) * innerWidth;
        const py = (-projectedVillage.y * .5 + .5) * innerHeight;
        const flipLeft = px > innerWidth - 210;
        marker.style.transform = flipLeft ? 'translate(calc(-100% - 14px), -50%)' : 'translate(16px, -50%)';
        marker.style.left = `${Math.max(12, Math.min(innerWidth - 12, px))}px`;
        marker.style.top = `${Math.max(56, Math.min(innerHeight - 90, py))}px`;
        marker.style.opacity = String(1 - smooth(8, 11, t));
        document.body.dataset.introStage = t < 16 ? 'orbit' : 'village';
        diagnostics.time = t;
        diagnostics.phase = t < 5 ? 'space' : t < 12 ? 'north-pole-zoom' : t < 16 ? 'descent' : t < 22 ? 'aurora' : t < 32 ? 'village' : 'complete';
        diagnostics.globeVisible = orbital.visible; diagnostics.villageVisible = Math.abs(projectedVillage.x) < 1 && Math.abs(projectedVillage.y) < 1 && projectedVillage.z < 1;
        diagnostics.villageAnchor = projectedVillage.toArray(); diagnostics.camera = camera.position.toArray();
        diagnostics.localAtmosphere = atmosphereReveal;
        return { target: look, complete: t >= INTRO_DURATION };
    }
    return { apply, leave, configure, diagnostics, ready, cameraCurve, targetCurve };
}
