// Run against `python3 -m http.server 8000 --bind 127.0.0.1`.
// NODE_PATH=/workspace/santa-browser-tools/node_modules node _check/village_smoke.cjs
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');

async function main() {
    const output = process.env.SANTA_TEST_OUTPUT || '/tmp/santa-village-checks';
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
        headless: true,
        args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, hasTouch: true });
        page.setDefaultTimeout(90000);
        const errors = [], failedRequests = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('requestfailed', r => failedRequests.push(`${r.url()}: ${r.failure()?.errorText}`));
        // Chromium doesn't inherit this cloud's CA bundle. Fetch CDN modules via
        // curl with inherited proxy/CA settings, preserving TLS verification.
        // No certificate bypass flags or persistent trust-store changes.
        const modules = new Map();
        await page.route('https://cdn.jsdelivr.net/**', async route => {
            const url = route.request().url();
            try {
                if (!modules.has(url)) modules.set(url, execFileSync('curl', ['-fsS', '--retry', '2', '--max-time', '30', url], { maxBuffer: 10 * 1024 * 1024 }));
                await route.fulfill({ status: 200, contentType: 'application/javascript', body: modules.get(url), headers: { 'access-control-allow-origin': '*' } });
            } catch (e) { errors.push(`Verified CDN fetch failed: ${url}: ${e.message}`); await route.abort(); }
        });
        await page.goto(`${process.env.SANTA_BASE_URL || 'http://127.0.0.1:8000'}/?intro=0`);
        await page.waitForFunction(() => window.village && window.__debugInfo?.triangles > 0);
        assert.equal(await page.evaluate(() => village.getState().reindeer), 8);
        assert.equal(await page.evaluate(() => village.getState().buildings), 25);
        const state = await page.evaluate(() => village.getState());
        assert.equal(state.elves, 48);
        assert.equal(state.life.variants, 10);
        assert.ok(state.life.skinTones >= 5);
        assert.equal(state.life.blocked, 0);
        assert.equal(state.voxelPitch, .125);
        // Sample the complete real-world route, including every bend and seam,
        // against all actual canopy envelopes, not just the tree at the plaza.
        const routeCheck = await page.evaluate(() => {
            const samples = 6000, failures = [];
            for (let i = 0; i <= samples; i++) {
                const [x, z] = village.route.at(village.route.length * i / samples);
                if (!village.navigation.isWalkable(x, z)) failures.push([x, z]);
                for (const tree of village.trees) {
                    if (Math.hypot(x - tree.position.x, z - tree.position.z) < tree.userData.collisionRadius + .48) failures.push(['tree', x, z]);
                }
            }
            return { failures, length: village.route.length, needles: village.trees[0].userData.needleCount };
        });
        assert.deepEqual(routeCheck.failures, []);
        assert.ok(routeCheck.length > 300);
        assert.ok(routeCheck.needles > 20000);
        console.log('PASS: 25 buildings, 48 diverse elves, fine voxels, full collision-free POV route');
        await page.screenshot({ path: `${output}/overview.png` });

        await page.click('#btn-walk');
        await page.waitForFunction(() => village.getState().walker[2] < 39.8);
        await page.click('#btn-tour-pause');
        assert.equal(await page.evaluate(() => village.getState().tourPlaying), false);
        const walker = await page.evaluate(() => village.getState().walker);
        await page.keyboard.down('w');
        await page.waitForFunction(z => Math.abs(village.getState().walker[2] - z) > .15, walker[2]);
        await page.keyboard.up('w');
        assert.equal(await page.evaluate(() => village.mode), 'walk');
        await page.screenshot({ path: `${output}/walk.png` });

        await page.click('#btn-santa');
        const start = await page.evaluate(() => village.getState().santa);
        await page.keyboard.down('w');
        await page.waitForFunction(z => village.getState().santa[2] < z - .2, start[2]);
        // Advance the held movement input toward the central tree.
        await page.evaluate(() => { for (let i = 0; i < 100; i++) village.update(.1, i / 10); });
        await page.keyboard.up('w');
        const stoppedZ = await page.evaluate(() => village.getState().santa[2]);
        assert.ok(stoppedZ >= 22.06 && stoppedZ < 22.4, `Santa passed through the tree: ${stoppedZ}`);
        await page.screenshot({ path: `${output}/santa.png` });

        await page.click('#btn-fly');
        await page.waitForFunction(() => village.getState().flight[2] < 24.5);
        await page.keyboard.down('w');
        await page.waitForFunction(() => village.getState().velocity > 6);
        await page.keyboard.up('w');
        const launchHeight = await page.evaluate(() => village.getState().altitude);
        await page.keyboard.down('Space');
        await page.waitForFunction(h => village.getState().altitude > h + 1, launchHeight);
        await page.keyboard.up('Space');
        const altitude = await page.evaluate(() => village.getState().altitude);
        await page.keyboard.down('Shift');
        await page.waitForFunction(h => village.getState().altitude < h - .3, altitude);
        await page.keyboard.up('Shift');
        assert.equal(await page.evaluate(() => village.mode), 'fly');
        console.log('PASS: tour, walking, collision, flight and altitude controls');
        await page.screenshot({ path: `${output}/flight.png` });
        await page.click('#btn-fly');
        assert.equal(await page.evaluate(() => village.mode), 'santa');
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => village.mode), 'overview');
        assert.equal(await page.evaluate(() => controls.enabled), true);

        await page.click('#btn-toggle-view');
        await page.waitForFunction(() => getCameraState() === 'binnen');
        await page.click('[data-mode="overview"]');
        await page.evaluate(() => gift.userData.toggleOpen(true));
        assert.equal(await page.evaluate(() => gift.userData.isOpen()), true);
        const soundBefore = await page.locator('#btn-toggle-sound').textContent();
        await page.click('#btn-toggle-sound');
        assert.notEqual(await page.locator('#btn-toggle-sound').textContent(), soundBefore);

        await page.setViewportSize({ width: 390, height: 844 });
        await page.click('#btn-walk');
        assert.equal(await page.locator('#touch-controls').isVisible(), true);
        await page.locator('[data-key="KeyW"]').tap();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `${output}/mobile.png` });
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 1100, height: 800 });
        await page.click('#btn-replay-intro');
        await page.waitForFunction(() => window.__introDiagnostics.phase === 'space');
        assert.equal(await page.evaluate(() => __introDiagnostics.globeVisible), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => getCameraState()), 'buiten');
        assert.equal(await page.evaluate(() => __introDiagnostics.globeVisible), false);
        console.log('Renderer:', await page.evaluate(() => window.__debugInfo));
        assert.deepEqual(failedRequests, []);
        assert.deepEqual(errors, []);
        console.log('PASS: render, tour, free walk, Santa, flight, climb/descent, return, workshop, gift, sound, mobile');
        console.log(`Screenshots: ${output}`);
    } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
