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
