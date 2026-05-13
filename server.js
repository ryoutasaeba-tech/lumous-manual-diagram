const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 3456;
const PROJECT_DIR = __dirname;

// Dropbox共有フォルダのパス（存在すればDropbox経由で同期）
const DROPBOX_DATA_PATHS = [
    '/mnt/c/Users/ryota/Dropbox/LUMOUS_SYSTEM/lumous-manual-diagram/user-data.json',  // WSL
    'C:\\Users\\ryota\\Dropbox\\LUMOUS_SYSTEM\\lumous-manual-diagram\\user-data.json',  // Windows
];
function getDataPath() {
    for (const p of DROPBOX_DATA_PATHS) {
        try { if (fs.existsSync(p)) return p; } catch (_) {}
    }
    return path.join(PROJECT_DIR, 'user-data.json');
}

const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
    // API: Save data + git backup
    if (req.method === 'POST' && req.url === '/api/backup') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                // Save user data to JSON file (Dropbox共有対応)
                const data = JSON.parse(body);
                const dataPath = getDataPath();
                fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');
                // ローカルにもコピーを保存
                const localPath = path.join(PROJECT_DIR, 'user-data.json');
                if (dataPath !== localPath) {
                    fs.writeFileSync(localPath, JSON.stringify(data, null, 2), 'utf-8');
                }

                // Git add, commit, push
                const timestamp = new Date().toLocaleString('ja-JP');
                execSync('git add -A', { cwd: PROJECT_DIR });

                // Check if there are changes to commit
                try {
                    execSync('git diff --cached --quiet', { cwd: PROJECT_DIR });
                    // No changes
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: '変更なし（既に最新です）' }));
                    return;
                } catch (_) {
                    // There are changes, proceed with commit
                }

                execSync(`git commit -m "backup: ${timestamp}"`, { cwd: PROJECT_DIR });
                execSync('git push origin master', { cwd: PROJECT_DIR });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: `GitHubにバックアップしました (${timestamp})` }));
            } catch (e) {
                console.error('Backup error:', e.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'バックアップ失敗: ' + e.message }));
            }
        });
        return;
    }

    // API: Restore data from JSON (Dropbox共有対応)
    if (req.method === 'GET' && req.url === '/api/restore') {
        const dataPath = getDataPath();
        if (fs.existsSync(dataPath)) {
            const data = fs.readFileSync(dataPath, 'utf-8');
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(data);
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(null));
        }
        return;
    }

    // API: 動画エクスポート (バイナリストリーミング受信)
    if (req.method === 'POST' && req.url.startsWith('/api/save-video')) {
        try {
            const u = new URL(req.url, 'http://localhost');
            const id = u.searchParams.get('id');
            const mime = req.headers['content-type'] || 'video/mp4';
            if (!id) { res.writeHead(400); res.end('id required'); return; }
            const ext = mime.includes('mp4') ? 'mp4' : mime.includes('webm') ? 'webm' : mime.includes('quicktime') ? 'mov' : 'mp4';
            const VID_DIR = '/home/ryota/lumous-manual-public/videos';
            fs.mkdirSync(VID_DIR, { recursive: true });
            const outPath = path.join(VID_DIR, `${id}.${ext}`);
            const ws = fs.createWriteStream(outPath);
            let size = 0;
            req.on('data', c => size += c.length);
            req.pipe(ws);
            ws.on('finish', () => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, ext, size }));
            });
            ws.on('error', e => { res.writeHead(500); res.end(e.message); });
        } catch (e) { res.writeHead(500); res.end(e.message); }
        return;
    }

    // API: 既にエクスポート済みの動画ID一覧 (スキップ用)
    if (req.method === 'GET' && req.url === '/api/saved-videos') {
        try {
            const VID_DIR = '/home/ryota/lumous-manual-public/videos';
            const files = fs.existsSync(VID_DIR) ? fs.readdirSync(VID_DIR) : [];
            const ids = files.map(f => f.replace(/\.(mp4|webm|mov)$/, ''));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(ids));
        } catch (e) { res.writeHead(500); res.end(e.message); }
        return;
    }

    // GET: 動画一括エクスポートページ
    if (req.method === 'GET' && req.url === '/export-videos') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>動画エクスポート</title>
