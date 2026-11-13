#!/usr/bin/env node
// Rebuild a single-file copy which works offline when opened via file://.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const toolsRoot = path.resolve(process.env.SANTA_EXPORT_TOOLS || '/workspace/santa-export');

function usage() {
    console.log('Usage: node _check/export.cjs [--output /path/to/winterdorp.html]');
    console.log('Default output: /tmp/santa-export/winterdorp.html');
    console.log('SANTA_EXPORT_TOOLS selects the directory containing node_modules/esbuild and node_modules/three.');
}

function options(args) {
    let output = '/tmp/santa-export/winterdorp.html';
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--help' || args[i] === '-h') { usage(); return null; }
        if (args[i] === '--output') {
            if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--output needs a file path');
            output = args[++i];
        } else if (args[i].startsWith('--output=')) {
            output = args[i].slice('--output='.length);
            if (!output) throw new Error('--output needs a file path');
        } else throw new Error(`Unknown argument: ${args[i]}`);
    }
    return { output: path.resolve(output) };
}

const mimeTypes = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.avif': 'image/avif'
};

async function main() {
    const settings = options(process.argv.slice(2));
    if (!settings) return;
    let esbuild;
    try { esbuild = require(require.resolve('esbuild', { paths: [toolsRoot, root] })); }
    catch { throw new Error(`Export tooling is missing: install esbuild and three in ${toolsRoot}, or set SANTA_EXPORT_TOOLS.`); }

    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const modulePattern = /<script\b[^>]*\btype=["']module["'][^>]*>([\s\S]*?)<\/script\s*>/i;
    const match = html.match(modulePattern);
    if (!match) throw new Error('index.html has no inline module entry');
    const embedded = new Set();
    const assetURL = /new\s+URL\(\s*(["'])(\.\/assets\/[^"']+)\1\s*,\s*import\.meta\.url\s*\)\.href/g;
    const result = await esbuild.build({
        stdin: { contents: match[1], resolveDir: root, sourcefile: 'santa-entry.js' },
        bundle: true, write: false, format: 'iife', minify: true,
        target: ['chrome110', 'firefox115', 'safari16'], legalComments: 'inline',
        nodePaths: [path.join(toolsRoot, 'node_modules')],
        plugins: [{
            name: 'embed-local-images',
            setup(build) {
                build.onLoad({ filter: /\.m?js$/ }, args => {
                    if (!args.path.startsWith(`${root}${path.sep}`)) return;
                    const source = fs.readFileSync(args.path, 'utf8');
                    const contents = source.replace(assetURL, (_expression, _quote, relative) => {
                        const asset = path.resolve(path.dirname(args.path), relative);
                        if (!asset.startsWith(`${root}${path.sep}`)) throw new Error(`Asset escapes checkout: ${relative}`);
                        const mime = mimeTypes[path.extname(asset).toLowerCase()];
                        if (!mime) throw new Error(`Unsupported offline image type: ${relative}`);
                        const dataURL = `data:${mime};base64,${fs.readFileSync(asset).toString('base64')}`;
                        embedded.add(path.relative(root, asset));
                        return JSON.stringify(dataURL);
                    });
                    return { contents, loader: 'js' };
                });
            }
        }]
    });
    if (result.warnings.length) throw new Error(`Export warnings require review: ${result.warnings.map(w => w.text).join('; ')}`);
    const bundle = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
    const output = html
        .replace(/\s*<script\b[^>]*\btype=["']importmap["'][^>]*>[\s\S]*?<\/script\s*>/gi, '')
        .replace(modulePattern, () => `<script>${bundle}</script>`);
    if (/<script\b[^>]*\b(?:src=|type=["'](?:module|importmap)["'])/i.test(output)) throw new Error('The export still contains an external or module script');
    fs.mkdirSync(path.dirname(settings.output), { recursive: true });
    fs.writeFileSync(settings.output, output);
    console.log(JSON.stringify({ output: settings.output, bytes: Buffer.byteLength(output), embeddedImages: [...embedded], warnings: 0 }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
