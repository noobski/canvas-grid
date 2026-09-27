// Minimal static server for the built Angular app (Railway runs `npm start`).
const express = require('express');
const path = require('path');

const app = express();
const dist = path.join(__dirname, 'dist', 'canvas-grid', 'browser');
const port = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(
  express.static(dist, {
    maxAge: '1y',
    setHeaders(res, filePath) {
      // index/manifest must always be fresh so new deploys show up
      if (/index\.html$|manifest\.webmanifest$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }),
);

app.get('/healthz', (_req, res) => res.send('ok'));

// SPA fallback
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(dist, 'index.html'));
});

app.listen(port, '0.0.0.0', () => console.log(`canvas-grid listening on ${port}`));