<style>body{font-family:sans-serif;max-width:700px;margin:40px auto;padding:20px}
.log{background:#f0f0f0;padding:10px;border-radius:6px;height:400px;overflow:auto;font-family:monospace;font-size:12px}
.progress{height:24px;background:#eee;border-radius:12px;overflow:hidden;margin:10px 0}
.bar{height:100%;background:#c39f59;transition:width .3s;text-align:center;color:white;line-height:24px}
button{padding:10px 20px;background:#685021;color:white;border:none;border-radius:6px;cursor:pointer}</style>
</head><body>
<h1>📹 動画エクスポート</h1>
<p>IndexedDBの動画を~/lumous-manual-public/videos/ に書き出します。</p>
<button id="go">開始</button>
<div class="progress"><div class="bar" id="bar" style="width:0%">0%</div></div>
<div class="log" id="log"></div>
<script>
const log = (m) => { document.getElementById('log').innerHTML += m + '<br>'; document.getElementById('log').scrollTop = 99999; };
document.getElementById('go').onclick = async () => {
  log('既存ファイルチェック...');
  const already = new Set(await (await fetch('/api/saved-videos')).json());
  log(\`既にエクスポート済み: \${already.size}件\`);
  log('IndexedDBを開く...');
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('lumous-videos', 1);
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e);
    r.onupgradeneeded = e => e.target.result.createObjectStore('videos');
  });
  const keys = await new Promise((res, rej) => {
    const r = db.transaction('videos','readonly').objectStore('videos').getAllKeys();
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e);
  });
  log(\`全動画: \${keys.length}件 / 未処理: \${keys.length - already.size}件\`);
  let saved = 0, totalSize = 0, skipped = 0;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (already.has(key)) { skipped++; continue; }
    try {
      // 1件ずつ取得
      const dataUrl = await new Promise((res, rej) => {
        const r = db.transaction('videos','readonly').objectStore('videos').get(key);
        r.onsuccess = e => res(e.target.result);
        r.onerror = e => rej(e);
      });
      // data URL → Blob (バイナリ、文字列の二重コピー回避)
      const blobResp = await fetch(dataUrl);
      const blob = await blobResp.blob();
      // dataUrl 参照を解放したいので即fetch
      const resp = await fetch('/api/save-video?id=' + encodeURIComponent(key), {
        method:'POST',
        headers:{'Content-Type': blob.type || 'video/mp4'},
        body: blob
      });
      const j = await resp.json();
      if (j.ok) { saved++; totalSize += j.size; log(\`  ✓ \${key}.\${j.ext} (\${(j.size/1024/1024).toFixed(1)}MB)\`); }
      else log(\`  ✗ \${key}: \${JSON.stringify(j)}\`);
    } catch(e) { log(\`  ✗ \${key}: \${e.message}\`); }
    const pct = Math.round((i+1)/keys.length*100);
    document.getElementById('bar').style.width = pct + '%';
    document.getElementById('bar').textContent = pct + '%';
    await new Promise(r => setTimeout(r, 100));
  }
  log(\`<b>完了: 新規 \${saved}件 / スキップ \${skipped}件 (新規分: \${(totalSize/1024/1024).toFixed(1)}MB)</b>\`);
};
</script></body></html>`);
        return;
    }

    // API: Download HTML file
    if (req.method === 'POST' && req.url === '/api/download-html') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const htmlContent = data.html || '';
                const fileName = (data.fileName || 'manual.html').replace(/[^a-zA-Z0-9\u3000-\u9FFF\u30A0-\u30FF\u3040-\u309F._\-]/g, '_');
                // Save a debug copy
                try { fs.writeFileSync(path.join(PROJECT_DIR, 'last-download.html'), htmlContent, 'utf-8'); } catch (_) {}
                res.writeHead(200, {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Content-Disposition': 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(fileName)
                });
                res.end(htmlContent);
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // Static files
    let filePath = path.join(PROJECT_DIR, req.url === '/' ? 'index.html' : req.url);
    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'text/plain';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }
        res.writeHead(200, {
            'Content-Type': contentType + '; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        res.end(content);
    });
});

server.listen(PORT, () => {
    console.log(`LUMOUS Manual Diagram Maker running at http://localhost:${PORT}`);
});
