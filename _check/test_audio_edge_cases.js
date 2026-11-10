import { runBrowserTest } from './harness.js';

async function testAllEdgeCases() {
    console.log('========================================================');
    console.log('COMPREHENSIVE AUDIT: AUDIO EDGE CASES & PERFORMANCE');
    console.log('========================================================\n');

    let allPassed = true;

    // Test 1: intro=0 starts completely silent and isIntroDone = true
    console.log('--- Case 1: URL ?intro=0 audio silence check ---');
    const resIntroZero = await runBrowserTest({
        urlPath: '/?debug&intro=0',
        waitMs: 1000,
        actions: async ({ evaluate }) => {
            const isDone = await evaluate('window.__soundManager.isIntroDone');
            const gain = await evaluate('window.__soundManager.masterGain.gain.value');
            console.log('isIntroDone:', isDone.result?.value, 'Gain:', gain.result?.value);
            if (!isDone.result?.value || gain.result?.value > 0.001) {
                console.error('FAIL: intro=0 was not silenced!');
                allPassed = false;
            } else {
                console.log('PASS: intro=0 is completely silent and marked done.');
            }
        }
    });
    if (resIntroZero.errors.length > 0) allPassed = false;

    // Test 2: view=binnen starts completely silent
    console.log('\n--- Case 2: URL ?view=binnen audio silence check ---');
    const resBinnen = await runBrowserTest({
        urlPath: '/?debug&view=binnen',
        waitMs: 1000,
        actions: async ({ evaluate }) => {
            const isDone = await evaluate('window.__soundManager.isIntroDone');
            const gain = await evaluate('window.__soundManager.masterGain.gain.value');
            console.log('isIntroDone:', isDone.result?.value, 'Gain:', gain.result?.value);
            if (!isDone.result?.value || gain.result?.value > 0.001) {
                console.error('FAIL: view=binnen was not silenced!');
                allPassed = false;
            } else {
                console.log('PASS: view=binnen is completely silent.');
            }
        }
    });
    if (resBinnen.errors.length > 0) allPassed = false;

    // Test 3: Sound button click during intro toggles sound and does NOT skip intro
    console.log('\n--- Case 3: Sound button click during intro preserves intro state ---');
    const resSoundToggleIntro = await runBrowserTest({
        urlPath: '/?debug',
        waitMs: 1000,
        actions: async ({ evaluate }) => {
            const stateBefore = await evaluate('window.getCameraState()');
            const btnBefore = await evaluate('document.getElementById("btn-toggle-sound").textContent');
            console.log('Initial state:', stateBefore.result?.value, 'Button text:', btnBefore.result?.value);

            await evaluate('document.getElementById("btn-toggle-sound").click()');
            await new Promise(r => setTimeout(r, 150));

            const stateAfter = await evaluate('window.getCameraState()');
            const btnAfter = await evaluate('document.getElementById("btn-toggle-sound").textContent');
            console.log('State after click:', stateAfter.result?.value, 'Button text:', btnAfter.result?.value);

            if (stateAfter.result?.value !== 'intro') {
                console.error('FAIL: Clicking sound button skipped the intro!');
                allPassed = false;
            } else if (btnAfter.result?.value !== 'Geluid: Uit') {
                console.error('FAIL: Button text did not change to "Geluid: Uit"');
                allPassed = false;
            } else {
                console.log('PASS: Sound toggled off cleanly while intro kept playing.');
            }
        }
    });
    if (resSoundToggleIntro.errors.length > 0) allPassed = false;

    // Test 4: Rapid toggling 10 times in a row without crashing or throwing
    console.log('\n--- Case 4: Rapid sound toggling stress test (10x) ---');
    const resStressToggle = await runBrowserTest({
        urlPath: '/?debug',
        waitMs: 1000,
        actions: async ({ evaluate }) => {
            for (let i = 0; i < 10; i++) {
                await evaluate('window.__soundManager.toggleSound()');
                await new Promise(r => setTimeout(r, 50));
            }
            const isEnabled = await evaluate('window.__soundManager.isEnabled');
            const gain = await evaluate('window.__soundManager.masterGain.gain.value');
            console.log('After 10 rapid toggles: isEnabled =', isEnabled.result?.value, 'gain =', gain.result?.value);
            console.log('PASS: 10 rapid toggles handled without any exceptions.');
        }
    });
    if (resStressToggle.errors.length > 0) allPassed = false;

    // Test 5: Replay intro restarts sound
    console.log('\n--- Case 5: Replay intro restarts audio and bell index ---');
    const resReplay = await runBrowserTest({
        urlPath: '/?debug&intro=0',
        waitMs: 1000,
        actions: async ({ evaluate }) => {
            await evaluate('document.getElementById("btn-replay-intro").click()');
            await new Promise(r => setTimeout(r, 200));

            const isDone = await evaluate('window.__soundManager.isIntroDone');
            const bellIdx = await evaluate('window.__soundManager.bellIndex');
            const camState = await evaluate('window.getCameraState()');

            console.log('Replay intro results:', { isDone: isDone.result?.value, bellIdx: bellIdx.result?.value, camState: camState.result?.value });
            if (isDone.result?.value !== false || bellIdx.result?.value !== 0 || camState.result?.value !== 'intro') {
                console.error('FAIL: Replay intro did not reset sound manager state properly!');
                allPassed = false;
            } else {
                console.log('PASS: Replay intro reset sound and camera correctly.');
            }
        }
    });
    if (resReplay.errors.length > 0) allPassed = false;

    // Test 6: Performance budget check (draw calls < 200, triangles < 1M)
    console.log('\n--- Case 6: Strict performance budget check across views ---');
    const views = ['/?debug&intro=0', '/?debug&view=binnen', '/?debug&t=17'];
    for (const v of views) {
        const res = await runBrowserTest({
            urlPath: v,
            waitMs: 1500
        });
        const info = res.evalResult?.info;
        console.log(`View ${v}: Calls = ${info?.calls}, Triangles = ${info?.triangles}`);
        if (info?.calls >= 200) {
            console.error(`FAIL: Draw calls (${info?.calls}) exceeded 200 limit on ${v}!`);
            allPassed = false;
        }
        if (info?.triangles >= 1000000) {
            console.error(`FAIL: Triangles (${info?.triangles}) exceeded 1,000,000 limit on ${v}!`);
            allPassed = false;
        }
        if (res.errors.length > 0) {
            console.error(`FAIL: Console errors detected on ${v}:`, res.errors);
            allPassed = false;
        }
    }

    console.log('\n========================================================');
    console.log('AUDIT COMPLETE. ALL EDGE CASES PASSED?', allPassed);
    console.log('========================================================');

    if (!allPassed) process.exit(1);
}

testAllEdgeCases();
