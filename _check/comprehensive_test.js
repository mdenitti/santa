import { runBrowserTest } from './harness.js';
import fs from 'fs';

async function runAllTests() {
    console.log('==============================================');
    console.log('STARTING COMPREHENSIVE VERIFICATION SUITE');
    console.log('==============================================\n');

    let allPassed = true;

    // 1. Test URL parameters and Intro timesteps
    const introTimes = [1.0, 5.0, 10.0, 13.5, 17.0];
    for (const t of introTimes) {
        console.log(`--- Testing Intro at t = ${t}s ---`);
        const res = await runBrowserTest({
            urlPath: `/?debug&t=${t}`,
            waitMs: 1500,
            screenshotPath: `_check/intro_t_${t}.png`
        });
        if (res.errors.length > 0) {
            console.error(`Errors at t=${t}:`, res.errors);
            allPassed = false;
        } else {
            console.log(`t=${t} OK. Calls: ${res.evalResult?.info?.calls}, Triangles: ${res.evalResult?.info?.triangles}`);
        }
    }

    // 2. Test Final Shot (Endshot, intro=0)
    console.log('\n--- Testing Final Overview Shot (?intro=0) ---');
    const resFinal = await runBrowserTest({
        urlPath: '/?debug&intro=0',
        waitMs: 2000,
        screenshotPath: '_check/final_shot_1080p.png'
    });
    console.log('Final shot info:', resFinal.evalResult?.info);
    if (resFinal.errors.length > 0) {
        console.error('Final shot errors:', resFinal.errors);
        allPassed = false;
    }

    // 3. Test Interior Dollhouse View (?view=binnen)
    console.log('\n--- Testing Interior Dollhouse View (?view=binnen) ---');
    const resInside = await runBrowserTest({
        urlPath: '/?debug&view=binnen',
        waitMs: 2000,
        screenshotPath: '_check/inside_dollhouse.png'
    });
    console.log('Interior info:', resInside.evalResult?.info);
    if (resInside.errors.length > 0) {
        console.error('Interior errors:', resInside.errors);
        allPassed = false;
    }

    // 4. Test Gift Open View (?gift=open)
    console.log('\n--- Testing Gift Open View (?intro=0&gift=open) ---');
    const resGift = await runBrowserTest({
        urlPath: '/?debug&intro=0&gift=open',
        waitMs: 2000,
        screenshotPath: '_check/gift_open.png'
    });
    console.log('Gift open info:', resGift.evalResult?.info);
    if (resGift.errors.length > 0) {
        console.error('Gift open errors:', resGift.errors);
        allPassed = false;
    }

    // 5. Test Drag vs Click interaction
    console.log('\n--- Testing Pointer Drag vs Click Interaction ---');
    const resInteraction = await runBrowserTest({
        urlPath: '/?debug&intro=0',
        waitMs: 1500,
        actions: async ({ send, evaluate }) => {
            // Check initial gift state (closed)
            let giftState = await evaluate('gift.userData.isOpen()');
            console.log('Initial gift isOpen:', giftState.result?.value);

            // Simulate mouse drag across screen (should NOT open gift)
            await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 960, y: 540, button: 'left' });
            await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1020, y: 580 }); // moved 60+ px
            await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1020, y: 580, button: 'left' });
            await new Promise(r => setTimeout(r, 500));

            giftState = await evaluate('gift.userData.isOpen()');
            console.log('Gift isOpen after drag:', giftState.result?.value);
            if (giftState.result?.value === true) {
                console.error('FAIL: Drag accidentally opened gift!');
                allPassed = false;
            } else {
                console.log('PASS: Drag did NOT open gift.');
            }

            // Now test programmatic or exact click on gift toggle
            await evaluate('gift.userData.toggleOpen()');
            await new Promise(r => setTimeout(r, 600));
            giftState = await evaluate('gift.userData.isOpen()');
            console.log('Gift isOpen after click:', giftState.result?.value);
            if (giftState.result?.value !== true) {
                console.error('FAIL: Click did not open gift!');
                allPassed = false;
            } else {
                console.log('PASS: Click opened gift.');
            }

            // Test toggle view (binnen / buiten)
            let viewState = await evaluate('window.getCameraState()');
            console.log('Initial cameraState:', viewState.result?.value);
            await evaluate('window.toggleInsideOutsideView()');
            await new Promise(r => setTimeout(r, 600));
            viewState = await evaluate('window.getCameraState()');
            console.log('cameraState after toggle:', viewState.result?.value);
            if (viewState.result?.value !== 'naar_binnen' && viewState.result?.value !== 'binnen') {
                console.error('FAIL: toggleInsideOutsideView did not start transition to inside!');
                allPassed = false;
            } else {
                console.log('PASS: View toggled towards inside.');
            }
        }
    });

    console.log('\n==============================================');
    console.log('SUITE FINISHED. All passed?', allPassed);
    console.log('==============================================');
}

runAllTests();
