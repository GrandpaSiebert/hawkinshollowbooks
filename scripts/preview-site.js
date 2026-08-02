const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'build');
const port = 8080;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const requestUrl = req.url || '/';
  const urlPath = requestUrl.split('?')[0].split('#')[0];
  const requestPath = urlPath === '/' ? '/index.html' : urlPath;
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch (error) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  const safePath = path.normalize(decodedPath).replace(/^\/+/, '');
  const filePath = path.join(root, safePath);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`Preview server running at http://localhost:${port}/`);
});
