const v = require('../validate');

function registerUpdates(ctx, handle) {
  handle('updates:status', () => ctx.updater.status());
  handle('updates:check', async () => {
    await ctx.updater.check({ manual: true });
    return ctx.updater.status();
  });
  handle('updates:download', () => ctx.updater.download());
  handle('updates:install', () => ctx.installUpdate());
  handle('updates:dismiss', (version) => {
    ctx.updater.dismiss(v.text(version, { min: 1, max: 32 }));
    return true;
  });
  handle('app:cancel-finish-action', () => ctx.power?.cancelCountdown() ?? false);
}

function bridgeUpdates(ctx) {
  const onStatus = (status) => ctx.send('updates:status', status);
  ctx.updater.on('status', onStatus);
  return () => ctx.updater.off('status', onStatus);
}

module.exports = { registerUpdates, bridgeUpdates };
