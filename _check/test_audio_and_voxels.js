import { runBrowserTest } from './harness.js';

async function testAudioAndVoxels() {
    console.log('====================================================');
    console.log('TESTING WEB AUDIO API SYNTHESIS & REFINED VOXELS');
    console.log('====================================================\n');

    let allPassed = true;

    // Test 1: Audio Manager & Sound Toggle Button
    console.log('--- Test 1: Audio Manager & Sound Toggle Button ---');
    const resAudio = await runBrowserTest({
        urlPath: '/?debug',
        waitMs: 2000,
        actions: async ({ send, evaluate }) => {
            // Check that soundManager exists
            const smExists = await evaluate('Boolean(window.__soundManager)');
            console.log('soundManager exists:', smExists.result?.value);
            if (!smExists.result?.value) {
                console.error('FAIL: soundManager not found on window');
                allPassed = false;
            }

            // Check button initial text
            const btnText = await evaluate('document.getElementById("btn-toggle-sound").textContent');
            console.log('btn-toggle-sound initial text:', btnText.result?.value);
            if (btnText.result?.value !== 'Geluid: Aan') {
                console.error('FAIL: Initial sound button text is not "Geluid: Aan"');
                allPassed = false;
            }

            // Simulate sound toggle button click
            await evaluate('document.getElementById("btn-toggle-sound").click()');
            await new Promise(r => setTimeout(r, 200));

            const btnTextAfterClick = await evaluate('document.getElementById("btn-toggle-sound").textContent');
            console.log('btn-toggle-sound text after click:', btnTextAfterClick.result?.value);
            if (btnTextAfterClick.result?.value !== 'Geluid: Uit') {
                console.error('FAIL: Sound button text did not toggle to "Geluid: Uit"');
                allPassed = false;
            }

            // Toggle back to Aan
            await evaluate('document.getElementById("btn-toggle-sound").click()');
            await new Promise(r => setTimeout(r, 200));
            const btnTextAan = await evaluate('document.getElementById("btn-toggle-sound").textContent');
            console.log('btn-toggle-sound text after toggle back:', btnTextAan.result?.value);
            if (btnTextAan.result?.value !== 'Geluid: Aan') {
                console.error('FAIL: Sound button text did not toggle back to "Geluid: Aan"');
                allPassed = false;
            }

            // Test audio timeline update and bell scheduling
            const introTime = await evaluate('window.getIntroTime()');
            console.log('Current introTime:', introTime.result?.value);

            // Test audio update function with t = 2.5s
            await evaluate('window.__soundManager.update(2.5, true)');
            const bellIndexAfter2_5s = await evaluate('window.__soundManager.bellIndex');
            console.log('Bell index at t=2.5s:', bellIndexAfter2_5s.result?.value);
            if (bellIndexAfter2_5s.result?.value !== 3) {
                console.error(`FAIL: Expected 3 bells at t=2.5s, got ${bellIndexAfter2_5s.result?.value}`);
                allPassed = false;
            } else {
                console.log('PASS: Exactly 3 crystal bells triggered at t=2.5s.');
            }

            // Test audio update with t = 14.0s (should trigger window chime and more bells)
            await evaluate('window.__soundManager.update(14.0, true)');
            const bellIndexAfter14s = await evaluate('window.__soundManager.bellIndex');
            console.log('Bell index at t=14.0s:', bellIndexAfter14s.result?.value);
            if (bellIndexAfter14s.result?.value < 9) {
                console.error('FAIL: Expected at least 9 bells at t=14.0s');
                allPassed = false;
            } else {
                console.log('PASS: Window chime and bells triggered along flight path.');
            }

            // Test fade out on skip intro
            await evaluate('window.__soundManager.fadeOut(1.8)');
            const isIntroDone = await evaluate('window.__soundManager.isIntroDone');
            console.log('isIntroDone after fadeOut:', isIntroDone.result?.value);
            if (!isIntroDone.result?.value) {
                console.error('FAIL: isIntroDone not set on fadeOut');
                allPassed = false;
            } else {
                console.log('PASS: fadeOut successfully engaged.');
            }

            // Test reset intro
            await evaluate('window.__soundManager.resetIntro()');
            const bellIndexAfterReset = await evaluate('window.__soundManager.bellIndex');
            console.log('bellIndex after resetIntro:', bellIndexAfterReset.result?.value);
            if (bellIndexAfterReset.result?.value !== 0) {
                console.error('FAIL: bellIndex was not reset to 0');
                allPassed = false;
            } else {
                console.log('PASS: soundManager reset successfully.');
            }
        }
    });

    if (resAudio.errors.length > 0) {
        console.error('Errors in Test 1:', resAudio.errors);
        allPassed = false;
    }

    // Test 2: Budget Check on Overview and Interior Views
    console.log('\n--- Test 2: Outside Overview Performance Budget ---');
    const resOutside = await runBrowserTest({
        urlPath: '/?debug&intro=0',
        waitMs: 2000,
        screenshotPath: '_check/refined_outside.png'
    });
    console.log('Outside info:', resOutside.evalResult?.info);
    if (resOutside.evalResult?.info?.calls > 200) {
        console.error('FAIL: Outside draw calls exceeded 200:', resOutside.evalResult?.info?.calls);
        allPassed = false;
    }
    if (resOutside.evalResult?.info?.triangles > 1000000) {
        console.error('FAIL: Outside triangles exceeded 1M:', resOutside.evalResult?.info?.triangles);
        allPassed = false;
    }

    console.log('\n--- Test 3: Inside Dollhouse Performance Budget ---');
    const resInside = await runBrowserTest({
        urlPath: '/?debug&view=binnen',
        waitMs: 2000,
        screenshotPath: '_check/refined_inside.png'
    });
    console.log('Inside info:', resInside.evalResult?.info);
    if (resInside.evalResult?.info?.calls > 200) {
        console.error('FAIL: Inside draw calls exceeded 200:', resInside.evalResult?.info?.calls);
        allPassed = false;
    }
    if (resInside.evalResult?.info?.triangles > 1000000) {
        console.error('FAIL: Inside triangles exceeded 1M:', resInside.evalResult?.info?.triangles);
        allPassed = false;
    }

    console.log('\n====================================================');
    console.log('ALL AUDIO & VOXEL TESTS COMPLETE. Passed?', allPassed);
    console.log('====================================================');

    process.exit(allPassed ? 0 : 1);
}

testAudioAndVoxels();
