import * as THREE from './vendor/three/build/three.module.js';
import { mergeGeometries } from './vendor/three/examples/jsm/utils/BufferGeometryUtils.js';
import { createVillageLife } from './residents.js';
import { renderIntroMusic } from './intro-music.js';

export function isChristmasDay(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', month: '2-digit', day: '2-digit' }).formatToParts(date);
    return parts.find(p => p.type === 'month').value === '12' && parts.find(p => p.type === 'day').value === '25';
}

class PartyAudio {
    constructor(sound) { this.sound = sound; this.buffer = null; this.pending = null; this.voice = null; this.bus = null; this.wanted = false; }
    update(wanted) {
        this.wanted = wanted; this.sound.setAmbientActive(wanted);
        const ctx = this.sound.ctx;
        const audible = wanted && this.sound.isEnabled && ctx?.state === 'running' && !document.hidden;
        if (!audible) { if (this.bus) this.bus.gain.setTargetAtTime(0, ctx.currentTime, .02); this.stop(); return; }
        if (!this.bus) { this.bus = ctx.createGain(); this.bus.gain.value = .75; this.bus.connect(ctx.destination); }
        this.bus.gain.setTargetAtTime(.75, ctx.currentTime, .04);
        if (!this.buffer && !this.pending) {
            this.pending = renderIntroMusic(ctx.sampleRate, { party: true }).then(buffer => { this.buffer = buffer; this.update(this.wanted); })
                .catch(error => console.warn('Feestmuziek kon niet worden opgebouwd:', error));
        }
        if (this.buffer && !this.voice) {
            const node = ctx.createBufferSource(), gain = ctx.createGain(); node.buffer = this.buffer; node.loop = true;
            gain.gain.setValueAtTime(0, ctx.currentTime); gain.gain.linearRampToValueAtTime(1, ctx.currentTime + .15);
            node.connect(gain); gain.connect(this.bus); const voice = { node, gain }; this.voice = voice;
            node.onended = () => { node.disconnect(); gain.disconnect(); if (this.voice === voice) this.voice = null; };
            node.start();
        }
    }
    stop() {
        if (!this.voice) return;
        const { node, gain } = this.voice; this.voice = null;
        gain.gain.cancelScheduledValues(this.sound.ctx.currentTime);
        gain.gain.setTargetAtTime(0, this.sound.ctx.currentTime, .025);
        node.stop(this.sound.ctx.currentTime + .15);
    }
    burst(pan) {
        const ctx = this.sound.ctx;
        if (!this.voice || !this.sound.isEnabled || ctx.state !== 'running' || document.hidden) return;
        const osc = ctx.createOscillator(), gain = ctx.createGain(), stereo = ctx.createStereoPanner();
        stereo.pan.value = pan; osc.frequency.setValueAtTime(95, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + .32);
        gain.gain.setValueAtTime(0, ctx.currentTime); gain.gain.linearRampToValueAtTime(.035, ctx.currentTime + .015);
        gain.gain.exponentialRampToValueAtTime(.00001, ctx.currentTime + .45);
        osc.connect(gain); gain.connect(stereo); stereo.connect(this.bus);
        osc.onended = () => { osc.disconnect(); gain.disconnect(); stereo.disconnect(); };
        osc.start(); osc.stop(ctx.currentTime + .46);
    }
}

