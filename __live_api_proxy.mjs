import http from 'node:http';

const TARGET = 'https://opside-node-api-woco.onrender.com';
const PORT = 3001;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', TARGET);
    const headers = { ...req.headers };
    delete headers.host;
    const method = req.method || 'GET';

    const body = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
      req.on('error', reject);
    });

    const upstream = await fetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      redirect: 'manual',
    });

    res.statusCode = upstream.status;
    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'content-encoding') return;
      res.setHeader(key, value);
    });

    const arrayBuffer = await upstream.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (error) {
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Proxy failure' }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Live API proxy listening on http://127.0.0.1:${PORT}`);
});
