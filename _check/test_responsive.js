import { runBrowserTest } from './harness.js';

async function testResponsive() {
    console.log('Testing responsive at 1366x768...');
    const res = await runBrowserTest({
        urlPath: '/?debug&intro=0',
        waitMs: 1500,
        screenshotPath: '_check/final_shot_1366x768.png',
        actions: async ({ send }) => {
            await send('Emulation.setDeviceMetricsOverride', {
                width: 1366,
                height: 768,
                deviceScaleFactor: 1,
                mobile: false
            });
            await send('Runtime.evaluate', { expression: 'window.dispatchEvent(new Event("resize"))' });
            await new Promise(r => setTimeout(r, 800));
        }
    });

    console.log('1366x768 info:', res.evalResult?.info);
    if (res.errors.length) {
        console.error('1366x768 errors:', res.errors);
    } else {
        console.log('1366x768 OK!');
    }
}

testResponsive();
