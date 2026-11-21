import app, { worldManager } from './app.js';
import { PORT } from './config.js';

const server = app.listen(PORT, () => {
  console.log(`CityZen server running on http://localhost:${PORT}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other server, or restart with \`npm run dev\` (it frees the port first).`);
    process.exit(1);
  }
  throw err;
});

// Release the port promptly when tsx watch restarts us or on Ctrl+C, so the
// next run doesn't find it still taken.
let shuttingDown = false;
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  worldManager.shutdown();
  server.close(() => process.exit(0));
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
