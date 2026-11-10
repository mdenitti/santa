import { runBrowserTest } from './harness.js';

async function checkCam() {
    await runBrowserTest({
        urlPath: '/?debug&intro=0',
        actions: async ({ evaluate }) => {
            const res = await evaluate(`
                [0, 1, 3, 5, 8, 10, 12, 13.5, 15, 17, 18].map(t => {
                    const progress = t / 18.0;
                    const eased = (progress < 0.5) ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
                    const pos = window.introCamCurve.getPoint(eased);
                    const tgt = window.introTargetCurve.getPoint(eased);
                    const distToPole = Math.hypot(pos.x, pos.z);
                    return {
                        t,
                        pos: { x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2) },
                        tgt: { x: +tgt.x.toFixed(2), y: +tgt.y.toFixed(2), z: +tgt.z.toFixed(2) },
                        distToPole: +distToPole.toFixed(2)
                    };
                })
            `);
            console.log(JSON.stringify(res.result.value, null, 2));
        }
    });
}
checkCam();
