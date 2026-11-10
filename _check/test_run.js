import { runBrowserTest } from './harness.js';

async function testPhase3() {
    console.log('--- Testing Phase 3: Outside view ---');
    const resOutside = await runBrowserTest({
        urlPath: '/?debug&intro=0',
        waitMs: 2500,
        screenshotPath: '_check/phase3_outside.png'
    });
    console.log('Outside info:', resOutside.evalResult?.info);
    if (resOutside.errors.length) console.error('Outside errors:', resOutside.errors);

    console.log('--- Testing Phase 3: Inside view ---');
    const resInside = await runBrowserTest({
        urlPath: '/?debug&view=binnen',
        waitMs: 2500,
        screenshotPath: '_check/phase3_inside.png'
    });
    console.log('Inside info:', resInside.evalResult?.info);
    if (resInside.errors.length) console.error('Inside errors:', resInside.errors);

    console.log('--- Testing Phase 3: Gift opened ---');
    const resGift = await runBrowserTest({
        urlPath: '/?debug&intro=0&gift=open',
        waitMs: 2500,
        screenshotPath: '_check/phase3_gift.png'
    });
    console.log('Gift info:', resGift.evalResult?.info);
    if (resGift.errors.length) console.error('Gift errors:', resGift.errors);
}

testPhase3();