export function createPartyMode({ scene, navigation, sound, onStreet, date = new Date(), mobile = false }) {
    const group = new THREE.Group(); group.name = 'Kerstfeest · 25 december'; group.visible = false; scene.add(group);
    const button = document.getElementById('btn-party'), streetButton = document.getElementById('btn-party-street');
    const status = document.getElementById('party-status');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const audio = new PartyAudio(sound);
    let enabled = false, built = false, life = null, startTime = null, elapsed = 0, bursts = 0;
    const burstCycles = new Array(6).fill(-1), lights = [];
    const fireTime = { value: 0 }, still = { value: reduced.matches ? 1 : 0 };
    const tint = new THREE.Color(), palette = [0xffc56a, 0x7be4c2, 0xe99af1, 0x93caff];
    const materials = palette.map(color => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5, roughness: .4 }));
    const frame = new THREE.MeshStandardMaterial({ color: 0x735c3c, roughness: .45, metalness: .5 });
    let bulbCount = 0;
    const sparksPerBurst = mobile ? 64 : 136;

    function build() {
        if (built) return; built = true;
        const batches = new Map(), sphere = new THREE.SphereGeometry(1, 8, 6), matrix = new THREE.Matrix4();
        function add(geo, mat, position, scale = [1, 1, 1], rotation = new THREE.Quaternion()) {
            matrix.compose(new THREE.Vector3(...position), rotation, new THREE.Vector3(...scale));
            const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(matrix);
            if (!batches.has(mat)) batches.set(mat, []); batches.get(mat).push(g);
        }
        function beam(a, b, width = .025) {
            const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), delta = to.clone().sub(from);
            const geometry = new THREE.CylinderGeometry(width, width, delta.length(), 6);
            add(geometry, frame, from.add(to).multiplyScalar(.5).toArray(), [1,1,1], new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), delta.normalize())); geometry.dispose();
        }
        function string(a, b, count, sag) {
            const steps = mobile ? Math.max(6, Math.ceil(count * 0.45)) : count;
            let previous = a;
            for (let i = 1; i <= steps; i++) {
                const u = i / steps, point = a.map((v, axis) => THREE.MathUtils.lerp(v, b[axis], u) - (axis === 1 ? Math.sin(u * Math.PI) * sag : 0));
                beam(previous, point); add(sphere, materials[i % 4], [point[0], point[1] - .1, point[2]], [.085,.11,.085]);
                bulbCount++; previous = point;
            }
        }
        // Build on the existing lamp posts. Nothing new occupies walking space.
        for (let x = -40; x <= 40; x += 16) {
            beam([x,5.2,-35], [x,7.8,-35], .055);
            if (x < 40) for (const z of [-35, -38, -41]) string([x,7.6,z], [x+16,7.6,z], 32, .7);
            string([x,7.7,-35], [x,7.5,-43], 20, .45);
        }
        const star = new THREE.Shape();
        for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5, r = i % 2 ? .19 : .45; const x = Math.sin(a)*r, y = Math.cos(a)*r; if (i) star.lineTo(x,y); else star.moveTo(x,y); }
        star.closePath(); const starGeo = new THREE.ExtrudeGeometry(star, { depth: .07, bevelEnabled: false });
        for (let x = -40; x <= 40; x += 8) { beam([x,7.3,-38], [x,6.65,-38], .015); add(starGeo, materials[(x+40)/8%4], [x,6.3,-38]); }
        for (const [x,z] of [[-23.7,1],[-16.3,11],[-23.7,21],[-16.3,31]]) {
            add(starGeo, materials[0], [x,5.9,z], [1.3,1.3,1.3]);
            string([x,6.6,z], [x,5.8,z+8], 20, .5);
        }
        for (const [mat, pieces] of batches) { const mesh = new THREE.Mesh(mergeGeometries(pieces), mat); group.add(mesh); pieces.forEach(g => g.dispose()); }
        sphere.dispose(); starGeo.dispose();
        const canvas = document.createElement('canvas'); canvas.width=1024; canvas.height=192;
        const ctx=canvas.getContext('2d'); ctx.fillStyle='#183d36'; ctx.fillRect(0,0,1024,192);
        ctx.strokeStyle='#d8af6c'; ctx.lineWidth=5; ctx.strokeRect(8,8,1008,176);
        ctx.textAlign='center'; ctx.fillStyle='#ffe1a3'; ctx.font='46px Georgia'; ctx.fillText('KERSTFEEST · 25 DECEMBER',512,83);
        ctx.font='22px sans-serif'; ctx.fillText('STERRENSTRAAT · LICHTJES, LEKKERS & MUZIEK',512,137);
        const texture=new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace;
        const banner=new THREE.Mesh(new THREE.PlaneGeometry(8.8,1.65),new THREE.MeshStandardMaterial({ map:texture, emissiveMap:texture, emissive:0xffffff, emissiveIntensity:.45, side:THREE.DoubleSide }));
        banner.position.set(0,7,-35.5); group.add(banner);
        if (!mobile) {
            for (const x of [-24, 24]) { const light = new THREE.PointLight(0xffc780, 28, 22, 2); light.position.set(x, 5.5, -38); group.add(light); lights.push(light); }
        }

        const paths = [ [[-42,-38],[0,-38],[40,-38]], [[-42,-30],[0,-30],[40,-30]], [[-25,27],[-27,10],[-20,4]], [[-20,42],[0,42],[30,42]] ]
            .map(path => path.slice(1).flatMap((p,i) => { const leg = navigation.plan(path[i],p); return i ? leg.slice(1) : leg; }));
        life=createVillageLife({parent:group,paths,count:mobile?14:36,isWalkable:navigation.isWalkable,festive:true,mobile});
        buildFireworks();
    }
    function buildFireworks() {
        const positions=[], velocities=[], phases=[], colors=[], ids=[];
        let seed=251225; const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
        const launches=[[-55,-70],[0,-76],[54,-60],[-70,4],[50,40],[-25,64]];
        for(let burst=0;burst<6;burst++) for(let i=0;i<sparksPerBurst;i++) {
            const azimuth=rand()*Math.PI*2, y=rand()*2-1, radius=Math.sqrt(1-y*y), speed=7+rand()*11;
            positions.push(launches[burst][0],48+burst%3*7,launches[burst][1]);
            velocities.push(Math.cos(azimuth)*radius*speed,y*speed,Math.sin(azimuth)*radius*speed);
            phases.push(burst*1.65); ids.push(i); tint.setHex(palette[burst%4]); colors.push(tint.r,tint.g,tint.b);
        }
        const geo=new THREE.BufferGeometry();
        for(const [name,values,size] of [['position',positions,3],['velocity',velocities,3],['phase',phases,1],['spark',ids,1],['color',colors,3]]) geo.setAttribute(name,new THREE.Float32BufferAttribute(values,size));
        const mat=new THREE.ShaderMaterial({uniforms:{time:fireTime,still},transparent:true,depthWrite:false,vertexColors:true,blending:THREE.AdditiveBlending,
            vertexShader:`uniform float time;uniform float still;attribute vec3 velocity;attribute float phase;attribute float spark;varying vec3 tint;varying float opacity;
                void main(){float age=mod(time+phase,12.);if(still>.5)age=3.1;vec3 p=position;tint=color;
                opacity=0.;float size=0.;
                if(age<1.5){if(spark<8.){p.y=mix(3.,position.y,age/1.5)-spark*.7;opacity=(1.-spark/9.)*.8;size=2.6;}}
                else if(age<5.8){float a=age-1.5;p+=velocity*(1.-exp(-a*.42))/.42;p.y-=2.8*a*a;
                opacity=(1.-smoothstep(.3,4.3,a))*(.7+.3*sin(spark*2.7+a*9.));size=2.8;}
                if(still>.5)opacity*=.4;
                vec4 view=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*view;gl_PointSize=opacity>0.?clamp(size*190./-view.z,1.,5.):0.;}`,
            fragmentShader:`varying vec3 tint;varying float opacity;void main(){float r=length(gl_PointCoord-.5);float core=exp(-r*r*35.);gl_FragColor=vec4(tint*(1.+core*.6),core*opacity);}`});
        const sparks=new THREE.Points(geo,mat); sparks.frustumCulled=false; sparks.renderOrder=5; group.add(sparks);
    }
    function setEnabled(next) {
        enabled=!!next; if(enabled)build(); group.visible=enabled; startTime=null; elapsed=0; burstCycles.forEach((_, i) => { burstCycles[i] = Math.floor((i * 1.65 - 1.5) / 12); });
        button.setAttribute('aria-pressed',String(enabled)); button.textContent=enabled?'25 dec · Feest aan':'25 dec · Feestmodus';
        streetButton.hidden=!enabled; status.hidden=!enabled;
        status.textContent = `${mobile ? 14 : 36} extra feestvierders · vuurwerk · feestmuziek · Sterrenstraat`;
        document.body.dataset.party=enabled?'on':'off';
        if(!enabled)audio.update(false);
    }
    button.addEventListener('click',()=>{sound.tryResume();setEnabled(!enabled);});
    streetButton.addEventListener('click',onStreet);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)audio.update(false);});
    const calendarEnabled=isChristmasDay(date), override=new URLSearchParams(location.search).get('party');
    setEnabled(override==='1'||(override!=='0'&&calendarEnabled));
    function update(dt,t,intro=false) {
        audio.update(enabled&&!intro);
        if(!enabled)return;
        if(startTime===null)startTime=t;
        elapsed=Math.max(0,t-startTime);still.value=reduced.matches?1:0; fireTime.value=elapsed;
        life.update(reduced.matches?0:dt,reduced.matches?0:elapsed);
        materials.forEach((m,i)=>{m.emissiveIntensity=reduced.matches?1.5:1.35+Math.sin(elapsed*.9+i*.8)*.2;});
        if(!reduced.matches)for(let i=0;i<6;i++) {
            const cycle=Math.floor((elapsed+i*1.65-1.5)/12);
            if(cycle>=0&&cycle!==burstCycles[i]){if(burstCycles[i]!==-1||elapsed<2){audio.burst((i-2.5)/4);bursts++;}burstCycles[i]=cycle;}
        }
    }
    return {setEnabled,update,isChristmasDay,get enabled(){return enabled;},getState:()=>({enabled,calendarEnabled,extraGuests:enabled?(mobile?14:36):0,dancing:enabled?life.getState().dancing:0,
        blockedGuests:enabled?life.getState().blocked:0,positions:enabled?life.getState().positions:[],bulbs:enabled?bulbCount:0,fireworkParticles:enabled?6*sparksPerBurst:0,
        bursts,reducedMotion:reduced.matches,audible:!!audio.voice,musicReady:!!audio.buffer,musicDuration:audio.buffer?.duration||0,street:'Sterrenstraat'})};
}
