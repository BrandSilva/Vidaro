const { ipcMain, app } = require('electron');
const { ValidationError } = require('./validate');

const DEV_ORIGIN = 'http://localhost:5173/';
const registered = new Set();

function isTrustedSender(event) {
  const url = event.senderFrame?.url || '';
  if (app.isPackaged) return url.startsWith('file://');
  return url.startsWith(DEV_ORIGIN) || url.startsWith('file://');
}

function publicError(error) {
  if (error instanceof ValidationError) return new Error(error.message);
  if (error && error.expose) return new Error(error.message);
  return new Error('The request could not be completed.');
}

function handle(channel, fn) {
  if (registered.has(channel)) throw new Error(`Duplicate IPC channel ${channel}`);
  registered.add(channel);
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender');
    try {
      return await fn(...args);
    } catch (error) {
      throw publicError(error);
    }
  });
}

function exposed(message) {
  const error = new Error(message);
  error.expose = true;
  return error;
}

function registerIpc(ctx, modules) {
  for (const register of modules) register(ctx, handle);
}

function unregisterIpc() {
  for (const channel of registered) ipcMain.removeHandler(channel);
  registered.clear();
}

module.exports = { registerIpc, unregisterIpc, exposed };
