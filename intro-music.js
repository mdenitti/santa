export const SCORE_DURATION = 32;
const BEAT = 2 / 3; // A gentle 90 bpm Christmas waltz, sixteen two-second bars.
const hz = midi => 440 * 2 ** ((midi - 69) / 12);

// Original four-phrase melody. Each entry is [pitch, duration in beats].
const MELODY = [
    [[74,1],[78,.5],[81,.5],[78,1]], [[76,1],[74,.5],[73,.5],[74,1]],
    [[78,1],[81,1],[83,1]], [[81,1.5],[78,.5],[76,1]],
    [[79,1],[83,.5],[86,.5],[83,1]], [[81,1],[79,.5],[78,.5],[76,1]],
    [[78,.5],[79,.5],[81,1],[73,1]], [[74,2], [null,1]],
    [[81,1],[86,.5],[85,.5],[83,1]], [[81,1.5],[78,.5],[76,1]],
    [[79,1],[83,1],[86,1]], [[85,1],[83,.5],[81,.5],[78,1]],
    [[79,.5],[78,.5],[76,1],[74,1]], [[73,1],[76,.5],[81,.5],[79,1]],
    [[78,1],[76,1],[73,1]], [[74,3]]
];
const CHORDS = [
    [50,62,66,69], [45,61,64,69], [47,62,66,71], [42,61,66,69],
    [43,59,62,67], [50,57,62,66], [45,61,64,67], [50,62,66,69],
    [47,62,66,71], [42,61,66,69], [43,59,62,67], [50,57,62,66],
    [40,59,64,67], [45,61,64,69], [45,61,64,67], [50,62,66,69]
];

export function createScore() {
    const notes = [];
    for (let bar = 0; bar < 16; bar++) {
        const chord = CHORDS[bar], start = bar * 2;
        let beat = 0;
        for (const [pitch, length] of MELODY[bar]) {
            if (pitch !== null) notes.push({ kind: 'celesta', pitch, time: start + beat * BEAT + .04, duration: Math.min(1.8, length * BEAT + .45), gain: bar < 8 ? .16 : .19, pan: -.08 });
            beat += length;
        }
        // Plucked bass followed by two light chord strokes gives a dancing
        // pulse. Every voice has an ending; there are no held drones or loops.
        notes.push({ kind: 'harp', pitch: chord[0], time: start + .02, duration: 1.35, gain: .12, pan: -.2 });
        for (const b of [1, 2]) for (let k = 1; k < 4; k++) {
            notes.push({ kind: 'harp', pitch: chord[k], time: start + b * BEAT + k * .017, duration: .8, gain: .033, pan: .18 });
        }
        if (bar >= 4 && bar < 15) for (let eighth = 0; eighth < 6; eighth++) {
            notes.push({ kind: 'harp', pitch: chord[1 + eighth % 3] + 12, time: start + eighth * BEAT / 2 + .025, duration: .65, gain: .027, pan: eighth % 2 ? .4 : -.4 });
        }
        if (bar >= 8 && bar < 15) for (const b of [0, 1.5, 2.5]) {
            notes.push({ kind: 'sleigh', time: start + b * BEAT, duration: .14, gain: .014, pan: .38 });
        }
    }
    return notes.sort((a, b) => a.time - b.time);
}

