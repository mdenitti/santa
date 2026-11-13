// Shared pedestrian collision and route planning. Metres, X/Z plane.
// Both the camera and Santa use a swept disc, including eye-level tree canopies.
export function createNavigation(obstacles, { boundary = 116, clearance = .48, cell = 1 } = {}) {
    function isWalkable(x, z, radius = clearance) {
        if (!Number.isFinite(x + z) || Math.hypot(x, z) > boundary - radius) return false;
        return !obstacles.some(o => {
            if (o.radius !== undefined) return Math.hypot(x - o.x, z - o.z) < o.radius + radius;
            const dx = Math.max(Math.abs(x - o.x) - o.w, 0);
            const dz = Math.max(Math.abs(z - o.z) - o.d, 0);
            return Math.hypot(dx, dz) < radius;
        });
    }
    function segmentClear(a, b, radius = clearance) {
        const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.ceil(distance / .18));
        for (let i = 0; i <= n; i++) {
            const f = i / n;
            if (!isWalkable(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, radius)) return false;
        }
        return true;
    }
    function move(position, dx, dz) {
        // Substeps prevent tunnelling even after a stalled frame or sprinting.
        const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .15));
        for (let i = 0; i < n; i++) {
            if (isWalkable(position.x + dx / n, position.z)) position.x += dx / n;
            if (isWalkable(position.x, position.z + dz / n)) position.z += dz / n;
        }
    }
    const key = (x, z) => `${x},${z}`;
    function nearest(point) {
        const base = point.map(v => Math.round(v / cell));
        for (let r = 0; r < 30; r++) {
            let best = null, distance = Infinity;
            for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
                const x = (base[0] + dx) * cell, z = (base[1] + dz) * cell;
                const d = Math.hypot(point[0] - x, point[1] - z);
                if (d < distance && isWalkable(x, z, clearance + .12)) { best = [base[0] + dx, base[1] + dz]; distance = d; }
            }
            if (best) return best;
        }
        throw new Error(`No pedestrian access near ${point}`);
    }
    function plan(startPoint, endPoint) {
        const start = nearest(startPoint), end = nearest(endPoint);
        const startKey = key(...start), endKey = key(...end);
        const open = [{ p: start, k: startKey, f: 0 }], costs = new Map([[startKey, 0]]), from = new Map();
        const closed = new Set();
        while (open.length) {
            let min = 0;
            for (let i = 1; i < open.length; i++) if (open[i].f < open[min].f) min = i;
            const current = open.splice(min, 1)[0];
            if (closed.has(current.k)) continue;
            if (current.k === endKey) {
                const points = [end.map(v => v * cell)];
                let k = endKey;
                while (from.has(k)) { const parent = from.get(k); points.push(parent.p.map(v => v * cell)); k = parent.k; }
                points.reverse();
                // Visibility pruning is safe: never smooth a corner through a tree.
                const simplified = [points[0]];
                for (let i = 0; i < points.length - 1;) {
                    let j = points.length - 1;
                    while (j > i + 1 && !segmentClear(points[i], points[j], clearance + .12)) j--;
                    simplified.push(points[j]); i = j;
                }
                return simplified;
            }
            closed.add(current.k);
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
                const p = [current.p[0] + dx, current.p[1] + dz], k = key(...p);
                if (closed.has(k) || !isWalkable(p[0] * cell, p[1] * cell, clearance + .12)) continue;
                if (!segmentClear(current.p.map(v => v * cell), p.map(v => v * cell), clearance + .12)) continue;
                const g = costs.get(current.k) + Math.hypot(dx, dz);
                if (g >= (costs.get(k) ?? Infinity)) continue;
                costs.set(k, g); from.set(k, { p: current.p, k: current.k });
                open.push({ p, k, f: g + Math.hypot(p[0] - end[0], p[1] - end[1]) });
            }
        }
        throw new Error(`No collision-free route from ${startPoint} to ${endPoint}`);
    }
    function tour(waypoints) {
        const points = [];
        for (let i = 0; i < waypoints.length; i++) {
            const leg = plan(waypoints[i], waypoints[(i + 1) % waypoints.length]);
            points.push(...(i ? leg.slice(1) : leg));
        }
        const lengths = [0];
        for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
        const length = lengths.at(-1);
        if (!(length > 1e-6)) throw new Error('A tour needs at least two distinct reachable stops');
        function at(distance) {
            const d = ((distance % length) + length) % length;
            let i = 1;
            while (i < lengths.length - 1 && lengths[i] < d) i++;
            const f = (d - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
            return points[i - 1].map((v, axis) => v + (points[i][axis] - v) * f);
        }
        return { points, length, at, validate: () => points.every((p, i) => !i || segmentClear(points[i - 1], p, clearance + .08)) };
    }
    return { isWalkable, segmentClear, move, plan, tour, clearance };
}
