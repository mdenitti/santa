const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
        args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
        page.setDefaultTimeout(120000);
        const errors = [], cache = new Map();
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error' && /shader|THREE\.|WebGLProgram/.test(m.text())) errors.push(m.text()); });
        await page.route('https://cdn.jsdelivr.net/**', async route => {
            const url = route.request().url();
            if (!cache.has(url)) cache.set(url, execFileSync('curl', ['-fsS', '--max-time', '30', url], { maxBuffer: 12e6 }));
            await route.fulfill({ contentType: 'application/javascript', body: cache.get(url), headers: { 'access-control-allow-origin': '*' } });
        });
        if (process.env.SANTA_HTML) {
            const html = fs.readFileSync(process.env.SANTA_HTML, 'utf8');
            await page.route('http://127.0.0.1:8000/**', route => route.fulfill({ contentType: 'text/html', body: html }));
            await page.context().setOffline(true);
        }
        const output = `${process.env.SANTA_TEST_OUTPUT || '/tmp/santa-village-checks'}/intro`;
        fs.mkdirSync(output, { recursive: true });
        await page.goto(`${process.env.SANTA_BASE_URL || 'http://127.0.0.1:8000'}/?t=0`);
        await page.waitForFunction(() => window.village && window.__debugInfo.triangles > 0 && __introDiagnostics.surface === 'bundled-earth-texture');
        for (const [time, phase] of [[0, 'space'], [6, 'north-pole-zoom'], [12, 'descent'], [18, 'aurora'], [24, 'village'], [32, 'complete']]) {
            await page.evaluate(t => seekIntro(t), time);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const state = await page.evaluate(() => __introDiagnostics);
            assert.equal(state.phase, phase);
            assert.equal(state.globeVisible, time < 19);
            assert.equal(state.continuousWorld, true);
            assert.equal(state.polarSunlight, 0, 'the North Pole must stay on the night side');
            if (time <= 12) assert.equal(state.villageVisible, true, 'the actual village must remain in frame during orbital descent');
            assert.equal(await page.locator('#orbital-transition').count(), 0, 'no full-screen wipe may hide a camera cut');
            assert.ok(state.camera.every(Number.isFinite));
            assert.equal(state.duration, 32);
            // Let CSS and the software GPU settle before collecting reviewable frames.
            await page.waitForTimeout(1800);
            const screenshot = await page.screenshot({ path: `${output}/${phase}.png` });
            if (time === 0) {
                // Inspect the rendered pixels, not merely diagnostic flags: a
                // healthy timeline can still produce an empty first frame.
                const colors = await page.evaluate(src => new Promise((resolve, reject) => {
                    const img = new Image(); img.onerror = reject;
                    img.onload = () => {
                        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
                        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
                        const pixels = ctx.getImageData(c.width * .15, c.height * .2, c.width * .7, c.height * .6).data;
                        const unique = new Set();
                        for (let i = 0; i < pixels.length; i += 16) unique.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
                        resolve(unique.size);
                    };
                    img.src = src;
                }), `data:image/png;base64,${screenshot.toString('base64')}`);
                assert.ok(colors > 512, `initial orbital frame is blank or flat (${colors} distinct colours)`);
            }
            console.log(`PASS: intro ${time}s · ${phase}`);
        }
        const continuity = await page.evaluate(() => {
            const failures = [];
            for (const t of [4, 5, 8, 12, 13, 14, 16, 19, 20, 22, 24, 28, 31.999]) {
                seekIntro(t - .001); const before = camera.position.clone(), rotation = camera.quaternion.clone();
                seekIntro(t + .001);
                if (before.distanceTo(camera.position) > 2 || rotation.angleTo(camera.quaternion) > .01) failures.push(t);
            }
            return failures;
        });
        assert.deepEqual(continuity, [], 'camera and gaze must remain continuous across every phase');
        await page.evaluate(() => seekIntro(8));
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => getCameraState()), 'buiten');
        assert.equal(await page.evaluate(() => __introDiagnostics.globeVisible), false);
        await page.click('#btn-replay-intro');
        assert.equal(await page.evaluate(() => __introDiagnostics.phase), 'space');
        await page.keyboard.press('Escape');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.reload();
        await page.waitForFunction(() => window.village);
        // Explicit ?t retains deterministic authoring even with reduced motion.
        await page.waitForFunction(() => __introDiagnostics.phase === 'space');
        await page.keyboard.press('Escape');
        await page.goto(`${process.env.SANTA_BASE_URL || 'http://127.0.0.1:8000'}/`);
        await page.waitForFunction(() => window.village && getCameraState() === 'buiten');
        assert.equal(await page.evaluate(() => __introDiagnostics.globeVisible), false);
        await page.click('#btn-walk');
        assert.equal(await page.evaluate(() => village.getState().tourPlaying), false);
        assert.deepEqual(errors, []);
        console.log('PASS: continuous camera, visible orbital village, polar night, frozen timeline, Escape, replay, reduced motion; no shader errors');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
