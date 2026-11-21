(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetFoodScatter = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const metrics = {
    protein: { label: '粗蛋白', unit: '%', default: 35, max: 100 },
    fat: { label: '粗脂肪', unit: '%', default: 15, max: 100 },
    pricePerJin: { label: '参考单价', unit: '元/斤', default: 40, max: null },
    conditionScore: { label: '条件匹配（非质量分）', unit: '/100', default: 50, max: 100 }
  };
  function step(span) {
    if (span <= 0) return 1;
    const raw = span / 6, scale = 10 ** Math.floor(Math.log10(raw)), factor = raw / scale;
    return (factor <= 1 ? 1 : factor <= 2 ? 2 : factor <= 5 ? 5 : 10) * scale;
  }
  function domain(values, reference, metric) {
    const low = Math.min(...values, reference), high = Math.max(...values, reference);
    const padding = Math.max(metric.max === 100 ? 2.5 : 1, (high - low) * .06);
    const tickStep = metric.max === 100 ? (high - low > 40 ? 10 : 5) : step(high - low + padding * 2);
    const min = Math.max(0, Math.floor((low - padding) / tickStep) * tickStep);
    const max = Math.min(metric.max ?? Infinity, Math.ceil((high + padding) / tickStep) * tickStep);
    return { min, max: max > min ? max : min + tickStep, step: tickStep };
  }
  function points(rows, chart) { return rows.filter(p => Number.isFinite(p[chart.x]) && Number.isFinite(p[chart.y])); }
  function productLabel(p) {
    if(p.presentation?.title)return p.presentation.title;
    return p.flavor && !p.product.includes(p.flavor) ? `${p.product} · ${p.flavor}` : p.product;
  }
  function priceLimit(rows, low = '', high = '') {
    return Math.max(1, Math.ceil(Math.max(0, ...rows.map(p => Number.isFinite(p.pricePerJin) ? p.pricePerJin : 0), Number(low) || 0, Number(high) || 0) / 10) * 10);
  }
  function radius(group, mode, maximum) {
    if (mode !== 'pricePerJin') return group.length > 1 ? Math.min(14, 6 + Math.sqrt(group.length) * 1.8) : 5;
    const values = group.map(p => p.pricePerJin).filter(Number.isFinite);
    if (!values.length) return 5;
    const mean = values.reduce((a,b) => a+b,0) / values.length;
    // Circle area, not radius, scales with price; a minimum area keeps true zero visible.
    return Math.sqrt(25 + 200 * mean / Math.max(1, maximum));
  }
  const palette = ['#2c7d65','#d95d39','#345d72','#9c6caa','#b18c28','#38889c','#aa526f','#64853a','#6c6cad','#9b603a','#527d91','#777777'];
  function color(category, categories, mode) {
    if (mode === 'imported') return category === '进口' ? '#d95d39' : category === '国产' ? '#2c7d65' : '#8d9792';
    return palette[Math.max(0,categories.indexOf(category)) % palette.length];
  }
  return { metrics, domain, points, productLabel, priceLimit, radius, color };
});
