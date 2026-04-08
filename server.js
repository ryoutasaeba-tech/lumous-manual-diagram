const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 3456;
const PROJECT_DIR = __dirname;

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
                // Save user data to JSON file
                const data = JSON.parse(body);
                fs.writeFileSync(path.join(PROJECT_DIR, 'user-data.json'), JSON.stringify(data, null, 2), 'utf-8');

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

    // API: Restore data from JSON
    if (req.method === 'GET' && req.url === '/api/restore') {
        const dataPath = path.join(PROJECT_DIR, 'user-data.json');
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
        res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
        res.end(content);
    });
});

server.listen(PORT, () => {
    console.log(`LUMOUS Manual Diagram Maker running at http://localhost:${PORT}`);
});
