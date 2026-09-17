function createNotices(send) {
  const items = new Map();
  return {
    add(id, notice) {
      items.set(id, { id, ...notice });
      send('app:notice', { id, ...notice });
    },
    remove(id) {
      if (items.delete(id)) send('app:notice', { id, removed: true });
    },
    dismiss(id) {
      items.delete(id);
      return true;
    },
    list() {
      return [...items.values()];
    }
  };
}

module.exports = { createNotices };