export async function renderIntroMusic(sampleRate = 44100, { party = false } = {}) {
    const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    const duration = party ? 24 : SCORE_DURATION;
    const ctx = new Offline(2, Math.ceil(duration * sampleRate), sampleRate);
    const mix = ctx.createGain(); mix.gain.value = .82;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, 0); master.gain.linearRampToValueAtTime(1, .08);
    master.gain.setValueAtTime(1, duration - (party ? .35 : 1.75)); master.gain.linearRampToValueAtTime(0, duration);
    mix.connect(master); master.connect(ctx.destination);

    // A small, deterministic stereo room softens the attacks without obscuring
    // the melody. The direct notes remain the dominant part of the mix.
    let seed = 122590;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const room = ctx.createConvolver(), wet = ctx.createGain(); wet.gain.value = .14;
    const impulse = ctx.createBuffer(2, Math.floor(sampleRate * 1.4), sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const data = impulse.getChannelData(ch);
        for (let i = 0; i < data.length; i++) data[i] = (random() * 2 - 1) * Math.exp(-i / sampleRate * 5.2) * Math.min(1, i / (sampleRate * .015));
    }
    room.buffer = impulse; mix.connect(room); room.connect(wet); wet.connect(master);
    const noise = ctx.createBuffer(1, Math.ceil(sampleRate * .2), sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;

    const notes = createScore().map(note => party ? { ...note, time: note.time * .75, duration: note.duration * .75 } : note);
    if (party) for (let beat = 0; beat < 47; beat++) {
        notes.push({ kind: 'sleigh', time: beat * .5 + .25, duration: .12, gain: .018, pan: beat % 2 ? -.3 : .3 });
        if (beat % 3 === 0) notes.push({ kind: 'kick', time: beat * .5, duration: .18, gain: .1, pan: 0 });
    }
    for (const note of notes) {
        const pan = ctx.createStereoPanner(); pan.pan.value = note.pan; pan.connect(mix);
        if (note.kind === 'kick') {
            const osc = ctx.createOscillator(), envelope = ctx.createGain();
            osc.frequency.setValueAtTime(100, note.time); osc.frequency.exponentialRampToValueAtTime(48, note.time + .12);
            envelope.gain.setValueAtTime(.00001, note.time); envelope.gain.linearRampToValueAtTime(note.gain, note.time + .006);
            envelope.gain.exponentialRampToValueAtTime(.00001, note.time + note.duration);
            osc.connect(envelope); envelope.connect(pan); osc.start(note.time); osc.stop(note.time + note.duration);
            continue;
        }
        if (note.kind === 'sleigh') {
            const source = ctx.createBufferSource(); source.buffer = noise;
            const filter = ctx.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 5600;
            const envelope = ctx.createGain();
            envelope.gain.setValueAtTime(0, note.time); envelope.gain.linearRampToValueAtTime(note.gain, note.time + .008);
            envelope.gain.exponentialRampToValueAtTime(.00001, note.time + note.duration);
            source.connect(filter); filter.connect(envelope); envelope.connect(pan);
            source.start(note.time); source.stop(note.time + note.duration);
            continue;
        }
        const partials = note.kind === 'celesta'
            ? [[1,1,1], [2,.24,.55], [3.01,.09,.3], [5.03,.025,.18]]
            : [[1,1,1], [2,.3,.55], [3,.12,.35], [4,.04,.2]];
        for (const [ratio, amplitude, decay] of partials) {
            const osc = ctx.createOscillator(), envelope = ctx.createGain();
            osc.frequency.value = hz(note.pitch) * ratio;
            const attack = note.kind === 'celesta' ? .009 : .015;
            const duration = note.duration * decay;
            envelope.gain.setValueAtTime(0, note.time);
            envelope.gain.linearRampToValueAtTime(note.gain * amplitude, note.time + attack);
            envelope.gain.exponentialRampToValueAtTime(.00001, note.time + Math.max(attack + .02, duration));
            osc.connect(envelope); envelope.connect(pan);
            osc.start(note.time); osc.stop(note.time + duration + .03);
        }
    }
    return ctx.startRendering();
}

