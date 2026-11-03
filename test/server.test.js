// 実行: node --test test/
// 本番は動かしません。/api/backup（git push する所）は呼びません。
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpVideos = fs.mkdtempSync(path.join(os.tmpdir(), 'lumous-vid-'));
process.env.LUMOUS_VIDEO_DIR = tmpVideos;
const { server } = require('../server.js');

let port;
test.before(() => new Promise(r => server.listen(0, '127.0.0.1', () => { port = server.address().port; r(); })));
test.after(() => { server.close(); fs.rmSync(tmpVideos, { recursive: true, force: true }); });

function req(method, p, body) {
    return new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { 'Content-Type': 'video/mp4' } }, res => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
        });
        r.on('error', reject);
        if (body) r.write(body);
        r.end();
    });
}

test('トップページが見られる（?付きでも）', async () => {
    assert.strictEqual((await req('GET', '/')).status, 200);
    assert.strictEqual((await req('GET', '/index.html?v=1')).status, 200);
});

test('フォルダの外のファイルは見られない', async () => {
    for (const p of ['/../../etc/passwd', '/..%2f..%2fetc/passwd', '/%2e%2e/%2e%2e/etc/passwd']) {
        const r = await req('GET', p);
        assert.ok([403, 404].includes(r.status), p + ' -> ' + r.status);
        assert.ok(!r.body.includes('root:'), p);
    }
});

test('.git の中は見られない', async () => {
    assert.strictEqual((await req('GET', '/.git/config')).status, 403);
});

test('動画の id に ../ は使えない', async () => {
    const r = await req('POST', '/api/save-video?id=' + encodeURIComponent('../../evil'), 'x');
    assert.strictEqual(r.status, 400);
    assert.ok(!fs.existsSync(path.join(tmpVideos, '..', '..', 'evil.mp4')));
});

test('ふつうの動画 id は保存できる', async () => {
    const r = await req('POST', '/api/save-video?id=video_123-a', 'abc');
    assert.strictEqual(r.status, 200);
    assert.ok(fs.existsSync(path.join(tmpVideos, 'video_123-a.mp4')));
    const list = JSON.parse((await req('GET', '/api/saved-videos')).body);
    assert.deepStrictEqual(list, ['video_123-a']);
});
