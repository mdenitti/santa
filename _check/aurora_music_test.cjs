// Offline browser regression for visible aurora and the rendered musical score.
// Build _check/export.cjs first. No external requests or audio autoplay bypass.
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const output = process.env.SANTA_TEST_OUTPUT || '/tmp/santa-aurora-music';
const html = fs.readFileSync(process.env.SANTA_HTML || '/workspace/santa-export/winterdorp.html', 'utf8');

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
        args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
        page.setDefaultTimeout(180000);
        const errors = [], requests = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error' && /shader|WebGLProgram/.test(m.text())) errors.push(m.text()); });
        page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith('http://127.0.0.1:8000/')) requests.push(r.url()); });
        await page.route('http://127.0.0.1:8000/**', r => r.fulfill({ contentType: 'text/html', body: html }));
        await page.context().setOffline(true);
        await page.goto(`http://127.0.0.1:8000/${process.env.SANTA_PARTY_ONLY ? '?intro=0' : '?t=0'}`);
        await page.waitForFunction(() => window.village && __debugInfo.triangles > 0 && __soundManager.buffer);
        if (!process.env.SANTA_PARTY_ONLY) {
        const music = await page.evaluate(() => {
            const b = __soundManager.buffer, samples = b.getChannelData(0), rate = b.sampleRate;
            let peak = 0, sum = 0;
            for (const v of samples) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
            const rms = (a, z) => { let sum = 0; for (let i = Math.floor(a * rate); i < Math.floor(z * rate); i++) sum += samples[i] ** 2; return Math.sqrt(sum / ((z - a) * rate)); };
            // Measure a low 55 Hz drone independently of the score's event data.
            let re = 0, im = 0; const n = rate * 4;
            for (let i = 0; i < n; i++) { re += samples[i] * Math.cos(i * 2 * Math.PI * 55 / rate); im -= samples[i] * Math.sin(i * 2 * Math.PI * 55 / rate); }
            return { duration: b.duration, channels: b.numberOfChannels, peak, rms: Math.sqrt(sum / samples.length),
                opening: rms(.15, 1.8), middle: rms(16, 18), tail: rms(31.9, 32), drone55: Math.hypot(re, im) * 2 / n };
        });
        assert.equal(music.duration, 32); assert.equal(music.channels, 2);
        assert.ok(music.peak < .96 && music.peak > .1, `clipping or silent score: ${music.peak}`);
        assert.ok(music.opening > .015 && music.middle > .015, 'melody must sound in orbit and during descent');
        assert.ok(music.tail < music.opening * .04, 'ending must resolve to silence');
        assert.ok(music.drone55 < music.rms * .05, 'low continuous drone must be absent');
        console.log('PASS rendered stereo score:', music);
        const wav = await page.evaluate(() => {
            const b = __soundManager.buffer, n = b.length, array = new ArrayBuffer(44 + n * 4), v = new DataView(array);
            const word = (offset, s) => { for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i)); };
            word(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); word(8, 'WAVE'); word(12, 'fmt ');
            v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
            v.setUint32(24, b.sampleRate, true); v.setUint32(28, b.sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
            word(36, 'data'); v.setUint32(40, n * 4, true);
            for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) v.setInt16(44 + i * 4 + ch * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true); }
            const bytes = new Uint8Array(array); let text = '';
            for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
            return btoa(text);
        });
        fs.writeFileSync(`${output}/winterwals.wav`, Buffer.from(wav, 'base64'));

        await page.click('#btn-toggle-sound'); // Explicit browser gesture unlocks audio.
        await page.waitForFunction(() => __soundManager.ctx.state === 'running');
        await page.evaluate(() => __soundManager.resetIntro());
        await page.waitForFunction(() => !!__soundManager.source);
        assert.ok(await page.evaluate(() => __soundManager.offset < .2));
        await page.click('#btn-toggle-sound');
        assert.equal(await page.evaluate(() => __soundManager.isEnabled), false);
        assert.equal(await page.evaluate(() => __soundManager.source), null);
        await page.click('#btn-toggle-sound');
        await page.waitForFunction(() => __soundManager.isEnabled && !!__soundManager.source);
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => __soundManager.isIntroDone && !__soundManager.source), true);
        await page.click('#btn-replay-intro');
        await page.waitForFunction(() => !__soundManager.isIntroDone && !!__soundManager.source);
        assert.ok(await page.evaluate(() => __soundManager.offset < 2));
        await page.evaluate(() => seekIntro(0));
        assert.equal(await page.evaluate(() => __soundManager.source), null);
        console.log('PASS music start, mute, unmute, Escape, replay and silent timeline seeking');

        for (const t of [0, 8, 14, 18, 22]) {
            await page.evaluate(t => seekIntro(t), t);
            await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
            const state = await page.evaluate(() => __introDiagnostics);
            assert.ok(state.orbitalAurora + state.localAurora >= .9, `aurora disappears at ${t}s`);
            if (t < 13) assert.equal(state.orbitalAurora, 1);
            const png = await page.screenshot({ path: `${output}/aurora-${t}.png` });
            if (t === 0 || t === 18) {
                const pixels = await page.evaluate(src => new Promise(resolve => {
                    const img = new Image(); img.onload = () => {
                        const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
                        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
                        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                        let green = 0;
                        for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 40 && d[i + 1] > d[i] * 1.45 && d[i + 1] > d[i + 2] * 1.05) green++;
                        resolve(green);
                    }; img.src = src;
                }), `data:image/png;base64,${png.toString('base64')}`);
                assert.ok(pixels > 100, `aurora is not visible in actual ${t}s image (${pixels} green pixels)`);
                console.log(`PASS visible aurora ${t}s: ${pixels} green pixels`);
            }
        }
        await page.keyboard.press('Escape');
        }
        const calendar = await page.evaluate(() => [
            '2026-12-24T22:59:00Z', '2026-12-24T23:00:00Z',
            '2026-12-25T22:59:00Z', '2026-12-25T23:00:00Z'
        ].map(iso => party.isChristmasDay(new Date(iso))));
        assert.deepEqual(calendar, [false, true, true, false], 'Christmas follows the Brussels calendar');
        if (await page.evaluate(() => party.enabled)) await page.click('#btn-party');
        await page.click('#btn-party');
        await page.waitForFunction(() => party.getState().audible);
        const festive = await page.evaluate(() => party.getState());
        assert.equal(festive.extraGuests, 36); assert.equal(festive.dancing, 20);
        assert.equal(festive.blockedGuests, 0); assert.ok(festive.bulbs >= 600);
        assert.equal(festive.fireworkParticles, 816); assert.equal(festive.musicDuration, 24);
        assert.equal(await page.locator('#btn-party').getAttribute('aria-pressed'), 'true');
        await page.waitForTimeout(1800);
        await page.screenshot({ path: `${output}/party-overview.png` });
        await page.click('#btn-party-street');
        assert.equal(await page.evaluate(() => village.mode), 'overview');
        await page.screenshot({ path: `${output}/party-street.png` });
        await page.click('#btn-toggle-sound');
        await page.waitForFunction(() => !party.getState().audible);
        const guests = await page.evaluate(() => {
            const bad = [];
            for (let i = 0; i < 400; i++) {
                party.update(.1, i * .1, false);
                for (const [x,z] of party.getState().positions) if (!village.navigation.isWalkable(x,z,.24)) bad.push([x,z]);
            }
            return bad;
        });
        assert.deepEqual(guests, [], 'party guests must stay out of buildings and trees');
        await page.click('#btn-toggle-sound');
        await page.waitForFunction(() => party.getState().audible);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.waitForFunction(() => party.getState().reducedMotion);
        await page.click('#btn-party');
        await page.waitForFunction(() => !party.enabled && !party.getState().audible);
        assert.equal(await page.locator('#btn-party-street').isVisible(), false);
        assert.equal(await page.evaluate(() => party.getState().extraGuests), 0);
        await page.click('#btn-party');
        await page.waitForFunction(() => party.getState().audible);
        assert.equal(await page.evaluate(() => party.getState().extraGuests), 36, 'toggling must not duplicate guests');
        await page.click('#btn-party');
        console.log('PASS Christmas calendar, 36 guests/20 dancers, 680 bulbs, fireworks, festive music, shopping street, collisions, mute, reduced motion and clean toggle');
        assert.deepEqual(errors, []); assert.deepEqual(requests, []);
        console.log('PASS offline scene, orbital/local aurora overlap, no shader or page errors');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