export class IntroMusic {
    constructor() {
        this.ctx = null; this.masterGain = null; this.buffer = null; this.source = null;
        this.isInitialized = false; this.isEnabled = true; this.isIntroDone = false;
        this.active = false; this.ambientActive = false; this.time = 0; this.startedAt = 0; this.offset = 0;
        this.ready = null;
        document.addEventListener('visibilitychange', () => { if (document.hidden) this._stop(); else this._play(); });
    }
    init() {
        if (this.isInitialized) return this.ready;
        const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Audio) return Promise.resolve();
        try {
            this.ctx = new Audio(); this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = this.isIntroDone || !this.isEnabled ? 0 : .85;
            this.masterGain.connect(this.ctx.destination); this.isInitialized = true;
            this.ctx.onstatechange = () => { this._label(); this._play(); };
            this.ready = renderIntroMusic(this.ctx.sampleRate).then(buffer => { this.buffer = buffer; this._play(); });
            this.ready.catch(error => console.warn('Intromuziek kon niet worden opgebouwd:', error));
            this._label();
            return this.ready;
        } catch (error) { console.warn('Web Audio niet beschikbaar:', error); return Promise.resolve(); }
    }
    _label() {
        const button = document.getElementById('btn-toggle-sound');
        if (button) button.textContent = !this.isEnabled ? 'Geluid: Uit' : this.ctx?.state === 'running' || (this.isIntroDone && !this.ambientActive) ? 'Geluid: Aan' : 'Start muziek';
    }
    setAmbientActive(active) { if (this.ambientActive !== active) { this.ambientActive = active; this._label(); } }
    _stop() {
        const voice = this.source; this.source = null;
        if (!voice) return;
        const now = this.ctx.currentTime;
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(0, now, .015);
        voice.node.stop(now + .08);
    }
    _play() {
        if (document.hidden || this.source || !this.buffer || !this.active || !this.isEnabled || this.isIntroDone || this.ctx.state !== 'running' || this.time >= SCORE_DURATION) return;
        const node = this.ctx.createBufferSource(), gain = this.ctx.createGain();
        node.buffer = this.buffer; node.connect(gain); gain.connect(this.masterGain);
        this.startedAt = this.ctx.currentTime; this.offset = Math.max(0, this.time);
        gain.gain.setValueAtTime(0, this.startedAt); gain.gain.linearRampToValueAtTime(1, this.startedAt + .025);
        const voice = { node, gain }; this.source = voice;
        node.onended = () => { node.disconnect(); gain.disconnect(); if (this.source === voice) this.source = null; };
        node.start(this.startedAt, this.offset);
    }
    update(time, isIntro) {
        this.time = time; this.active = isIntro;
        if (!isIntro || time >= SCORE_DURATION) { this.fadeOut(); return; }
        if (this.source && Math.abs(this.offset + this.ctx.currentTime - this.startedAt - time) > .5) this._stop();
        this._play();
    }
    pauseForSeek(time) { this.time = time; this.active = false; this._stop(); }
    fadeOut() { this.isIntroDone = true; this.active = false; this._stop(); if (this.masterGain) this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, .04); }
    resetIntro() {
        this._stop(); this.time = 0; this.active = true; this.isIntroDone = false;
        this.init();
        if (this.masterGain) this.masterGain.gain.setTargetAtTime(this.isEnabled ? .85 : 0, this.ctx.currentTime, .025);
        this.tryResume(); this._play();
    }
    toggleSound() {
        this.init();
        // A blocked autoplay request is an invitation to start, not to mute.
        if (this.isEnabled && (!this.isIntroDone || this.ambientActive) && this.ctx?.state === 'suspended') { this.tryResume(); return true; }
        this.isEnabled = !this.isEnabled;
        if (this.masterGain) this.masterGain.gain.setTargetAtTime(this.isEnabled && !this.isIntroDone ? .85 : 0, this.ctx.currentTime, .025);
        if (!this.isEnabled) this._stop(); else { this.tryResume(); this._play(); }
        this._label(); return this.isEnabled;
    }
    tryResume() {
        this.init();
        if (this.ctx?.state === 'suspended') this.ctx.resume().then(() => { this._label(); this._play(); }).catch(() => {});
        else this._play();
    }
}
