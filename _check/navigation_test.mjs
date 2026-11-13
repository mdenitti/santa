// Pure Node regressions for the shared automatic/manual pedestrian collision map.
// Run: node --test _check/navigation_test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Keep the static application free of a Node package.json/module-mode requirement.
const source = await readFile(new URL('../navigation.js', import.meta.url), 'utf8');
const { createNavigation } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

// Independent geometry check: sample the actual produced pedestrian positions,
// without calling the implementation's isWalkable/segmentClear validators.
function assertClear(point, obstacles, clearance = .48, boundary = 40) {
    const [x, z] = point;
    assert.ok(Number.isFinite(x) && Number.isFinite(z), `nonfinite position: ${point}`);
    assert.ok(Math.hypot(x, z) <= boundary - clearance + 1e-8, `outside world: ${point}`);
    for (const obstacle of obstacles) {
        const distance = obstacle.radius === undefined
            ? Math.hypot(Math.max(Math.abs(x - obstacle.x) - obstacle.w, 0), Math.max(Math.abs(z - obstacle.z) - obstacle.d, 0))
            : Math.hypot(x - obstacle.x, z - obstacle.z) - obstacle.radius;
        assert.ok(distance >= clearance - 1e-8, `walked through ${obstacle.name}: ${point} (clearance ${distance})`);
    }
}

function assertPathClear(points, obstacles, clearance = .48, boundary = 40) {
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / .025));
        for (let j = 0; j <= count; j++) {
            const f = j / count;
            assertClear([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], obstacles, clearance, boundary);
        }
    }
}

test('automatic route goes around a full eye-level tree canopy', () => {
    const obstacles = [{ name: 'plaza fir canopy', x: 0, z: 0, radius: 4 }];
    const nav = createNavigation(obstacles, { boundary: 40 });
    const path = nav.plan([-10, 0], [10, 0]);
    assert.ok(path.length > 2, 'a direct two-point route would cut through the tree');
    assert.deepEqual(path[0], [-10, 0]);
    assert.deepEqual(path.at(-1), [10, 0]);
    assertPathClear(path, obstacles);
});

test('route visibility pruning does not cut building corners or nearby trees', () => {
    const obstacles = [
        { name: 'workshop', x: 0, z: 0, w: 4, d: 3 },
        { name: 'doorway fir', x: 6, z: 3, radius: 2 },
        { name: 'mailbox', x: -5, z: -5, w: .5, d: .5 }
    ];
    const nav = createNavigation(obstacles, { boundary: 40 });
    assertPathClear(nav.plan([-10, -7], [12, 8]), obstacles);
});

test('fast manual movement cannot tunnel through a tree canopy or a wall', () => {
    const tree = { name: 'spruce', x: 0, z: 0, radius: 3.5 };
    const treeNav = createNavigation([tree], { boundary: 40 });
    const walker = { x: -10, z: 0 };
    treeNav.move(walker, 30, 0);
    assert.ok(walker.x < -3.98 && walker.x > -4.15, `did not stop at canopy: ${walker.x}`);
    assertClear([walker.x, walker.z], [tree]);

    const wall = { name: 'house wall', x: 0, z: 0, w: .2, d: 8 };
    const wallNav = createNavigation([wall], { boundary: 40 });
    const santa = { x: -5, z: 0 };
    wallNav.move(santa, 25, 0);
    assert.ok(santa.x <= -.68, `crossed a thin wall: ${santa.x}`);
    assertClear([santa.x, santa.z], [wall]);
});

test('a complete repeating tour remains finite and collision-free at every sample', () => {
    const obstacles = [
        { name: 'square Christmas tree', x: 0, z: 0, radius: 3.8 },
        { name: 'bakery', x: -9, z: 2, w: 2, d: 3 },
        { name: 'low fir branches', x: 8, z: -7, radius: 2.6 }
    ];
    const nav = createNavigation(obstacles, { boundary: 40 });
    const tour = nav.tour([[-5, -6], [5, -6], [6, 6], [-6, 6]]);
    assert.ok(tour.length > 30);
    assert.equal(tour.validate(), true);
    assertPathClear(tour.points, obstacles);
    for (let distance = 0; distance < tour.length * 2; distance += .025) {
        assertClear(tour.at(distance), obstacles);
    }
    assert.deepEqual(tour.at(0), tour.at(tour.length));
    const before = tour.at(tour.length - .01), after = tour.at(tour.length + .01);
    assert.ok(Math.hypot(before[0] - after[0], before[1] - after[1]) <= .021, 'tour jumps at its loop seam');
    assertClear(tour.at(-1), obstacles);
});

test('manual movement respects the circular world boundary', () => {
    const nav = createNavigation([], { boundary: 10 });
    const position = { x: 0, z: 0 };
    nav.move(position, 100, 0);
    assert.ok(position.x <= 9.52 && position.x > 9.35);
    assertClear([position.x, position.z], [], .48, 10);
});

test('planner reports an unreachable destination rather than returning a clipping path', () => {
    const nav = createNavigation([{ x: 0, z: 0, w: 11, d: .5 }], { boundary: 10 });
    assert.throws(() => nav.plan([0, -5], [0, 5]), /No collision-free route/);
});

test('tour rejects stops that all snap to the same cell instead of producing NaN positions', () => {
    const nav = createNavigation([], { boundary: 40 });
    assert.throws(() => nav.tour([[0, 0], [.1, .1]]), /at least two distinct reachable stops/);
});
