// Public catalog chunks are immutable and requested only for the visible view.
const publicMobileDetails = (() => {
  const loaded = new Set(), pending = new Map(), failed = new Set();
  const intel = {brands:{}, factories:{}};
  const files = mobileCatalog.detailFiles;
  function needed(route, selected) {
    if (route.page === 'entity') return [mobileCatalog.intelFile];
    if (route.page === 'compare' && selected.length === 2) return [...new Set(selected.map(id => files[id]))];
    if (route.page === 'detail') return [files[route.sku], ...(route.tab === 2 ? [mobileCatalog.intelFile] : [])];
    return [];
  }
  async function read(file, bySku) {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000 + attempt * 10000);
      try {
        const response = await fetch(file, {signal:controller.signal, cache:attempt ? 'reload' : 'default'});
        if (!response.ok) throw Error('读取失败');
        const data = await response.json();
        if (data.revision !== mobileCatalog.revision) throw Error('版本不匹配');
        if (file === mobileCatalog.intelFile) {
          if (!data.intel?.brands || !data.intel?.factories) throw Error('档案不完整');
          Object.assign(intel, data.intel);
        } else {
          const ids = Object.keys(files).filter(id => files[id] === file);
          if (!ids.length || !ids.every(id => data.details?.[id])) throw Error('配方不完整');
          for (const id of ids) Object.assign(bySku.get(id).item, data.details[id]);
        }
        loaded.add(file);
        return;
      } catch (error) {
        if (attempt >= 1) throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  function prepare(route, selected, bySku, render) {
    const missing = needed(route, selected).filter(file => !loaded.has(file));
    if (missing.some(file => failed.has(file))) return 'error';
    for (const file of missing) {
      if (pending.has(file)) continue;
      pending.set(file, read(file, bySku).catch(() => failed.add(file)).finally(() => {
        pending.delete(file);
        render();
      }));
    }
    return missing.length ? 'loading' : 'ready';
  }
  return {prepare, intel, retry() { failed.clear(); }};
})();
