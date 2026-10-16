(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetFoodAttributes = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const defaults = () => ({ comparison_tags: [], comparison_note: '' });
  function parse(tags, note) {
    const groups = [...new Set(tags.split(/[,，;；\n]+/u).map(s => s.trim()).filter(Boolean))];
    if (groups.length > 10 || groups.some(s => s.length > 30 || /[\x00-\x1f\x7f]/.test(s))) throw new Error('我的分组最多10个，每个不超过30字。');
    if (note.length > 1000 || note.includes('\x00')) throw new Error('对比备注最多1000字。');
    return { comparison_tags: groups, comparison_note: note.trim() };
  }
  function values(p) { return { ...defaults(), ...p.attributes }; }
  function changes(p, next) {
    const current = values(p);
    return Object.fromEntries(Object.entries(next).filter(([k,v]) => JSON.stringify(current[k]) !== JSON.stringify(v)));
  }
  function display(value) { return Array.isArray(value) ? value.join('、') || '未分组' : value || '未填写'; }
  return { defaults, parse, values, changes, display };
});

;
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetFoodNutrition = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const comparator = {'≥':'ge','>=':'ge','>':'strict_ge','≤':'le','<=':'le','<':'strict_le','=':'eq','＝':'eq'};
  const labels = {
    phosphorus: '磷',
    chloride: '水溶性氯化物',
    animalIngredient: '动物性原料占比',
    animalProtein: '动物性蛋白占总蛋白'
  };

  function basis(raw) {
    const value = String(raw ?? '').normalize('NFKC');
    if (/干物质|dry\s*matter|DM\b/i.test(value)) return 'dry_matter';
    if (/原物质|原物|鲜物|as[-\s]?fed/i.test(value)) return 'as_fed';
    return 'unknown';
  }

  function segment(raw, key) {
    const text = String(raw ?? '').normalize('NFKC');
    const pattern = key === 'chloride' ? /水溶性氯化物/i : /(?:总磷|磷)(?!酸)/i;
    return text.split(/[;；。]/).find(part => pattern.test(part)) || '';
  }

  function guarantee(raw, key) {
    const source = segment(raw, key);
    if (!source) return {key, label: labels[key], value: null, status: 'missing', comparable: false, raw: String(raw ?? '')};
    const pattern = key === 'chloride'
      ? /水溶性氯化物[^≤＜<≥＞>=＝]*?([≤＜<≥＞>=＝])?\s*(\d+(?:\.\d+)?)\s*(%|mg\/kg)?/i
      : /(?:总磷|磷)(?!酸)[^≤＜<≥＞>=＝]*?([≤＜<≥＞>=＝])?\s*(\d+(?:\.\d+)?)\s*(%|mg\/kg)?/i;
    const match = source.match(pattern);
    if (!match) return {key, label: labels[key], value: null, status: 'raw_only', comparable: false, raw: source, basis: basis(raw)};
    const comp = comparator[match[1] || ''];
    const unit = match[3] || 'unknown';
    const b = basis(raw);
    const value = Number(match[2]);
    const strict = comp === 'strict_ge' || comp === 'strict_le';
    const comparable = !strict && ['ge','le','eq'].includes(comp) && ['%','mg/kg'].includes(unit) && b !== 'unknown';
    return {key, label: labels[key], value, comparator: comp || 'unknown', comparatorText: match[1] || '未标比较符', unit,
      basis: b, comparable, status: comparable ? (comp === 'ge' ? 'lower_bound' : 'bounded') : 'partial', raw: source,
      low: comp === 'le' ? 0 : value, high: comp === 'ge' ? Infinity : value};
  }

  function ratio(raw, key, inputs) {
    const source = String(raw ?? '').trim();
    const unitKey = key === 'animalIngredient' ? 'animalIngredientUnit' : 'animalProteinUnit';
    const denominatorKey = key === 'animalIngredient' ? 'animalIngredientDenominator' : 'animalProteinDenominator';
    const unit = inputs?.[unitKey] || 'unknown';
    const denominator = inputs?.[denominatorKey] || 'unknown';
    const match = source.normalize('NFKC').match(/^\s*(\d+(?:\.\d+)?)\s*(%)?\s*$/);
    if (!source) return {key, label: labels[key], value: null, status: 'missing', comparable: false, raw: source, unit, denominator};
    if (!match) return {key, label: labels[key], value: null, status: 'raw_only', comparable: false, raw: source, unit, denominator};
    const rawValue=Number(match[1]);
    const inferredFraction=!match[2] && rawValue>=0 && rawValue<=1;
    const displayValue=match[2] ? rawValue : inferredFraction ? rawValue*100 : rawValue;
    if (!['fraction','percent'].includes(unit) || denominator === 'unknown')
      return {key, label: labels[key], value: displayValue <= 100 ? displayValue : null, status: 'partial', comparable: false, raw: source, unit:'%', denominator, basis:'unknown'};
    if (match[2] && unit !== 'percent') return {key, label: labels[key], value: null, status: 'conflict', comparable: false, raw: source, unit, denominator};
    const value = Number(match[1]) * (unit === 'fraction' ? 100 : 1);
    return {key, label: labels[key], value: value <= 100 ? value : null, status: value <= 100 ? 'comparable' : 'conflict',
      comparable: value <= 100, raw: source, unit, denominator};
  }

  function metrics(product) { if(product.publicDerived) return product.publicDerived.nutrition;
    const details = product?.details || {};
    const inputs = product?.analysisInputState === 'current' ? product.analysisInputs : null;
    const phosphorus = guarantee(details.other_guaranteed_analysis_raw, 'phosphorus');
    const chloride = guarantee(details.other_guaranteed_analysis_raw, 'chloride');
    const animalIngredient = ratio(details.animal_ingredient_ratio_raw, 'animalIngredient', inputs);
    const animalProtein = ratio(details.animal_protein_ratio_raw, 'animalProtein', inputs);
    const proteinBasis = inputs?.nutritionBasis || 'unknown';
    const animalProteinDensity = animalProtein.comparable && Number.isFinite(product?.protein) && proteinBasis !== 'unknown'
      ? {value: product.protein * animalProtein.value / 100, unit: '%总饲料', status: 'derived', comparable: true, basis: proteinBasis}
      : {value: null, unit: '%总饲料', status: 'not_derived', comparable: false, basis: proteinBasis};
    return {phosphorus, chloride, animalIngredient, animalProtein, animalProteinDensity,
      chlorideSignals: {sodiumChloride: /氯化钠|NaCl/i.test(details.additives_raw || ''), potassiumChloride: /氯化钾|KCl/i.test(details.additives_raw || '')}};
  }

  function inRange(value, low = '', high = '') {
    if (low === '' && high === '') return true;
    return value !== null && Number.isFinite(value) && (low === '' || value >= Number(low)) && (high === '' || value <= Number(high));
  }

  function matchMetric(metric, mode, low, high) {
    if (!mode) return true;
    if (mode === 'unknown') return !metric.comparable;
    if (mode === 'bounded') return metric.comparable && (metric.comparator === 'le' || metric.comparator === 'eq') && inRange(metric.value, low, high);
    if (mode === 'declared') return metric.value !== null && inRange(metric.value, low, high);
    if (mode === 'comparable') return metric.comparable && inRange(metric.value, low, high);
    return true;
  }

  function matches(product, query) {
    const m = metrics(product);
    return matchMetric(m.phosphorus, query.phosphorusMode, query.phosphorusMin, query.phosphorusMax) &&
      matchMetric(m.chloride, query.chlorideMode, query.chlorideMin, query.chlorideMax) &&
      matchMetric(m.animalIngredient, query.animalIngredientMode, query.animalIngredientMin, query.animalIngredientMax) &&
      matchMetric(m.animalProtein, query.animalProteinMode, query.animalProteinMin, query.animalProteinMax);
  }

  function display(metric) {
    if (!metric || metric.status === 'missing') return '未记录';
    if (metric.value === null) return `原文：${metric.raw || '未记录'}（${metric.status === 'partial' ? '口径不完整' : '暂不可比'}）`;
    const suffix = metric.unit && metric.unit !== 'unknown' ? metric.unit : '';
    const basisText = metric.basis === 'dry_matter' ? '干物质' : metric.basis === 'as_fed' ? '原物' : '基准未标明';
    return `${metric.comparatorText || ''}${metric.value}${suffix} · ${basisText}${metric.status === 'lower_bound' ? ' · 最低保证值' : ''}`;
  }

  function rowSummary(product) {
    const m = metrics(product);
    return `磷：${display(m.phosphorus)}；氯化物：${display(m.chloride)}；动物原料：${display(m.animalIngredient)}；动物蛋白：${display(m.animalProtein)}`;
  }

  return {labels, basis, guarantee, ratio, metrics, matches, matchMetric, display, rowSummary};
});

;
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./nutrition-compare.js'), () => require('./query.js'));
  else root.PetFoodSorting = factory(root.PetFoodNutrition, () => root.PetFoodQuery);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (nutrition, getQuery) {
  'use strict';
  // A read-only projection of current records, never a new product fact.
  const definitions = [
    ['protein','粗蛋白','%',null,'protein'], ['fat','粗脂肪','%',null,'fat'],
    ['price','参考价格（元/斤）','元/斤',null,'pricePerJin'],
    ['pagePrice','页面价格（元）','元',null,'pagePriceRaw'],
    ['phosphorus','磷','%','总磷|磷'], ['chloride','水溶性氯化物','%','水溶性氯化物'],
    ['moisture','水分','%','水分'], ['calcium','钙','%','总钙|钙'],
    ['fiber','粗纤维','%','粗纤维'], ['ash','粗灰分','%','粗灰分'],
    ['taurine','牛磺酸','%','牛磺酸(?:含量)?'],
    ['omega3','Omega-3','%','Omega-?3(?:脂肪酸)?|Ω-?3|欧米伽3(?:脂肪酸)?'],
    ['omega6','Omega-6','%','Omega-?6(?:脂肪酸)?|Ω-?6|欧米伽6(?:脂肪酸)?'],
    ['dha','DHA','%','DHA'], ['epa','EPA','%','EPA'], ['epaDha','EPA+DHA','%','EPA\\+DHA'],
    ['lysine','赖氨酸','%','赖氨酸'], ['arginine','精氨酸','%','精氨酸'],
    ['methionine','蛋氨酸','%','蛋氨酸'], ['linoleic','亚油酸','%','亚油酸'],
    ['alphaLinolenic','α-亚麻酸','%','α-?亚麻酸'], ['arachidonic','花生四烯酸','%','花生四烯酸'],
    ['magnesium','镁','%','镁'], ['iodine','碘','mg/kg','碘'], ['selenium','硒','mg/kg','硒'],
    ['zinc','锌','mg/kg','锌'], ['potassium','钾','%','钾'], ['sodium','钠','%','钠'],
    ['iron','铁','mg/kg','铁'], ['manganese','锰','mg/kg','锰'], ['copper','铜','mg/kg','铜'],
    ['sulfur','硫','%','硫'], ['biotin','生物素','mg/kg','生物素'], ['inositol','肌醇','mg/kg','肌醇'],
    ['vitA','维生素A','IU/kg','维生素A'], ['vitD','维生素D','IU/kg','维生素D3?'],
    ['vitE','维生素E','IU/kg','维生素E'], ['vitC','维生素C','mg/kg','维生素C'],
    ['vitB1','维生素B1','mg/kg','维生素B1(?![0-9])'], ['vitB2','维生素B2','mg/kg','维生素B2'],
    ['vitB6','维生素B6','mg/kg','维生素B6'], ['vitB12','维生素B12','mg/kg','维生素B12'],
    ['energy','能量（页面记录）','kcal/kg','代谢能|卡路里(?:含量)?|能量值|能量密度'],
    ['glucosamine','葡萄糖胺','mg/kg','葡萄糖胺'], ['chondroitin','硫酸软骨素','mg/kg','硫酸软骨素'],
    ['lCarnitine','L-肉碱','mg/kg','L-肉碱'],
    ['animalIngredient','动物性原料占比（原始记录）','',null,'animal_ingredient_ratio_raw'],
    ['animalProtein','动物性蛋白占比（原始记录）','',null,'animal_protein_ratio_raw'],
    ['tractDigest','成品消化率（原始记录）','',null,'total_tract_digestibility_raw'],
    ['pepsinDigest','胃蛋白酶消化率（原始记录）','',null,'pepsin_digestibility_raw']
  ].map(([key,label,unit,aliases,field]) => ({key,label,unit,aliases,field}));
  const byKey = Object.fromEntries(definitions.map(d => [d.key,d]));
  const textDefinitions = [
    ['brand','品牌','brand'], ['product','产品','product'], ['process','工艺','process'],
    ['function','功能','functionRaw'], ['stage','阶段','stage'], ['imported','进口属性','importStatus'],
    ['core','核心产品','core_product_raw'], ['productionMode','生产方式','productionMode'], ['factory','工厂名称','factoryName'],
    // D099：品牌创立 / 工厂成立 / 工厂规模本来也能加入表头显示，但此前不在排序定义里，
    // 点表头会抛「该列不可排序」。这里补上：排序取展示用的短口径（"2007 年" / "12 万吨"），
    // 无记录、DATA_GAP 或只显示"见详情"的按未知处理，排在最后。
    ['brandFounded','品牌创立','brandFoundedShort'],
    ['factoryFounded','工厂成立','factoryFoundedShort'],
    ['factoryScale','工厂规模','factoryScaleShort']
  ].map(([key,label,field]) => ({key,label,field,type:'text'}));
  const textByKey = Object.fromEntries(textDefinitions.map(d => [d.key,d]));
  const textCollator = new Intl.Collator('zh-CN', {numeric:true,sensitivity:'base'});
  const ratioPercentKeys = new Set(['animalIngredient','animalProtein','tractDigest','pepsinDigest']);
  const validSort = key => key === 'source' || key === 'brand' ||
    [...definitions,...textDefinitions].some(d => key === d.key+'-asc' || key === d.key+'-desc');
  const definition = sort => byKey[String(sort).replace(/-(asc|desc)$/,'')] || null;
  const sortDefinition = sort => textByKey[String(sort).replace(/-(asc|desc)$/,'')] || definition(sort);
  const clean = raw => String(raw ?? '').normalize('NFKC').trim();
  const missing = (raw = '', reason = '未记录') => ({value:null,raw,reason,unit:'',comparator:'',basis:'',group:''});
  function sortValue(product, d) {
    if (d.type !== 'text') return metric(product,d.key);
    const sourceFields = {core:'coreRaw',productionMode:'productionMode',factory:'factoryName'};
    const value = clean(sourceFields[d.key] ? getQuery()?.[sourceFields[d.key]](product) : d.key === 'function'
      ? (getQuery()?.functionValueSummary(product) || product.details?.function_raw || product.functionRaw)
      : product[d.field]);
    const unknown = !value || /^[-—–?？\s/]+$/.test(value) ||
      /^(?:unknown|n\/?a|null|undefined|none|待核验|待核实|待确认|待补充|未知|未记录|未提供|未标明|未注明|未明确|不详|暂无|见详情|DATA_GAP)(?:\s*[(:：].*)?$/i.test(value);
    return {value:unknown ? null : value};
  }
  function convert(value, unit, target) {
    const mass = {'%':10000,'mg/kg':1,'g/kg':1000,'ppm':1};
    if (mass[unit] && mass[target]) return {value:value*mass[unit]/mass[target],unit:target};
    const energy = {'kcal/kg':1,'kJ/kg':1/4.184,'kJ/100g':10/4.184,'kcal/100g':10};
    if (energy[unit] && energy[target]) return {value:value*energy[unit]/energy[target],unit:target};
    // IU and mass cannot be interconverted without nutrient-specific facts.
    return {value,unit};
  }
  function declaredText(product) {
    const raw = clean(product.details?.other_guaranteed_analysis_raw);
    return raw.split(/检测\s*\(|冲突版本\s*:|版本[AB]\s*:|主食冻干\s*:/i)[0];
  }
  function basisOf(segment, text, key) {
    if (/除水分外[^;；。]*干物质/.test(text)) return key === 'moisture' ? '基准未标明' : '干物质';
    if (/干物质/.test(segment)) return '干物质';
    if (/原物质|原物|as[- ]?fed/i.test(segment)) return '原物';
    if (/(?:^|[;；。])(?:页面标注)?以干物质计\s*[。;；]?$/.test(text)) return '干物质';
    return '基准未标明';
  }
  function splitGuarantees(raw) {
    // Split enumeration only before a known nutrient, not inside ranges or commentary.
    const names = ['粗蛋白质?', '粗脂肪', ...definitions.filter(d => d.aliases).map(d => d.aliases)].join('|');
    return String(raw ?? '').split(new RegExp('[;；。\\n]+|、(?=(?:' + names + '))', 'i')).map(s => s.trim()).filter(Boolean);
  }
  function guarantee(product, d) {
    const text = declaredText(product);
    const parts = splitGuarantees(text).map(s => s.replace(/^(?:保证值|主食猫粮)\s*:/,''));
    const prefix = new RegExp('^(?:'+d.aliases+')(?![A-Za-z+])(?:\\((?:以?Cl[^)]*计|Ca|min|max|估值)\\))?\\s*:?\\s*','i');
    const hits = parts.filter(s => prefix.test(s));
    const values = hits.map(raw => {
      const amount = raw.replace(prefix,'').match(/^(>=|<=|≥|≤|>|<|=|≈)?\s*(\d+(?:\.\d+)?)\s*(%|mg\/kg|g\/kg|ppm|IU\/kg|kcal(?:\s*ME)?\/kg|kJ(?:\s*ME)?\/(?:kg|100g)|kcal\/100g)\s*(\([^)]*\))?\s*$/i);
      if (!amount || amount[4] && !/^\((?:以?干物质计?|以?原物质计?|页面称以干物质计|除水分外,?其他项目以干物质计|页面\/报告值)\)$/.test(amount[4]))
        return missing(raw,'原文存在范围、多值或说明，未取数');
      const originalUnit = amount[3].replace(/\s*ME/i,'');
      const unit = /^iu/i.test(originalUnit) ? 'IU/kg' : /^kj/i.test(originalUnit) ? originalUnit.replace(/^kj/i,'kJ') : originalUnit.toLowerCase();
      const converted = convert(Number(amount[2]),unit,d.unit);
      if (!Number.isFinite(converted.value)) return missing(raw,'数值无效');
      return {...converted,comparator:({'<=':'≤','>=':'≥'})[amount[1]] || amount[1] || '',
        raw,basis:basisOf(raw,text,d.key),group:converted.unit};
    });
    if (!values.length) return missing();
    if (values.some(v => v.value === null) || values.some(v => v.value !== values[0].value || v.unit !== values[0].unit || v.comparator !== values[0].comparator || v.basis !== values[0].basis))
      return missing(hits.join('；'),'多值或口径不一致，未取数');
    return values[0];
  }
  function metric(product, key) { if(product.publicDerived?.metrics[key]) return product.publicDerived.metrics[key];
    const d = byKey[key];
    if (!d) return missing();
    if (d.aliases) return guarantee(product,d);
    if (['animalIngredient','animalProtein'].includes(key)) {
      const m = nutrition.metrics(product)[key];
      if (m.comparable) return {value:m.value,unit:'%',raw:m.raw,group:'%',comparator:'',basis:'口径已记录'};
    }
    const raw = d.field.endsWith('_raw') ? product.details?.[d.field] : product[d.field];
    const match = clean(raw).match(/^(>=|<=|≥|≤|>|<|=)?\s*(\d+(?:\.\d+)?)\s*(%)?$/);
    if (!match) return missing(clean(raw),clean(raw) ? '范围或非单值，未取数' : '未记录');
    if (!Number.isFinite(Number(match[2]))) return missing(clean(raw),'数值无效');
    const rawValue = Number(match[2]);
    const isRatioPercent = ratioPercentKeys.has(key);
    const value = isRatioPercent && !match[3] && rawValue >= 0 && rawValue <= 1 ? rawValue * 100 : rawValue;
    const unit = d.unit || (isRatioPercent || match[3] ? '%' : '原始数值');
    const rawComparator = ['protein','fat'].includes(key) ? clean(product.details?.[key+'_raw']).match(/^(>=|<=|≥|≤|>|<|=)/)?.[1] : '';
    return {value,unit,raw:clean(raw),group:unit,
      comparator:({'<=':'≤','>=':'≥'})[match[1] || rawComparator] || match[1] || rawComparator || '',
      basis:d.unit ? '' : isRatioPercent ? '分母/方法待明确' : match[3] ? '分母/方法待明确' : '单位/分母待明确'};
  }
  function display(m) {
    if (m.value === null) return m.reason;
    return (m.comparator || '') + Number(m.value.toFixed(5)) + (m.unit === '原始数值' ? '' : m.unit === '%' ? '%' : ' '+m.unit);
  }
  function sortRows(rows, key, secondary = '') {
    const copy = [...rows], d = validSort(key) ? sortDefinition(key) : null;
    if (!d) return copy;
    const direction = key.endsWith('-desc') ? -1 : 1;
    const next = validSort(secondary) ? sortDefinition(secondary) : null;
    function compareValue(a, b, definition, descending) {
      if (a.value === null || b.value === null) return a.value === null ? (b.value === null ? 0 : 1) : -1;
      if (definition.type === 'text') return (descending ? -1 : 1)*textCollator.compare(a.value,b.value);
      return a.group.localeCompare(b.group) || (descending ? -1 : 1)*(a.value-b.value);
    }
    // Decorate once: stable ties, missing last in either direction; unlike units grouped, never compared numerically.
    return copy.map((p,index) => ({p,index,m:sortValue(p,d),n:next && next.key !== d.key ? sortValue(p,next) : null})).sort((a,b) => {
      if (a.m.value === null || b.m.value === null) return a.m.value === null ? (b.m.value === null ? a.index-b.index : 1) : -1;
      return compareValue(a.m,b.m,d,direction === -1) ||
        (a.n ? compareValue(a.n,b.n,next,secondary.endsWith('-desc')) : 0) || a.index-b.index;
    }).map(item => item.p);
  }
  function options(products, selectedSort = 'source', direction = 'asc') {
    const selected = definition(selectedSort)?.key;
    return definitions.map(d => ({...d,count:products.filter(p => metric(p,d.key).value !== null).length,
      value:d.key+'-'+direction})).filter(d => d.count > 0 || d.key === selected);
  }
  return {definitions,textDefinitions,validSort,definition,sortDefinition,metric,display,sortRows,options,splitGuarantees};
});


;
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sorting.js'));
  else root.PFDSComparisonSummary = factory(root.PetFoodSorting);
})(typeof window !== 'undefined' ? window : globalThis, function (sorting) {
  'use strict';

  // Plain text only. The parent must escape titles/text or assign textContent.
  const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  function known(value) {
    const raw = text(value), normalized = raw.normalize('NFKC');
    return raw && !/^[-—–?？\s/]+$/.test(raw) &&
      !/^(?:unknown|n\/?a|null|undefined|none|待核验|待核实|待确认|待补充|未知|未记录|未提供|未标明|未注明|未明确|不详|暂无|见详情|DATA_GAP)(?:\s*[(:：].*)?$/i.test(normalized) ? raw : '';
  }
  function summarize(products, options = {}) {
    if (!Array.isArray(products) || products.length < 2 || products.length > 6 ||
        products.some(p => !p || typeof p !== 'object' || Array.isArray(p))) return [];
    const names = products.map((p, i) => {
      const name = known(p.product), brand = known(p.brand), flavor = known(p.flavor);
      return [brand && !name.includes(brand) ? brand : '', name || known(p.skuId) || `产品${i + 1}`,
        flavor && !name.includes(flavor) ? flavor : ''].filter(Boolean).join(' · ');
    });
    const labels = names.map((name, i) => names.filter(n => n === name).length > 1
      ? `${name}（${known(products[i].skuId) || '所选'}，第${i + 1}款）` : name);
    const {metrics = ['protein','fat','price'], focus = '', differentOnly = false} = options || {};
    const selected = new Set(Array.isArray(metrics) ? metrics : ['protein','fat','price']);
    const focused = ['nutrition','price','animalRatios','feedingStudy'].includes(focus) ? focus : '';
    const enabled = theme => !focused || focused === theme;
    const result = [];
    let hiddenSame = false;
    const hiddenThemes = new Set();
    const displayBasis = basis => ({as_fed:'原物',dry_matter:'干物质',unknown:'基准未标明'})[basis] || basis || '基准未标明';
    const equal = values => values.every(v => v === values[0]);
    const sameMetric = values => values.every(m => m.value !== null) &&
      equal(values.map(m => JSON.stringify([m.value,m.comparator,m.unit,m.basis,m.denominator])));
    const read = (p, key) => {
      const m = {...sorting.metric(p, key)};
      const inputs = p.analysisInputState === 'current' ? p.analysisInputs : null;
      if (['protein','fat'].includes(key)) m.basis = inputs?.nutritionBasis || '基准未标明';
      if (['animalIngredient','animalProtein'].includes(key)) m.denominator = inputs?.[key+'Denominator'] || 'unknown';
      return m;
    };
    const retain = (same, theme) => {
      if (differentOnly && same) { hiddenSame = true; if (theme) hiddenThemes.add(theme); return false; }
      return true;
    };
    const add = (kind, title, value) => result.push({kind, title, text:value});
    const entries = values => values.map((v, i) => `${labels[i]}：${v}`).join('；');
    for (const [key, title] of [['stage','适用阶段'], ['process','主粮工艺']]) {
      if (focused && key === 'process') continue;
      const values = products.map(p => known(p[key]));
      const available = values.filter(Boolean);
      if (!available.length) continue;
      const same = available.every(v => v.normalize('NFKC') === available[0].normalize('NFKC'));
      if (!retain(same && available.length === products.length)) continue;
      if (same && available.length === products.length) {
        add(key, title, `所选产品均为 ${available[0]}。`);
        continue;
      }
      const status = available.length === products.length
        ? (same ? '记录相同' : '记录不同') : (same ? '已知记录相同，部分未记录' : '已知记录不同，部分未记录');
      add(key, title, `${status}：${entries(values.map(v => v || '未记录'))}。`);
    }
    const prices = products.map(p => read(p, 'price'));
    if (enabled('price') && (focused === 'price' || selected.has('price')) &&
        prices.some(m => m.value !== null) && retain(sameMetric(prices),'price')) {
      const displayPrice = m => m.value === null ? '价格未知' : `${m.comparator || ''}${Number(m.value.toFixed(2))} ${m.unit}`;
      // Equality uses unrounded records and bounds, never the displayed price.
      const same = prices.every(m => m.value !== null && m.value === prices[0].value &&
        m.comparator === prices[0].comparator && m.unit === prices[0].unit);
      const value = same ? `所选产品的记录参考价均为 ${displayPrice(prices[0])}` : entries(prices.map(displayPrice));
      add('price', '记录参考价', `${value}。仅为记录参考价；需核对报价日期、渠道、优惠条件及包装规格与报价的对应，不代表实时售价或日喂养成本。`);
    }
    const selectedNutrition = enabled('nutrition') ? sorting.definitions.filter(d => selected.has(d.key) &&
      (d.aliases || ['protein','fat'].includes(d.key))) : [];
    const nutrition = selectedNutrition.map(d => ({d, values:products.map(p => read(p,d.key))}))
      .filter(({values}) => retain(sameMetric(values),'nutrition'));
    if (nutrition.some(({values}) => values.some(m => m.value !== null || m.raw))) {
      const values = products.map((p,i) => nutrition.map(({d,values}) => {
        const m = values[i];
        return `${d.label} ${m.value === null ? (m.raw ? '记录无法取单值' : '未记录')
          : `${sorting.display(m)}（${displayBasis(m.basis)}）`}`;
      }).join('、'));
      let caution = '≥/>为下限，≤/<为上限；基准不明或不同不直接比较，记录值不等于实测值。';
      if (nutrition.some(({d}) => d.key === 'phosphorus')) caution += '不能据下限较小判断实际磷更低。';
      if (nutrition.some(({d}) => d.key === 'chloride')) caution += '氯化物不等于钠、盐含量或咸度。';
      add('nutrition', '营养记录', `${entries(values)}。${caution}`);
    }
    const ratioKeys = enabled('animalRatios') ? ['animalIngredient','animalProtein'].filter(key =>
      focused === 'animalRatios' || selected.has(key) || selected.has('animalRatios'))
      .filter(key => retain(sameMetric(products.map(p => read(p,key))),'animalRatios')) : [];
    const ratios = products.map(p => ratioKeys.map(key => read(p, key)));
    if (ratios.some(pair => pair.some(m => m.value !== null || m.raw))) {
      add('animalRatios', '动物性占比', `${entries(ratios.map(pair => pair.map((m, i) =>
        `${ratioKeys[i] === 'animalProtein' ? '动物性蛋白' : '动物性原料'} ${m.value === null ? (m.raw ? '记录无法取单值' : '未记录') : sorting.display(m)}`
      ).join('、')))}。原料占比与蛋白占比的分母不同，不能互换或排名；跨产品分母未核对，百分比显示不代表同口径。`);
    }
    const studies = products.map(p => known(p.details?.feeding_study_raw ?? p.feedingStudyRaw));
    if (enabled('feedingStudy') && studies.some(Boolean) && retain(studies.every(Boolean) && equal(studies),'feedingStudy')) {
      add('feedingStudy', '喂养研究记录', `${entries(studies.map(raw => !raw ? '未记录'
        : /^(?:无|没有|未开展|无相关研究|无喂养实验|无喂养研究)[。.]?$/.test(raw) ? `原文记“${raw}”` : '有研究字段文字记录'))}。仅说明资料记录情况，不证明已开展试验或功效；未记录也不代表没有研究，需查看原文与研究对象、设计及终点。`);
    }
    // A stage record cannot stand in for the requested topic's state.
    if (focused && !result.some(b => b.kind === focused)) {
      const title = {nutrition:'营养记录',price:'记录参考价',animalRatios:'动物性占比',feedingStudy:'喂养研究记录'}[focused];
      if (hiddenThemes.has(focused)) {
        const remainingUnknown = focused === 'nutrition' ? nutrition.length > 0 : focused === 'animalRatios' && ratioKeys.length > 0;
        add('noDifferences', title, `该主题的可用记录无差异，已按“只看差异”隐藏；${remainingUnknown ? '其余所选指标未记录，仍未知；' : ''}不代表实际含量、功效或品质相同。`);
      } else if (focused === 'nutrition' && !selectedNutrition.length) {
        add(focused, title, '未选营养指标，请选择要比较的营养指标。');
      } else {
        const message = {nutrition:'所选营养指标均未记录；未知不按0处理。',
          price:'所选产品无可用参考价记录，价格未知；未知不按0处理，仍需核对报价与包装规格。',
          animalRatios:'所选产品的动物性占比均未记录；未知不按0处理，不据此排名。',
          feedingStudy:'所选产品的喂养研究均未记录；未记录不代表没有研究，也不证明功效。'}[focused];
        add(focused, title, message);
      }
    }
    if (!result.length) {
      if (hiddenSame) add('noDifferences', '暂无记录差异', '当前范围内的可用记录未发现差异；缺失或无法解析的资料仍未知，不代表实际含量、功效或品质相同。');
      else add('missing', '资料不足', `${labels.join('、')}：当前所选主题与指标无可用记录；未知不按0处理。`);
    }
    return result;
  }
  return {summarize};
});

;
(function(root,factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sorting.js'));
  else root.PetFoodTableView = factory(root.PetFoodSorting);
})(typeof globalThis !== 'undefined' ? globalThis : this,function(sorting) {
  'use strict';
  const KEY='pet-food-table-view-v1';
  const attributes=[{key:'process',label:'工艺'},{key:'function',label:'功能'},{key:'stage',label:'阶段'},{key:'imported',label:'进口属性'},
    {key:'productionMode',label:'生产方式'},{key:'factory',label:'工厂名称'},
    {key:'brandFounded',label:'品牌创立'},{key:'factoryFounded',label:'工厂成立'},{key:'factoryScale',label:'工厂规模'}];
  const columns=[...attributes,...sorting.definitions.map(d=>({...d,label:({
    protein:'蛋白 %',fat:'脂肪 %',price:'元/斤',pagePrice:'页面价 元',
    animalIngredient:'动物性原料 %',animalProtein:'动物性蛋白 %',tractDigest:'成品消化率 %',pepsinDigest:'胃蛋白酶消化率 %'
  })[d.key]||d.label,metric:true}))];
  const presets=[
    {key:'basic',label:'基础营养与生产',columns:['process','function','stage','imported','protein','fat','price']},
    {key:'minerals',label:'磷与氯化物',columns:['stage','phosphorus','chloride','protein','fat','price']},
    {key:'price',label:'价格与营养',columns:['process','protein','fat','price','energy']},
    {key:'animal',label:'动物性成分',columns:['animalIngredient','animalProtein','protein','fat','price','tractDigest','pepsinDigest']}
  ];
  presets.push({key:'compact',label:'简洁选粮',columns:['protein','fat','price','stage']});
  presets[0].columns.splice(4,0,'productionMode','factory');
  const known=new Set(columns.map(d=>d.key));
  function defaults(sort='source') {return {columns:[...presets.find(p=>p.key==='basic').columns],sort,secondary:''};}
  function normalize(value,sort) {
    const v=value??defaults(sort);
    if(!v || !Array.isArray(v.columns) || v.columns.length>columns.length || v.columns.some(k=>!known.has(k)))throw Error('显示列设置不兼容');
    const key=sort??v.sort??'source',secondary=v.secondary??'';
    if(!sorting.validSort(key)||typeof secondary!=='string'||secondary && (!sorting.validSort(secondary)||!sorting.sortDefinition(secondary)))throw Error('排序设置不兼容');
    return {columns:[...new Set(v.columns)],sort:key,secondary:!sorting.sortDefinition(key)||sorting.sortDefinition(key)?.key===sorting.sortDefinition(secondary)?.key?'':secondary};
  }
  function preset(state,key) {
    const p=presets.find(p=>p.key===key);
    if(!p)throw Error('未知查看组合');
    return normalize({...state,columns:[...p.columns]});
  }
  function presetKey(state) {
    return presets.find(p=>p.columns.join('|')===state.columns.join('|'))?.key||'custom';
  }
  function effective(state,query={}) {
    const result=[...state.columns];
    const add=k=>{if(known.has(k)&&!result.includes(k))result.push(k);};
    for(const key of ['phosphorus','chloride','animalIngredient','animalProtein'])
      if(query[key+'Mode'])add(key);
    if(query.functionValue)add('function');
    if(query.productionMode)add('productionMode');
    if(query.factoryName)add('factory');
    add(sorting.sortDefinition(state.sort)?.key);add(sorting.sortDefinition(state.secondary)?.key);
    return result;
  }
  function toggle(state,key,checked) {
    if(!known.has(key))throw Error('未知显示列');
    const columns=state.columns.filter(k=>k!==key);
    if(checked)columns.push(key);
    return normalize({...state,columns,
      sort:!checked&&sorting.sortDefinition(state.sort)?.key===key?'source':state.sort,
      secondary:!checked&&sorting.sortDefinition(state.secondary)?.key===key?'':state.secondary});
  }
  function headerSort(state,key) {
    if(!sorting.sortDefinition(key+'-asc'))throw Error('该列不可排序');
    const active=sorting.sortDefinition(state.sort)?.key===key;
    const sort=active?(state.sort.endsWith('-desc')?'source':key+'-desc'):key+'-asc';
    // When the user moves to another header, retain the previous primary
    // direction as the secondary tie-breaker instead of silently discarding it.
    // The explicit secondary selector remains available for changing that tie-breaker.
    const previous = sorting.sortDefinition(state.sort);
    const secondary = !active && previous && previous.key !== key ? state.sort : state.secondary;
    return normalize({...state,sort,secondary});
  }
  // Drag-to-reorder: move fromKey next to toKey. before=true inserts ahead of toKey,
  // otherwise after it. Unknown keys or a no-op move return the state unchanged.
  function move(state,fromKey,toKey,before) {
    if(!known.has(fromKey)||!known.has(toKey)||fromKey===toKey)return state;
    const columns=state.columns.filter(k=>k!==fromKey);
    const index=columns.indexOf(toKey);
    columns.splice(index<0?columns.length:index+(before?0:1),0,fromKey);
    return normalize({...state,columns});
  }
  // A column is draggable only when it is an explicit user choice (auto columns are
  // appended by effective() for filters/sorts and are not part of state.columns).
  function draggable(state,key) {
    return known.has(key)&&state.columns.includes(key);
  }
  function read(storage) {
    const text=storage.getItem(KEY);
    if(!text)return defaults();
    const doc=JSON.parse(text);
    if(doc?.version!==1||!doc.table)throw Error('显示列版本不兼容');
    const table=normalize(doc.table);
    // Upgrade only the old default, not an owner's custom column selection.
    if(doc.defaultVersion !== 2 && presetKey(table)==='compact') return preset(table,'basic');
    // Show the newly requested field once without discarding existing column choices.
    if(doc.fieldVersion !== 2 && !table.columns.includes('function')) {
      const index=table.columns.indexOf('process');
      table.columns.splice(index<0?0:index+1,0,'function');
    }
    return table;
  }
  function write(storage,state) {
    storage.setItem(KEY,JSON.stringify({version:1,fieldVersion:2,defaultVersion:2,table:normalize(state)}));
  }
  function tooltip(product,key) {
    const m=sorting.metric(product,key);
    const raw=['protein','fat'].includes(key)?product.details?.[key+'_raw']||m.raw:key==='price'?product.details?.price_per_jin_raw||m.raw:m.raw;
    return [raw&&'原文：'+raw,m.basis,m.value===null?m.reason:'',
      ['animalIngredient','animalProtein','tractDigest','pepsinDigest'].includes(key)?'原始记录，单位/分母或方法以详情为准':'',
      key==='price'?'参考记录，不是实时售价':''].filter(Boolean).join('；');
  }
  return {KEY,columns,presets,defaults,normalize,preset,presetKey,effective,toggle,headerSort,move,draggable,read,write,tooltip};
});


;
(function (root) {
  'use strict';
  const nutrition = root.PetFoodNutrition || (typeof require === 'function' ? require('./nutrition-compare.js') : { matches: () => true });
  const studyFunctionBindings = root.PetFoodStudyFunctions || (typeof require === 'function' ? require('./function-studies.js') : []);
  const themePatterns = {
    coat: /美毛|亮毛|护毛|毛发|皮肤|皮毛|掉毛|护肤|健肤|SKIN|COAT/i,
    digestion: /肠胃|胃肠|消化|肠道|益生菌|益生元|便臭|软便|粪便成型|护胃|护肠|DIGEST/i,
    hairball: /毛球|化毛|排毛|控毛球|去毛球|HAIRBALL/i,
    weight: /控重|体重控制|减重|减脂|瘦身|塑形|体态|绝育|体重管理|WEIGHT MANAGEMENT|NEUTERED/i,
    urinary: /泌尿|尿路|尿液|结石|URINARY/i,
    immunity: /免疫|抵抗力|抗体|IMMUNE/i,
    senior: /关节|软骨|老年|高龄|7岁|SENIOR|JOINT/i,
    sensitivity: /低敏|敏感|过敏|单一动物蛋白|HYPOALLERGENIC|SENSITIVE/i,
    dental: /口腔|牙齿|磨牙|洁齿|牙结石|ORAL|DENTAL/i
  };
  // Named positioning only, not efficacy verification. Keep legacy theme clues separate.
  const functionLabels = {
    coat: '美毛健肤', digestion: '肠胃消化护理', hairball: '毛球管理', weight: '控重绝育',
    urinary: '泌尿护理', sensitivity: '低敏敏感', dental: '口腔护理', joint: '关节护理', immunity: '免疫专护',
    gain: '增重长肉', antioxidant: '抗氧化支持'
  };
  const functionPatterns = {
    coat: /美毛|健肤|护肤|(?:皮肤|皮毛|毛发)(?:护理|呵护|专护|养护)|(?:亮毛|护毛)(?:配方|猫粮|犬粮|系列)|\bSKIN\s*(?:&|AND|\+)\s*COAT\b|\b(?:SKIN|COAT)\s+(?:CARE|SUPPORT|HEALTH)\b/i,
    digestion: /肠胃(?:呵护|护理|专护|养护|原动力|配方|猫粮|犬粮|系列)|胃肠|(?:消化|肠道)(?:呵护|护理|专护|养护)|(?:呵护|护理|专护|养护)(?:肠胃|胃肠)|益肠动力|\bGASTRO[\s-]*INTESTINAL\b|\b(?:DIGESTIVE|DIGESTION)\s+(?:CARE|SUPPORT)\b/i,
    hairball: /毛球|化毛|(?:排毛|去毛)(?:配方|猫粮|犬粮|系列)|\bHAIR[\s-]*BALLS?\b/i,
    weight: /控重|减重|体重(?:控制|管理)|控制体重|减脂|瘦身|塑形|健美体态|绝育|\b(?:WEIGHT\s+(?:MANAGEMENT|CONTROL)|NEUTERED|STERILI[ZS]ED)\b/i,
    urinary: /泌尿|尿路(?:护理|呵护|专护|养护)|\bURINARY\b/i,
    sensitivity: /低敏|敏感(?:消化|肠胃|胃肠|护理|专护|配方)|(?:消化|肠胃|胃肠)敏感|\bHYPO[\s-]*ALLERGENIC\b|\bSENSITIVE(?:\s+(?:DIGESTION|STOMACH|SKIN))?\b/i,
    dental: /洁齿|(?:口腔|牙齿)(?:护理|呵护|专护|养护)|\b(?:DENTAL|ORAL\s+CARE)\b/i,
    joint: /(?:关节|软骨)(?:护理|呵护|专护|养护)|\bJOINT\s+(?:CARE|SUPPORT|HEALTH)\b/i,
    immunity: /免疫(?:专护|专研|专向|护理|养护|定向)|\bIMMUN(?:E|ITY)\s+(?:CARE|SUPPORT)\b/i
  };
  const functionProse = /描述|声称|宣称|宣传|营销|卖点|功效|有助(?:于)?|帮助|促进|改善|支持|增强|提升|减少|降低|富含|添加|含有|(?:泛|通用|全面|均衡|全方位)营养|营养(?:支持|均衡)|\b(?:claims?|helps?|supports?|promotes?|contains?)\b/i;
  const functionDescription = /描述|声称|宣称|宣传|营销|卖点|功效|(?:泛|通用|全面|均衡|全方位)营养|营养(?:支持|均衡)/i;
  const functionReferences = /(?:其他|其它|别的|另一|另外|某)(?:款|产品|配方|SKU)|(?:同|该|本)系列(?:中|内|包含|包括|有|另)|系列(?:包含|包括|含有)|多(?:款|个\s*SKU)|全(?:线|系列)(?:产品|SKU)|旗下|例如|比如|相比|对比|参照|参考|\b(?:other\s+(?:products?|formulas?|SKUs?)|including|e\.g\.)\b/i;
  const functionNegationBefore = /(?:没有|并非|不是|不属于|不具备|不提供|不支持|不主打|不宣称|不定位|不以|不针对|无|非|未(?:明确)?(?:定位|标注|声明)?|尚未定位)\s*(?:(?:明确|任何|特殊|专门|针对|功能(?:型|性)?|定位|产品|配方|系列|为|成|于|的|美毛|健肤|化毛|毛球|控重|减重|绝育|泌尿|低敏|洁齿|关节护理|免疫专护|及|和|或|[、/，,：:])\s*)*$|\b(?:no|not|non[\s-]*|without)\s*(?:(?:a|an|the|specifically|positioned|formulated|for|as)\s*)*$/i;
  const functionNegationAfter = /^\s*[)）\]】]*\s*(?:(?:功能|定位|功效|作用|效果)\s*[:：=]?\s*(?:无|没有|否|未明确|未定位)|(?:功能|定位)?\s*[:：=]?\s*(?:未(?:明确)?定位|不是|不属于|非功能)|[（(]\s*(?:非功能|不是(?:功能|定位)|未(?:明确)?定位)|[-\s]+free\b)/i;
  function functionEvidence(p, q = {}) { if(p.publicDerived) return p.publicDerived.query.functionEvidence.filter(e=>!q.function||q.function==="any"||e.key===q.function);
    const selected = q?.function, evidence = [], denied = new Set();
    // Never use brand, ingredients, claims, stage or name history to infer positioning.
    const fields = [['产品名', p?.product], ['系列', p?.series]];
    for (const [key, pattern] of Object.entries(functionPatterns)) {
      if (selected && selected !== 'any' && selected !== key) continue;
      for (const [source, value] of fields) {
        const raw = String(value ?? '');
        // A portfolio/list is not the positioning of this SKU, even across clauses.
        if (functionReferences.test(raw) || (raw.match(/款|\bSKU\b/gi) || []).length > 1) continue;
        const quotes = [...raw.matchAll(/“[^”]*”|「[^」]*」|『[^』]*』|‘[^’]*’|"[^"]*"|'[^']*'/gu)];
        for (const hit of raw.matchAll(new RegExp(pattern.source, 'gi'))) {
          if (quotes.some(quote => hit.index >= quote.index && hit.index < quote.index + quote[0].length)) continue;
          const before = raw.slice(0, hit.index).split(/[;；。！？\r\n|｜]/u).pop();
          const after = raw.slice(hit.index + hit[0].length).split(/[;；。！？\r\n|｜]/u)[0];
          // A direct denial in either current name field vetoes that key in both.
          if (functionNegationBefore.test(before) || functionNegationAfter.test(after)) {
            denied.add(key);
            continue;
          }
          if (functionDescription.test(raw) || functionProse.test(before + ' ' + after)) continue;
          if (evidence.some(item => item.key === key && item.source === source)) continue;
          const start = Math.max(0, hit.index - 24), end = Math.min(raw.length, hit.index + hit[0].length + 30);
          evidence.push({ key, label: functionLabels[key], source, raw,
            excerpt: `${start ? '…' : ''}${raw.slice(start, end)}${end < raw.length ? '…' : ''}` });
        }
      }
    }
    return evidence.filter(item => !denied.has(item.key));
  }
  function evidenceFunctionEvidence(p, q = {}) { if(p.publicDerived) return p.publicDerived.query.evidenceFunctionEvidence.filter(e=>!q.function||q.function==="any"||e.key===q.function);
    const selected = q?.function, raw = String(p?.details?.feeding_study_raw ?? p?.feedingStudyRaw ?? '').trim();
    const claims = String(p?.details?.marketing_claims_raw ?? '').trim();
    return studyFunctionBindings.filter(item => item.keys.length && item.skuId === p?.skuId && item.product === p?.product
      && item.series === p?.series && item.flavor === p?.flavor && item.formulaVersion === p?.formulaVersion
      && item.raw === raw && item.claims === claims)
      .flatMap(item => item.keys.filter(key => !selected || selected === 'any' || selected === key)
        .map(key => ({key, label: functionLabels[key], source: item.source, raw,
          excerpt: item.excerpt, reference: item.reference, limitation: item.limitation, scope: item.scope,
          workbook: item.workbook, row: item.row})));
  }
  function functionEvidenceAll(p, q = {}) { return [...functionEvidence(p, q), ...evidenceFunctionEvidence(p, q)]; }
  function functionEvidenceGroups(p) {
    const groups = new Map();
    for (const item of functionEvidenceAll(p)) {
      const id = JSON.stringify([item.source, item.raw, item.excerpt, item.reference, item.scope, item.limitation]);
      if (!groups.has(id)) groups.set(id, {...item, labels: []});
      if (!groups.get(id).labels.includes(item.label)) groups.get(id).labels.push(item.label);
    }
    return [...groups.values()];
  }
  function functions(p) { return [...new Set(functionEvidenceAll(p).map(item => item.key))]; }
  function functionSummary(p) {
    return functions(p).map(key => functionLabels[key]).join(' / ') || '未明确功能定位';
  }
  // The editable field remains authoritative. When it is empty, a narrowly
  // matched product/series positioning is available as a derived display value.
  function functionRaw(p) { if(p.publicDerived) return p.publicDerived.query.functionRaw;
    return String(p?.details?.function_raw ?? p?.functionRaw ?? '').trim();
  }
  function functionValues(p) { if(p.publicDerived) return p.publicDerived.query.functionValues;
    const rawValues = [...new Set(functionRaw(p).split(/[,，;；、\n|｜]+/u).map(v => v.trim()).filter(Boolean))];
    return rawValues.length ? rawValues : [...new Set(functions(p).map(key => functionLabels[key]).filter(Boolean))];
  }
  function functionValueSummary(p) { return functionValues(p).join(' / '); }
  function matchesFunctionValue(p, value) {
    const tags = functionValues(p);
    if (!value) return true;
    if (value === 'filled') return tags.length > 0;
    if (value === 'empty') return tags.length === 0;
    return value.startsWith('value:') && tags.includes(value.slice(6));
  }
  function coreRaw(p) { if(p.publicDerived) return p.publicDerived.query.coreRaw;
    const raw = p?.details?.core_product_raw;
    if (Object.hasOwn(p?.details || {}, 'core_product_raw')) return ['是','否'].includes(raw) ? raw : '';
    return ({confirmed:'是',excluded:'否'})[p?.coreRoleStatus] || '';
  }
  function productionMode(p) {
    return String(Object.hasOwn(p?.details || {}, 'production_mode_raw') ? p.details.production_mode_raw ?? '' : p?.productionMode ?? '').trim();
  }
  function factoryName(p) {
    return String(Object.hasOwn(p?.details || {}, 'factory_name_raw') ? p.details.factory_name_raw ?? '' : p?.factoryName ?? '').trim();
  }
  function matchesFactory(p, value) {
    const name = factoryName(p);
    if (!value) return true;
    if (value === 'empty') return !name;
    if (value === 'filled') return Boolean(name);
    return value.startsWith('value:') && name === value.slice(6);
  }
  // D099：品牌创立 / 工厂成立 / 工厂规模三列也能加入表头，与其它列一样可排序、可筛选。
  // 判定与工厂名称同源：原始记录值决定"有 / 无记录"，展示用的短口径（"2007 年" / "12 万吨"）用于挑具体值。
  // 缺失不按 0 处理——未记录就是未记录，也不会被"有记录"选中。
  function matchesIntelText(raw, shortText, value) {
    const text = String(raw ?? '').trim();
    const known = Boolean(text) && !/DATA_GAP/i.test(text);
    if (!value) return true;
    if (value === 'empty') return !known;
    if (value === 'filled') return known;
    return value.startsWith('value:') && String(shortText ?? '').trim() === value.slice(6);
  }
  const literal = keyword => text => {
    const index = text.toLocaleLowerCase('zh-CN').indexOf(keyword.toLocaleLowerCase('zh-CN'));
    return index < 0 ? null : { index, length: keyword.length };
  };
  function findMatch(fields, matcher) {
    for (const [source, value] of fields) {
      const raw = String(value ?? ''), hit = matcher(raw);
      if (!hit) continue;
      const start = Math.max(0, hit.index - 24), end = Math.min(raw.length, hit.index + hit.length + 30);
      return { source, excerpt: `${start ? '…' : ''}${raw.slice(start, end)}${end < raw.length ? '…' : ''}` };
    }
    return null;
  }
  // D100：「配料关键词」升级为「成分关键词」——除了配料原文，还查营养添加剂原文与营养成分（保证值）原文。
  // 仍然是原文字词（AND、字面量），不判断含量、否定语义或功效；也不查页面声称或产品名。
  const compositionFields = p => [
    ['配料原文', p?.details?.ingredients_raw],
    ['营养添加剂原文', p?.details?.additives_raw],
    ['营养成分原文', [p?.details?.protein_raw, p?.details?.fat_raw, p?.details?.other_guaranteed_analysis_raw]
      .filter(value => value !== null && value !== undefined && value !== '').join(' ｜ ')]
  ];
  // D100：新增「描述关键词」——只要在产品的描述性原文里提到就能被筛出来。
  // 范围＝除成分三类字段以外的全部描述文字（工艺原话/页面声称/溯源/喂养研究/工厂进口/保质期/
  // 规格/阶段/形态/背景/功能/价格原文等）＋品牌·系列·产品·口味名称（含旧名）。
  // 字段清单按 details 现有键动态生成，以后新增描述字段会自动纳入，不需要再改这里。
  const descriptionSkip = new Set(['ingredients_raw', 'additives_raw', 'protein_raw', 'fat_raw',
    'other_guaranteed_analysis_raw', 'brand_name', 'series_name', 'product_name', 'flavor']);
  const detailLabels = {
    life_stage_raw: '适用阶段原文', format_raw: '产品形态原文', package_size_raw: '包装规格原文',
    shelf_life_raw: '保质期原文', page_price_raw: '页面价格原文', price_per_jin_raw: '元/斤原文',
    process_claim_raw: '工艺/官方原话', animal_ingredient_ratio_raw: '动物性原料原文',
    animal_protein_ratio_raw: '动物性蛋白原文', total_tract_digestibility_raw: '全肠道消化率原文',
    pepsin_digestibility_raw: '胃蛋白酶消化率原文', feeding_study_raw: '喂养实验/研究原文',
    marketing_claims_raw: '页面卖点/声称原文', traceability_raw: '原料溯源原文',
    factory_import_raw: '工厂/进口原文', brand_positioning_raw: '品牌定位原文',
    market_position_raw: '市场地位原文', rd_capability_raw: '研发能力原文',
    brand_endorsement_raw: '品牌背书原文', function_raw: '功能原文', core_product_raw: '核心产品原文',
    production_mode_raw: '生产方式原文', factory_name_raw: '工厂名称原文'
  };
  function descriptionFields(p) {
    const fields = [['名称（品牌/系列/产品/口味）',
      [p?.brand, p?.series, p?.product, p?.flavor,
        ...(p?.nameHistory || []).flatMap(h => [h.product, h.flavor])].filter(Boolean).join(' · ')]];
    for (const [key, value] of Object.entries(p?.details || {})) {
      if (descriptionSkip.has(key) || value === null || value === undefined || value === '') continue;
      fields.push([`描述原文（${detailLabels[key] || key}）`, value]);
    }
    return fields;
  }
  const words = value => [...new Set(String(value || '').trim().split(/[\s,，;；]+/u).filter(Boolean))];
  function textEvidence(p, q) { if(p.publicDerived) return globalThis.PFDSRelease.textEvidence(p,q);
    const matches = [], claims = [['页面声称原文', p.details?.marketing_claims_raw], ['产品名', p.product]];
    const requirements = [];
    if (q.theme) requirements.push(['主题', claims, text => {
      const hit = themePatterns[q.theme]?.exec(text);
      return hit ? { index: hit.index, length: hit[0].length } : null;
    }]);
    if (q.themeKeyword?.trim()) requirements.push(['声称关键词', claims, literal(q.themeKeyword.trim())]);
    // Literal AND words across the composition fields (ingredients, additives, guaranteed analysis).
    const composition = () => compositionFields(p);
    for (const word of words(q.ingredients)) requirements.push([`成分「${word}」`, composition(), literal(word)]);
    // Literal AND words across every descriptive text field. Computed only when the filter is on.
    if (q.descriptionKeyword?.trim()) {
      const fields = descriptionFields(p);
      for (const word of words(q.descriptionKeyword)) requirements.push([`描述「${word}」`, fields, literal(word)]);
    }
    for (const [label, fields, matcher] of requirements) {
      const hit = findMatch(fields, matcher);
      if (!hit) return null;
      matches.push({ label, ...hit });
    }
    return matches;
  }
  function inRange(value, low = '', high = '') {
    if (low === '' && high === '') return true;
    if (value == null || !Number.isFinite(value)) return false;
    return (low === '' || value >= Number(low)) && (high === '' || value <= Number(high));
  }
  function matches(p, q) {
    const haystack = [p.brand, p.series, p.product, p.flavor,
      ...(p.nameHistory || []).flatMap(h => [h.product, h.flavor])].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN');
    return (!q.search?.trim() || haystack.includes(q.search.trim().toLocaleLowerCase('zh-CN')))
      && (!q.brand || p.brand === q.brand) && (!q.process || p.process === q.process)
      && (!q.stage || p.stage === q.stage) && (!q.imported || p.importStatus === q.imported)
      && (!q.productionMode || (q.productionMode === 'empty' ? !productionMode(p) : productionMode(p) === q.productionMode))
      && matchesFactory(p, q.factoryName)
      && matchesIntelText(p.brandFounded, p.brandFoundedShort, q.brandFounded)
      && matchesIntelText(p.factoryFounded, p.factoryFoundedShort, q.factoryFounded)
      && matchesIntelText(p.factoryScale, p.factoryScaleShort, q.factoryScale)
      && (!q.legendCategory || category(p, q.legendMode) === q.legendCategory)
      && (!q.core || p.coreCandidate)
      && (!q.coreStatus || (q.coreStatus === 'legacy' ? p.coreCandidate : p.coreRoleStatus === q.coreStatus))
      && (!q.group || (q.group === 'unassigned' ? !(p.attributes?.comparison_tags?.length)
        : q.group === 'assigned' ? Boolean(p.attributes?.comparison_tags?.length)
        : (p.attributes?.comparison_tags || []).includes(q.group.slice(4)) && q.group.startsWith('tag:')))
      && (!q.noteKeyword?.trim() || String(p.attributes?.comparison_note || '').toLocaleLowerCase('zh-CN')
        .includes(q.noteKeyword.trim().toLocaleLowerCase('zh-CN')))
      && textEvidence(p, q) !== null
      && (!q.function || functionEvidenceAll(p, q).length > 0)
      && matchesFunctionValue(p, q.functionValue)
      && (!q.priceScope || (q.priceScope === 'bound' ? p.priceBasis?.scope === 'bound' : q.priceScope === 'single_consistent' ? ['single_consistent','bound'].includes(p.priceBasis?.scope) : !['single_consistent','bound'].includes(p.priceBasis?.scope)))
      && inRange(p.protein, q.proteinMin, q.proteinMax) && inRange(p.fat, q.fatMin, q.fatMax)
      && inRange(p.pricePerJin, q.priceMin, q.priceMax)
      && nutrition.matches(p, q);
  }
  // D099：营养指标列的范围筛选。取值函数由调用方注入（避免 query ↔ sorting 循环依赖），
  // 这里只负责"没填就不筛、填了就按同一条 inRange 规则判定"。缺失值不参与，也不按 0 处理。
  function matchesMetricRanges(product, ranges = {}, valueOf) {
    for (const [key, [low, high]] of Object.entries(ranges || {})) {
      if (low === '' && high === '') continue;
      if (!inRange(valueOf ? valueOf(product, key) : null, low, high)) return false;
    }
    return true;
  }
  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }
  const themeLabels = {coat:'毛发 / 皮肤',digestion:'肠胃 / 消化',hairball:'毛球',weight:'体重 / 绝育',urinary:'泌尿',immunity:'免疫',senior:'关节 / 老年',sensitivity:'敏感 / 低敏',dental:'口腔 / 牙齿'};
  function themes(p) { if(p.publicDerived) return p.publicDerived.query.themes; return Object.keys(themePatterns).filter(theme => textEvidence(p, {theme}) !== null); }
  function category(p, mode) {
    if (mode === 'function') return functionValues(p).join(' / ') || '未分类';
    if (mode === 'process') return p.process || '待核验';
    if (mode === 'theme' || mode === 'group') {
      const values = mode === 'theme' ? themes(p).map(key => themeLabels[key]) : (p.attributes?.comparison_tags || []);
      return values.length > 1 ? (mode === 'theme' ? '多主题文字线索' : '多个分组') : values[0] || (mode === 'theme' ? '无主题文字命中' : '未分组');
    }
    return p.importStatus || '待核验';
  }
  const api = { textEvidence, matches, inRange, csvCell, themes, themeLabels, category,
    compositionFields, descriptionFields,
    functions, functionEvidence, evidenceFunctionEvidence, functionEvidenceAll, functionEvidenceGroups, functionLabels, functionSummary,
    functionRaw, functionValues, functionValueSummary, matchesFunctionValue,
    coreRaw, productionMode, factoryName, matchesFactory, matchesIntelText, matchesMetricRanges };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PetFoodQuery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

;
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

;
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetFoodScoring = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 'preference-v1';
  const keys = ['protein','fat','pricePerJin'];
  const labels = {protein:'蛋白记录匹配',fat:'脂肪记录匹配',pricePerJin:'参考价格匹配'};
  function defaults() {
    return {version:VERSION,mode:'off',priceScope:'single_consistent',rules:{
      protein:{low:35,high:45,tolerance:10,weight:100},
      fat:{low:12,high:20,tolerance:5,weight:100},
      pricePerJin:{low:0,high:60,tolerance:60,weight:100}}};
  }
  function normalize(value) {
    if (!value) return defaults();
    if (value.version !== VERSION || !['off','custom'].includes(value.mode) || !['single_consistent','reference'].includes(value.priceScope)) throw new Error('评分设置版本或模式不兼容，未覆盖原方案。');
    const rules = {};
    for (const key of keys) {
      const r = value.rules?.[key];
      if (!r || ['low','high','tolerance','weight'].some(k => !Number.isFinite(r[k]))) throw new Error(`${labels[key]}：请填写完整数字。`);
      if (r.low < 0 || r.high < r.low || r.high > (key === 'pricePerJin' ? 1e6 : 100) || r.tolerance <= 0 || r.tolerance > 1e6 || r.weight < 0 || r.weight > 100) throw new Error(`${labels[key]}：目标上下限、缓冲距离或权重不合法。`);
      rules[key] = {low:r.low,high:r.high,tolerance:r.tolerance,weight:r.weight};
    }
    if (value.mode === 'custom' && !keys.some(key => rules[key].weight > 0)) throw new Error('至少一项权重大于0；也可切回不评分。');
    return {version:VERSION,mode:value.mode,priceScope:value.priceScope,rules};
  }
  function dimension(value, rule) {
    if (!Number.isFinite(value) || value < 0) return null;
    const distance = Math.max(rule.low-value, value-rule.high, 0);
    return Math.max(0,100*(1-distance/rule.tolerance));
  }
  function score(p, settings) {
    const config = normalize(settings);
    if (config.mode === 'off') return {total:null,coverage:null,dimensions:[],mode:'off',version:VERSION};
    const totalWeight = keys.reduce((sum,key)=>sum+config.rules[key].weight,0);
    let knownWeight=0, contribution=0;
    const dimensions = keys.filter(key => config.rules[key].weight > 0).map(key => {
      const rule = config.rules[key], eligible = key !== 'pricePerJin' || config.priceScope === 'reference' || ['single_consistent','bound'].includes(p.priceBasis?.scope);
      const value = Number.isFinite(p[key]) ? p[key] : null;
      const points = eligible ? dimension(value,rule) : null;
      const weight = rule.weight/totalWeight;
      if (points !== null) { knownWeight+=rule.weight; contribution+=points*rule.weight; }
      return {key,label:labels[key],value,points,weight,contribution:points === null ? null : points*weight,
        rule:{...rule},reason:points !== null ? '' : !eligible ? '价格/规格对应未明确，本规则不计入' : '缺有效数值（不当0或低分）'};
    });
    return {mode:'custom',version:VERSION,total:knownWeight === totalWeight ? contribution/totalWeight : null,
      coverage:knownWeight/totalWeight,dimensions};
  }
  function rank(rows, config) {
    const results = rows.map(p=>({product:p,result:score(p,config)}));
    return {complete:results.filter(r=>r.result.total !== null).sort((a,b)=>b.result.total-a.result.total || String(a.product.skuId).localeCompare(String(b.product.skuId))),
      incomplete:results.filter(r=>r.result.total === null)};
  }
  return {VERSION,keys,labels,defaults,normalize,dimension,score,rank};
});

;
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetFoodEvaluation = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const VERSION = 'candidate-v1', KEY = 'pet-food-trials-v1';
  const definitions = [
    {key:'nutrition', label:'营养适配', weight:30, fields:[['life_stage_raw','阶段原文'],['protein_raw','粗蛋白保证值'],['fat_raw','粗脂肪保证值'],['other_guaranteed_analysis_raw','其他保证值']], criterion:'结合普通成年猫场景、阶段、能量及保证值的比较符/单位/基准判断；阈值需有出处，不以蛋白越高越好判分。', boundary:'保证值不是检测值。缺能量、计量基准或适用标准时不能推断营养合格；全阶段标签不等于适配已核。'},
    {key:'ingredients', label:'原料与配方', weight:25, fields:[['ingredients_raw','配料原文'],['additives_raw','添加剂原文'],['animal_ingredient_ratio_raw','动物性原料比例'],['animal_protein_ratio_raw','动物性蛋白比例']], criterion:'根据本款原料构成与明确比例分母判断，说明判分方向/档位；鲜肉投料不替代动物蛋白，无谷/无肉粉不自动加分。', boundary:'鲜肉添加量、动物性原料和动物来源蛋白分开。标签列序和未核比例不能推出完整配方或品质。'},
    {key:'evidence', label:'科学 / 功能证据', weight:20, fields:[['feeding_study_raw','研究/喂养实验'],['total_tract_digestibility_raw','全消化道消化率'],['pepsin_digestibility_raw','胃蛋白酶体外指标'],['marketing_claims_raw','页面声称']], criterion:'对应本SKU及版本的对象、设计、终点和局限；记录分档依据，不将成分机制、体外结果直接判成功效。', boundary:'没有资料是未知，不证明无效。声称不是已核证据，不跨口味借用试验。'},
    {key:'transparency', label:'生产与信息透明', weight:15, fields:[['factory_import_raw','工厂/进口原文'],['traceability_raw','原料溯源']], criterion:'看本SKU制造企业、标签与来源的对应及可追溯程度；供应商不等于工厂，进口/工艺/品牌大小不直接加分。', boundary:'只评信息透明度，不是安全分。品牌共用背景不套用为本SKU制造事实。'},
    {key:'value', label:'价格价值', weight:10, fields:[['package_size_raw','规格原文'],['page_price_raw','页面价格原文'],['price_per_jin_raw','元/斤原文']], criterion:'在适用场景成立后，按明确包装、日期/渠道/优惠条件和预算判断；未核参考价不能自动专业判分，便宜不等于更好。', boundary:'报价是记录不是实时/最低价；没有可对应报价与预算依据时留空。'}
  ];
  const keys = definitions.map(d=>d.key);
  const weightSchemes = [
    {id:'daily',label:'日常选购',weights:[40,35,0,0,25],description:'营养40% · 原料与配方35% · 价格25%。功能证据和生产透明仍展示，不计总分；不是全面质量或安全评级。'},
    {id:'full',label:'完整五维',weights:[30,25,20,15,10],description:'营养30% · 原料25% · 功能证据20% · 生产透明15% · 价格10%。五项都启用，任一项未知不出总分。'}
  ];
  const fail = message => { throw new Error(message || '试评记录不兼容或已损坏，未覆盖原记录。'); };
  function str(value, max, optional = false) {
    if (typeof value !== 'string' || value.length > max || !optional && !value.trim()) fail('试评文字为空或超出长度限制。');
    return value.trim();
  }
  function defaults() {
    return {version:VERSION, mode:'off', scenario:'adult', rules:Object.fromEntries(definitions.map(d=>[d.key,{weight:d.weight,criterion:d.criterion}]))};
  }
  function normalize(value) {
    if (value == null) return defaults();
    if (value.version !== VERSION || !['off','custom'].includes(value.mode) || !['adult','other'].includes(value.scenario)) fail('试评规则版本/模式/场景不兼容。');
    const rules = {};
    for (const key of keys) {
      const r = value.rules?.[key];
      if (!r || typeof r.weight !== 'number' || !Number.isFinite(r.weight) || r.weight < 0 || r.weight > 100) fail('权重须为0–100的数字。');
      rules[key] = {weight:r.weight,criterion:str(r.criterion,2000)};
    }
    if (value.mode === 'custom' && !keys.some(key=>rules[key].weight > 0)) fail('至少一个维度权重须大于0；全零不计算。');
    return {version:VERSION,mode:value.mode,scenario:value.scenario,rules};
  }
  function weightScheme(value) {
    const c = normalize(value), sum = keys.reduce((n,k)=>n+c.rules[k].weight,0);
    return weightSchemes.find(s=>keys.every((k,i)=>Math.abs((sum ? c.rules[k].weight/sum : 0)-s.weights[i]/100)<1e-9)) || null;
  }
  function applyWeightScheme(value,id) {
    const c = normalize(value), scheme = weightSchemes.find(s=>s.id===id);
    if (!scheme) fail('未知权重方案，未改当前配置。');
    keys.forEach((key,i)=>{c.rules[key].weight=scheme.weights[i];});
    return c;
  }
  function source(p) {
    return {file:p.source?.file ?? null,sheet:p.source?.sheet ?? '产品信息',row:p.source?.row ?? null};
  }
  function facts(p, key) {
    const d = definitions.find(d=>d.key === key);
    if (!d) fail('未知维度。');
    const raw = p.details || p.raw || {};
    const rows = d.fields.map(([field,label])=>({field,label,value:raw[field] ?? null}));
    if (key === 'nutrition') rows.push({field:'stage',label:'阶段归类（规则）',value:p.stage ?? null});
    // Only attach the relevant explicit analysis context; legacy products keep their tokens.
    if (p.analysisInputs || p.analysisRevision) {
      const contextFields = key === 'nutrition' ? ['nutritionBasis','proteinComparator','fatComparator','energyKcalKg']
        : key === 'ingredients' ? ['animalIngredientDenominator','animalProteinDenominator','animalIngredientUnit','animalProteinUnit'] : [];
      if (contextFields.length) rows.push({field:'analysisContext',label:'分析口径与绑定状态',value:JSON.stringify({
        state:p.analysisInputState ?? 'unknown',
        inputs:Object.fromEntries(contextFields.map(field=>[field,p.analysisInputs?.[field] ?? null])),
        sourceText:p.analysisInputs?.sourceText ?? null
      })});
    }
    if (key === 'transparency') rows.push({field:'importStatus',label:'进口分类（不等于手续已核）',value:p.importStatus ?? null});
    if (key === 'value') {
      rows.push({field:'pricePerJin',label:'当前参考元/斤',value:p.pricePerJin ?? null},
        {field:'priceBasis',label:'报价口径',value:p.priceBasis?.label ?? null},
        {field:'activeQuote',label:'明确包装报价记录',value:p.activeQuote ? JSON.stringify(p.activeQuote) : null});
    }
    return {rows,source:source(p),boundary:d.boundary};
  }
  function snapshot(p, key) {
    const f = facts(p,key);
    return JSON.stringify({skuId:p.skuId,formulaVersion:p.formulaVersion ?? null,formulaVersionId:p.formulaVersionId ?? null,
      identity:[p.brand,p.series,p.product,p.flavor,p.stage],source:f.source,rows:f.rows});
  }
  function ruleToken(config, key) {
    return JSON.stringify([VERSION,config.scenario,config.rules[key].criterion]);
  }
  function entry(value) {
    if (!value || typeof value !== 'object') fail('缺少分项记录。');
    const points = value.points;
    if (points !== null && (typeof points !== 'number' || !Number.isFinite(points) || points < 0 || points > 100)) fail('分项分须为0–100，未知请留空。');
    const reason = str(value.reason,2000,true), evidence = str(value.evidence,2000,true);
    if (points !== null && (!reason || !evidence)) fail('填写分项分时必须说明判分理由和出处；缺依据请留空。');
    return {points,reason,evidence,snapshot:str(value.snapshot,100000),ruleToken:str(value.ruleToken,5000)};
  }
  function record(p, config, values = {}, risk = '') {
    config = normalize(config);
    const dimensions = Object.fromEntries(keys.map(key=>[key,entry({points:null,reason:'',evidence:'',...values[key],
      snapshot:snapshot(p,key),ruleToken:ruleToken(config,key)})]));
    return {skuId:str(p.skuId,200),formulaVersion:p.formulaVersion ?? null,
      label:[p.brand,p.product,p.flavor].filter(Boolean).join(' · '),risk:str(risk,2000,true),dimensions};
  }
  function normalizeRecord(r) {
    if (!r || typeof r !== 'object' || r.formulaVersion !== null && typeof r.formulaVersion !== 'string') fail();
    return {skuId:str(r.skuId,200),formulaVersion:r.formulaVersion,label:str(r.label,500),risk:str(r.risk,2000,true),
      dimensions:Object.fromEntries(keys.map(key=>[key,entry(r.dimensions?.[key])]))};
  }
  function score(p, config, r) {
    config = normalize(config);
    if (r) r = normalizeRecord(r);
    const weightSum = keys.reduce((sum,key)=>sum+config.rules[key].weight,0);
    const dimensions = definitions.map(d=>{
      const rule = config.rules[d.key], e = r?.skuId === p.skuId ? r.dimensions[d.key] : null;
      const stale = !!e && e.points !== null && (e.snapshot !== snapshot(p,d.key) || e.ruleToken !== ruleToken(config,d.key));
      const points = !stale && e ? e.points : null;
      const reason = stale ? '资料/场景/判分依据已变，旧分不参与；请重新试评' : points === null ? '未知 / 未评分' : '自填候选分，非已核专业结论';
      const weight = weightSum ? rule.weight / weightSum : 0;
      return {key:d.key,label:d.label,points,weight,contribution:points === null || !rule.weight ? null : points*weight,
        stale,reason,evidence:e?.evidence || '',rationale:e?.reason || '',enabled:rule.weight > 0};
    });
    const enabled = dimensions.filter(d=>d.enabled), coverage = enabled.reduce((sum,d)=>sum+(d.points !== null ? d.weight : 0),0);
    const limitations = [];
    if (config.scenario !== 'adult') limitations.push('其他/疾病/处方场景仅记录分项，不出总分');
    if (!['成猫','全阶段'].includes(p.stage)) limitations.push('当前阶段不在普通成年猫候选范围，或阶段未知');
    if (r?.skuId === p.skuId && r.risk) limitations.push(`适用限制：${r.risk}（不能被总分抵消）`);
    const total = config.mode === 'custom' && enabled.length > 0 && enabled.every(d=>d.points !== null) && !limitations.length
      ? Math.round(enabled.reduce((sum,d)=>sum+d.contribution,0)*100)/100 : null;
    return {total,coverage,dimensions,limitations,excluded:dimensions.filter(d=>!d.enabled).map(d=>d.label),
      missing:enabled.filter(d=>d.points===null).map(d=>d.label)};
  }
  function session(value) {
    if (!value || value.version !== VERSION || !Array.isArray(value.records) || value.records.length < 2 || value.records.length > 6) fail('试评应包含2–6款SKU，版本须兼容。');
    const records = value.records.map(normalizeRecord);
    if (new Set(records.map(r=>r.skuId)).size !== records.length) fail('试评SKU重复。');
    const createdAt = str(value.createdAt,40);
    if (!Number.isFinite(Date.parse(createdAt))) fail('试评时间无效。');
    return {version:VERSION,name:str(value.name,60),createdAt,config:normalize(value.config),records};
  }
  function read(storage) {
    const raw = storage.getItem(KEY);
    if (raw == null) return [];
    let doc;
    try { doc = JSON.parse(raw); } catch { fail(); }
    if (doc?.version !== 1 || !Array.isArray(doc.trials) || doc.trials.length > 20) fail();
    const trials = doc.trials.map(session);
    if (new Set(trials.map(t=>t.name)).size !== trials.length) fail();
    return trials;
  }
  function add(storage, value) {
    const trials = read(storage), next = session(value);
    if (trials.some(t=>t.name === next.name)) fail('已有同名试评，请另取名称；不会覆盖旧记录。');
    if (trials.length >= 20) fail('本浏览器最多20次试评；请先导出备份并移除不用的记录。');
    storage.setItem(KEY,JSON.stringify({version:1,trials:[...trials,next]}));
    return next;
  }
  function remove(storage, name) {
    const trials = read(storage), old = trials.find(t=>t.name === name);
    if (!old) fail('试评已不存在。');
    storage.setItem(KEY,JSON.stringify({version:1,trials:trials.filter(t=>t.name !== name)}));
    return old;
  }
  return {VERSION,KEY,definitions,keys,weightSchemes,weightScheme,applyWeightScheme,defaults,normalize,facts,snapshot,ruleToken,record,score,session,read,add,remove};
});

;
(function(root,factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetFoodAnalysis = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this,function() {
  'use strict';
  const VERSION='target-analysis-v1';
  const keys=['nutrition','ingredients','evidence','transparency','value'];
  const labels={nutrition:'营养条件匹配',ingredients:'配料条件匹配',evidence:'功能证据',transparency:'生产透明',value:'预算匹配'};
  const INPUTS={
    nutritionBasis:{label:'保证值计量基准',options:{unknown:'未知',as_fed:'原物质 / 原样',dry_matter:'干物质'}},
    proteinComparator:{label:'粗蛋白比较符',options:{unknown:'未知',ge:'≥ 下界',le:'≤ 上界',eq:'= 明确等值'}},
    fatComparator:{label:'粗脂肪比较符',options:{unknown:'未知',ge:'≥ 下界',le:'≤ 上界',eq:'= 明确等值'}},
    animalIngredientDenominator:{label:'动物原料比例分母',options:{unknown:'未知',input_mass:'投料总质量',finished_mass:'成品总质量'}},
    animalIngredientUnit:{label:'动物原料比例单位',options:{unknown:'未知',fraction:'0–1比例',percent:'百分比'}},
    animalProteinDenominator:{label:'动物蛋白比例分母',options:{unknown:'未知',total_protein:'总蛋白'}},
    animalProteinUnit:{label:'动物蛋白比例单位',options:{unknown:'未知',fraction:'0–1比例',percent:'百分比'}}
  };
  const fail=()=>{throw new Error('自动分析设置无效；未知留空，范围为0–100，预算缓冲须大于0。');};
  function defaults() {return {version:VERSION,mode:'off',scenario:'adult',weights:{nutrition:40,ingredients:35,evidence:0,transparency:0,value:25},
    basis:'as_fed',proteinMin:null,fatMax:null,requiredWords:'',excludedWords:'',
    animalIngredientMin:null,animalIngredientDenominator:'input_mass',animalProteinMin:null,
    budgetMax:null,budgetBuffer:20,priceScope:'consistent',riskNotes:{}};}
  function normalize(v) {
    if (v==null) return defaults();
    if (v.version!==VERSION || !['off','custom'].includes(v.mode) || !['adult','other'].includes(v.scenario) ||
      !['as_fed','dry_matter'].includes(v.basis) || !['input_mass','finished_mass'].includes(v.animalIngredientDenominator) ||
      !['consistent','reference'].includes(v.priceScope)) fail();
    const c={version:VERSION,mode:v.mode,scenario:v.scenario,basis:v.basis,animalIngredientDenominator:v.animalIngredientDenominator,priceScope:v.priceScope,weights:{}};
    for(const k of keys) {
      const n=v.weights?.[k];if(!Number.isFinite(n)||n<0||n>100)fail();c.weights[k]=n;
    }
    if(v.mode==='custom'&&!keys.some(k=>c.weights[k]>0))fail();
    for(const k of ['proteinMin','fatMax','animalIngredientMin','animalProteinMin','budgetMax']) {
      const n=v[k];if(n!==null&&(!Number.isFinite(n)||n<0||n>(k==='budgetMax'?1e6:100)))fail();c[k]=n;
    }
    if(!Number.isFinite(v.budgetBuffer)||v.budgetBuffer<=0||v.budgetBuffer>1e6)fail();c.budgetBuffer=v.budgetBuffer;
    for(const k of ['requiredWords','excludedWords']) {if(typeof v[k]!=='string'||v[k].length>1000)fail();c[k]=v[k].trim();}
    const notes=v.riskNotes??{};
    if(!notes||typeof notes!=='object'||Array.isArray(notes)||Object.keys(notes).length>200)fail();
    c.riskNotes={};
    for(const [id,note] of Object.entries(notes)) {
      if(!id||id.length>200||typeof note!=='string'||note.length>1000)fail();
      if(note.trim())Object.defineProperty(c.riskNotes,id,{value:note.trim(),enumerable:true});
    }
    return c;
  }
  function words(text){return [...new Set(text.normalize('NFKC').toLowerCase().split(/[\s,，、;；]+/).filter(Boolean))];}
  function metadata(p) {
    return p.analysisInputState==='current'&&p.analysisInputs ? p.analysisInputs : {};
  }
  function parseGuarantee(raw,comparator,basis) {
    const m=String(raw??'').normalize('NFKC').match(/^\s*(≥|≤|>=|<=|=|>|<)?\s*(\d+(?:\.\d+)?)\s*(%)?\s*(?:[（(](以干物质计|以原物质计)[）)])?\s*$/);
    if(!m||Number(m[2])>100) return {reason:'保证值原文无法保守解析'};
    if(['>','<'].includes(m[1]))return {reason:'严格不等号暂不转换为闭区间，保留未知'};
    const parsed={'≥':'ge','>=':'ge','>':'ge','≤':'le','<=':'le','<':'le','=':'eq'}[m[1]];
    if(parsed&&comparator&&comparator!=='unknown'&&parsed!==comparator) return {reason:'原文比较符与维护口径冲突'};
    const comp=parsed||comparator;
    const inlineBasis=m[4]==='以干物质计'?'dry_matter':m[4]==='以原物质计'?'as_fed':null;
    if(inlineBasis&&basis&&basis!=='unknown'&&basis!==inlineBasis)return {reason:'原文计量基准与维护口径冲突'};
    const b=inlineBasis||basis;
    if(!['ge','le','eq'].includes(comp))return {reason:'比较符未知，不能把记录值当实测值'};
    if(!['as_fed','dry_matter'].includes(b))return {reason:'计量基准未知；请在产品编辑中补口径'};
    const value=Number(m[2]);
    return {value,comparator:comp,basis:b,low:comp==='le'?0:value,high:comp==='ge'?100:value};
  }
  function threshold(interval,target,direction) {
    if(interval.reason)return {points:null,reason:interval.reason};
    const pass=direction==='min'?interval.low>=target:interval.high<=target;
    const fail=direction==='min'?interval.high<target:interval.low>target;
    return {points:pass?100:fail?0:null,reason:pass?'保证范围能支持所设条件':fail?'保证范围与所设条件不相交':'保证值只给边界，不能判断是否满足所设条件'};
  }
  function ratio(raw,unit) {
    const m=String(raw??'').normalize('NFKC').match(/^\s*(\d+(?:\.\d+)?)\s*(%)?\s*$/);
    if(!m)return {reason:'含量原文为声称/范围或含糊文本，未取首数'};
    if(!['fraction','percent'].includes(unit))return {reason:'比例单位未知，不能猜0.85与85的含义'};
    if(m[2]&&unit!=='percent')return {reason:'原文百分号与维护单位冲突'};
    const n=Number(m[1])*(unit==='fraction'?100:1);
    return n<=100?{value:n}:{reason:'比例数值与单位不一致'};
  }
  function combine(checks) {
    return {points:checks.length&&checks.every(c=>c.points!==null)?checks.reduce((s,c)=>s+c.points,0)/checks.length:null,
      reason:checks.length?checks.map(c=>c.reason).join('；'):'未设置本维度条件，不自动评分',checks};
  }
  function score(p,value,risk='') {
    const c=normalize(value),m=metadata(p),raw=p.details||p.raw||{},checks=[];
    const source=[p.source?.file,'产品信息第'+(p.source?.row??'?')+'行',m.sourceText].filter(Boolean).join(' · ');
    for(const [key,target,direction,label] of [['protein',c.proteinMin,'min','粗蛋白下限'],['fat',c.fatMax,'max','粗脂肪上限']]) {
      if(target===null)continue;
      const v=parseGuarantee(raw[key+'_raw'],m[key+'Comparator'],m.nutritionBasis);
      const result=!v.reason&&v.basis!==c.basis?{points:null,reason:'标签与目标计量基准不同，不跨基准换算'}:threshold(v,target,direction);
      checks.push({...result,reason:label+' '+target+'%：'+result.reason});
    }
    const ingredients=[],text=String(raw.ingredients_raw??'').normalize('NFKC').toLowerCase(),required=words(c.requiredWords),excluded=words(c.excludedWords);
    if(required.length||excluded.length) {
      if(!text.trim())ingredients.push({points:null,reason:'配料原文缺失，不按未命中给通过'});
      else {
        const absent=required.filter(w=>!text.includes(w)),hits=excluded.filter(w=>text.includes(w));
        ingredients.push({points:absent.length||hits.length?0:100,reason: '标签文字条件：'+(absent.length?'未命中必含词 '+absent.join('、')+'；':'')+(hits.length?'命中排除词 '+hits.join('、'):'')+(!absent.length&&!hits.length?'匹配所设词语；不证明无过敏原或功效':'')});
      }
    }
    for(const [key,target,denominator,unit,label] of [
      ['animal_ingredient_ratio_raw',c.animalIngredientMin,m.animalIngredientDenominator===c.animalIngredientDenominator,m.animalIngredientUnit,'动物原料'],
      ['animal_protein_ratio_raw',c.animalProteinMin,m.animalProteinDenominator==='total_protein',m.animalProteinUnit,'动物来源蛋白占总蛋白']]) {
      if(target===null)continue;
      const v=ratio(raw[key],unit);
      ingredients.push(!denominator?{points:null,reason:label+'分母未知或不匹配'}:v.reason?{points:null,reason:label+'：'+v.reason}:{points:v.value>=target?100:0,reason:label+'记录 '+v.value+'%，目标至少 '+target+'%；仅比较同分母记录，不核准声称'});
    }
    let budget={points:null,reason:'未设置预算，不自动评分'};
    if(c.budgetMax!==null) {
      const price=p.pricePerJin,eligible=c.priceScope==='reference'||['single_consistent','bound'].includes(p.priceBasis?.scope);
      budget=!eligible?{points:null,reason:'规格/价格对应不清，严格口径不计入'}:
        !Number.isFinite(price)||price<0?{points:null,reason:'缺明确单值参考价'}:
        {points:Math.max(0,100*(1-Math.max(0,price-c.budgetMax)/c.budgetBuffer)),reason:'参考 '+price+' 元/斤，预算 '+c.budgetMax+'；预算内100，超出每 '+c.budgetBuffer+' 元下降100分，最低0；不是价值/品质评级'};
    }
    const values={nutrition:combine(checks),ingredients:combine(ingredients),evidence:{points:null,reason:'未实现专业证据自动判分，查看原文/人工试评'},transparency:{points:null,reason:'未实现生产透明度自动判分，进口分类不加分'},value:budget};
    const sum=keys.reduce((n,k)=>n+c.weights[k],0);
    const dimensions=keys.map(k=>({key:k,label:labels[k],...values[k],points:c.mode==='off'?null:values[k].points,weight:sum?c.weights[k]/sum:0,enabled:c.weights[k]>0,source}));
    for(const d of dimensions)d.contribution=d.points===null||!d.enabled?null:d.points*d.weight;
    const missing=dimensions.filter(d=>d.enabled&&d.points===null).map(d=>d.label);
    const limitations=[];
    if(c.scenario!=='adult'||!['成猫','全阶段'].includes(p.stage))limitations.push('非普通成年猫候选场景或阶段不明，只看分项');
    if(risk)limitations.push('人工适用限制：'+risk+'（不能被总分抵消）');
    if(c.riskNotes[p.skuId])limitations.push('本次适用限制：'+c.riskNotes[p.skuId]+'（不能被总分抵消）');
    const warnings=p.analysisInputState==='stale'?['维护口径绑定的资料已变化，旧口径停用；不依赖此口径的分项仍可计算']:[];
    const total=c.mode==='custom'&&sum>0&&!missing.length&&!limitations.length?dimensions.filter(d=>d.enabled).reduce((n,d)=>n+d.contribution,0):null;
    return {version:VERSION,total,dimensions,missing,limitations,warnings,coverage:dimensions.reduce((n,d)=>n+(d.enabled&&d.points!==null?d.weight:0),0)};
  }
  function summary(p,c,risk='') {
    const s=score(p,c,risk);if(c.mode==='off')return '自动条件分析未启用';
    return (s.total===null?'条件匹配总分：—':'条件匹配 '+s.total.toFixed(2)+'/100（非质量分）')+'\n'+s.dimensions.filter(d=>d.enabled).map(d=>d.label+'：'+(d.points===null?'未知':d.points.toFixed(2)+'分')+'；'+d.reason).join('\n')+(s.limitations.length?'\n'+s.limitations.join('；'):'');
  }
  function editorHtml(p,esc) {
    const v=p.analysisInputs||{};
    return '<details class="detail-section" id="analysis-input-editor"><summary>分析口径：营养基准 / 含量分母</summary><p class="detail-help">只补有来源的口径，未知保持未知。保存到本品牌Excel“分析口径”页，不替换原始数值；资料变化后旧口径停用。</p><p>当前状态：'+esc(p.analysisInputState||'unknown')+'</p><label class="edit-field"><span>本次口径操作</span><select name="analysisMode"><option value="keep">不改口径</option><option value="save">补充 / 更新口径</option><option value="withdraw">停用当前口径</option></select></label><div id="analysis-input-fields" class="edit-grid" hidden>'+
      Object.entries(INPUTS).map(([key,f])=>'<label class="edit-field"><span>'+f.label+'</span><select name="analysis_'+key+'">'+Object.entries(f.options).map(([k,label])=>'<option value="'+k+'" '+((v[key]||'unknown')===k?'selected':'')+'>'+label+'</option>').join('')+'</select></label>').join('')+
      '<label class="edit-field"><span>能量 kcal/kg（有本款依据才填）</span><input type="number" name="analysis_energyKcalKg" min="0.01" max="20000" step="any" value="'+esc(v.energyKcalKg??'')+'"></label><label class="edit-field"><span>本款口径来源 / 背标位置</span><textarea name="analysis_sourceText" rows="2" maxlength="2000">'+esc(v.sourceText||'')+'</textarea></label></div></details>';
  }
  function editorPayload(form,p) {
    const mode=form.elements.analysisMode.value;
    if(mode==='keep')return {};
    let value=null;
    if(mode==='save') {
      value=Object.fromEntries(Object.keys(INPUTS).map(k=>[k,form.elements['analysis_'+k].value]));
      const energy=form.elements.analysis_energyKcalKg.value;
      value.energyKcalKg=energy===''?null:Number(energy);value.sourceText=form.elements.analysis_sourceText.value.trim();
      if(!value.sourceText&&Object.keys(INPUTS).some(k=>value[k]!=='unknown')||value.energyKcalKg!==null&&!value.sourceText)throw new Error('补充口径时请填写本款来源；不确定的项保持未知。');
    }
    return {analysisInputs:value,expectedAnalysisRevision:p.analysisRevision??null};
  }
  return {VERSION,keys,labels,INPUTS,defaults,normalize,parseGuarantee,threshold,ratio,words,score,summary,editorHtml,editorPayload};
});

;
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.PFDSIntake=api;})(typeof window==='object'?window:globalThis,function(){
  const VERSION='pfds-intake-v1';
  const fields=[['brand_name','品牌'],['series_name','系列'],['product_name','产品'],['flavor','口味'],
    ['life_stage_raw','适用阶段'],['format_raw','形态'],['package_size_raw','规格'],['shelf_life_raw','保质期（未开封）'],
    ['page_price_raw','页面价格（元）'],['price_per_jin_raw','元/斤'],['ingredients_raw','配方（原料，原始顺序）'],
    ['additives_raw','营养添加剂（原始顺序）'],['protein_raw','蛋白质（%）'],['fat_raw','脂肪（%）'],
    ['other_guaranteed_analysis_raw','其他保证值（原文）'],['process_claim_raw','工艺/官方原话'],
    ['animal_ingredient_ratio_raw','动物性原料占比'],['animal_protein_ratio_raw','动物性蛋白占比'],
    ['total_tract_digestibility_raw','全肠道粗蛋白质消化率'],['pepsin_digestibility_raw','胃蛋白酶消化率'],
    ['feeding_study_raw','正式喂养实验/研究信息'],['marketing_claims_raw','页面卖点/声称'],['traceability_raw','原料溯源'],
    ['factory_import_raw','工厂/进口信息'],['brand_positioning_raw','品牌定位'],['market_position_raw','市场地位'],
    ['rd_capability_raw','研发能力'],['brand_endorsement_raw','品牌背书'],['function_raw','功能'],
    ['core_product_raw','核心产品'],['production_mode_raw','生产方式'],['factory_name_raw','工厂名称']];
  const quoteFields=[['package','绑定包装','text'],['grams','单包装净重（g）','number'],['quantity','购买数量','number'],
    ['total','实付总价（元）','number'],['date','报价日期','date'],['channel','渠道','text'],
    ['conditions','优惠条件 / 赠品','text'],['sourceText','报价来源','text']];
  function parseRefs(text){const out={};for(const line of text.split('\n').map(x=>x.trim()).filter(Boolean)){
    const n=line.indexOf('：')>=0?line.indexOf('：'):line.indexOf(':');
    if(n<1)throw new Error('字段出处按每行“字段名：位置”填写。');
    const label=line.slice(0,n).trim();if(!fields.some(f=>f[1]===label)||Object.hasOwn(out,label))throw new Error('字段出处名称未知或重复：'+label);
    out[label]=line.slice(n+1).trim();}return out;}
  function fromForm(form,analysis){
    const get=k=>form.elements[k].value.trim();
    const draft={'版本':VERSION,'原文字段':Object.fromEntries(fields.map(([k,l])=>[l,get(k)||null])),
      '来源':{'说明':get('intake_source'),'字段出处':parseRefs(get('intake_refs')),'待确认':get('intake_questions').split('\n').map(s=>s.trim()).filter(Boolean)},
      '分析口径':form.elements.analysisMode.value==='save'?{
        ...Object.fromEntries(Object.keys(analysis.INPUTS).map(k=>[k,get('analysis_'+k)])),
        energyKcalKg:get('analysis_energyKcalKg')===''?null:Number(get('analysis_energyKcalKg')),sourceText:get('analysis_sourceText')}:null,
      '报价':form.elements.intake_quote.checked?Object.fromEntries(quoteFields.map(([k])=>[k,get('intake_quote_'+k)])):null};
    return draft;
  }
  function validateShape(draft){
    if(!draft||draft['版本']!==VERSION||!draft['原文字段']||typeof draft['原文字段']!=='object'||Array.isArray(draft['原文字段']))throw new Error('不是pfds-intake-v1整理模板。');
    if(Object.keys(draft).some(k=>!['版本','原文字段','来源','分析口径','报价'].includes(k)))throw new Error('模板包含未知分区。');
    for(const [label,v] of Object.entries(draft['原文字段'])){
      if(!fields.some(f=>f[1]===label)||v!==null&&!['string','number'].includes(typeof v)||typeof v==='number'&&!Number.isFinite(v))throw new Error('原文字段不正确：'+label);
    }
    for (const [label,allowed] of [['核心产品',['是','否']],['生产方式',['自有','代工']]]) {
      const v=draft['原文字段'][label];
      if (v != null && v !== '' && (typeof v !== 'string' || !allowed.includes(v.trim()))) throw new Error(label+'选项不正确，未知留空。');
    }
    const factory=draft['原文字段']['工厂名称'];
    if (factory != null && (typeof factory !== 'string' || factory.length > 500)) throw new Error('工厂名称应为500字以内的文字，未知留空。');
    const notes=draft['来源']||{};
    if(typeof notes!=='object'||Array.isArray(notes)||Object.keys(notes).some(k=>!['说明','字段出处','待确认'].includes(k))||
       (notes['说明']!==undefined&&typeof notes['说明']!=='string')||notes['待确认']&&(!Array.isArray(notes['待确认'])||notes['待确认'].some(v=>typeof v!=='string')))throw new Error('来源结构不正确。');
    const refs=notes['字段出处']||{};if(typeof refs!=='object'||Array.isArray(refs))throw new Error('字段出处须为对象。');
    for(const [l,v] of Object.entries(refs))if(!fields.some(f=>f[1]===l)||typeof v!=='string')throw new Error('字段出处不正确。');
    return draft;
  }
  // Read-only assistance, not a merge plan. Only current names are matched;
  // no aliases, missing facts, package weights or nutrition bounds are inferred.
  // Arrays are capped for rendering; totals explicitly disclose omitted results.
  function review(draft,products){
    validateShape(draft);
    if(!Array.isArray(products))throw new Error('审核需要产品列表。');
    const raw=draft['原文字段'], notes=draft['来源']||{}, analysis=draft['分析口径']||{};
    const blank=v=>v==null||typeof v==='string'&&!v.trim();
    const norm=v=>String(v??'').normalize('NFKC').trim().toLowerCase();
    const same=(a,b)=>!blank(a)&&!blank(b)&&norm(a)===norm(b);
    const identityKeys={brand:'brand_name',series:'series_name',product:'product_name',flavor:'flavor'};
    const original=(p,k)=>Object.hasOwn(p.details||{},k)?p.details[k]:null;
    const identity=(p,k)=>Object.hasOwn(p.details||{},identityKeys[k])?p.details[identityKeys[k]]:p[k]??null;
    const warnings=[];
    const warn=(code,field,message)=>warnings.push({code,field,message});
    const provided=fields.filter(([,label])=>Object.hasOwn(raw,label));
    const explicitBlankFields=provided.filter(([,label])=>blank(raw[label])).map(([key,label])=>({key,label,value:raw[label]}));
    if(explicitBlankFields.length)warn('explicit_blanks',null,'草稿含明确空白；空白不表示删除旧值，覆盖须逐项确认。');
    if(blank(notes['说明']))warn('missing_source',null,'缺少资料来源位置，请补图片、文件或页面出处；填写来源不代表已核实。');
    const missingFieldSources=provided.filter(([,l])=>!blank(raw[l])&&blank(notes['字段出处']?.[l])).map(([key,label])=>({key,label}));
    if(missingFieldSources.length)warn('missing_field_sources',null,'部分已填字段未标具体出处，可补图片序号或原文位置。');
    if(blank(raw['品牌']))warn('missing_brand','brand_name','品牌未填，暂不跨品牌查找候选。');
    const brandRows=products.filter(p=>p&&same(raw['品牌'],identity(p,'brand')));
    const groups=new Map();
    for(const p of brandRows){
      const brand=identity(p,'brand'),series=identity(p,'series'),key=JSON.stringify([norm(brand),norm(series)]);
      if(!groups.has(key))groups.set(key,{brand,series,count:0,skuIds:[]});
      const group=groups.get(key);group.count++;if(group.skuIds.length<12)group.skuIds.push(p.skuId??null);
    }
    const matches=[];
    for(const p of brandRows){
      const productMatch=same(raw['产品'],identity(p,'product')),flavorMatch=same(raw['口味'],identity(p,'flavor'));
      if(!productMatch&&!flavorMatch)continue;
      const seriesMatch=same(raw['系列'],identity(p,'series'));
      const reasons=[{code:'same_brand',message:'品牌名称相同'}];
      if(productMatch)reasons.push({code:'same_product',message:'产品名称相同'});
      if(flavorMatch)reasons.push({code:'same_flavor',message:'口味相同'});
      if(seriesMatch)reasons.push({code:'same_series',message:'系列名称相同'});
      if(!blank(raw['系列'])&&!blank(identity(p,'series'))&&!seriesMatch)reasons.push({code:'different_series',message:'系列不同，需人工排除同名款'});
      const changes=[];
      for(const [key,label] of provided){
        const before=original(p,key),after=raw[label],explicitBlank=blank(after);
        // Excel originals are strings. Numeric zero and textual zero are equal,
        // but no trimming/normalization hides a change to original wording.
        if((blank(before)&&explicitBlank)||(!blank(before)&&!explicitBlank&&String(before)===String(after)))continue;
        changes.push({key,label,before,after,kind:explicitBlank?'explicit_blank':blank(before)?'added':'changed',
          message:explicitBlank?'草稿明确留空；不自动清空已有原文':blank(before)?'草稿新增原文，待核对':'与已有原文不同，待核对'});
      }
      matches.push({skuId:p.skuId??null,formulaVersion:p.formulaVersion??null,
        brand:identity(p,'brand'),series:identity(p,'series'),product:identity(p,'product'),flavor:identity(p,'flavor'),
        match:productMatch&&flavorMatch?'same_product_flavor':productMatch?'same_product':'same_flavor',reasons,changes});
    }
    const rank={same_product_flavor:0,same_product:1,same_flavor:2};
    matches.sort((a,b)=>rank[a.match]-rank[b.match]);
    if(matches.length>1)warn('ambiguous_candidates',null,'有多个候选，不能自动确定同一SKU或合并。');
    for(const [label,key] of [['蛋白质（%）','protein'],['脂肪（%）','fat']]){
      if(blank(raw[label]))continue;
      const text=norm(raw[label]),inline=/^\s*(>=|<=|≥|≤|=|>|<)/.exec(text)?.[1];
      const comparator=analysis[key+'Comparator'];
      if(!inline&&!['ge','le','eq'].includes(comparator))warn('missing_nutrition_comparator',key+'_raw',label+'未注明比较符，不能当作等值或实测值。');
      const parsed={'>=':'ge','≥':'ge','<=':'le','≤':'le','=':'eq'}[inline];
      if(inline&&['ge','le','eq'].includes(comparator)&&parsed!==comparator)warn('nutrition_comparator_conflict',key+'_raw',label+'原文比较符与分析口径不一致，请核对。');
      if(!['as_fed','dry_matter'].includes(analysis.nutritionBasis)&&!/[（(]以(?:干物质|原物质)计[）)]/.test(text))warn('missing_nutrition_basis',key+'_raw',label+'计量基准未明确，不跨基准比较。');
    }
    const hasPrice=!blank(raw['页面价格（元）'])||!blank(raw['元/斤']),q=draft['报价'];
    if(hasPrice&&blank(raw['规格']))warn('missing_package','package_size_raw','已有价格但规格为空，需确认对应包装。');
    if(hasPrice&&!q)warn('unbound_price','page_price_raw','原文价格尚未绑定明确报价；不从规格推算数量或单位价。');
    if(q){
      if(blank(q.package))warn('missing_quote_package','package','报价未填写绑定包装。');
      for(const key of ['grams','quantity','total']){
        const value=q[key],validType=typeof value==='number'||typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value.trim());
        const n=Number(value);
        if(blank(value)||!validType||!Number.isFinite(n)||n<0||key!=='total'&&n===0||key==='quantity'&&(!Number.isInteger(n)||n>100000))warn('invalid_quote_number',key,'报价'+({grams:'单包装净重须大于0',quantity:'数量须为1至100000的整数',total:'总价须为非负明确数字'})[key]+'。');
      }
      if(!blank(q.package)&&!blank(raw['规格'])&&!same(q.package,raw['规格']))warn('quote_package_differs','package','报价包装与规格原文不同，请人工确认对应关系；不自动换算。');
      if(blank(q.sourceText))warn('missing_quote_source','sourceText','报价来源未填。');
      if(blank(q.date)||blank(q.channel))warn('incomplete_quote_context',null,'报价日期或渠道未填，不能当作当前通用售价。');
    }
    return {version:'pfds-intake-review-v1',summary:matches.length?'发现'+matches.length+'个候选，请逐项核对；未合并或写入。':'未找到同品牌同名或同口味候选；不证明是新SKU。',
      candidateCount:matches.length,ambiguous:matches.length>1,candidates:matches.slice(0,12),
      candidatesTruncated:matches.length>12,groupCount:groups.size,groups:[...groups.values()].slice(0,12),groupsTruncated:groups.size>12,
      explicitBlankFields,missingFieldSources,warnings};
  }
  return {VERSION,fields,quoteFields,parseRefs,fromForm,validateShape,review};
});

;
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./evaluation.js'));
  else root.PetFoodCalibration = factory(root.PetFoodEvaluation);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(engine) {
  'use strict';
  const VERSION = 'calibration-v1', AS_OF = '2026-10-03';
  const bindings = {"pub_49a3729e441a6554c3c5":{"nutrition":"db59103fd1c8f346","ingredients":"5f61f0d278b19c06","evidence":"c30e0f0344281b5f","transparency":"8fd62d61117b1ca1","value":"b1b9f30ba5182c4f"},"pub_eb3094d8cdff6cbe7546":{"nutrition":"fc29bc2d19dd9547","ingredients":"5b6b8a66e89da2a9","evidence":"6e41338cea0fbd56","transparency":"8203522fffc290b7","value":"b19dbc22311617b2"},"pub_0cd84f2a9d42bc52a8c1":{"nutrition":"4e456c16d55d5566","ingredients":"530353646d7dac2b","evidence":"c7d58b5126bae27d","transparency":"fec17d048d0b8344","value":"b4c9649ecd3986c4"}};
  const sources = {"p40_chicken":{"path":"公开资料记录","sha256":"c477195be40238b49d798506358d22106553c6689748279f891f5bd8631cbffb"},"p40_pigeon":{"path":"公开资料记录","sha256":"b172927b0f230d367662f45bdeaffa5a8114dfc36943184a6eba96136f10a48e"},"p40_supplier":{"path":"公开资料记录","sha256":"cf46be96bdd5162c1ebffff86ab00982e5ea2f01888a6762694486e3198adc9e"},"p40_pigeon_claim":{"path":"公开资料记录","sha256":"3e6829bbf32dc4921ce7c7bc265492f66849e694cf195cdb569e46833e89e631"},"farmina_adult":{"path":"公开资料记录","sha256":"c67df8e41a2fe6ac66df64c0ea4405597a54823eebc818add9cfe2350f44adf5"},"farmina_protein_claim":{"path":"公开资料记录","sha256":"b7a53af4b873e58876a10ffe990e3587830985b91eacb4ac0020dde3f52d81a5"}};
  const labels = {p40_chicken:'P40鸡鱼配料与保证值图',p40_pigeon:'P40乳鸽配料与保证值图',p40_supplier:'P40原料供应商图',p40_pigeon_claim:'P40乳鸽84%鲜肉声称图',farmina_adult:'法米纳鸡肉石榴成猫成分图',farmina_protein_claim:'法米纳系列98%动物蛋白声称图'};
  const rubric = {
    nutrition:{focus:'先核阶段、主食定位、能量及保证值的比较符/单位/基准，再按本场景适用标准与实际需求逐项判断。不从40/44或干物质估算值直接给品质分。',
      bands:['0：已核证据明确不满足本次指定营养判据；实际不适用/风险另列限制，不靠总分决定。','50：已核适用性基本成立，具体营养目标有明显限制。','75：适用性成立，已选关键营养目标得到较好支持，限制不改变本次行动。','100：本次明确的营养目标在已核范围支持充分；不表示全面合格或所有猫适用。']},
    ingredients:{focus:'针对明确饮食需求看完整原料、添加剂、比例口径与个体限制；鲜/干、无谷/肉粉或营销投料量不直接排序。没有可用分母时只描述，不算肉含量分。',
      bands:['0：已核配方事实明确不满足本次指定判据；过敏等另列适用限制。','50：明确配方需求得到基本支持，但有已知限制。','75：关键配方需求得到较好支持，可解释来源和局限。','100：本次具体配方需求在已核范围支持充分；不表示工艺/原料形式天然更优。']},
    evidence:{focus:'评价本款明确声称的证据支持程度，不评价未知功效大小。要求完整原始资料、SKU/版本、物种对象、设计、对照、终点与局限；体外/成分/品牌研究不能替本款体内功效。',
      bands:['0：适用的原始证据明确不支持本次具体声称；没有资料不是0。','50：对应本款/对象/终点的探索性结果，限制显著且已说明。','75：适当设计与对照支持该终点，报告充分，适用限制明确。','100：多项适用且相互独立的可靠研究重复支持同一明确终点；不表示治疗或普遍有效。']},
    transparency:{focus:'只评价本SKU身份/标签/制造企业与来源可追溯性，不评价产品安全。先分清原料供应商、成品工厂、品牌背景和进口分类；未披露是未知，不直接扣品质分。',
      bands:['0：核实的关键身份/来源信息不满足本次明确追溯判据；不能推出不安全。','50：关键SKU身份和制造主体可核，追溯仍有明确限制。','75：本SKU标签、制造主体、版本和来源对应较好，限制清晰。','100：本次指定的追溯范围均有对应资料；仅表示该范围透明，不是安全认证。']},
    value:{focus:'先满足本场景适用性，再按明确包装/数量/日期/渠道/条件及自定预算比较。原记录元/斤只是参考；能量未核不算每日喂养成本，不用越便宜越好。',
      bands:['0：同条件已核报价明确不满足本次指定预算/可得性判据；不等于品质差。','50：适用性成立、满足基本预算，但条件或可得性有明显限制。','75：适用性和预算成立，同条件支出/可得性有较好支持。','100：本次明确预算与选择目标在同条件已核报价中支持充分；不是全市场最低价。']}
  };
  const g = (summary, reason, refs=[])=>({summary,reason,refs,points:null});
  const p40Nutrition = g('原图写≥40% / ≥18%及“以干物质计”；不能与法米纳未标基准的44/20直接判高低。','原图已读到保证值下界和表题基准，但当前包装/真实版本对应、能量及适用标准未对齐。营养适配留空，不把保证下界当实测值。');
  const profiles = {
    pub_49a3729e441a6554c3c5:{
      nutrition:{...p40Nutrition,refs:['p40_chicken']},
      ingredients:g('鲜鸡肉80%是原文配料/投料线索，不是成品动物性蛋白含量。','能描述鲜鸡肉、鱼类和脂肪来源；原料总比例/干湿分母与当前版本未核，不能按80%打肉含量品质分。',['p40_chicken']),
      evidence:g('0.951是体外胃蛋白酶声称；14天/7天等系列展示不足以确定本款功效。','尚未取得对应本款/版本的完整研究设计和原件，证据维度未知，不填0，不推有效或无效。'),
      transparency:g('春雪/仙坛原图是鲜鸡肉供应商，不是成品制造企业。','供应商图可定位，但本SKU中文背标/成品制造企业/版本未对齐；不能套用品牌自有工厂，透明度分留空。',['p40_supplier']),
      value:g('当前1.5kg、72元、24元/斤算术一致，只作参考。','无本轮明确绑定报价/日期渠道条件，且场景适用性尚未核准；不自动给专业价值分。')
    },
    pub_eb3094d8cdff6cbe7546:{
      nutrition:{...p40Nutrition,refs:['p40_pigeon']},
      ingredients:g('原图写84%鲜肉；主表动物性原料0.85不能因此视为已核。','84%鲜肉声称与主表0.85不是同一已明确分母；保留原值，不相加反推、不自动纠成84/85。乳鸽味仍含鸡、鸭及鱼油，不当单一乳鸽蛋白。',['p40_pigeon','p40_pigeon_claim']),
      evidence:g('不能借鸡鱼味0.951或系列喂养声称给乳鸽味功效分。','本乳鸽SKU/版本的研究对象、方法、对照、终点和原件未对齐；证据未知，不填0。'),
      transparency:g('系列供应商不能代替本乳鸽SKU成品工厂。','供应商图列鲜乳鸽原料供应商，不建立成品制造关系；本款背标与生产主体未对齐，透明度分留空。',['p40_supplier']),
      value:g('与鸡鱼同为参考24元/斤，不代表同配方或同等品质。','无同日期/渠道条件明确报价和预算判断依据；仅作记录价格比较，专业价值留空。')
    },
    pub_0cd84f2a9d42bc52a8c1:{
      nutrition:g('成猫图写蛋白min44%、脂肪min20%；未注明计量基准，不能直接胜过P40。','原图可识别成猫、保证值下界；本图未明示营养基准，能量/适用标准/当前版本未对齐。不能用水分上限把保证值换成精确干物质实测，营养适配留空。',['farmina_adult']),
      ingredients:g('30%鲜鸡肉与28%鸡肉干不能与鲜肉80%直接排名；98%是动物蛋白声称。','鲜/干原料口径不同；系列98%动物蛋白图不等于98%动物性原料，本SKU版本和总蛋白分母仍待对应；只描述，不给含量品质分。',['farmina_adult','farmina_protein_claim']),
      evidence:g('主表“无”只表示未记录本款研究，不证明没有研究或无效。','品牌/大学科研背书不代替本成猫鸡肉石榴SKU的研究原件和终点；证据留未知，不因进口或品牌研发加分。'),
      transparency:g('进口分类可用，但不替代本款制造企业、背标与批次对应。','原图可定位成猫品名/规格；本SKU成品制造主体、中文背标、原产地原件未对齐，不能套品牌全球工厂。',['farmina_adult']),
      value:g('1.5kg与5kg并列；365/36.5不能靠算术自动绑定5kg。','仍是未对应参考报价；缺明确包装/数量/日期渠道条件与预算依据，专业价值留空。',['farmina_adult'])
    }
  };
  // Non-security freshness token: no fact or score is inferred from this hash.
  function token(text) {
    let n=14695981039346656037n;
    for(let i=0;i<text.length;i++){n^=BigInt(text.charCodeAt(i));n=BigInt.asUintN(64,n*1099511628211n);}
    return n.toString(16).padStart(16,'0');
  }
  function guide(p,key,sourceStates={}) {
    const value=profiles[p.skuId]?.[key];
    if(!value) return {state:'unsampled',summary:'此款未做本轮三款校准；按当前本款资料判断，不借样板结论。',points:null};
    if(token(engine.snapshot(p,key))!==bindings[p.skuId][key])
      return {state:'stale',summary:'本款相关资料已变，原校准说明不再套用；当前原文照常可查。',points:null};
    if(value.refs.some(id=>sourceStates[id]!=='current'))
      return {state:'unavailable',summary:'原图缺失/已变或当前服务未核对，暂不带入原图校准说明；当前原文仍可查。',points:null};
    return {state:'current',version:VERSION,asOf:AS_OF,summary:value.summary,reason:value.reason,points:null,
      refs:value.refs.map(id=>({id,label:labels[id],...sources[id]}))};
  }
  function criterion(key) {
    if(!rubric[key]) throw new Error('未知校准维度。');
    return VERSION+'（候选，不是默认专业评级）\n'+rubric[key].focus+'\n未知：无适用原件/分母/场景判据时不分档、不填0。\n'+rubric[key].bands.join('\n')+'\n0/50/75/100是讨论锚点，不是科学测量或Charles已认可的阈值；须对应实际判据、理由与出处。';
  }
  function assist(p,key,current,sourceStates={}) {
    const value=guide(p,key,sourceStates);
    if(value.state!=='current') throw new Error('当前资料未校准或已变化，不带入旧判断。');
    if(current.points!==null || current.reason.trim() || current.evidence.trim())
      throw new Error('本项已有分数或文字，未覆盖；需要时先自行清空该项。');
    return {...current,points:null,reason:value.reason,evidence:
      VERSION+' · '+AS_OF+' · '+p.source.file+' 产品信息第'+p.source.row+'行；'+
      (value.refs.length?value.refs.map(r=>r.label+'：'+r.path+' [SHA256 '+r.sha256+']').join('；'):'尚缺本SKU适用原件，当前记录仅作线索，不是功效或品质证据。')};
  }
  return {VERSION,AS_OF,guide,criterion,assist,token,keys:engine.keys};
});

;
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./scoring.js'),require('./evaluation.js'),require('./analysis.js'),require('./sorting.js'),require('./table-view.js'));
  else root.PetFoodViews = factory(root.PetFoodScoring,root.PetFoodEvaluation,root.PetFoodAnalysis,root.PetFoodSorting,root.PetFoodTableView);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (scoring, evaluation, analysis, sorting, tableView) {
  'use strict';
  const KEY = 'pet-food-saved-views-v1';
  // D100：新增 descriptionKeyword（描述关键词）。group / noteKeyword 保留在键表里只为兼容旧方案格式，
  // 侧栏已无对应控件，恢复旧方案时这两项不再生效（不会被套用到其它条件）。
  const keys = ['search', 'brand', 'process', 'stage', 'imported', 'function', 'functionValue', 'theme', 'themeKeyword',
    'ingredients', 'descriptionKeyword', 'priceScope', 'coreStatus', 'productionMode', 'factoryName', 'group', 'noteKeyword', 'legendMode', 'legendCategory', 'proteinMin', 'proteinMax', 'fatMin', 'fatMax', 'priceMin', 'priceMax',
    ...['phosphorus','chloride','animalIngredient','animalProtein'].flatMap(k=>[k+'Mode',k+'Min',k+'Max'])];
  const fail = () => { throw new Error('方案格式不兼容或已损坏，未覆盖原记录。'); };
  function normalize(value) {
    if (!value || typeof value !== 'object' || typeof value.name !== 'string') fail();
    const name = value.name.trim();
    if (!name || name.length > 60 || !value.query || typeof value.query !== 'object') fail();
    const query = {};
    for (const key of keys) {
      const text = value.query[key] ?? '';
      if (typeof text !== 'string' || text.length > 2000) fail();
      if (/(Min|Max)$/.test(key) && text !== '' && (!text.trim() || !Number.isFinite(Number(text)) || Number(text) < 0)) fail();
      query[key] = text;
    }
    if (value.query.core != null && typeof value.query.core !== 'boolean') fail();
    query.core = value.query.core ?? false;
    if (value.query.coreStatus == null && query.core) query.coreStatus = 'legacy';
    if (!['', 'confirmed', 'candidate', 'excluded', 'unknown', 'legacy'].includes(query.coreStatus)) fail();
    if (!['','自有','代工','empty'].includes(query.productionMode)) fail();
    if (!['','filled','empty'].includes(query.factoryName) && !query.factoryName.startsWith('value:')) fail();
    for(const key of ['phosphorus','chloride'])if(!['','bounded','declared','unknown'].includes(query[key+'Mode']))fail();
    for(const key of ['animalIngredient','animalProtein'])if(!['','comparable','unknown'].includes(query[key+'Mode']))fail();
    if (!['','imported','process','function','theme','group'].includes(query.legendMode) || (query.legendCategory && !query.legendMode)) fail();
    if (!sorting.validSort(value.sort) || !Array.isArray(value.selected) || value.selected.length > 1000) fail();
    if (value.selected.some(id => typeof id !== 'string' || !id || id.length > 200)) fail();
    if (!value.origin || ['protein', 'fat'].some(k => !Number.isFinite(value.origin[k]) || value.origin[k] < 0 || value.origin[k] > 100)) fail();
    const chart = value.chart ?? { x: 'protein', y: 'fat', priceOrigin: 40 };
    if (!['protein','fat','pricePerJin','conditionScore'].includes(chart.x) || !['protein','fat','pricePerJin','conditionScore'].includes(chart.y) || chart.x === chart.y || !Number.isFinite(chart.priceOrigin) || chart.priceOrigin < 0) fail();
    const conditionOrigin=chart.conditionOrigin??50;
    if(!Number.isFinite(conditionOrigin)||conditionOrigin<0||conditionOrigin>100)fail();
    const color = chart.color ?? 'imported', size = chart.size ?? 'uniform';
    if (!['imported','process','function','theme','group'].includes(color) || !['uniform','pricePerJin'].includes(size)) fail();
    if (query.legendCategory && query.legendMode !== color) fail();
    const score = scoring.normalize(value.scoring);
    return { name, query, sort: value.sort, table:tableView.normalize(value.table,value.sort), selected: [...new Set(value.selected)],
      origin: { protein: value.origin.protein, fat: value.origin.fat },
      chart: { x: chart.x, y: chart.y, priceOrigin: chart.priceOrigin, ...(chart.conditionOrigin!=null?{conditionOrigin}:{}), color, size }, scoring: score, evaluation:evaluation.normalize(value.evaluation), analysis:analysis.normalize(value.analysis) };
  }
  function decode(raw) {
    if (raw == null) return [];
    let doc;
    try { doc = JSON.parse(raw); } catch { fail(); }
    if (doc?.version !== 1 || !Array.isArray(doc.views) || doc.views.length > 20) fail();
    const views = doc.views.map(normalize);
    if (new Set(views.map(v => v.name)).size !== views.length) fail();
    return views;
  }
  function read(storage) { return decode(storage.getItem(KEY)); }
  function write(storage, views) {
    const payload = JSON.stringify({ version: 1, views });
    decode(payload);
    storage.setItem(KEY, payload);
  }
  function add(storage, view) {
    const views = read(storage), next = normalize(view);
    if (views.some(v => v.name === next.name)) throw new Error('已有同名方案，请换个名称；不会覆盖旧方案。');
    if (views.length >= 20) throw new Error('最多保存20个方案，请先删除不用的方案。');
    write(storage, [...views, next]);
    return next;
  }
  function remove(storage, name) {
    const views = read(storage), target = views.find(v => v.name === name);
    if (!target) throw new Error('方案已不存在，请重新选择。');
    write(storage, views.filter(v => v.name !== name));
    return target;
  }
  function resolve(view, products, options) {
    const normalized = normalize(view), ids = new Set(products.map(p => p.skuId));
    const unavailable = Object.entries(options).filter(([key, values]) =>
      normalized.query[key] !== '' && !values.includes(normalized.query[key])).map(([key]) => key);
    return { ...normalized, unavailable, missing: normalized.selected.filter(id => !ids.has(id)),
      selected: normalized.selected.filter(id => ids.has(id)) };
  }
  return { KEY, normalize, decode, read, add, remove, resolve };
});

;
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PFDSCleaning = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const text = value => String(value ?? '').trim();
  // Display-only: never used for identity matching or source write-back.
  const displayName = value => text(value).replace(/\s*[|｜]\s*/g, ' · ').replace(/\s+/g, ' ');
  function productName(value, brand) {
    let normalized = displayName(value);
    const aliases = [text(brand), ...text(brand).split(/[\s()（）]+/)].filter(x=>x.length>1).sort((a,b)=>b.length-a.length);
    for (const alias of [...aliases,...aliases]) {
      if (normalized.toLowerCase().startsWith(alias.toLowerCase())) {
        const rest=normalized.slice(alias.length).replace(/^[\s·|｜]+/,'');
        if(rest && (!/^[a-z]/i.test(rest) || /\s/.test(normalized[alias.length]||''))) normalized=rest;
      }
    }
    normalized=normalized.replace(/[;；]\s*英文包装[:：].*$/,'')
      .replace(/\s*[·（(]\s*\d+(?:\.\d+)?\s*(?:kg|g|公斤|千克)\s*[）)]?$/i,'').trim();
    return normalized || displayName(value);
  }
  function brief(value) {
    if (/(?:待核|待复核|冲突|未明确)/.test(text(value))) return text(value);
    return text(value).replace(/[（(][^()（）]*(?:页面|用户|待核|待补|未独立|未明确)[^()（）]*[）)]/g,'')
      .split(/[;；]/).filter(s=>!/(?:待补|待核|用户价格快照)/.test(s)).join('；').trim();
  }
  function seriesName(p) {
    // Only the three already-corrected Balance records; never guess another fish species.
    if (/佰萃/.test(p.brand||'') && /鱼种待复核/.test(p.series||'')) {
      if (/添加鳀鱼干/.test(p.product||'')) return '添加鳀鱼干';
      if (/添加鲣鱼片/.test(p.product||'')) return '添加鲣鱼片';
    }
    return text(p.series);
  }
  function ratio(raw) {
    const original = text(raw), normalized = original.normalize('NFKC');
    if (!original) return {raw:original, display:'未记录', status:'missing'};
    if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?|\d+(?:\.\d+)?%)$/.test(normalized))
      return {raw:original, display:original, status:'raw_only'};
    const n = normalized.endsWith('%') ? Number(normalized.slice(0,-1)) : Number(normalized) * 100;
    if (n > 100) return {raw:original, display:original, status:'raw_only'};
    return {raw:original, display:`${Number(n.toFixed(6))}%`, status:'display_only'};
  }
  function packaging(raw) {
    const original = text(raw), normalized = original.normalize('NFKC').toLowerCase();
    const matches = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|斤|lb|磅)(?![a-z])/g)];
    const factors = {kg:1000,g:1,'斤':500,lb:453.59237,'磅':453.59237};
    return {raw:original, candidates:matches.map(m=>({text:m[0],grams:Number(m[1])*factors[m[2]]})),
      interpretation:'按原文出现顺序提取重量字样；可能包含内包装、组合装、赠品或待核记录，不代表已确认的独立规格；不去重、不推算组合总重、不对应价格。'};
  }
  function inspect(p) {
    const d = p.details || {}, claims = text(d.marketing_claims_raw);
    const ingredient = ratio(d.animal_ingredient_ratio_raw), protein = ratio(d.animal_protein_ratio_raw);
    const issues = [];
    if (protein.status !== 'missing' && /(?:不能|不可|不应).{0,15}(?:填入|填写|填|作为).{0,20}动物性蛋白/.test(claims))
      issues.push('动物性蛋白字段有值，但同款声称说明不宜填入该数值；保留两处原文，待来源适用范围核对。');
    if (p.priceBasis?.scope === 'mismatch') issues.push('规格与记录价算术未对应；不能据此猜包装或改价格。');
    return {version:'cleaning-v1', displayName:productName(p.product,p.brand), rawName:text(p.product), packaging:packaging(p.packageSize),
      ingredient, protein, issues,
      boundary:'仅整理展示与文本线索，未新增事实核验。鲜肉添加量≠动物性原料占比≠总蛋白中动物来源比例；分母、投料/成品/干物质及SKU/系列适用范围未确定，不用于评分。'};
  }
  return {displayName, productName, brief, seriesName, ratio, packaging, inspect};
});

;
(function(root,factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./query.js'),require('./sorting.js'),require('./table-view.js'),require('./cleaning.js'));
  else root.PetFoodCatalogExport = factory(root.PetFoodQuery,root.PetFoodSorting,root.PetFoodTableView,root.PFDSCleaning);
})(typeof globalThis !== 'undefined' ? globalThis : this,function(query,sorting,tableView,cleaning) {
  'use strict';
  function value(p,key) {
    if (key === 'brand') return p.brand;
    if (key === 'product') return cleaning.productName(p.product,p.brand);
    if (key === 'core') return query.coreRaw(p);
    if (key === 'productionMode') return query.productionMode(p);
    if (key === 'factory') return query.factoryName(p);
    if (key === 'brandFounded') return p.brandFoundedShort || '';
    if (key === 'factoryFounded') return p.factoryFoundedShort || '';
    if (key === 'factoryScale') return p.factoryScaleShort || '';
    if (key === 'function') return query.functionValueSummary(p);
    if (key === 'imported') return p.importStatus;
    if (key === 'process' || key === 'stage') return p[key];
    const m = sorting.metric(p,key);
    if (m.value === null) return '';
    // Keep guarantee signs, units and basis with the visible value; no internal IDs/configuration columns.
    return [sorting.display(m),m.basis].filter(Boolean).join(' · ');
  }
  function project(products,state,filters={}) {
    const columns = [...new Set(['brand','product','core',...tableView.effective(state,filters),'productionMode','factory'])];
    const label = key => key === 'core' ? '核心产品' : key === 'brand' ? '品牌' : key === 'product' ? '产品'
      : tableView.columns.find(d=>d.key===key).label;
    const rows = sorting.sortRows(products.filter(p=>query.matches(p,filters)),state.sort,state.secondary);
    return {columns,headers:columns.map(label),rows:rows.map(p=>columns.map(key=>value(p,key)))};
  }
  function csv(projection) {
    return '\ufeff' + [projection.headers,...projection.rows].map(row=>row.map(query.csvCell).join(',')).join('\r\n');
  }
  return {value,project,csv};
});

;
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetFoodWorkspaces = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const areas = ['library', 'analysis', 'intel', 'manage'];
  const modes = ['nutrition', 'price', 'compare', 'score'];
  function state(area = 'library', mode = 'nutrition') {
    return {area: areas.includes(area) ? area : 'library', mode: modes.includes(mode) ? mode : 'nutrition'};
  }
  function preset(mode) {
    if (mode === 'nutrition') return {x:'protein', y:'fat'};
    if (mode === 'price') return {x:'pricePerJin', y:'protein'};
    return null;
  }
  function canCompare(count) { return Number.isInteger(count) && count >= 2 && count <= 6; }
  const groups = [
    {title:'产品与适用阶段', fields:[['系列','series'],['口味','flavor'],['阶段','stage'],['工艺','process'],['进口属性','importStatus']]},
    {title:'保证值原文与口径', fields:[['粗蛋白原文','details.protein_raw'],['粗脂肪原文','details.fat_raw'],['其他保证值原文','details.other_guaranteed_analysis_raw']]},
    {title:'配方与含量口径', fields:[['配料原文','details.ingredients_raw'],['营养添加剂原文','details.additives_raw'],['动物性原料原文','details.animal_ingredient_ratio_raw'],['动物性蛋白原文','details.animal_protein_ratio_raw']]},
    {title:'包装与参考价格来源', fields:[['包装规格原文','packageSize'],['页面价格原文（元）','pagePriceRaw'],['元/斤原文','details.price_per_jin_raw'],['价格与规格口径','priceBasis.label'],['绑定包装','activeQuote.package'],['单包装净重 g','activeQuote.grams'],['购买数量','activeQuote.quantity'],['实付总价 元','activeQuote.total'],['报价日期','activeQuote.date'],['渠道','activeQuote.channel'],['优惠条件','activeQuote.conditions'],['报价来源','activeQuote.sourceText']]},
    {title:'功能与喂养研究', fields:[['研究/实验原文','details.feeding_study_raw'],['页面声称（非功效结论）','details.marketing_claims_raw']]},
    {title:'品牌与生产信息', fields:[['核心产品','details.core_product_raw'],['生产方式','details.production_mode_raw'],['工厂名称','details.factory_name_raw'],['工厂/进口原文','details.factory_import_raw'],['原料溯源','details.traceability_raw'],['来源工作簿','source.file']]}
  ];
  function value(product, path) { return path.split('.').reduce((v,k)=>v?.[k],product) ?? null; }
  function displayValue(product, path) {
    const raw = value(product, path);
    if (raw == null || String(raw).trim() === '') return raw;
    const key = path.replace(/^details\./, '');
    const ratios = ['animal_ingredient_ratio_raw','animal_protein_ratio_raw','total_tract_digestibility_raw','pepsin_digestibility_raw'];
    if (ratios.includes(key) && /^\d+(?:\.\d+)?$/.test(String(raw).trim())) {
      const n = Number(raw);
      if (n >= 0 && n <= 100) return Number((n <= 1 ? n * 100 : n).toFixed(6)) + '%';
    }
    if (['protein_raw','fat_raw'].includes(key) && /^(?:[≥≤<>]=?\s*)?\d+(?:\.\d+)?$/.test(String(raw).trim()))
      return String(raw).trim() + '%';
    return raw;
  }
  return {areas, modes, state, preset, canCompare, groups, value, displayValue};
});

;
// 工厂情报模块（D089）：工厂背景数据集_v1.json 的只读呈现 + 品牌↔工厂双向关联。
// 关联键：产品 factoryName 去「(待背标确认)」后缀后与数据集 factoryName 归一化匹配
// （32/32 产品表厂名全覆盖；泰安希望为 D086 判定的名称误记留痕实体，不被现役产品引用）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetFoodFactoryIntel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LEVEL_STYLE = { S: 'level-s', T: 'level-t', C: 'level-c', U: 'level-u' };
  const LEVEL_NAMES = { S: '官网/官方', T: '权威媒体', C: '一般来源', U: '未证实' };

  function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function normalizeName(name) {
    return String(name || '').replace(/[（(]待背标确认[)）]\s*$/, '').trim();
  }
  function levelChip(level) {
    return `<span class="intel-chip ${LEVEL_STYLE[level] || 'level-u'}" title="来源分级 ${level}：${LEVEL_NAMES[level] || '未证实'}">[${level || 'U'}] ${LEVEL_NAMES[level] || '未证实'}</span>`;
  }
  // 短口径：表格列/芯片用；完整口径留在 title 与详情。
  function shortFounded(text) {
    const t = String(text || '');
    if (!t) return '—';
    if (t.includes('DATA_GAP')) return 'DATA_GAP';
    const m = t.match(/((?:18|19|20)\d{2})/) || t.match(/(\d{4})\s*年/);
    return m ? m[1] + ' 年' : '见详情';
  }
  function shortScale(text) {
    const t = String(text || '').replace(/(\d)[,，](?=\d{3}(?:\D|$))/g, '$1');
    const values = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(万吨|吨)/g)];
    if (values.length !== 1) return t ? '见详情' : '—';
    return Number(values[0][1]) > 0 ? values[0][1] + ' ' + values[0][2] : '见详情';
  }

  // D101：工厂列表按「集团 → 厂区」聚合排序（Charles：几个中宠都没放在一起）。
  // 数据集没有集团 id，只有 background.parentGroup 的自由文本；这里先剥掉括注得到母公司主名，
  // 再经显式归并表把同一母公司的不同写法收敛为同一个集团键。
  // 归并表只收语义上确属同一母公司的条目（中宠三厂区；帅克/汉欧体系；福贝/福智体系），不做名称猜测式合并。
  const GROUP_CANONICAL = {
    '中宠食品股份有限公司': '中宠食品股份有限公司',
    '山东帅克宠物用品股份有限公司': '帅克集团',
    '帅克集团': '帅克集团',
    '福贝宠食集团': '福贝宠食集团',
    '上海福贝宠物用品股份有限公司': '福贝宠食集团',
  };
  // 返回集团键（'' = 无可用母公司信息，排序时单独沉底）。group 只作归集与排序键，不作为展示名称。
  function groupOf(factory) {
    const raw = String(factory?.background?.parentGroup || '').trim();
    if (!raw || raw === '未知' || /未单独确认/.test(raw) || /^[—–-]/.test(raw)) return '';
    const base = raw.split(/[（(]/)[0].trim();
    return GROUP_CANONICAL[base] || base;
  }

  // data=dashboard.json（products/brandFacts），factoryData=工厂背景数据集投影。
  // 返回 profiles（32 实体，含现役 live 引用统计 + 集团归集键）与两个关联索引。
  function collect(data, factoryData) {
    const products = data?.products || [];
    const factories = factoryData?.factories || [];
    const profiles = factories.map(f => {
      const key = normalizeName(f.factoryName);
      const live = products.filter(p => normalizeName(p.factoryName) === key);
      const byBrand = new Map();
      for (const p of live) {
        if (!byBrand.has(p.brandId)) byBrand.set(p.brandId, { brandId: p.brandId, brand: p.brand, skuCount: 0 });
        byBrand.get(p.brandId).skuCount += 1;
      }
      return {
        ...f,
        group: groupOf(f),
        liveSkuCount: live.length,
        liveBrands: [...byBrand.values()].sort((a, b) => b.skuCount - a.skuCount || a.brand.localeCompare(b.brand, 'zh-Hans-CN')),
      };
    });
    // 集团维度汇总：集团合计现役 SKU 决定集团之间的先后，集团内再按厂区现役 SKU 降序。
    // 无母公司信息的实体当作「自成一组」，仍按自身现役 SKU 参与排序（不人为沉底）。
    const groupSku = new Map();
    const groupFactories = new Map();
    for (const p of profiles) {
      if (!p.group) continue;
      groupSku.set(p.group, (groupSku.get(p.group) || 0) + p.liveSkuCount);
      groupFactories.set(p.group, (groupFactories.get(p.group) || 0) + 1);
    }
    for (const p of profiles) {
      p.groupSkuCount = p.group ? groupSku.get(p.group) : p.liveSkuCount;
      p.groupFactoryCount = p.group ? groupFactories.get(p.group) : 1;
    }
    const groupKey = p => p.group || `\u0000self:${p.factoryId}`;
    return profiles.sort((a, b) => {
      if (groupKey(a) !== groupKey(b)) {
        const byGroupSku = b.groupSkuCount - a.groupSkuCount;
        if (byGroupSku) return byGroupSku;
        const byGroupName = (a.group || '').localeCompare(b.group || '', 'zh-Hans-CN');
        if (byGroupName) return byGroupName;
        const byKey = groupKey(a).localeCompare(groupKey(b));
        if (byKey) return byKey;
      }
      return b.liveSkuCount - a.liveSkuCount || a.factoryName.localeCompare(b.factoryName, 'zh-Hans-CN');
    });
  }

  function association(data, factoryData) {
    const profiles = collect(data, factoryData);
    const byFactoryName = new Map();
    for (const f of profiles) byFactoryName.set(normalizeName(f.factoryName), f);
    const byBrandId = new Map();
    for (const p of data?.products || []) {
      const f = byFactoryName.get(normalizeName(p.factoryName));
      if (!f) continue;
      if (!byBrandId.has(p.brandId)) byBrandId.set(p.brandId, []);
      const list = byBrandId.get(p.brandId);
      if (!list.includes(f)) list.push(f);
    }
    for (const list of byBrandId.values()) list.sort((a, b) => b.liveSkuCount - a.liveSkuCount);
    return { profiles, byFactoryName, byBrandId };
  }

  // D103：来源条目容错——旧数据允许只有 url/note 而没有 name（曾渲染成空白 <li>）。
  // 缺 name 时用 note 首句兜底，仍无则显示等级占位，不产出空白条目。
  // D105：有 url 的来源渲染为可点击外链（target=_blank + rel=noopener），
  // 这样补录的链接在页面上真正可复核；无 url 的保持纯文本，不伪造链接。
  function sourceList(sources) {
    if (!sources || !sources.length) return '<p class="theme-note">未记录来源</p>';
    const items = sources.map(s => {
      const label = String(s.name ?? '').trim() || String(s.note ?? '').trim().split(/[。；;]/)[0] || '';
      const raw = label || '来源名称未记录';
      const href = String(s.url ?? '').trim();
      // 只接受 http/https，避免 javascript: 之类被注入 href。
      const safe = /^https?:\/\//i.test(href) ? href : '';
      const text = label ? escapeHtml(label) : `<span class="theme-note">${escapeHtml(raw)}</span>`;
      const body = safe
        ? `<a class="intel-source-link" href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer" title="在新标签页打开来源原文">${text}</a>`
        : text;
      return `<li>${body} ${levelChip(s.level)}</li>`;
    });
    return `<ul class="intel-sources">${items.join('')}</ul>`;
  }

  function detailPanel(f, options = {}) {
    const typeCls = f.type === '代工' ? 'factory-type-oem' : 'factory-type-own';
    const brandLinks = (f.liveBrands || []).map(b =>
      `<button type="button" class="text-button intel-link" data-intel-brand="${escapeHtml(b.brandId)}">${escapeHtml(b.brand)} <small>${b.skuCount} 款</small></button>`).join('') || '<span class="theme-note">现役看板无引用（可能为历史/误记留痕实体）</span>';
    const conflicts = (options.conflicts || []).filter(c => String(c.item || '').includes(f.factoryName));
    return `<div class="intel-detail">
      <div class="intel-profile-head">
        <h2>${escapeHtml(f.factoryName)} <span class="intel-sku-count"><span class="factory-type ${typeCls}">${escapeHtml(f.type)}</span> 本库收录 ${f.liveSkuCount} 款产品</span></h2>
        <p class="intel-tagline">${escapeHtml(f.background?.parentGroup || '母公司背景未记录')}</p>
      </div>
      <div class="intel-profile-grid">
        ${f.background?.value ? `<section class="intel-block intel-block-wide"><h3>企业背景</h3><p class="intel-value">${escapeHtml(f.background.value)}</p>${f.background.note ? `<p class="theme-note">${escapeHtml(f.background.note)}</p>` : ''}</section>` : ''}
        <section class="intel-block intel-block-hero">
          <h3>成立时间</h3>
          <p class="intel-value">${escapeHtml(f.founded?.value || 'DATA_GAP')} ${levelChip(f.founded?.level)}</p>
          ${f.founded?.note ? `<p class="theme-note">${escapeHtml(f.founded.note)}</p>` : ''}
        </section>
        <section class="intel-block">
          <h3>规模产能</h3>
          <p class="intel-value">${escapeHtml(f.scale?.capacity || 'DATA_GAP')}</p>
          ${f.scale?.location ? `<p class="theme-note">所在地：${escapeHtml(f.scale.location)}</p>` : ''}
          ${f.scale?.employees ? `<p class="theme-note">员工规模：${escapeHtml(f.scale.employees)}</p>` : ''}
          ${f.scale?.revenue ? `<p class="theme-note">经营规模（原文）：${escapeHtml(f.scale.revenue)}</p>` : ''}
        </section>
        <section class="intel-block">
          <h3>资质认证</h3>
          <p class="intel-value">${(f.certifications || []).length ? f.certifications.map(escapeHtml).join(' · ') : 'DATA_GAP'}</p>
        </section>
        <section class="intel-block">
          <h3>供应关系</h3>
          <p class="intel-value">${escapeHtml(f.relationship || 'DATA_GAP')}</p>
        </section>
        <section class="intel-block">
          <h3>宣传口径与数据比对</h3>
          <p class="intel-value">${escapeHtml(f.claim || '无特殊宣传口径记录')}</p>
          <p class="theme-note">历史核对记录（其中款数为当时快照，当前数量见本库关联品牌）：${escapeHtml(String(f.dataComparison?.existing || f.factoryName).replace(/dashboard 现役值/g, '当时收录值'))}；判定：${escapeHtml(f.dataComparison?.verdict || '—')}${f.dataComparison?.note ? `——${escapeHtml(f.dataComparison.note)}` : ''}</p>
        </section>
        <section class="intel-block intel-block-wide">
          <h3>本库关联品牌</h3>
          <p class="intel-links">${brandLinks}</p>
          <p class="theme-note">按已收录产品的工厂信息关联；自有或代工以具体产品与品牌的关系为准。</p>
        </section>
        ${conflicts.length ? `<section class="intel-block intel-block-wide"><h3>相关冲突（${conflicts.length}）</h3>${conflicts.map(c => `<p>${escapeHtml(c.status)}：${escapeHtml(c.detail)}</p>`).join('')}</section>` : ''}
        ${f.latestUpdate?.items?.length ? `<section class="intel-block intel-block-wide">
          <h3>最新动态（截至 ${escapeHtml(f.latestUpdate.asOf || '—')}） ${levelChip(f.latestUpdate.level)}</h3>
          <ul class="intel-updates">${f.latestUpdate.items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul></section>` : ''}
        <section class="intel-block intel-block-wide">
          <h3>来源</h3>
          ${sourceList(f.sources)}
        </section>
      </div>
    </div>`;
  }

  return { collect, association, detailPanel, normalizeName, shortFounded, shortScale, levelChip, groupOf };
});

;
// 品牌情报模块（D082 核验数据 → D089 排版重构 + 品牌↔工厂关联 + 双模式）。
// 只读聚合 brandFacts；工厂关联经 PetFoodFactoryIntel（现役看板现算）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetFoodBrandIntel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LEVEL_STYLE = { S: 'level-s', T: 'level-t', C: 'level-c', U: 'level-u' };
  const STATUS_LABEL = { 已定论: '已定论', 未定论: '未定论', 个案集合: '个案集合', 个案: '个案' };

  function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 聚合 brandFacts 为品牌档案（只读；D082 核验三字段 + 原有定位/摘要）。
  function marketRecords(data,brandId) {
    const records=[];
    const add=(text,kind,scope,source,status)=>{
      if(!text||/^(无|未知|未记录|暂无|—)$/.test(String(text).trim()))return;
      const same=records.find(r=>r.text===text&&r.kind===kind&&r.source===source);
      if(same){if(!same.scopes.includes(scope))same.scopes.push(scope);return;}
      records.push({text,kind,scopes:[scope],source:source||'',status:status||'原文记录，未独立核验'});
    };
    for(const f of data.brandFacts||[]){
      if(f.brandId!==brandId||!/定位|市场|销量|销售|口碑/.test(f.fieldLabel||''))continue;
      add(f.valueText,/定位/.test(f.fieldLabel)?'定位原文':'市场表现原文',
        f.fieldLabel,f.sourceText,f.verificationStatus);
    }
    for(const p of data.products||[]){
      if(p.brandId!==brandId)continue;
      for(const [key,kind] of [['brand_positioning_raw','定位原文'],['market_position_raw','市场表现原文']]){
        const text=p.details?.[key];
        // Identical SKU text is grouped by source file, retaining every associated SKU.
        add(text,kind,[p.product,p.flavor].filter(Boolean).join(' · '),p.source?.file,'产品页／底稿记录，范围以原文为准');
      }
    }
    return records;
  }
  function marketPanel(records) {
    if(!records?.length)return '';
    return '<section class="intel-block"><h3>定位与市场信息</h3><p class="theme-note">定位与市场声称不是品质评级。销量、销售额、会员数、排名分别阅读；不同产品范围、单位、渠道与时期不能混排。页面引用第三方报告，不代表本库已核对原报告。</p>'+
      records.map(r=>'<details><summary>'+escapeHtml(r.kind+' · '+r.scopes[0]+(r.scopes.length>1?' 等'+r.scopes.length+'款记录':''))+'</summary><p class="intel-value">'+escapeHtml(r.text)+'</p>'+(r.scopes.length>1?'<p class="theme-note">收录于：'+escapeHtml(r.scopes.join('；'))+'（同文收录不等于每款均有独立统计）</p>':'')+'<p class="theme-note">'+escapeHtml(r.status)+'</p>'+(r.source?'<p class="theme-note">出处：'+escapeHtml(r.source)+'</p>':'')+'</details>').join('')+'</section>';
  }
  // profileData（PET_FOOD_BRAND_PROFILE_DATA）提供同集团品牌关联（D090）。
  function collect(data, profileData) {
    const products = data.products || [];
    const brands = new Map();
    const nameToId = new Map();
    for (const p of products) {
      const bid = p.brandId;
      if (!brands.has(bid)) brands.set(bid, { brandId: bid, name: p.brand, skuCount: 0, founded: null, operator: null, events: null, positioning: null, summary: null, existing: [], siblings: [], groupNormalized: '' });
      brands.get(bid).skuCount += 1;
      if (p.brand && !nameToId.has(p.brand)) nameToId.set(p.brand, bid);
    }
    for (const f of data.brandFacts || []) {
      const b = brands.get(f.brandId);
      if (!b) continue;
      const label = f.fieldLabel || '';
      const value = f.valueText || '';
      if (label.includes('品牌成立时间')) b.founded = value;
      else if (label.includes('运营主体与集团关系')) b.operator = value;
      else if (label.includes('重大舆情与召回事件')) b.events = value;
      else if (label === '品牌定位' && !b.positioning) b.positioning = value;
      else if (label === '一句话背景摘要' && !b.summary) b.summary = value;
      else b.existing.push({ label, value });
    }
    const profiles = (profileData && profileData.profiles) || {};
    for (const b of brands.values()) {
      const profile = profiles[b.brandId];
      if (!profile) continue;
      b.groupNormalized = profile.groupNormalized || '';
      b.siblings = (profile.siblings || []).map(s => ({
        name: s.name, inLibrary: !!s.inLibrary, note: s.note || '', level: s.level || 'C',
        brandId: nameToId.get(s.name) || ([...nameToId].filter(([name])=>name.split(/\s+/)[0] === s.name).length === 1 ? [...nameToId].find(([name])=>name.split(/\s+/)[0] === s.name)[1] : null),
        // D111：sourceUrl 必须在这里显式带过来。此前本映射漏了它，
        // 导致数据集里已有的 31 条来源链接在页面上完全无法点击（静默失效）。
        // 教训：新增/修改数据字段时，要grep 前端所有「消费该字段的位置」，
        // 只改数据不改渲染 = 白存。详见 tests/test_source_link_coverage.cjs。
        sourceUrl: s.sourceUrl || '',
      }));
    }
    for(const b of brands.values()) b.marketRecords=marketRecords(data,b.brandId);
    return [...brands.values()].sort((a, b2) => a.name.localeCompare(b2.name, 'zh-Hans-CN'));
  }

  // 舆情多行文本 → 结构化事件（分隔符经 NFKC 归一化后可能是半角 |，两种都兼容）
  function parseEvents(text) {
    if (!text) return [];
    return text.split('\n').map(line => {
      const m = line.match(/^(.+?)[｜|](.+?)[｜|]\[([STCU])\][｜|](.+?)[｜|]([\s\S]*)$/);
      if (!m) return { raw: line };
      return { date: m[1], title: m[2], level: m[3], status: m[4], summary: m[5] };
    });
  }

  function levelChip(level) {
    const names = { S: '官网/官方', T: '权威媒体', C: '一般来源', U: '未证实' };
    return `<span class="intel-chip ${LEVEL_STYLE[level] || 'level-u'}" title="来源分级 ${level}：${names[level] || '未证实'}">[${level || 'U'}] ${names[level] || '未证实'}</span>`;
  }

  // D111：来源外链渲染。与 factory-intel.js 的 sourceList() 保持同一套安全口径 ——
  // 只接受 http/https，避免 javascript: 之类被注入 href；无 URL 时返回纯文本，
  // **绝不伪造链接**（宁可少一个可点的，也不能给一个点不开或指向不明处的地址）。
  function sourceLink(url, label) {
    const href = String(url ?? '').trim();
    if (!/^https?:\/\//i.test(href)) return escapeHtml(label);
    return `<a class="intel-source-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" title="在新标签页打开来源原文">${escapeHtml(label)}</a>`;
  }

  function eventRow(ev) {
    if (ev.raw) return `<li class="intel-event"><span class="intel-event-raw">${escapeHtml(ev.raw)}</span></li>`;
    const statusCls = ev.status === '未定论' ? 'status-open' : (ev.status === '个案' || ev.status === '个案集合' ? 'status-case' : 'status-closed');
    return `<li class="intel-event">
      <span class="intel-event-date">${escapeHtml(ev.date)}</span>
      <span class="intel-event-body">
        <strong>${escapeHtml(ev.title)}</strong> ${levelChip(ev.level)}
        <span class="intel-status ${statusCls}">${escapeHtml(STATUS_LABEL[ev.status] || ev.status)}</span>
        <span class="intel-event-summary">${escapeHtml(ev.summary)}</span>
      </span>
    </li>`;
  }

  // 品牌详情：上部档案卡网格（成立/运营/定位/同集团/工厂关联）+ 下部舆情时间线（保持原样）。
  function detailPanel(brand, extras = {}) {
    const events = parseEvents(brand.events);
    const factories = extras.factories || [];
    const sibs = brand.siblings || [];
    const inLib = sibs.filter(s => s.brandId);
    const outLib = sibs.filter(s => !s.brandId);
    const siblingBlock = sibs.length ? `<section class="intel-block intel-block-wide">
        <h3>同集团品牌${brand.groupNormalized ? ` · ${escapeHtml(brand.groupNormalized)}` : ''}</h3>
        ${inLib.length ? `<p class="intel-links">${inLib.map(s =>
          `<button type="button" class="text-button intel-link" data-intel-brand="${escapeHtml(s.brandId)}">${escapeHtml(s.name)}</button>`).join('')}</p>
          <p class="theme-note">点击库内同集团品牌直接跳转其情报页。</p>`
        : '<p class="theme-note">本项目产品库内无该品牌同集团的其他品牌。</p>'}
        ${outLib.length ? `<p class="intel-sources">库外同集团品牌（未收录本项目产品库）：${outLib.map(s =>
          /* D111：有 sourceUrl 的品牌名做成外链，点开可直接复核原文；
             无 URL 的保持纯文本 +原有说明，不生成假链接。 */
          `${s.sourceUrl ? sourceLink(s.sourceUrl, s.name) : escapeHtml(s.name)}${s.note ? `（${escapeHtml(s.note)}）` : ''}`).join('；')}</p>` : ''}
      </section>` : '';
    const factoryBlock = `<section class="intel-block intel-block-wide">
        <h3>生产工厂（本库关联 ${factories.length} 家）</h3>
        ${factories.length ? `<p class="intel-links">${factories.map(f =>
          `<button type="button" class="text-button intel-link" data-intel-factory="${escapeHtml(f.factoryId)}">${escapeHtml(f.factoryName)} <small>${f.type} · ${f.liveSkuCount} 款</small></button>`).join('')}</p>
          <p class="theme-note">点击厂名查看规模、资质与来源；生产关系以具体产品资料为准。</p>`
        : '<p class="theme-note">本库暂未收录该品牌产品的工厂名称。</p>'}
      </section>`;
    return `<div class="intel-detail">
      <div class="intel-profile-head">
        <h2>${escapeHtml(brand.name)} <span class="intel-sku-count">${brand.skuCount} 款产品</span></h2>
        ${brand.summary ? `<p class="intel-tagline">${escapeHtml(brand.summary)}</p>` : ''}
      </div>
      <div class="intel-profile-grid">
        <section class="intel-block intel-block-hero">
          <h3>成立与发展</h3>
          <p class="intel-value">${escapeHtml(brand.founded || '暂无资料')}</p>
          <p class="theme-note">品牌成立、公司注册与集团并购是不同时间，分别阅读。</p>
        </section>
        <section class="intel-block">
          <h3>运营主体与集团关系</h3>
          <p class="intel-value">${escapeHtml(brand.operator || '暂无资料')}</p>
        </section>
        ${brand.positioning ? `<section class="intel-block"><h3>品牌定位（现有资料）</h3><p class="intel-value">${escapeHtml(brand.positioning)}</p></section>` : ''}
        ${siblingBlock}
        ${factoryBlock}
      </div>
      <section class="intel-block">
        <h3>重要事件与召回记录</h3>
        ${events.length ? `<ul class="intel-events">${events.map(eventRow).join('')}</ul>` : `<p>${escapeHtml(brand.events || '本库暂无事件记录，不代表没有相关事件。')}</p>`}
        <p class="theme-note">来源分级：[S] 官网/官方 · [T] 权威媒体/监管 · [C] 一般来源 · [U] 未证实。请结合时间、涉及产品和原始来源阅读；个案或投诉不等于已证实因果，也不代表当前全部产品的状态。</p>
      </section>
    </div>`;
  }

  // D097：移除"勾选并排比较"整条链路（勾选框、清空比较按钮、比较表、勾选提示）——
  // 品牌情报页只做"点一条看一条"。需要横向比较时走产品库的"多款比较"，不再在这里维护第二个入口。

  function mount(data, factoryData, profileData) {
    const host = document.getElementById('workspace-intel');
    if (!host) return;
    const brands = collect(data, profileData || (typeof globalThis !== 'undefined' ? globalThis : this).PET_FOOD_BRAND_PROFILE_DATA);
    const factoryIntel = (typeof globalThis !== 'undefined' ? globalThis : this).PetFoodFactoryIntel;
    const association = factoryIntel ? factoryIntel.association(data, factoryData || { factories: [] }) : { profiles: [], byFactoryName: new Map(), byBrandId: new Map() };
    const factories = association.profiles;
    let mode = 'brand'; // 'brand' | 'factory'
    let activeBrandId = brands.length ? brands[0].brandId : null;
    let activeFactoryId = factories.length ? factories[0].factoryId : null;
    let keyword = '';

    host.innerHTML = `
      <div class="panel intel-toolbar">
        <h2>品牌与工厂情报</h2>
        <div class="intel-controls">
          <div class="intel-modes" role="tablist" aria-label="情报类型">
            <button type="button" class="intel-mode" data-intel-mode="brand" aria-pressed="true">品牌情报</button>
            <button type="button" class="intel-mode" data-intel-mode="factory" aria-pressed="false">工厂情报</button>
          </div>
          <label>搜索${mode === 'brand' ? '品牌' : '工厂'}<input type="search" id="intel-search" placeholder="${mode === 'brand' ? '品牌名/运营主体/集团' : '工厂名/所在地/母公司'}"></label>
          <button class="secondary-button" type="button" id="intel-back-library">← 返回产品库</button>
        </div>
      </div>
      <div class="intel-layout">
        <aside class="panel intel-list" aria-label="情报列表"><ul id="intel-brands"></ul></aside>
        <div class="intel-main" id="intel-main"></div>
      </div>`;

    const listEl = host.querySelector('#intel-brands');
    const mainEl = host.querySelector('#intel-main');
    const searchEl = host.querySelector('#intel-search');

    function visibleBrands() {
      const kw = keyword.trim();
      if (!kw) return brands;
      return brands.filter(b => [b.name, b.operator || '', b.founded || '', b.positioning || ''].some(t => t.includes(kw)));
    }
    function visibleFactories() {
      const kw = keyword.trim();
      if (!kw) return factories;
      return factories.filter(f => [f.factoryName, f.background?.parentGroup || '', f.scale?.location || '', f.type].some(t => String(t).includes(kw)));
    }

    // 列表项：整行就是"查看该品牌/工厂情报"的按钮（D097 去掉勾选框与并排比较）。
    function renderList() {
      if (mode === 'brand') {
        listEl.innerHTML = visibleBrands().map(b => `
          <li>
            <button type="button" class="intel-brand-row${b.brandId === activeBrandId ? ' active' : ''}" data-intel-pick="brand" data-brand-id="${escapeHtml(b.brandId)}">
              <span class="intel-brand-name">${escapeHtml(b.name)}</span>
              <span class="intel-brand-meta">${b.skuCount} 款</span>
            </button>
          </li>`).join('') || '<li class="theme-note">无匹配品牌</li>';
      } else {
        listEl.innerHTML = visibleFactories().map(f => `
          <li>
            <button type="button" class="intel-brand-row${f.factoryId === activeFactoryId ? ' active' : ''}" data-intel-pick="factory" data-factory-id="${escapeHtml(f.factoryId)}">
              <span class="intel-brand-name">${escapeHtml(f.factoryName)}</span>
              <span class="intel-brand-meta">${f.type} · ${f.liveSkuCount} 款</span>
            </button>
          </li>`).join('') || '<li class="theme-note">无匹配工厂</li>';
      }
      listEl.querySelectorAll('[data-intel-pick]').forEach(btn => btn.addEventListener('click', () => {
        if (btn.dataset.intelPick === 'brand') activeBrandId = btn.dataset.brandId;
        else activeFactoryId = btn.dataset.factoryId;
        renderAll();
      }));
    }

    function renderMain() {
      if (mode === 'brand') {
        const active = brands.find(b => b.brandId === activeBrandId);
        const extras = { factories: active ? (association.byBrandId.get(active.brandId) || []) : [] };
        mainEl.innerHTML = active ? detailPanel(active, extras) : '';
      } else {
        const active = factories.find(f => f.factoryId === activeFactoryId);
        mainEl.innerHTML = active ? factoryIntel.detailPanel(active, { conflicts: factoryData?.conflictSummary || [] }) : '';
      }
      mainEl.querySelectorAll('[data-intel-factory]').forEach(btn => btn.addEventListener('click', () => {
        activeFactoryId = btn.dataset.intelFactory;
        mode = 'factory';
        syncModeButtons();
        renderAll();
      }));
      mainEl.querySelectorAll('[data-intel-brand]').forEach(btn => btn.addEventListener('click', () => {
        activeBrandId = btn.dataset.intelBrand;
        mode = 'brand';
        syncModeButtons();
        renderAll();
      }));
    }

    function syncModeButtons() {
      host.querySelectorAll('[data-intel-mode]').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.intelMode === mode)));
      const label = host.querySelector('.intel-controls label');
      if (label) {
        label.firstChild.textContent = mode === 'brand' ? '搜索品牌' : '搜索工厂';
        searchEl.placeholder = mode === 'brand' ? '品牌名/运营主体/集团' : '工厂名/所在地/母公司';
      }
    }

    function renderAll() { renderList(); renderMain(); }

    host.querySelectorAll('[data-intel-mode]').forEach(btn => btn.addEventListener('click', () => {
      mode = btn.dataset.intelMode;
      syncModeButtons();
      renderAll();
    }));
    searchEl.addEventListener('input', e => { keyword = e.target.value; renderList(); });
    renderAll();

    // 跨 Tab 导航钩子（产品详情页「工厂情报」按钮用）。
    const globalRoot = typeof globalThis !== 'undefined' ? globalThis : this;
    globalRoot.PetFoodIntelNav = {
      showFactory(factoryId) {
        if (!factories.some(f => f.factoryId === factoryId)) return false;
        mode = 'factory'; activeFactoryId = factoryId; syncModeButtons(); renderAll();
        return true;
      },
      showBrand(brandId) {
        if (!brands.some(b => b.brandId === brandId)) return false;
        mode = 'brand'; activeBrandId = brandId; syncModeButtons(); renderAll();
        return true;
      },
    };
  }

  return { collect, parseEvents, mount, detailPanel, marketRecords, marketPanel };
});

;
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetFoodSample = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const SKU_ID = 'pub_49a3729e441a6554c3c5';
  const UNKNOWN = '未知（当前输入未记录）';
  const text = value => value == null ? '' : String(value);
  const known = value => text(value).trim() !== '';
  const display = value => known(value) ? text(value) : UNKNOWN;
  const row = (label, value, boundary) => ({label, value: display(value), boundary});
  const group = (title, rows) => ({title, rows});
  const questions = () => [
    '身份是否采用“品牌 → 系列 → 产品配方/口味 → 内部配方版本”，包装与报价另列？内部 v1 不代表真实包装第1版。',
    '包装规格、报价快照和单位价算术是否分别保存，报价带日期/渠道/数量；缺来源的现有价格仍只作参考？',
    '保证值是否拆成项目/上下界/数值/单位/计量基准并保留原文，声称实验与功效证据是否各自独立？'
  ];
  const replication = () => [
    '按稳定 SKU ID 读取当次 dashboard/raw；缺项留未知，不从旧样板、同品牌或其他口味补值。',
    '品牌共用信息只从同 brandId 的 brandFacts 读取，并保留性质、核验状态和来源；不套用为 SKU 工厂或功效。',
    '先分身份、包装、报价、保证值、原料、添加剂和声称层；有明确原文才拆字段，原文始终保留。',
    '展示草案仅用于确认拆法，不修改事实主本、不自动评分；真实改版和后续写入另按已有维护流程处理。'
  ];

  function sourceLabel(source, sheet) {
    if (!source || !known(source.file)) return '来源未知（当前输入未记录文件）';
    return `${source.file} · ${display(source.sheet || sheet)} · 第${display(source.row)}行`;
  }

  function guarantee(raw, unit) {
    const value = display(raw);
    // Unit metadata does not supply a missing comparator, value or analysis basis.
    const suffix = known(raw) && known(unit) && !/[%％]|mg\/kg|g\/kg/i.test(text(raw))
      ? `（字段单位：${unit}）` : '';
    return value + suffix;
  }

  function splitGuarantees(raw) {
    if (!known(raw)) return [];
    const labels = '(粗纤维|粗灰分|钙|总磷|磷|水分|牛磺酸|蛋氨酸|肌醇|生物素|锌|DHA|EPA|Ω-3|Ω-6|水溶性氯化物(?:[（(]以[^()（）]+计[）)])?)';
    const expression = new RegExp(`^${labels}\\s*(?:≥|≤|>=|<=)\\s*\\d+(?:\\.\\d+)?\\s*(?:%|％|mg/kg|g/kg)(?:\\s*[（(]以干物质计[）)])?$`, 'i');
    return text(raw).split(/[;；\n]/).flatMap(part => {
      const segment = part.trim(), match = segment.match(expression);
      return match ? [row(match[1], segment,
        '从当次其他保证值原文保守拆出；保留原不等号、数值、单位和限定语。保证值不是检测值；整表计量基准未明确时不把局部“干物质”推广到全部项目。')] : [];
    });
  }

  function freshMeatClaim(raw) {
    const clauses = text(raw).split(/[;；\n]/).map(part => part.trim());
    return clauses.filter(part => /^鲜肉配方\s*(?:≥|≤|>=|<=|>|<)?\s*\d+(?:\.\d+)?\s*[%％]/.test(part)).join('；');
  }

  function unitOf(data, fieldKey) {
    const definition = (Array.isArray(data.fieldDefinitions) ? data.fieldDefinitions : [])
      .find(item => item && item.fieldKey === fieldKey);
    return definition && definition.unit;
  }

  // Parse only isolated guaranteed-analysis records. Reports and test results
  // are not inputs: matching a number cannot establish its sample or basis.
  function nutrition(data, product) {
    const d = product.details || product.raw || {};
    const source = {file: product.source?.file || null, sheet: product.source?.sheet || '产品信息',
      row: product.source?.row ?? null, skuId: product.skuId, formulaVersion: product.formulaVersion ?? null};
    const guarantees = [], unparsed = [];
    const names = '(粗蛋白质|粗蛋白|粗脂肪|粗纤维|粗灰分|钙|总磷|磷|水分|牛磺酸|蛋氨酸|肌醇|生物素|锌|DHA|EPA|Ω-3|Ω-6|水溶性氯化物(?:[（(]以[^()（）]+计[）)])?)';
    const amount = /^\s*(>=|<=|≥|≤|>|<|=)?\s*(\d+(?:\.\d+)?)\s*(%|％|mg\/kg|g\/kg)?\s*(?:[（(](以干物质计|以原物质计)[）)])?\s*$/i;
    function parse(label, raw, fieldKey, defaultUnit, requireUnit) {
      const original = raw == null ? '' : String(raw);
      const m = original.match(amount);
      if (!m || requireUnit && !m[3]) {
        if (original.trim()) unparsed.push({raw:original,fieldKey,reason:'无法保守拆分，保留原文',source:{...source}});
        return;
      }
      const comparator = ({'>=':'≥','<=':'≤'})[m[1]] || m[1] || null;
      const value = Number(m[2]), unit = m[3] === '％' ? '%' : m[3] || defaultUnit || null;
      guarantees.push({label,raw:original,fieldKey,kind:'guarantee',comparator,value,unit,
        unitBasis:m[3] ? '原文' : unit ? '字段定义' : null,
        lowerBound:['≥','>','='].includes(comparator) ? value : null,
        upperBound:['≤','<','='].includes(comparator) ? value : null,
        basis:m[4] || null,source:{...source},verification:'仅解析，未核实',
        missing:[!comparator && '比较符未记录',!unit && '单位未记录',!m[4] && '计量基准未记录'].filter(Boolean)});
    }
    parse('粗蛋白',d.protein_raw,'protein_raw',unitOf(data,'protein_pct'),false);
    parse('粗脂肪',d.fat_raw,'fat_raw',unitOf(data,'fat_pct'),false);
    for (const part of String(d.other_guaranteed_analysis_raw ?? '').split(/[;；\n]/)) {
      if (!part.trim()) continue;
      const m = part.trim().match(new RegExp('^'+names+'(.*)$','i'));
      if (m) {
        const before = guarantees.length;
        const beforeUnparsed = unparsed.length;
        parse(m[1],m[2],'other_guaranteed_analysis_raw',null,true);
        if (guarantees.length > before) guarantees[before].raw = part.trim();
        else if (unparsed.length > beforeUnparsed) unparsed[unparsed.length-1].raw = part.trim();
        else unparsed.push({raw:part.trim(),fieldKey:'other_guaranteed_analysis_raw',reason:'缺数值或单位，保留原文',source:{...source}});
      } else unparsed.push({raw:part.trim(),fieldKey:'other_guaranteed_analysis_raw',reason:'说明/范围/未知项目未解析',source:{...source}});
    }
    return {guarantees,unparsed,testResults:[],testNote:'现役数据未提供独立检测对象/批次/方法字段；报告中的检测线索不自动填入保证值或当前检测结果。'};
  }

  function pricing(product) {
    const d = product.details || product.raw || {};
    const raw = text(d.package_size_raw);
    const candidates = [...raw.normalize('NFKC').matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|斤)(?![a-z])/gi)].map(m=>({
      text:m[0],value:Number(m[1]),unit:m[2].toLowerCase()
    }));
    const number = value => {
      const s=text(value).trim();
      return /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : null;
    };
    return {raw,candidates,quoteRaw:text(d.page_price_raw),quoteValue:number(d.page_price_raw),
      unitPriceRaw:text(d.price_per_jin_raw),unitPriceValue:number(d.price_per_jin_raw),
      packageBinding:product.activeQuote?.package || null,quantity:product.activeQuote?.quantity ?? null,
      date:product.activeQuote?.date || null,channel:product.activeQuote?.channel || null,conditions:product.activeQuote?.conditions || null,
      arithmetic:product.priceBasis?.label || '未记录',
      source:sourceLabel(product.source,'产品信息'),
      boundary:'重量仅为原文候选，可能包含组合、赠品或待核规格；不推算袋数或总重，不从单位价反推包装。算术一致不等于报价已核。'};
  }

  function create(data, skuId = SKU_ID) {
    const input = data && typeof data === 'object' ? data : {};
    const p = (Array.isArray(input.products) ? input.products : [])
      .find(item => item && item.skuId === skuId);
    if (!p) return {
      skuId, title: '样板暂不可用', source: '当前 dashboard 未找到目标 SKU，未回填历史数值。',
      groups: [group('样板状态', [row('目标 SKU', skuId, '请载入包含该 SKU 的现役 dashboard；此处为空态。')])],
      questions: [], replication: replication(), empty: true
    };

    // Imported raw fields live in details; raw is accepted for standalone preview inputs.
    const d = p.details && typeof p.details === 'object' ? p.details
      : p.raw && typeof p.raw === 'object' ? p.raw : {};
    const brandFacts = (Array.isArray(input.brandFacts) ? input.brandFacts : [])
      .filter(fact => fact && known(p.brandId) && fact.brandId === p.brandId);
    const snapshot = input.meta && input.meta.generatedAt;
    const source = `${sourceLabel(p.source, '产品信息')} · 导入快照：${display(snapshot)} · 仅展示草案`;
    const sourceBoundary = '直接读取当次 dashboard；来源定位不是事实已核结论。';
    const isP40Sample = p.skuId === SKU_ID;
    const nutritionBoundary = '保证值原文，不是实测值；未标不等号时不补 ≥ 或 ≤，缺计量基准时不推定干物质或原物质。' + (isP40Sample ? 'P40 报告的鸡鱼味保证值表带下界与“以干物质计”线索，版本与计量基准仍待包装核对，不回填为本字段已核属性。' : '');
    const priceBoundary = '记录参考/快照，未在此核准报价来源、日期、渠道或优惠条件；不是已核当前价。';
    const formulaBoundary = '内部 formula_version 登记用于绑定本 SKU 的配方资料；v1 是内部初始记录，非真实包装版，不证明真实配方第1版；资料纠错不自动生成真实改版。';
    const importBoundary = '仅此 SKU 的有效分类；不从品牌国籍、进口原料或其他 SKU 推断成品进口，不证明具体产地、工厂或手续已核。';
    const basis = p.priceBasis || {};
    const confirmation = p.importConfirmation || {};
    const nutrientPreview = nutrition(input,p);
    const groups = [
      group('身份与配方登记', [
        row('品牌', p.brand, '品牌层名称，不合并为系列或口味。'),
        row('系列', p.series, '系列层名称，不自动套用其他系列的配方或保证值。'),
        row('产品配方', p.product, '本 SKU 产品名称；不从产品名称推算蛋白数值或配方事实。'),
        row('口味', p.flavor, '不同口味及普通/PLUS产品各自按 SKU 分开；口味字段的阶段文字不自动认作配方口味。'),
        row('品牌 ID', p.brandId, '品牌登记标识。'),
        row('系列 ID', p.seriesId, '系列登记标识。'),
        row('SKU ID', p.skuId, '当前展示对象的稳定身份，不按名称模糊匹配。'),
        row('内部配方版本 ID', p.formulaVersionId, formulaBoundary),
        row('内部 formula_version', p.formulaVersion, formulaBoundary),
        row('适用阶段原文', d.life_stage_raw, '原文与查询标准化分类分开。'),
        row('形态原文', d.format_raw, '不据形态判断品质。')
      ]),
      group('包装与报价', [
        row('包装规格原文', d.package_size_raw, '重量文本不等于已确认包装；不从报价反推袋数或主规格。'),
        row('保质期原文', d.shelf_life_raw, '记录原文；实际适用包装及开封条件另核。'),
        row('页面报价原文', d.page_price_raw, priceBoundary),
        row('单位价原文', d.price_per_jin_raw, `${priceBoundary} 字段单位：元/斤；不补算或替换。`),
        row('算术口径', basis.label, `当次 dashboard 价格派生口径，算术一致不等于报价已核或包装对应已确认。${text(basis.note)}`),
        row('报价来源与条件', p.activeQuote ? [p.activeQuote.sourceText,p.activeQuote.date,p.activeQuote.channel,p.activeQuote.conditions].filter(Boolean).join('；') : null, '缺项留空，品牌价格带不充作本款报价凭据。')
      ]),
      group('包装报价结构化记录', [
        row('规格候选', pricing(p).candidates.map(v=>v.text).join('；'), pricing(p).boundary),
        row('报价数值（元）', pricing(p).quoteValue, '仅识别孤立数字，单位来自页面报价字段；范围、优惠说明不抓首数。'),
        row('单位价数值（元/斤）', pricing(p).unitPriceValue, '记录值，不作为已核当前价格。'),
        row('报价绑定包装', pricing(p).packageBinding, '明确输入建立绑定；不按单规格或算术一致自动确认。'),
        row('购买数量 / 日期 / 渠道 / 优惠条件', p.activeQuote ? [p.activeQuote.quantity,p.activeQuote.date || '日期未填',p.activeQuote.channel || '渠道未填',p.activeQuote.conditions || '条件未填'].join('；') : null, '独立缺项，不用导入日期、品牌价格带或其他SKU补值。'),
        row('算术口径（独立）', pricing(p).arithmetic, '算术检查与事实核验分开；多规格未绑定不混成可比报价。'),
        row('来源', pricing(p).source, '原规格与价格完整原文保留在上方包装与报价组。')
      ]),
      group('成分分析保证值', [
        row('粗蛋白保证值原文', guarantee(d.protein_raw, unitOf(input, 'protein_pct')), nutritionBoundary),
        row('粗脂肪保证值原文', guarantee(d.fat_raw, unitOf(input, 'fat_pct')), nutritionBoundary),
        row('其他保证值原文', d.other_guaranteed_analysis_raw, nutritionBoundary),
        ...splitGuarantees(d.other_guaranteed_analysis_raw)
      ]),
      {title:'营养结构化预览（只读，不写底稿）',rows:[],nutrition:nutrientPreview},
      group('原料配方与添加剂', [
        row('原料配方原文', d.ingredients_raw, '保留原顺序和单项比例；不是成品检测组成，不相加推算动物性原料总比例。'),
        row('添加剂原文', d.additives_raw, '与原料配方独立；添加量不是功效证据。'),
        row('鲜肉配方声称', freshMeatClaim(d.marketing_claims_raw), '仅提取明确的页面原文片段；不等于动物性原料比例或动物蛋白比例，投料/成品与分母另核。'),
        row('动物性原料比例原文', d.animal_ingredient_ratio_raw, '缺失保持未知；不把鲜肉单项比例相加，也不从鲜肉声称回填。'),
        row('动物蛋白比例原文', d.animal_protein_ratio_raw, '总蛋白中动物来源的比例与动物性原料不同；分母/计量基准待核，不从粗蛋白推算。')
      ]),
      group('本 SKU 工厂、产地与进口', [
        row('工厂/进口原文', d.factory_import_raw, '逐 SKU 保留原文；品牌共用工厂不套用本款，供应商不直接当成品制造商。' + (isP40Sample ? '需排查原料供应商/成品工厂混淆：P40 报告第六节将春雪/仙坛列为鲜鸡肉供应商，不能据此证实成品制造工厂。' : '')),
        row('生产方式', d.production_mode_raw ?? p.productionMode, '本款底稿人工维护；未知留空，不从品牌或进口分类推导。'),
        row('成品制造工厂', d.factory_name_raw ?? p.factoryName, (isP40Sample ? '原料供应商/成品工厂混淆仍需排查；待本SKU包装背标确认。' : '') + '本款底稿人工维护；供应商不直接当成品制造商，名称记录不代表背标或许可证已核。'),
        row('成品进口属性', p.importStatus, importBoundary),
        row('进口分类依据', p.importStatusBasis, importBoundary),
        row('原文规则分类', p.importStatusRule, '规则查询分类，不是独立证据核验。'),
        row('本款人工分类记录', known(confirmation.value)
          ? `${confirmation.value} · 本项目人工确认 · ${display(confirmation.confirmedAt)} · 状态：${display(confirmation.status)}` : null, importBoundary),
        row('原料溯源原文', d.traceability_raw, '供应商/进口鱼油不等于成品进口或成品生产厂。'),
        row('工厂与进口证据', null, '当前对象没有独立的本款背标、许可证、具体产地或进口手续证据字段；不从品牌共用信息填入。')
      ]),
      group('声称、实验与功效', [
        row('工艺声称原文', d.process_claim_raw, '页面工艺展示，不自动升级为生产事实或品质结论。'),
        row('页面卖点/声称原文', d.marketing_claims_raw, '保留整段以供回查；鲜肉、工艺、实验和美毛用语不互相证明。'),
        row('声称实验原文', d.feeding_study_raw, '仅记录页面/报告声称；原件、设计、对照、样本与本 SKU 适用范围仍需证据，不等于正式实验已核。'),
        row('胃蛋白酶消化率原文', d.pepsin_digestibility_raw, '保留字段原值；体外胃蛋白酶指标不等于全消化道消化率或临床功效。'),
        row('全消化道消化率原文', d.total_tract_digestibility_raw, '与胃蛋白酶指标分开；缺失不换算或借用。'),
        row('已核功效证据', null, '当前对象没有独立功效证据字段；不能由页面卖点、实验声称或品牌背书推出本款效果。')
      ]),
      group('品牌共用信息（来自 brandFacts）', brandFacts.length ? brandFacts.map(fact =>
        row(display(fact.fieldLabel), fact.valueText,
          `仅品牌层，不套用为本 SKU 事实。性质：${display(fact.informationNature)}；原核验状态：${display(fact.verificationStatus)}；日期：${display(fact.verificationDate)}；出处：${display(fact.sourceText)}；定位：${sourceLabel(fact.source, '品牌信息')}。`))
        : [row('品牌共用信息', null, '当前 brandFacts 无同 brandId 记录；不借用产品行品牌背景或其他品牌。')]),
      group('来源与用途', [
        row('来源定位', sourceLabel(p.source, '产品信息'), sourceBoundary),
        row('导入快照时间', snapshot, '导入时间不是报价日期、包装生产日期或事实核验日期。'),
        row('样板状态', '拆分草案，仅展示', '不写事实主本、不自动评分。确认拆法后仍按逐字段来源维护，未知不补值。')
      ])
    ];
    return {
      skuId: p.skuId,
      title: [p.brand, p.series, p.product, p.flavor].filter(known).map(text).join(' · ') || '产品样板（身份信息待补）',
      source, groups, questions: questions(), replication: replication(), empty: false
    };
  }

  return {create,nutrition,pricing};
});

;
(function(root) {
  'use strict';
  root.PetFoodEvaluationUI = function(api) {
    const engine = root.PetFoodEvaluation, $ = id=>document.getElementById(id), esc = api.esc;
    let config = engine.defaults(), error = '', drafts = new Map(), removed = null, pendingDelete = '', pendingAdopt = '';
    const number = value=>new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(value);
    const rows = ()=>api.getProducts().filter(p=>api.getSelected().has(p.skuId));
    const message = text=>{ $('trial-message').textContent = text; };
    function action(fn) { try { fn(); } catch(e) { message(`未完成：${e.message} 产品底稿未改动。`); } }
    function getConfig() { if (error) throw new Error(error); return engine.normalize(config); }
    function ensure(p) {
      if (!drafts.has(p.skuId)) drafts.set(p.skuId,engine.record(p,config));
      return drafts.get(p.skuId);
    }
    const calibration = root.PetFoodCalibration;
    const sourceStates = api.sourceStates || {};
    function syncWeightScheme() {
      const scheme = engine.weightScheme(config);
      $('trial-weight-scheme').value = scheme?.id || 'custom';
      $('trial-weight-hint').textContent = (scheme?.description || '自定义权重：按启用权重总和计算，0权重项仍可查看，不计入总分。') + ' 仅权重方案，不自动判分或认可判据；切换保留原分、理由和场景。';
    }
    function calibrationHtml(p,key,enabled) {
      const guide = calibration.guide(p,key,sourceStates);
      if (guide.state === 'unsampled') return '';
      return `<section class="trial-calibration"><strong>本款判断 · ${esc(calibration.AS_OF)}</strong><p>${esc(guide.summary)}</p>${guide.state === 'current' ? `<p class="chart-hint">${esc(guide.reason)}</p>${guide.refs.map(ref=>`<a href="/api/calibration-source?id=${esc(ref.id)}" target="_blank" rel="noopener">查看${esc(ref.label)}</a>`).join(' · ')}${enabled ? '<p><button class="secondary-button" type="button" data-trial-assist>带入判断与出处（不填分）</button></p>' : ''}` : ''}</section>`;
    }
    function sync() {
      pendingAdopt = '';
      $('trial-mode').value = config.mode; $('trial-scenario').value = config.scenario;
      syncWeightScheme();
      $('trial-rules').innerHTML = engine.definitions.map(d=>`<fieldset class="score-rule"><legend>${esc(d.label)}</legend><label>权重<input type="number" min="0" max="100" step="1" aria-label="${esc(d.label)}试评权重" data-trial-weight="${d.key}" value="${config.rules[d.key].weight}"></label><label class="trial-criterion">判分方向 / 阈值与分档依据<textarea rows="4" maxlength="2000" data-trial-criterion="${d.key}">${esc(config.rules[d.key].criterion)}</textarea></label><details><summary>查看${esc(d.label)}候选分档</summary><p class="chart-hint">仅讨论锚点，非科学阈值/默认标准，不自动填分。缺适用依据时仍未知。</p><p class="trial-rubric">${esc(calibration.criterion(d.key))}</p><button class="secondary-button" type="button" data-trial-adopt="${d.key}">采用这一维候选依据</button></details></fieldset>`).join('');
    }
    function readConfig() {
      pendingAdopt = '';
      $('trial-rules').querySelectorAll('[data-trial-adopt]').forEach(b=>{ b.textContent = '采用这一维候选依据'; });
      try {
        const rules = Object.fromEntries(engine.keys.map(key=>{
          const raw = $('trial-rules').querySelector(`[data-trial-weight="${key}"]`).value;
          return [key,{weight:raw === '' ? NaN : Number(raw),criterion:$('trial-rules').querySelector(`[data-trial-criterion="${key}"]`).value}];
        }));
        config = engine.normalize({version:engine.VERSION,mode:$('trial-mode').value,scenario:$('trial-scenario').value,rules}); error = ''; syncWeightScheme();
      } catch(e) { error = e.message; }
      updateResults();
    }
    function renderMatrix() {
      const products = rows(), enabled = $('trial-mode').value === 'custom';
      $('trial-config').hidden = !enabled;
      $('trial-save').disabled = $('trial-export').disabled = products.length < 2 || products.length > 6;
      if (products.length < 2 || products.length > 6) {
        $('trial-matrix').innerHTML = '<p class="chart-hint">先在产品库勾选2–6款。这里仅评你选中的产品，不随筛选偷偷替换；建议先试2–3款。</p>';
        $('trial-totals').innerHTML = ''; return;
      }
      const opened = new Set([...$('trial-matrix').querySelectorAll('details[open]')].map(d=>d.dataset.trialDisclosure));
      $('trial-matrix').innerHTML = '<div class="table-wrap trial-table"><table><thead><tr><th>分项</th>' + products.map(p=>`<th><button type="button" class="detail-button" data-trial-detail="${esc(p.skuId)}">${esc(api.label(p))}</button><small>${esc(p.skuId)} · 内部 ${esc(p.formulaVersion)}</small></th>`).join('') + '</tr></thead><tbody>' +
        engine.definitions.map(d=>`<tr><th scope="row">${esc(d.label)}<small>${esc(d.boundary)}</small></th>` + products.map(p=>{
          const r = ensure(p).dimensions[d.key], f = engine.facts(p,d.key), disclosure = `${p.skuId}:${d.key}`;
          return `<td><p data-trial-result="${esc(disclosure)}"></p><details data-trial-disclosure="${esc(disclosure)}" data-calibration-sku="${esc(p.skuId)}" data-calibration-key="${d.key}" ${opened.has(disclosure) ? 'open' : ''}><summary>${enabled ? '查看资料 / 填写本项' : '查看记录与缺项'}</summary>${calibrationHtml(p,d.key,enabled)}<dl class="trial-facts">${f.rows.map(row=>`<dt>${esc(row.label)}</dt><dd>${esc(row.value === null || row.value === '' ? '未知 / 当前未记录' : row.value)}</dd>`).join('')}</dl><p class="chart-hint">来源：${esc(f.source.file || '未记录')} · ${esc(f.source.sheet)} 第${esc(f.source.row ?? '?')}行。原文未自动升级为已核事实。</p>${enabled ? `<div class="trial-entry" data-trial-sku="${esc(p.skuId)}" data-trial-key="${d.key}"><label>自填候选分 0–100（未知留空）<input type="number" min="0" max="100" step="0.1" data-trial-field="points" value="${r.points ?? ''}" aria-label="${esc(api.label(p)+' '+d.label+' 候选分')}"></label><label>判分理由 / 未知原因<textarea rows="2" maxlength="2000" data-trial-field="reason">${esc(r.reason)}</textarea></label><label>出处（本SKU材料 / 链接 / 行号）<textarea rows="2" maxlength="2000" data-trial-field="evidence">${esc(r.evidence)}</textarea></label><button class="secondary-button" type="button" data-trial-reconfirm hidden>按当前资料与依据重新确认本项</button></div>` : ''}</details></td>`;
        }).join('')+'</tr>').join('') + `<tr><th scope="row">适用限制<small>过敏、疾病、疑点等不能被总分抵消；填写后不出总分。</small></th>${products.map(p=>`<td><label>本款限制 / 待解决风险<textarea rows="2" maxlength="2000" data-trial-risk="${esc(p.skuId)}" ${enabled ? '' : 'disabled'}>${esc(ensure(p).risk)}</textarea></label></td>`).join('')}</tr></tbody></table></div>`;
      updateResults();
    }
    function updateResults() {
      const products = rows(), off = $('trial-mode').value !== 'custom';
      $('trial-config').hidden = off;
      const schemeLabel = engine.weightScheme(config)?.label || '自定义权重';
      $('trial-status').textContent = off ? `当前权重：${schemeLabel}；仍只看资料，不产生评级。开启自定义候选试评才计算；方案不是已核专业标准。` : error ? `停止计算：${error}` : `当前权重：${schemeLabel}。分项分自填，缺任何启用项不算总分；0权重项旁列，不是全面质量评价。`;
      if (products.length < 2 || products.length > 6) return;
      const totals = [];
      for (const p of products) {
        let result, resultError = '';
        try { result = engine.score(p,config,ensure(p)); }
        catch(e) { result = null; resultError = e.message; }
        for (const d of engine.definitions) {
          const cell = $('trial-matrix').querySelector(`[data-trial-result="${p.skuId}:${d.key}"]`);
          const dim = result?.dimensions.find(v=>v.key === d.key);
          if (cell) {
            cell.textContent = off ? '只看资料 / 不评分' : error ? '设置无效 / 未计算' : !dim ? `未计算：${resultError}` :
              `${dim.enabled ? `${number(dim.weight*100)}%权重` : '旁列 · 不计总分'} · ${dim.points === null ? dim.reason : `${number(dim.points)}分 × ${number(dim.weight*100)}% = ${dim.contribution === null ? '不计入' : number(dim.contribution)}`}`;
            const button = cell.closest('td').querySelector('[data-trial-reconfirm]');
            if (button) button.hidden = !dim?.stale;
          }
        }
        totals.push(`<article><strong>${esc(api.label(p))}</strong><p>${off ? '不评分' : error || !result ? '未计算' : result.total === null ? '候选总分：—' : `候选总分：${number(result.total)} / 100`}</p>${!off && result && !error ? `<small>可用分项权重覆盖 ${number(result.coverage*100)}%（不是品质）${result.excluded.length ? ` · 旁列不计总分：${esc(result.excluded.join('、'))}` : ''}</small>${result.missing.length ? `<p class="chart-hint">尚缺启用分项：${esc(result.missing.join('、'))}（未填或已失效）</p>` : ''}${result.limitations.map(t=>`<p class="trial-warning">${esc(t)}</p>`).join('')}` : ''}</article>`);
      }
      $('trial-totals').innerHTML = totals.join('');
    }
    $('trial-mode').addEventListener('change',()=>{readConfig();renderMatrix();});
    $('trial-weight-scheme').addEventListener('change',()=>action(()=>{
      const id = $('trial-weight-scheme').value;
      if (id === 'custom') {
        if (config.mode === 'custom') $('trial-config').open = true;
        message('当前权重未变；开启自定义候选试评后可展开调整权重，原分项与判分依据保留。'); return;
      }
      config = engine.applyWeightScheme(getConfig(),id); error = ''; sync(); renderMatrix();
      message(`已切换${engine.weightScheme(config).label}权重。原分、理由、出处、判分依据和场景保留；未填分、未改底稿。${config.mode === 'off' ? '当前仍只看资料。' : ''}`);
    }));
    $('trial-scenario').addEventListener('change',readConfig);
    $('trial-rules').addEventListener('input',readConfig);
    $('trial-rules').addEventListener('click',e=>{
      const button = e.target.closest('[data-trial-adopt]'); if (!button) return;
      if (pendingAdopt !== button.dataset.trialAdopt) {
        pendingAdopt = button.dataset.trialAdopt;
        $('trial-rules').querySelectorAll('[data-trial-adopt]').forEach(b=>{ b.textContent = b === button ? '确认采用这一维（旧分将失效）' : '采用这一维候选依据'; });
        message('再点一次确认替换这一维依据；旧分会失效，权重和底稿不变。这不是认可默认专业规则。'); return;
      }
      pendingAdopt = ''; button.textContent = '采用这一维候选依据';
      const field = $('trial-rules').querySelector(`[data-trial-criterion="${button.dataset.trialAdopt}"]`);
      field.value = calibration.criterion(button.dataset.trialAdopt); readConfig();
      message('已采用这一维候选依据；未填分、未改权重/事实。旧分如失效需重新判断，不自动承接。');
    });
    $('trial-matrix').addEventListener('click',e=>{
      const detail = e.target.closest('[data-trial-detail]'); if (detail) api.openDetail(detail.dataset.trialDetail);
      const assist = e.target.closest('[data-trial-assist]');
      if (assist) action(()=>{
        getConfig();
        const box = assist.closest('[data-calibration-sku]'), sku = box.dataset.calibrationSku, key = box.dataset.calibrationKey;
        const p = rows().find(p=>p.skuId === sku), r = ensure(p);
        const next = calibration.assist(p,key,r.dimensions[key],sourceStates);
        r.dimensions[key] = next;
        const form = box.querySelector('.trial-entry');
        form.querySelector('[data-trial-field="reason"]').value = next.reason;
        form.querySelector('[data-trial-field="evidence"]').value = next.evidence;
        updateResults(); message('已带入本款未知原因与出处，分项仍空；有分或有文字的项不会覆盖。保存试评后可恢复。');
      });
      const confirm = e.target.closest('[data-trial-reconfirm]');
      if (confirm) action(()=>{
        const c = getConfig(), form = confirm.closest('[data-trial-sku]'), p = rows().find(p=>p.skuId === form.dataset.trialSku);
        const r = ensure(p).dimensions[form.dataset.trialKey];
        r.snapshot = engine.snapshot(p,form.dataset.trialKey); r.ruleToken = engine.ruleToken(c,form.dataset.trialKey);
        updateResults(); message('已按当前资料和判分依据重新确认这一项；这是你的候选判断，不是系统核准。');
      });
    });
    $('trial-matrix').addEventListener('input',e=>{
      const form = e.target.closest('[data-trial-sku]');
      if (form) {
        const r = drafts.get(form.dataset.trialSku).dimensions[form.dataset.trialKey];
        const value = e.target.value;
        if (e.target.dataset.trialField === 'points' && r.points === null && value !== '' && !error) {
          const p = rows().find(p=>p.skuId === form.dataset.trialSku);
          r.snapshot = engine.snapshot(p,form.dataset.trialKey); r.ruleToken = engine.ruleToken(config,form.dataset.trialKey);
        }
        r[e.target.dataset.trialField] = e.target.dataset.trialField === 'points' ? value === '' ? null : Number(value) : value;
      }
      if (e.target.dataset.trialRisk) drafts.get(e.target.dataset.trialRisk).risk = e.target.value;
      updateResults();
      if(e.target.dataset.trialRisk)api.riskChanged?.();
    });
    function currentSession() {
      const c = getConfig();
      if (c.mode !== 'custom') throw new Error('请先开启自定义试评，再保存/导出；只看资料不生成评分记录。');
      const createdAt = new Date().toISOString();
      return engine.session({version:engine.VERSION,name:$('trial-name').value.trim() || `试评 ${createdAt}`,createdAt,config:c,records:rows().map(ensure)});
    }
    function refreshSaved(name = $('trial-saved').value) {
      const saved = engine.read(localStorage);
      $('trial-saved').innerHTML = '<option value="">选择已保存试评</option>'+saved.map(t=>`<option value="${esc(t.name)}">${esc(t.name)} · ${t.records.length}款</option>`).join('');
      $('trial-saved').value = saved.some(t=>t.name === name) ? name : '';
      $('trial-restore').disabled = $('trial-delete').disabled = !$('trial-saved').value;
      pendingDelete = ''; $('trial-delete').textContent = '移除试评';
    }
    function restore(value) {
      const t = engine.session(value), ids = new Set(api.getProducts().map(p=>p.skuId));
      drafts = new Map(t.records.map(r=>[r.skuId,r])); config = t.config; error = ''; sync();
      $('trial-name').value = t.name;
      api.setSelected(t.records.filter(r=>ids.has(r.skuId)).map(r=>r.skuId));
      renderMatrix();
      message(`已恢复「${t.name}」。${t.records.some(r=>!ids.has(r.skuId)) ? '部分SKU已不在当前库，未找替身；原记录仍在。' : ''}资料或场景/依据变动的旧分不参与计算；重存请换名。`);
    }
    $('trial-save').addEventListener('click',()=>action(()=>{
      const saved = engine.add(localStorage,currentSession()); refreshSaved(saved.name);
      message(`已保存「${saved.name}」到本浏览器/同源地址；未写Excel。建议下载JSON备份，换浏览器或端口需导入恢复。`);
    }));
    $('trial-saved').addEventListener('change',()=>action(()=>refreshSaved()));
    $('trial-restore').addEventListener('click',()=>action(()=>{
      const t = engine.read(localStorage).find(t=>t.name === $('trial-saved').value);
      if (!t) throw new Error('记录已不存在，请重新选择。'); restore(t);
    }));
    $('trial-delete').addEventListener('click',()=>action(()=>{
      const name = $('trial-saved').value;
      if (pendingDelete !== name) { pendingDelete = name; $('trial-delete').textContent = '确认移除'; message('仅移除所选浏览器试评，不改产品；本页刷新前可撤销，长期保留请先导出JSON。'); return; }
      removed = engine.remove(localStorage,name); refreshSaved(); $('trial-undo').hidden = false; message('已移除这次试评；本页刷新前可撤销。');
    }));
    $('trial-undo').addEventListener('click',()=>action(()=>{if (!removed) return; const t = engine.add(localStorage,removed); refreshSaved(t.name); removed = null; $('trial-undo').hidden = true; message('已撤销移除。');}));
    function download(name,content,type) {
      const link = document.createElement('a'), url = URL.createObjectURL(new Blob([content],{type}));
      link.href = url; link.download = name; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    $('trial-export').addEventListener('click',()=>action(()=>{
      const t = currentSession(), date = new Date().toISOString().slice(0,10);
      download(`pet-food-trial-${date}.json`,JSON.stringify(t,null,2),'application/json');
      message('已请求下载当前试评JSON；包含规则、分项理由/出处和资料绑定。导入可恢复，不是产品事实文件。');
    }));
    $('trial-csv').addEventListener('click',()=>action(()=>{
      const t = currentSession(), csv = [['sku_id','内部版本','产品','记录性质','场景','维度','分项分','有效分项分','权重','归一权重','贡献','状态','判分理由','出处','判分依据','适用限制','候选总分']];
      for (const p of rows()) {
        const r = drafts.get(p.skuId), s = engine.score(p,t.config,r);
        for (const d of s.dimensions) csv.push([p.skuId,p.formulaVersion,api.label(p),'自填候选试评，非已核专业结论',t.config.scenario,d.label,r.dimensions[d.key].points,d.points,t.config.rules[d.key].weight,d.weight,d.contribution,d.reason,r.dimensions[d.key].reason,d.evidence,t.config.rules[d.key].criterion,s.limitations.join('；'),s.total]);
      }
      download(`pet-food-trial-${new Date().toISOString().slice(0,10)}.csv`,'\ufeff'+csv.map(r=>r.map(root.PetFoodQuery.csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
      message('已请求下载分项CSV；旧分与当前有效分分列，未知不填0。CSV不作为产品事实导入。');
    }));
    $('trial-import').addEventListener('change',async e=>{
      const file = e.target.files[0]; if (!file) return;
      try {
        if (file.size > 4000000) throw new Error('文件超过4MB，未读取。');
        const t = engine.session(JSON.parse(await file.text())); restore(t);
        message(`已载入「${t.name}」为当前草稿，尚未保存本浏览器；资料变化的分数自动失效。`);
      } catch(err) { message(`导入未完成：${err.message} 现有记录未覆盖。`); }
      e.target.value = '';
    });
    $('trial-reset').addEventListener('click',()=>{
      if (!root.confirm('清空当前未保存试评和规则？已保存记录与产品底稿不变。')) return;
      config = engine.defaults(); drafts = new Map(); error = ''; $('trial-name').value = ''; sync(); renderMatrix(); message('当前草稿已清空，保存记录不变。');
    });
    sync(); action(()=>refreshSaved());
    return {render:renderMatrix,getConfig,getRisk:p=>drafts.get(p.skuId)?.risk||'',setConfig:value=>{config=engine.normalize(value);error='';sync();renderMatrix();}};
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

;
(function(root) {
  'use strict';
  root.PetFoodAnalysisUI=function(api) {
    const engine=root.PetFoodAnalysis,$=id=>document.getElementById(id),esc=api.esc;
    let config=engine.defaults(),error='';
    const numeric=['proteinMin','fatMax','animalIngredientMin','animalProteinMin','budgetMax','budgetBuffer'];
    const controls=['mode','scenario','basis','requiredWords','excludedWords','animalIngredientDenominator','priceScope',...numeric];
    const rows=()=>api.getProducts().filter(p=>api.getSelected().has(p.skuId));
    const num=n=>new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(n);
    function getConfig(){if(error)throw new Error(error);return engine.normalize(config);}
    function sync(){
      for(const key of controls)$('auto-'+key).value=config[key]??'';
      const sum=engine.keys.reduce((n,k)=>n+config.weights[k],0);
      $('auto-scheme').value=JSON.stringify(engine.keys.map(k=>config.weights[k]/(sum||1)))===JSON.stringify([.4,.35,0,0,.25])?'daily':
        JSON.stringify(engine.keys.map(k=>config.weights[k]/(sum||1)))===JSON.stringify([.3,.25,.2,.15,.1])?'full':'custom';
      for(const key of engine.keys)$('auto-weight-'+key).value=config.weights[key];
    }
    function read(){
      try {
        const v={version:engine.VERSION,weights:{},riskNotes:config.riskNotes};
        for(const k of controls){const text=$('auto-'+k).value;v[k]=numeric.includes(k)?text===''?null:Number(text):text;}
        for(const k of engine.keys){const text=$('auto-weight-'+k).value;v.weights[k]=text===''?NaN:Number(text);}
        config=engine.normalize(v);error='';
        const sum=engine.keys.reduce((n,k)=>n+config.weights[k],0),ratio=engine.keys.map(k=>config.weights[k]/(sum||1));
        $('auto-scheme').value=ratio.every((n,i)=>Math.abs(n-[.4,.35,0,0,.25][i])<1e-9)?'daily':ratio.every((n,i)=>Math.abs(n-[.3,.25,.2,.15,.1][i])<1e-9)?'full':'custom';
      } catch(e){error=e.message;}
      api.changed();
    }
    function score(p){return error?null:engine.score(p,config,api.getRisk(p));}
    function text(p){return error?'自动分析停止：'+error:engine.summary(p,config,api.getRisk(p));}
    function render(){
      const products=rows(),active=config.mode==='custom';
      $('auto-settings').hidden=$('auto-weights').hidden=!active;
      $('auto-status').textContent=error?'停止计算：'+error:active?'只对明确设置的条件计算；启用项未知则无总分。保证值只给下/上界时，无法推出的条件仍未知。':'默认只看资料。启用后先填写你的条件；没有预设的专业质量阈值。';
      $('auto-export').disabled=products.length<2||products.length>6||!!error;
      if(products.length<2||products.length>6){$('auto-results').innerHTML='<p class="empty-state">先勾选2–6款，或点“选入三款样例”。只比较已选产品，不随筛选替换。</p>';return;}
        const results=products.map(p=>({p,s:score(p)}));
      const header='<thead><tr><th>条件与解释</th>'+products.map(p=>'<th><button class="detail-button" data-auto-detail="'+esc(p.skuId)+'">'+esc(api.label(p))+'</button><br><button class="text-button" data-auto-edit="'+esc(p.skuId)+'" '+(api.canEdit()?'':'disabled')+'>修改这款资料</button></th>').join('')+'</tr></thead>';
      const total='<tr><th>条件匹配总分<small>不是品质 / 安全 / 功效评级</small></th>'+results.map(({s})=>'<td>'+(!active?'未启用':!s?'未计算':s.total===null?'—':num(s.total)+'/100')+(active&&s?'<small>'+esc(s.missing.length?'尚缺：'+s.missing.join('、'):'')+'</small>'+s.limitations.map(t=>'<small>'+esc(t)+'</small>').join(''):'')+'</td>').join('')+'</tr>';
      $('auto-results').innerHTML='<div class="table-wrap"><table class="compare-table auto-table">'+header+'<tbody>'+total+engine.keys.map(k=>'<tr><th>'+esc(engine.labels[k])+'</th>'+results.map(({s})=>{
        const d=s?.dimensions.find(d=>d.key===k);
        return '<td>'+(!active?'只看资料':!d?'未计算':d.enabled?(d.points===null?'未知':num(d.points)+'分 × '+num(d.weight*100)+'% = '+num(d.contribution)):'旁列，不计总分')+
          (d?'<details><summary>查看依据与缺项</summary><p>'+esc(d.reason)+'</p><small>'+esc(d.source)+'</small></details>':'')+'</td>';
      }).join('')+'</tr>').join('')+'<tr><th>本次适用限制</th>'+products.map(p=>'<td><details><summary>填写 / 查看限制</summary><label>限制说明<textarea rows="2" maxlength="1000" data-auto-risk="'+esc(p.skuId)+'">'+esc(config.riskNotes[p.skuId]||'')+'</textarea></label><small>填写后不出总分，随常用方案保存；不改产品事实。</small></details></td>').join('')+'</tr></tbody></table></div>';
      $('auto-results').querySelectorAll('[data-auto-detail]').forEach(b=>b.onclick=()=>api.openDetail(b.dataset.autoDetail));
      $('auto-results').querySelectorAll('[data-auto-edit]').forEach(b=>b.onclick=()=>api.openEditor(b.dataset.autoEdit));
      $('auto-results').querySelectorAll('[data-auto-risk]').forEach(field=>field.onchange=()=>{
        config=engine.normalize({...config,riskNotes:{...config.riskNotes,[field.dataset.autoRisk]:field.value}});
        api.changed();
      });
    }
    for(const k of controls)$('auto-'+k).addEventListener(['mode','scenario','basis','animalIngredientDenominator','priceScope'].includes(k)?'change':'input',read);
    for(const k of engine.keys)$('auto-weight-'+k).addEventListener('input',read);
    $('auto-scheme').addEventListener('change',()=>{
      const weights=$('auto-scheme').value==='daily'?[40,35,0,0,25]:$('auto-scheme').value==='full'?[30,25,20,15,10]:null;
      if(weights)engine.keys.forEach((k,i)=>{$('auto-weight-'+k).value=weights[i];});read();
    });
    $('auto-select-sample').onclick=()=>api.setSelected(['pub_49a3729e441a6554c3c5','pub_eb3094d8cdff6cbe7546','pub_0cd84f2a9d42bc52a8c1']);
    $('auto-chart').onclick=()=>api.showChart();
    $('auto-compare').onclick=()=>api.showCompare();
    $('auto-export').onclick=()=>{
      try{
        const c=getConfig(),rowsOut=[['sku_id','产品','结果性质','维度','有效分项','归一权重','贡献','原因','来源','条件总分','规则配置']];
        for(const p of rows()) {const s=engine.score(p,c,api.getRisk(p));for(const d of s.dimensions)rowsOut.push([p.skuId,api.label(p),'用户条件匹配，非质量评级',d.label,d.points,d.weight,d.contribution,d.reason,d.source,s.total,JSON.stringify(c)]);}
        const a=document.createElement('a'),url=URL.createObjectURL(new Blob(['\ufeff'+rowsOut.map(r=>r.map(root.PetFoodQuery.csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
        a.href=url;a.download='pet-food-target-analysis.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }catch(e){$('auto-status').textContent=e.message;}
    };
    sync();
    return {render,getConfig,score,text,setConfig:v=>{config=engine.normalize(v);error='';sync();}};
  };
})(typeof globalThis!=='undefined'?globalThis:this);

;
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.PFDSSelectionLab=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION='selection-lab-v1';
  const dimensions=[
    ['assurance','稳妥依据'],['formula','配方与研发'],['ingredients','配料偏好'],
    ['production','生产方式偏好'],['process','工艺偏好'],['budget','预算匹配']
  ];
  const schemes={
    steady:{label:'稳妥优先',weights:[40,25,10,10,5,10]},
    formula:{label:'配方优先',weights:[30,35,20,5,5,5]},
    budget:{label:'预算平衡',weights:[30,20,10,5,5,30]}
  };
  const schemeDescriptions={
    steady:'更重视质量控制、品牌与产品历史、工厂能力及相关事件的判断；不是按品牌知名度排名。',
    formula:'更重视配方验证、研发与原料偏好；肉粉或进口身份本身不代表配方差。',
    budget:'更重视预算匹配；预算内同等满足，不是越便宜越好。',
    custom:'按你设置的权重计算；下方可查看每项实际占比。'
  };
  function ingredientProfile(raw={}) {
    const text=String(raw.ingredients_raw||'').trim(), claim=String(raw.marketing_claims_raw||'');
    const fresh=/(?:新)?鲜(?:去骨)?(?:鸡|鸭|牛|羊|猪|兔|鱼|三文鱼|鲱鱼|鳕鱼|鲑鱼|乳鸽|火鸡|鹿)(?:肉|肝|心)?/.test(text);
    const frozen=/冻(?:去骨)?(?:鸡|鸭|牛|羊|猪|兔|鱼|三文鱼|火鸡|鹿)/.test(text.replace(/冻干/g,''));
    const meal=/(?:鸡肉|鸭肉|牛肉|羊肉|猪肉|禽肉|肉骨|鱼|肉|鸡|鸭|火鸡)粉/.test(text);
    const dehydrated=/脱水|(?:鸡|鸭|牛|羊|鱼|火鸡)肉干|干燥(?:鸡|鸭|牛|羊|鱼)/.test(text);
    const noMeal=/(?:0|零|不含|无)肉粉/.test(claim);
    const noFrozen=/(?:0|零|不含|无|不使用)冻肉/.test(claim);
    let type='unknown',label='原料形式未明确';
    if(meal&&noMeal||frozen&&noFrozen){type='conflict';label='配料与无肉粉／冻肉声称冲突';}
    else if(!text||/^(无|未记录|待补)$/.test(text))label='配料未收录';
    else if(dehydrated){type='dehydrated';label='含脱水肉／干肉，单列判断';}
    else if(meal&&(fresh||frozen)){type='mixed';label='鲜／冻肉与肉粉混合型';}
    else if(meal){
      // Unspecified meat can have unknown fresh/frozen state; do not assert pure meal.
      const rest=text.replace(/(?:鸡肉|鸭肉|牛肉|羊肉|猪肉|禽肉|肉骨|鱼|肉|鸡|鸭|火鸡)粉/g,'');
      if(/鸡肉|鸭肉|牛肉|羊肉|鱼肉|鸡肝|鸭肝|冻干/.test(rest))label='含肉粉，其他肉类形式待明确';
      else {type='meal';label='肉粉型（按已录配料）';}
    }
    else if(frozen&&noMeal){type='frozen';label='含冻肉型，无肉粉声称';}
    else if(fresh&&noMeal&&noFrozen){type='fresh';label='鲜肉型，无肉粉／冻肉声称';}
    else if(fresh&&noMeal){type='no_meal';label='鲜肉＋无肉粉声称，冻肉情况未明确';}
    return {type,label,fresh,frozen,meal,noMeal,noFrozen,dehydrated};
  }
  function evidenceSummary(p,ctx={}) {
    const d=p.details||{},present=v=>v!=null&&String(v).trim()!==''&&!/^(无|暂无|未记录|待补|未知|—)$/.test(String(v).trim());
    const fields=[['配料',d.ingredients_raw],['营养保证值',d.other_guaranteed_analysis_raw],
      ['生产企业',p.factoryName],['原料来源',d.traceability_raw],
      ['动物性原料比例',d.animal_ingredient_ratio_raw],['动物性蛋白比例',d.animal_protein_ratio_raw],
      ['研究记录',d.feeding_study_raw]];
    const available=fields.filter(([,v])=>present(v)).map(([label])=>label);
    const missing=fields.filter(([,v])=>!present(v)).map(([label])=>label);
    const facts=ctx.brand||[], factories=ctx.factory||[];
    return {available,missing,coverage:available.length+'/'+fields.length,
      history:facts.filter(f=>/成立|年限|历史/.test(f.fieldLabel)),
      market:facts.filter(f=>/市场|销量|销售|口碑/.test(f.fieldLabel)),
      events:facts.filter(f=>/舆情|召回|事件|投诉/.test(f.fieldLabel)),
      research:facts.filter(f=>/研发|研究/.test(f.fieldLabel)),
      factories, factoryLinked:factories.length>0&&!/待|未确认/.test(p.factoryName||''),
      functionText:p.functionRaw||d.function_raw||'',study:present(d.feeding_study_raw)?d.feeding_study_raw:'',
      ingredient:ingredientProfile(d)};
  }
  const weights=id=>Object.fromEntries(dimensions.map(([k],i)=>[k,schemes[id].weights[i]]));
  function defaults(){return {version:VERSION,scheme:'steady',weights:weights('steady'),ingredient:'fresh_only',ownPreference:'slight',process:'',budget:null};}
  function normalize(v){
    if(!v||v.version!==VERSION||!['steady','formula','budget','custom'].includes(v.scheme)||
      !['fresh','fresh_only','frozen_no_meal','mixed','meal','no_meal','none','manual'].includes(v.ingredient)||!['slight','none'].includes(v.ownPreference)||
      typeof v.process!=='string'||v.process.length>50||!(v.budget===null||Number.isFinite(v.budget)&&v.budget>0&&v.budget<=1000000))
      throw new Error('请检查预算与偏好设置。');
    if(!v.weights||dimensions.some(([k])=>!Number.isFinite(v.weights[k])||v.weights[k]<0||v.weights[k]>100)||
      !dimensions.some(([k])=>v.weights[k]>0))throw new Error('权重为0–100，至少保留一项。安全把关不随权重关闭。');
    return {...v,weights:Object.fromEntries(dimensions.map(([k])=>[k,v.weights[k]]))};
  }
  // Equality snapshot, not a quality verdict. Include linked evidence to invalidate stale judgments.
  function snapshot(p,context){return JSON.stringify([VERSION,p.skuId,p.formulaVersionId,p.details,p.stage,p.productionMode,p.factoryName,p.pricePerJin,context]);}
  function reviewValid(r,stamp){return !!r&&r.snapshot===stamp;}
  function manual(r,key){
    const x=r?.dimensions?.[key];
    return x&&[0,25,50,75,100].includes(x.points)&&String(x.reason||'').trim()&&String(x.source||'').trim()
      ?{points:x.points,reason:x.reason,source:x.source}
      :{points:null,reason:x?.reason||'需要本次判断与出处；现有文字可在下方查看',source:x?.source};
  }
  function score(p,value,record,stamp,externalRisk=''){
    // Retire only the exact stage-only hold generated by the old six-product pilot.
    if(record?.pilot===true&&record.gate==='hold'&&record.gateReason==='当前仅有幼猫记录，不纳入普通成猫方案')
      record={...record,gate:'unreviewed'};
    const c=normalize(value),valid=reviewValid(record,stamp),r=valid?record:null,raw=p.details||{};
    const values={assurance:manual(r,'assurance'),formula:manual(r,'formula')};
    const ingredients=String(raw.ingredients_raw||'').trim(),claims=String(raw.marketing_claims_raw||'');
    if(c.ingredient==='manual')values.ingredients=manual(r,'ingredients');
    else if(!ingredients||/^(无|未记录|待补)$/.test(ingredients))values.ingredients={points:null,reason:'没有可用配料原文'};
    else if(c.ingredient==='fresh'){
      const hit=ingredients.match(/(?:新)?鲜(?:去骨)?(?:鸡|鸭|牛|羊|猪|兔|鱼|三文鱼|鲱鱼|鳕鱼|鲑鱼|乳鸽|火鸡|鹿)(?:肉|肝|心)?/);
      values.ingredients={points:hit?100:0,reason:hit?'配料文字命中“'+hit[0]+'”；只满足鲜肉偏好，不代表营养更好':'配料文字未命中所设鲜肉词，不是质量差的结论'};
    }else{
      const meal=ingredients.match(/(?:鸡肉|鸭肉|牛肉|羊肉|猪肉|禽肉|肉骨|鱼|肉)粉/);
      const claim=/(?:0|零|不含|无)肉粉/.test(claims);
      values.ingredients=meal&&claim?{points:null,reason:'无肉粉声称与配料文字冲突'}:
        meal?{points:0,reason:'配料含“'+meal[0]+'”，不满足无肉粉偏好；不判营养优劣'}:
        claim?{points:100,reason:'页面明确声称无肉粉，仅匹配声称，未独立核验'}:
        {points:null,reason:'未列肉粉不自动证明无肉粉；缺明确声称'};
    }
    if(['fresh_only','frozen_no_meal','mixed','meal','none'].includes(c.ingredient)){
      const profile=ingredientProfile(raw);
      const known=['fresh','frozen','mixed','meal'].includes(profile.type);
      values.ingredients=c.ingredient==='none'?{points:100,reason:'原料形式不作高低区分；不代表各配方品质相同'}:
        !known?{points:null,reason:profile.label+'；不猜填原料形式'}:
        {points:profile.type===({fresh_only:'fresh',frozen_no_meal:'frozen'}[c.ingredient]||c.ingredient)?100:0,reason:profile.label+'；只匹配所选原料形式，不是营养优劣评分'};
    }
    values.production=c.ownPreference==='none'?{points:100,reason:'自有和代工同等对待，不因生产模式拉开差距'}:
      p.productionMode==='自有'?{points:100,reason:'记录为自有，满足你的轻度偏好；不是安全分'}:
      p.productionMode==='代工'?{points:75,reason:'记录为代工，按你的生产方式偏好计75；工厂能力另看依据，不是安全性低25%'}:
      {points:null,reason:'生产方式未明确，不按代工处理'};
    values.process=!c.process?{points:null,reason:'尚未选择工艺；可设本项权重为0'}:
      !p.process||/待核|未知|未填写/.test(p.process)?{points:null,reason:'工艺未明确'}:
      {points:p.process===c.process?100:0,reason:'仅匹配你选的“'+c.process+'”，不是工艺优劣排名'};
    values.budget=c.budget===null?{points:null,reason:'尚未设置参考元/斤预算'}:
      !Number.isFinite(p.pricePerJin)||p.pricePerJin<0?{points:null,reason:'缺有效参考单价'}:
      {points:Math.min(100,Math.max(0,100*(2-p.pricePerJin/c.budget))),reason:'参考'+p.pricePerJin+'元/斤；预算内100，达到预算两倍为0。不绑定包装，不是实时价或品质分'};
    const sum=dimensions.reduce((s,[k])=>s+c.weights[k],0);
    const ds=dimensions.map(([key,label])=>({key,label,...values[key],weight:c.weights[key]/sum}));
    const enabled=ds.filter(d=>d.weight>0),missing=enabled.filter(d=>d.points===null);
    const coverage=enabled.filter(d=>d.points!==null).reduce((s,d)=>s+d.weight,0);
    const contribution=enabled.reduce((s,d)=>s+(d.points??0)*d.weight,0);
    const gateReason=externalRisk?'已有适用限制：'+externalRisk:
      !r?'安全与适用性尚未核对（旧判断在资料变化后失效）':
      r.gate==='hold'?'暂不纳入：'+(r.gateReason||'需进一步核对'):
      r.gate!=='reviewed'||!String(r.gateReason||'').trim()||!String(r.gateSource||'').trim()?'安全与适用性尚未核对':'';
    // Provisional preference estimate: unknown is an explicit assumption, never a safety finding.
    const trialBlock = externalRisk ? '已有适用限制：'+externalRisk
      : record?.gate==='hold' ? '暂不纳入：'+(record.gateReason||'已记录限制，需复核')
      : '';
    const unknownWeight = Math.max(0,1-coverage);
    const trial = trialBlock ? null : contribution+50*unknownWeight;
    return {dimensions:ds,missing:missing.map(d=>d.label),coverage,contribution,
      trial,trialBlock,trialRange:trialBlock?null:[contribution,contribution+100*unknownWeight],
      total:!gateReason&&!missing.length?contribution:null,gateReason,
      stale:!!record&&!valid,ruleVersion:VERSION};
  }
  return {VERSION,dimensions,schemes,schemeDescriptions,ingredientProfile,evidenceSummary,weights,defaults,normalize,snapshot,reviewValid,score};
});

;
(function(root){
  'use strict';
  root.PFDSSelectionLabUI=function(api){
    const E=root.PFDSSelectionLab,$=id=>document.getElementById(id),esc=api.esc,KEY='pfds-selection-lab-v1';
    const visitor=document.body.dataset.audience==='visitor';
    const compactMedia=root.matchMedia?.('(max-width: 760px)');
    let config=E.defaults(),records={},error='',scope='all',page=0,lastSelection='',functionFocus='';
    try{const saved=visitor?null:JSON.parse(localStorage.getItem(KEY)||'null');if(saved){config=E.normalize(saved.config);if(config.ingredient==='fresh')config={...config,ingredient:'fresh_only'};records=saved.records||{};}}
    catch(e){error='本机旧设置未读取，已用默认方案；未覆盖旧保存。';}
    const panel=$('selection-lab');
    const n=v=>Number(v.toFixed(1));
    const context=p=>api.context(p);
    const stamp=p=>E.snapshot(p,context(p));
    const judgment=p=>root.PFDSSelectionReviewed.resolve(p,stamp(p),records[p.skuId]);
    panel.innerHTML=`<div class="panel-heading"><div><p class="section-kicker">${visitor?'偏好探索 · 测试中':'内部测试 · 不写产品底稿'}</p><h2>选粮偏好实验室</h2></div></div>
      <p>先看是否适用、有没有需要排除的问题，再看你的取舍。猫已经吃得稳定，不必因为这里的分数换粮。</p>
      <p class="reading-note">各阶段产品均可试评；为具体猫选粮时，请按适用阶段筛选。不同阶段的分数不代表可以互相替代。</p>
      <div class="edit-grid">
        <label>选粮倾向<select id="lab-scheme">${Object.entries(E.schemes).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}<option value="custom">自定义</option></select></label>
        <label>配料偏好<select id="lab-ingredient"><option value="fresh_only">鲜肉型，无肉粉／冻肉</option><option value="frozen_no_meal">含冻肉型，无肉粉</option><option value="mixed">鲜／冻肉与肉粉混合型</option><option value="meal">肉粉型</option><option value="none">原料形式不作高低区分</option><option value="fresh">旧设置：只匹配鲜肉文字</option><option value="no_meal">偏好明确无肉粉声称</option><option value="manual">按具体配方自行判断</option></select></label>
        <label>生产方式<select id="lab-own"><option value="slight">自有100／代工75</option><option value="none">自有 / 代工不作差别</option></select></label>
        <label>偏好工艺<select id="lab-process"><option value="">暂未指定</option>${[...new Set(api.getProducts().map(p=>p.process).filter(Boolean))].sort().map(s=>`<option>${esc(s)}</option>`).join('')}</select></label>
        <label>预算上限（参考元/斤）<input id="lab-budget" type="number" min="0.01" step="any" placeholder="填自己的预算，不预设价格"></label>
        <label>关注功能（只对照依据，不加总分）<select id="lab-function"><option value="">不指定</option><option>美毛</option><option>肠胃</option><option>泌尿</option><option>控重</option><option>毛球</option><option>低敏</option><option>免疫</option></select></label>
      </div>
      <p id="lab-explanation" class="reading-note"></p><details class="tool-disclosure"><summary>调整权重与查看规则</summary><div class="edit-grid">${E.dimensions.map(([k,l])=>`<label>${l}<input type="number" id="lab-w-${k}" min="0" max="100" step="1"></label>`).join('')}</div>
      <p>权重按总和归一。稳妥依据看品牌/生产责任、质量控制、配方使用时间及相关事件；研发看营养配方和研究适用范围。销量、品牌年龄、自有工厂均不自动证明安全；鲜肉/无肉粉不自动代表营养优越。动物原料、动物蛋白、体内/体外消化率不混算。</p>
      <p>稳妥依据、配方与研发采用人工候选档：100＝支持充分，75＝较多支持，50＝部分支持，25＝支持有限且有反向依据，0＝明确相反依据；未知留空，不以低分代替缺资料；必须填写理由与出处。不是安全概率或通用质量分。来源S/T/C/U继续在情报库保留，不按字母自动加分。</p>
      <p>原料类别按已录配料和声称区分；无肉粉／冻肉需明确依据，矛盾时未知。脱水肉单列，不直接当肉粉。类别匹配100／0只代表偏好，不是品质排序。自有100／代工75是你的主观刻度，工厂能力另看情报。工艺只匹配选择，不默认烘焙优于膨化。预算内100、两倍预算为0。未知不填0、不重分配权重；任何权重下安全把关都不能关闭。</p></details>
      <div class="chart-controls"><button type="button" class="secondary-button" id="lab-save">保存本机测试设置与判断</button><span id="lab-message" role="status"></span></div>
      <div class="chart-controls"><label>查看范围<select id="lab-scope"><option value="all">全部正式产品</option><option value="selected">仅比较已选产品</option></select></label><button type="button" class="secondary-button" id="lab-prev">上一组</button><span id="lab-page" role="status"></span><button type="button" class="secondary-button" id="lab-next">下一组</button></div>
      <p class="theme-note">全库沿用同一试用规则，电脑每组6款，手机每组2款，保持原始顺序，不是排行榜。未完成逐款证据判读的维度标为50*，不会套用样本判断。调整仅影响本次比较，不改产品底稿。</p><div id="lab-results"></div>`;
    function sync(){
      $('lab-scheme').value=config.scheme;$('lab-ingredient').value=config.ingredient;$('lab-own').value=config.ownPreference;
      $('lab-process').value=config.process;$('lab-budget').value=config.budget??'';
      E.dimensions.forEach(([k])=>$('lab-w-'+k).value=config.weights[k]);
    }
    function read(){
      try{config=E.normalize({version:E.VERSION,scheme:$('lab-scheme').value,
        ingredient:$('lab-ingredient').value,ownPreference:$('lab-own').value,process:$('lab-process').value,
        budget:$('lab-budget').value===''?null:Number($('lab-budget').value),
        weights:Object.fromEntries(E.dimensions.map(([k])=>[k,$('lab-w-'+k).value===''?NaN:Number($('lab-w-'+k).value)]))});error='';}
      catch(e){error=e.message;}
      render();
    }
    function evidence(p){
      const raw=p.details||{},ctx=context(p),rows=[
        ['生产记录',[p.productionMode,p.factoryName,raw.factory_import_raw].filter(Boolean).join('；')],
        ['配料与保证值',[raw.ingredients_raw,raw.protein_raw,raw.fat_raw,raw.other_guaranteed_analysis_raw].filter(Boolean).join('；')],
        ['比例与消化率',[['动物原料',raw.animal_ingredient_ratio_raw],['动物来源蛋白',raw.animal_protein_ratio_raw],['全消化道',raw.total_tract_digestibility_raw],['体外胃蛋白酶',raw.pepsin_digestibility_raw]].filter(([,v])=>v!=null&&v!=='').map(([k,v])=>k+'：'+v).join('；')],
        ['研发原文',raw.rd_capability_raw],['研究原文',raw.feeding_study_raw],
        ...ctx.brand.map(f=>[f.fieldLabel,f.valueText+'；出处：'+(f.sourceText||'未列')]),
        ...ctx.factory.flatMap(f=>[
          ['工厂背景',f.factoryName+'；'+(f.background?.value||f.background?.parentGroup||'')+'；'+(f.background?.note||'')],
          ['资质记录（需核有效期与范围）',(f.certifications||[]).join('；')],
          ['工厂来源分级',(f.sources||[]).map(s=>(s.level||'U')+' · '+(s.name||s.note||'')+(s.url?' · '+s.url:'')).join('；')]
        ])];
      return rows.filter(([,v])=>v).map(([l,v])=>`<dt>${esc(l)}</dt><dd>${esc(v)}</dd>`).join('');
    }
    let releaseRender=0; async function render(){
      const ticket=++releaseRender;
      if(document.body.dataset.workspace!=="analysis" || document.body.dataset.analysis!=="score") return;
      $('lab-explanation').textContent=E.schemeDescriptions[config.scheme]+' 当前权重：'+E.dimensions.map(([k,l])=>l+' '+n(config.weights[k]/Object.values(config.weights).reduce((a,b)=>a+b,0)*100)+'%').join(' · ');
      const selectionKey=JSON.stringify([...api.getSelected()].sort());
      if(selectionKey!==lastSelection){
        if(lastSelection!=='' || api.getSelected().size) {scope='selected';page=0;}
        lastSelection=selectionKey;
      }
      $('lab-scope').value=scope;
      $('lab-message').textContent=error||'未自动保存；确认后可保存本机试用记录。';
      if(error){$('lab-results').innerHTML='<p>设置需要调整，已暂停结果计算。</p>';return;}
      const pool=api.getProducts().filter(p=>!root.PFDSCatalogScope.pendingIds.has(p.skuId)&&(scope==='all'||api.getSelected().has(p.skuId)));
      const perPage=compactMedia?.matches?2:6;
      page=Math.max(0,Math.min(page,Math.ceil(pool.length/perPage)-1));
      const rows=pool.slice(page*perPage,page*perPage+perPage);
      $('lab-page').textContent=pool.length?'第 '+(page+1)+' / '+Math.ceil(pool.length/perPage)+' 组 · 共 '+pool.length+' 款':'尚未选择正式产品';
      $('lab-prev').disabled=page===0;$('lab-next').disabled=(page+1)*perPage>=pool.length;
      if(!rows.length){$('lab-results').innerHTML='<p class="empty-state">请在正式产品库选择产品，或切换“全部正式产品”。待补新品暂不纳入试评。</p>';return;}
      try { await Promise.all(rows.map(p=>root.PFDSRelease.detail(p.skuId))); } catch(e) { $("lab-results").textContent=e.message; return; }
      if(ticket!==releaseRender || document.body.dataset.workspace!=="analysis" || document.body.dataset.analysis!=="score") return;
      const results=rows.map(p=>E.score(p,config,judgment(p),stamp(p),api.getRisk(p)));
      const summaries=rows.map(p=>E.evidenceSummary(p,context(p)));
      const tr=(label,cells,cls='')=>`<tr class="${cls}"><th scope="row">${label}</th>${cells.map(c=>'<td>'+c+'</td>').join('')}</tr>`;
      const matrix=`<div class="lab-matrix-wrap" role="region" aria-label="产品权重并列比较" tabindex="0"><table class="lab-matrix"><caption>当前偏好 · ${esc(E.schemes[config.scheme]?.label||'自定义')}（非品质排名）</caption><thead><tr><th scope="col">比较项目</th>${rows.map(p=>`<th scope="col"><button class="text-button" data-lab-detail="${esc(p.skuId)}">${esc(api.label(p))}</button></th>`).join('')}</tr></thead><tbody>
        ${tr('偏好试评分',results.map(s=>s.trial===null?'—':n(s.trial)), 'lab-score-row')}
        ${tr('资料覆盖',results.map(s=>n(s.coverage*100)+'%'))}
        ${tr('可能浮动范围',results.map(s=>s.trialRange?n(s.trialRange[0])+'–'+n(s.trialRange[1]):'—'))}
        ${E.dimensions.map(([key,label])=>tr(esc(label)+'<small>'+n(results[0].dimensions.find(d=>d.key===key).weight*100)+'% 权重</small>',results.map(s=>{const d=s.dimensions.find(d=>d.key===key);return d.weight===0?'不计入':d.points===null?'50*<small>未知暂用</small>':n(d.points)+'<small>'+(['assurance','formula'].includes(key)||key==='ingredients'&&config.ingredient==='manual'?'候选判断':'偏好匹配')+'</small>';}))).join('')}
        ${tr('原料类型',summaries.map(s=>esc(s.ingredient.label)))}
        ${tr('资料收录（非品质分）',summaries.map(s=>esc(s.coverage+'项')+'<small>'+esc(s.missing.length?'未收录：'+s.missing.join('、'):'各项均有记录，非全部核实')+'</small>'))}
        ${tr('适用提示',results.map(s=>esc(s.trialBlock||'仅作偏好试评，未核定安全')), 'lab-note-row')}
      </tbody></table></div><p class="reading-note">50*是未知暂用，不是评为中等；候选50表示部分依据支持。偏好匹配100只代表符合所选条件，不是品质满分。当前为粗粒度试评，覆盖率包含候选判断，不作精细排名。点击产品名看资料。</p>`;
      const factText=fs=>fs.length?fs.map(f=>f.fieldLabel+'：'+f.valueText+'（'+(f.verificationStatus||'状态未注明')+'；来源：'+(f.sourceText||'未列')+'）').join('；'):'尚无可用记录，不代表没有';
      const linked='<details class="tool-disclosure"><summary>品牌、工厂与功能依据 · 并列查看</summary><p class="reading-note">资料用于支持稳妥／配方判断，不按品牌年龄、资质数量或宣传字数自动加分。收录程度不是品牌透明度评分，也不等于产品质量；未收录可能是尚未整理。功能不选需求、不自动加分；研究原文不等于当前SKU功效已证实。事件按时间、地区和批次核对，不按投诉条数扣分。</p><div class="table-wrap"><table class="compare-table"><thead><tr><th>依据</th>'+rows.map(p=>'<th>'+esc(api.label(p))+'</th>').join('')+'</tr></thead><tbody>'+
        tr('品牌历史',summaries.map(s=>esc(factText(s.history))))+
        tr('市场背景（不直接计分）',summaries.map(s=>esc(factText(s.market))))+
        tr('工厂对应',summaries.map((s,i)=>esc(rows[i].factoryName||'未收录')+'<small>'+esc(s.factoryLinked?'已匹配工厂情报；非批次核验':'未明确关联，不借其他厂能力加分')+'</small>'))+
        tr('工厂资质与来源',summaries.map(s=>esc(s.factories.length?s.factories.map(f=>(f.certifications||[]).join('、')+'；成立记录：'+(f.founded?.value||'未列')+'；来源：'+(f.sources||[]).map(x=>'['+(x.level||'U')+'] '+(x.name||x.url||'')).join('；')).join('；'):'未关联')+'<small>需核有效期、范围及当前产品关系；FDA登记不等于产品批准。</small>'))+
        tr('品牌研发背景',summaries.map(s=>esc(factText(s.research))))+
        tr('功能与本款研究原文',summaries.map(s=>esc(s.functionText||'未收录功能')+'<small>'+esc(s.study||'研究未收录；不等于没有研究')+'</small>'))+
        (functionFocus?tr('关注：'+esc(functionFocus),summaries.map(s=>{
          const patterns={'美毛':/美毛|毛发|皮肤/,'肠胃':/肠胃|消化|肠道/,'泌尿':/泌尿/,'控重':/控重|体重|减重/,'毛球':/毛球/,'低敏':/低敏|敏感/,'免疫':/免疫/};
          return patterns[functionFocus].test(s.functionText+' '+s.study)?'有相关文字，请核对上行试验对象与结果；不是功效已证实':'现有文字未匹配；不代表没有该作用';
        })): '')+
        tr('事件与舆情记录',summaries.map(s=>esc(factText(s.events))))+
        tr('原料供应商／溯源',rows.map(p=>esc(p.details?.traceability_raw||'尚未收录；不推定品牌未披露')))+
        '</tbody></table></div></details>';
      $('lab-results').innerHTML=matrix+linked+'<details class="tool-disclosure"><summary>查看各款评分理由、来源与修改判断</summary>'+rows.map(p=>{
        const current=judgment(p),s=E.score(p,config,current,stamp(p),api.getRisk(p)),r=E.reviewValid(current,stamp(p))?current:{};
        const opts=(value,items)=>items.map(([v,l])=>`<option value="${v}" ${String(value??'')===String(v)?'selected':''}>${l}</option>`).join('');
        return `<article class="lab-card" data-lab-id="${esc(p.skuId)}"><div class="panel-heading"><h3>${esc(api.label(p))}</h3><button type="button" class="text-button" data-lab-detail="${esc(p.skuId)}">完整资料</button></div>
          <p class="lab-gate">${esc(s.gateReason||'已记录本次适用性判断；不等于安全认证')}${s.stale?' · 资料已变化，请重新核对':''}</p>
          <p class="lab-result"><strong>${s.trial===null?'不纳入本方案':n(s.trial)+' / 100 偏好试评分'}</strong> · 有依据分项覆盖 ${n(s.coverage*100)}% 权重（含候选判断）</p>
          <p class="reading-note">${s.trial===null?esc(s.trialBlock):'普通未知项暂按50档计入，不代表表现中等。未知项按0–100变化时，试评分范围 '+n(s.trialRange[0])+'–'+n(s.trialRange[1])+'；这是敏感性范围，不是统计置信区间，也未涵盖已录资料可能有误。'}</p>
          ${r.pilot?'<p class="reading-note">资料复核候选 · 依据当前收录原文，未经你的终审；不等于原报告已核验。可展开查看具体理由。</p>':''}
          <div class="lab-dimensions">${s.dimensions.map(d=>`<div><strong>${esc(d.label)}</strong><span>${n(d.weight*100)}%权重 · ${d.weight===0?'不计入':d.points===null?'未知 · 暂按50档':n(d.points)+'档'}</span><small>${esc(d.reason)}</small></div>`).join('')}</div>
          <p class="theme-note">已知分项贡献 ${n(s.contribution)} / 100，尚未判断的权重为 ${n((1-s.coverage)*100)}%；贡献不是总分，也不是产品质量排名。${s.missing.length?' 待判断：'+esc(s.missing.join('、'))+'。':''}</p>
          <details class="tool-disclosure"><summary>这款在三种倾向下有什么变化？</summary><ul>${Object.entries(E.schemes).map(([id,v])=>{const t=E.score(p,{...config,scheme:id,weights:E.weights(id)},current,stamp(p),api.getRisk(p));return `<li>${v.label}：${t.trial===null?'不纳入本方案':n(t.trial)+' / 100 试评分 · 浮动 '+n(t.trialRange[0])+'–'+n(t.trialRange[1])} · 覆盖 ${n(t.coverage*100)}%权重</li>`;}).join('')}</ul><p>相同判断，只改权重；区间重叠不据此硬排名。未核对安全不等于安全，也不等于不安全；试评分只用于偏好探索。</p></details>
          <details class="tool-disclosure"><summary>查看已有依据与本次判断</summary><p>以下是原始资料，不是本次已核结论。“无”或未记录不证明没有研究/事件；品牌历史不等于本款配方使用时间。销量、配方稳定性与适口性缺同口径资料时不自动判分。</p><dl class="lab-evidence">${evidence(p)}</dl>
          <form data-lab-review="${esc(p.skuId)}"><h4>安全与适用性把关（独立于权重）</h4>
          <label>本次状态<select name="gate">${opts(r.gate,[['unreviewed','尚未核对'],['reviewed','已核对，本次未发现需排除因素'],['hold','发现限制 / 暂不纳入']])}</select></label>
          <label>理由及范围<textarea name="gateReason" rows="2" required placeholder="阶段、已知限制、事件涉及时间/地区/产品；不要只写无舆情">${esc(r.gateReason||'')}</textarea></label>
          <label>核对出处<input name="gateSource" required value="${esc(r.gateSource||'')}" placeholder="记录链接或可追溯文件位置"></label>
          ${['assurance','formula',...(config.ingredient==='manual'?['ingredients']:[])].map(k=>`<fieldset><legend>${E.dimensions.find(([key])=>key===k)[1]}</legend>
            <label>候选档位<select name="${k}Points">${opts(r.dimensions?.[k]?.points,[['','未知'],[100,'100 · 本次判据支持充分'],[75,'75 · 较多支持'],[50,'50 · 部分支持'],[25,'25 · 支持有限且有反向依据'],[0,'0 · 有明确相反依据']])}</select></label>
            <label>判断理由<textarea name="${k}Reason" rows="2">${esc(r.dimensions?.[k]?.reason||'')}</textarea></label>
            <label>依据出处<input name="${k}Source" value="${esc(r.dimensions?.[k]?.source||'')}"></label></fieldset>`).join('')}
          <button class="secondary-button" type="submit">应用本次判断（不改底稿）</button><p class="lab-form-message" role="status"></p></form></details></article>`;
      }).join('')+'</details>';
      panel.querySelectorAll('[data-lab-detail]').forEach(b=>b.onclick=()=>api.openDetail(b.dataset.labDetail));
      panel.querySelectorAll('[data-lab-review]').forEach(form=>form.onsubmit=e=>{
        e.preventDefault();if(visitor)return;const p=rows.find(p=>p.skuId===form.dataset.labReview),fd=new FormData(form);
        const record={snapshot:stamp(p),gate:fd.get('gate'),gateReason:fd.get('gateReason').trim(),gateSource:fd.get('gateSource').trim(),dimensions:{},updatedAt:new Date().toISOString()};
        for(const k of ['assurance','formula',...(config.ingredient==='manual'?['ingredients']:[])]){
          const val=fd.get(k+'Points'),reason=fd.get(k+'Reason').trim(),source=fd.get(k+'Source').trim();
          if(val!==''&&(!reason||!source)){form.querySelector('.lab-form-message').textContent='有分项档位时必须同时填写理由和出处。';return;}
          record.dimensions[k]={points:val===''?null:Number(val),reason,source};
        }
        records[p.skuId]=record;render();
      });
    }
    $('lab-scheme').onchange=()=>{const id=$('lab-scheme').value;if(id!=='custom'){config={...config,scheme:id,weights:E.weights(id)};sync();}read();};
    $('lab-function').onchange=()=>{functionFocus=$('lab-function').value;render();};
    ['ingredient','own','process','budget'].forEach(k=>$('lab-'+k).onchange=read);
    E.dimensions.forEach(([k])=>$('lab-w-'+k).onchange=()=>{$('lab-scheme').value='custom';read();});
    $('lab-save').onclick=()=>{if(error||visitor)return;try{localStorage.setItem(KEY,JSON.stringify({config,records}));$('lab-message').textContent='已保存当前浏览器；产品底稿未改变。';}catch(e){$('lab-message').textContent='未能保存，请检查浏览器存储；本页草稿仍保留。';}};
    $('lab-scope').onchange=()=>{scope=$('lab-scope').value;page=0;render();};
    $('lab-prev').onclick=()=>{page--;render();};
    $('lab-next').onclick=()=>{page++;render();};
    compactMedia?.addEventListener('change',()=>{page=0;render();});
    sync();return {render,showSelected(){scope='selected';page=0;render();}};
  };
})(typeof globalThis!=='undefined'?globalThis:this);

;
/* 公开版「意见反馈」模块（D106）
 *
 * 边界（刻意不做的事）：
 * - 不让访客直接改底稿。反馈只是「进入待处理区」，是否采纳、怎么改由维护者决定。
 * - 不提交到公开 GitHub Issues。那会要求登录并把内容公开。
 * - 不暴露接收邮箱。access_key 只是邮箱的别名，页面与代码里都不写邮箱。
 * - 未知值不按 0 处理这条口径同样适用于反馈：提交失败要如实报错，不假装成功。
 *
 * 接收通道：Web3Forms（静态站直连、无需后端）。免费档 250 次/月。
 * 邮件含完整提交内容；提交记录在第三方保留，可在后台查看与导出。
 */
(function () {
  'use strict';

  var ENDPOINT = 'http公开资料记录';

  /* 占位符：Charles 需要去 app.web3forms.com 用接收邮箱申请一个 key 贴进来。
   * 未替换时模块会降级 —— 按钮可点但明确提示「尚未启用」，不会静默吞掉提交。 */
  var ACCESS_KEY = 'REPLACE_WITH_WEB3FORMS_ACCESS_KEY';
  var PLACEHOLDER = 'REPLACE_WITH_WEB3FORMS_ACCESS_KEY';

  var CATEGORIES = [
    { value: '数据纠错', label: '数据纠错（某款产品的信息有误）' },
    { value: '操作问题', label: '操作问题（页面用不顺/功能失效）' },
    { value: '功能建议', label: '功能建议（希望增加什么）' },
    { value: '其他', label: '其他' }
  ];

  var configured = ACCESS_KEY !== PLACEHOLDER && ACCESS_KEY.length > 0;

  /* ---------- DOM 适配层 ----------
   * 为什么要这一层：详情弹层的实现换过一版。
   *   v0.2 公开版：原生 <dialog id="detail"> + #detailBody，用 dialog.open 判开合
   *   v0.7 内部版：<div class="overlay" id="detail-overlay" hidden> + #detail-content，
   *                判开合要看 hidden 属性
   * 直接写死任一版本，重传内部版时这五个锚点会全部失效，而且**不报错**：
   * 表单照常能开能提交，只是产品上下文悄悄丢了 —— 访客以为功能正常。
   * 所以这里把「找节点 / 判开合 / 取产品名 / 找选择框」全部收敛成一层适配，
   * 两版共用同一份 feedback.js，公开版重传时不需要再嫁接。
   *
   * 边界：适配层只处理「两版都存在的语义」，用探测顺序兜住差异，不新增功能。
   * 取不到就返回空（降级），绝不用假数据填。 */
  var DOM_ADAPTER = (function buildDomAdapter() {
    /* 详情内容容器：两版 id 不同，顺序即优先级。 */
    var DETAIL_BODY_SELECTORS = ['#detailBody', '#detail-content'];

    /* 详情「打开着」的判定：原生 dialog 用 .open，overlay 用 hidden 属性。
     * 两版结构差异太大，不做单一选择器 —— 分别探测，谁存在用谁。 */
    function detailContainer() {
      for (var i = 0; i < DETAIL_BODY_SELECTORS.length; i++) {
        var node = document.querySelector(DETAIL_BODY_SELECTORS[i]);
        if (node) return node;
      }
      return null;
    }

    function detailIsOpen() {
      var dlg = document.getElementById('detail');
      if (dlg && typeof dlg.open === 'boolean') return dlg.open;
      var overlay = document.getElementById('detail-overlay');
      if (overlay) return !overlay.hasAttribute('hidden');
      /* 两版结构都认不出来时，不谎称「开着」，交给上层降级。 */
      return false;
    }

    /* 产品名：v0.2 是 <h2 class="detail-title">；v0.7 的 .detail-title 内含
     * <p>品牌·系列</p><h2 id="detail-title">产品名</h2><p>规格…</p>。
     * 所以优先取 h2（两版都能命中），没有再退回整块文本。 */
    function detailProductName(body) {
      if (!body) return '';
      var heading = body.querySelector('#detail-title, .detail-title h2');
      if (heading && heading.textContent.trim()) return heading.textContent.trim();
      var title = body.querySelector('.detail-title');
      return title ? title.textContent.trim() : '';
    }

    /* 产品副标题（品牌·系列·口味）。v0.7 的品牌在 .detail-title 内的首个 <p>，
     * 规格在末个 <p>，两段都要，才够还原「哪一款」。 */
    function detailSubText(body) {
      if (!body) return '';
      var muted = body.querySelector('.muted');
      if (muted && muted.textContent.trim()) return muted.textContent.trim();
      var paras = body.querySelectorAll('.detail-title p');
      var parts = [];
      for (var i = 0; i < paras.length; i++) {
        var t = paras[i].textContent.trim();
        if (t) parts.push(t);
      }
      return parts.join(' · ');
    }

    /* 已勾选的产品：v0.2 是 input.select-product，v0.7 是 input.compare-check。
     * 用属性选择器（input[type=checkbox][data-index], input[type=checkbox][data-sku]）
     * 不够稳 —— 内部版还有 .core-check 同样是 checkbox。所以只认「参与比较选择」
     * 的那一个 class，两个版本各一个候选。 */
    var SELECT_CHECKBOX_SELECTORS = [
      'input.select-product:checked',
      'input.compare-check:checked'
    ];

    function firstCheckedCheckbox() {
      for (var i = 0; i < SELECT_CHECKBOX_SELECTORS.length; i++) {
        var box = document.querySelector(SELECT_CHECKBOX_SELECTORS[i]);
        if (box) return box;
      }
      return null;
    }

    /* 从勾选行取品牌/产品。
     * v0.2：td[1]=品牌、td[2] 的 <strong>=产品
     * v0.7：td[2]=品牌(.brand-cell)、td[3] 的 <strong>=产品（多一列 core-check）
     * 列位置会漂，所以不写死索引 —— 优先找带语义 class 的单元格。 */
    function productFromRow(row) {
      if (!row) return null;
      var brandCell = row.querySelector('.brand-cell');
      var productCell = row.querySelector('.product-cell');
      var brand = brandCell ? brandCell.textContent.trim() : '';
      var product = '';
      var strong = (productCell || row).querySelector('strong');
      if (strong) product = strong.textContent.trim();
      if (!brand || !product) {
        /* 语义 class 认不到（结构又变了）才退回按列位推断，
         * 且只取有内容的列，不硬编码具体下标。 */
        var cells = row.querySelectorAll('td');
        for (var i = 0; i < cells.length; i++) {
          var text = cells[i].textContent.trim();
          var cellStrong = cells[i].querySelector('strong');
          if (cellStrong && !product) {
            product = cellStrong.textContent.trim();
            var prev = i > 0 ? cells[i - 1].textContent.trim() : '';
            if (prev && !brand) brand = prev;
          } else if (text && !brand && !cellStrong) {
            brand = brand || text;
          }
        }
      }
      if (!brand && !product) return null;
      return { brand: brand, series: '', product: product, flavor: '' };
    }

    /* 顶栏入口挂载点：v0.2 紧挨「只读体验」徽章，v0.7 没有徽章，挂在 .topbar-meta 旁。
     * 两者都拿不到就退回 .topbar 末尾 —— 位置不理想但功能可用，不静默消失。 */
    function triggerAnchor() {
      var badge = document.querySelector('.readonly-badge');
      if (badge) return { parent: badge.parentNode, before: badge };
      var meta = document.querySelector('.topbar-meta');
      if (meta && meta.parentNode) return { parent: meta.parentNode, before: meta.nextSibling };
      var bar = document.querySelector('.topbar');
      if (bar) return { parent: bar, before: null };
      return null;
    }

    return {
      detailContainer: detailContainer,
      detailIsOpen: detailIsOpen,
      detailProductName: detailProductName,
      detailSubText: detailSubText,
      productFromSelection: function () {
        var row = firstCheckedCheckbox();
        if (!row || !row.closest) return null;
        return productFromRow(row.closest('tr'));
      },
      triggerAnchor: triggerAnchor
    };
  })();

  /* ---------- 上下文捕捉：访客正在看/选的产品，自动带入反馈 ----------
   * 目的：反馈某款产品时不必手打名字。取不到就留空，不报错。 */
  var contextProduct = null;

  function describeProduct(p) {
    if (!p) return '';
    return [p.brand, p.series, p.product, p.flavor]
      .filter(Boolean)
      .map(function (x) { return String(x).trim(); })
      .filter(Boolean)
      .join(' · ');
  }

  /* 从详情弹层反查当前打开的产品。只读 DOM，不侵入 app.js。 */
  function productFromOpenDialog() {
    if (!DOM_ADAPTER.detailIsOpen()) return null;
    var body = DOM_ADAPTER.detailContainer();
    var name = DOM_ADAPTER.detailProductName(body);
    var sub = DOM_ADAPTER.detailSubText(body);
    if (!name && !sub) return null;
    return { brand: '', series: '', product: name, flavor: '', __sub: sub };
  }

  function productFromSelection() {
    return DOM_ADAPTER.productFromSelection();
  }

  /* 产品上下文：打开中的详情弹层 → 显式传入 → 已勾选产品。按可信度排序。 */
  /* 产品上下文取值，按「准确度」排序。
   * 关键：productFromOpenDialog() 只从 DOM 反查，拿到的常常只有标题残片，
   *   describeProduct 拼不出完整串时会返回空 —— 不能让它把更准的
   *   contextProduct（由详情入口显式传入）挡在后面。所以逐个尝试、谁先拼出
   *   非空文本就用谁。 */
  function currentContextLabel() {
    var candidates = [contextProduct, productFromOpenDialog(), productFromSelection()];
    for (var i = 0; i < candidates.length; i++) {
      var p = candidates[i];
      if (!p) continue;
      var text = describeProduct(p);
      if (!text && p.__sub) text = String(p.__sub).trim();
      if (text) return text;
    }
    return '';
  }

  /* ---------- 装配 UI ---------- */
  function buildDialog() {
    var dlg = document.createElement('dialog');
    dlg.id = 'feedbackDialog';
    dlg.className = 'fb-dialog';
    dlg.setAttribute('aria-label', '意见反馈');

    var opts = CATEGORIES.map(function (c) {
      return '<option value="' + c.value + '">' + c.label + '</option>';
    }).join('');

    dlg.innerHTML = [
      '<form method="dialog" id="feedbackForm" novalidate>',
      '  <div class="fb-head">',
      '    <div><h2>意见反馈</h2><p>可反馈数据问题、操作问题或建议；反馈不会直接修改产品资料。</p></div>',
      '    <button type="button" class="fb-close" id="fbClose" aria-label="关闭">×</button>',
      '  </div>',
      '  <div class="fb-body">',
      '    <div class="fb-context" id="fbContext" hidden></div>',
      '    <label class="fb-field"><span>反馈类型 <b class="fb-req">*</b></span>',
      '      <select id="fbCategory" required>' + opts + '</select></label>',
      '    <label class="fb-field"><span>具体说明 <b class="fb-req">*</b></span>',
      '      <textarea id="fbMessage" required maxlength="2000" placeholder="请写清是哪款产品、哪个字段、你认为正确值是什么。"></textarea>',
      '      <p class="fb-hint">写清「产品名 + 字段 + 正确值」处理最快。最多 2000 字。</p></label>',
      '    <label class="fb-field"><span>联系邮箱（选填）</span>',
      '      <input type="email" id="fbEmail" autocomplete="email" placeholder="不填也可以提交">',
      '      <p class="fb-hint">填了才能回你；不填视为匿名，不会公开。</p></label>',
      '    <input type="checkbox" name="botcheck" class="fb-hp" tabindex="-1" autocomplete="off">',
      '    <div class="fb-actions">',
      '      <button type="submit" class="fb-submit" id="fbSubmit">提交反馈</button>',
      '      <span class="fb-hint" id="fbCounter">0 / 2000</span>',
      '    </div>',
      '    <p class="fb-status" id="fbStatus" role="status" aria-live="polite"></p>',
      configured ? '    <p class="fb-footnote">提交后由第三方服务转发至维护者邮箱。</p>' : '',
      '  </div>',
      '</form>'
    ].join('');

    document.body.appendChild(dlg);
    return dlg;
  }

  function setStatus(node, kind, text) {
    node.className = 'fb-status' + (kind ? ' is-' + kind : '');
    node.textContent = text || '';
  }

  /* 产品上下文渲染。正常路径与降级路径共用，避免两处逻辑分叉。 */
  function renderContext() {
    var ctx = document.getElementById('fbContext');
    var label = currentContextLabel();
    if (label) {
      ctx.hidden = false;
      ctx.innerHTML = '将反馈以下产品：<strong>' + escapeHtml(label) + '</strong>' +
        '<button type="button" id="fbClearCtx">清除</button>';
      document.getElementById('fbClearCtx').onclick = function () {
        ctx.hidden = true;
        ctx.textContent = '';
      };
    } else {
      ctx.hidden = true;
      ctx.textContent = '';
    }
  }

  function openDialog() {
    var isNew = !document.getElementById('feedbackDialog');
    var dlg = isNew ? buildDialog() : document.getElementById('feedbackDialog');
    if (isNew) wireForm();
    renderContext();
    setStatus(document.getElementById('fbStatus'), '', '');
    document.getElementById('fbCounter').textContent =
      document.getElementById('fbMessage').value.length + ' / 2000';
    dlg.showModal();
    document.getElementById('fbMessage').focus();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function mountTrigger() {
    var anchor = DOM_ADAPTER.triggerAnchor();
    if (!anchor) return;
    var wrap = document.createElement('div');
    wrap.className = 'fb-topbar-actions';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'feedbackTrigger';
    btn.className = 'fb-trigger';
    btn.textContent = configured ? '意见反馈' : '反馈（未启用）';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.onclick = function () {
      if (configured) openDialog();
      else openDialogWithDisabledNotice();
    };

    wrap.appendChild(btn);
    if (anchor.before) anchor.parent.insertBefore(wrap, anchor.before);
    else anchor.parent.appendChild(wrap);
  }

  /* 降级路径：key 未配置时，弹窗仍可打开，但明说「尚未启用」并禁用提交，
   * 不让访客写完一整段反馈才发现发不出去。
   * 注意：降级只影响「能不能发出去」，不影响「在看哪款产品」—— 产品上下文
   * 必须照常展示，否则访客已经写好的信息在界面上凭空消失。 */
  function openDialogWithDisabledNotice() {
    var isNew = !document.getElementById('feedbackDialog');
    var dlg = isNew ? buildDialog() : document.getElementById('feedbackDialog');
    if (isNew) wireForm();
    renderContext();
    setStatus(
      document.getElementById('fbStatus'),
      'warn',
      '在线反馈尚未启用，本窗口不会发送信息。内部使用时，请将产品名和问题直接告诉维护者。'
    );
    var submit = document.getElementById('fbSubmit');
    submit.disabled = true;
    submit.textContent = '暂不可提交';
    dlg.showModal();
  }

  function wireForm() {
    var form = document.getElementById('feedbackForm');
    if (!form || form.dataset.wired === '1') return;
    form.dataset.wired = '1';
    var msg = document.getElementById('fbMessage');
    var counter = document.getElementById('fbCounter');
    var status = document.getElementById('fbStatus');
    var submit = document.getElementById('fbSubmit');

    msg.addEventListener('input', function () {
      counter.textContent = msg.value.length + ' / 2000';
    });

    document.getElementById('fbClose').onclick = function () {
      document.getElementById('feedbackDialog').close();
    };

    /* 原生 POST 作为无 JS 兜底：正常走 fetch（不跳页），fetch 不可用时表单仍能提交。 */
    form.addEventListener('submit', function (ev) {
      if (!configured) {
        ev.preventDefault();
        return;
      }
      if (typeof window.fetch !== 'function' || typeof window.FormData !== 'function') return; // 退回原生提交

      ev.preventDefault();
      if (!msg.value.trim()) {
        setStatus(status, 'error', '请先填写具体说明。');
        msg.focus();
        return;
      }
      if (submit.disabled) return;

      submit.disabled = true;
      submit.textContent = '提交中…';
      setStatus(status, '', '正在提交…');

      var category = document.getElementById('fbCategory').value;
      var email = document.getElementById('fbEmail').value.trim();
      var ctx = currentContextLabel();

      var body = new FormData();
      body.append('access_key', ACCESS_KEY);
      body.append('subject', '[' + category + '] 公开体验版用户反馈');
      body.append('from_name', 'Pet Food Data Studio 体验版访客');
      body.append('message',
        '【反馈类型】' + category + '\n' +
        (ctx ? '【相关产品】' + ctx + '\n' : '') +
        '【具体说明】\n' + msg.value.trim() +
        (email ? '\n\n【回信邮箱】' + email : '\n\n【回信邮箱】未留（匿名提交）'));
      if (email) body.append('replyto', email);
      body.append('botcheck', '');

      fetch(ENDPOINT, { method: 'POST', body: body, headers: { Accept: 'application/json' } })
        .then(function (res) {
          return res.json().then(function (data) { return { ok: res.ok, data: data }; });
        })
        .then(function (r) {
          if (r.ok && r.data && r.data.success) {
            setStatus(status, 'ok', '已收到，谢谢你。反馈已进入待处理清单。');
            msg.value = '';
            counter.textContent = '0 / 2000';
            document.getElementById('fbEmail').value = '';
            submit.textContent = '已提交';
            setTimeout(function () {
              document.getElementById('feedbackDialog').close();
              submit.disabled = false;
              submit.textContent = '提交反馈';
            }, 1400);
          } else {
            var reason = (r.data && r.data.message) || ('HTTP ' + (r.ok ? '?' : '异常'));
            setStatus(status, 'error',
              '提交没成功（' + reason + '）。你写的内容还在，' +
              '可以直接复制后发邮件给维护者，谢谢。');
            submit.disabled = false;
            submit.textContent = '重新提交';
          }
        })
        .catch(function () {
          setStatus(status, 'error',
            '网络原因提交失败。你写的内容还在，' +
            '可以直接复制后发邮件给维护者，谢谢。');
          submit.disabled = false;
          submit.textContent = '重新提交';
        });
    });
  }

  /* ---------- 详情弹窗内的反馈入口 ----------
   * 为什么必须在弹窗内另给一个：详情打开时遮罩/遮罩层会盖住整页，顶栏按钮点不到。
   * 而「正在看某款产品时提反馈」恰恰是最常见的场景 —— 访客的眼睛就在这款产品上。
   * 不改 z-index 去抢层级，而是就地给入口，顺带保证产品上下文 100% 准确。
   *
   * 用 MutationObserver 观察详情内容容器，不侵入 app.js。 */
  function injectDetailEntry() {
    var body = DOM_ADAPTER.detailContainer();
    if (!body) return;
    if (document.getElementById('fbDetailEntry')) return;

    var wrap = document.createElement('div');
    wrap.className = 'fb-detail-entry';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'fbDetailEntry';
    btn.className = 'fb-detail-btn';
    btn.textContent = configured ? '对这款产品提反馈' : '产品反馈（未启用）';
    btn.onclick = function () {
      /* 两版详情结构不同：
       *   v0.2：.detail-title = <h2>产品名</h2>，.muted = 品牌·系列·口味
       *   v0.7：.detail-title = <p>品牌·系列</p><h2 id="detail-title">产品名</h2><p>规格…</p>
       * 内容有重叠（品牌名会同时出现），直接拼接会重复。
       * 这里按语义拆成有序小段（品牌/系列/口味/产品名/规格）再去重，
       * 只去完全相同的整段，不做模糊截断，避免误删真信息。 */
      var title = DOM_ADAPTER.detailProductName(body);
      var sub = DOM_ADAPTER.detailSubText(body);
      var raw = [sub, title].filter(Boolean);
      var segments = [];
      raw.forEach(function (chunk) {
        chunk.split(/[|·]/).forEach(function (s) {
          var t = s.trim();
          if (t) segments.push(t);
        });
      });
      var seen = {};
      var label = segments.filter(function (seg) {
        if (seen[seg]) return false;
        seen[seg] = 1;
        return true;
      }).join(' · ');
      window.openFeedback(label);
    };

    wrap.appendChild(btn);
    wrap.appendChild(hintNode(configured ? '提交反馈不会直接改动产品资料。' : '在线接收尚未启用；可将产品名和问题直接告诉维护者。'));
    body.appendChild(wrap);
  }

  function hintNode(text) {
    var p = document.createElement('p');
    p.className = 'fb-hint';
    p.textContent = text;
    return p;
  }

  /* 详情容器在两版里都是 index.html 的静态节点，init 时通常已存在。
   * 但若将来某版改成动态生成，init 时找不到就会永远观察不到 —— 这里做一次兜底：
   * 没找到就监听 body，容器出现后再挂观察者。只挂一次，不重复注册。 */
  function watchDetail() {
    if (typeof MutationObserver !== 'function') return;
    var body = DOM_ADAPTER.detailContainer();
    if (body) {
      new MutationObserver(injectDetailEntry).observe(body, { childList: true });
      return;
    }
    if (watchDetail.pending) return;
    watchDetail.pending = true;
    new MutationObserver(function () {
      var found = DOM_ADAPTER.detailContainer();
      if (!found) return;
      watchDetail.pending = false;
      observer.disconnect();
      new MutationObserver(injectDetailEntry).observe(found, { childList: true });
    }).observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    mountTrigger();
    watchDetail();
    /* 提供一个显式入口，供详情等场景带产品名调用；不侵入 app.js。 */
    window.openFeedback = function (productText) {
      contextProduct = productText ? { product: productText } : null;
      if (configured) openDialog(); else openDialogWithDisabledNotice();
    };

    /* 适配层自检：如果连详情容器和顶栏都认不到，说明这一版的 DOM 变了，
     * 产品上下文必然丢失。这里把结果挂到 window.feedbackAdapterCheck，
     * 让验收脚本和浏览器控制台能主动查出来 —— 不要等到访客反馈里
     * 才发现「提交是成功了，就是不知道他说的是哪款」。
     * 注意：这只是可观测性，不改变任何行为，也不会自动修。
     *
     * 关键：值必须是**惰性 getter**，不能在 init 时就把结果算死。
     * init() 跑在 DOMContentLoaded，而 app.js 的 render() 在之后才把表格
     * 渲染出来 —— 若在 init 那一刻统计勾选框，必定得到 0，会让人误判「适配失败」。
     * 内部版实测踩过这个坑（selectionCheckboxes 恒为 0）。 */
    window.feedbackAdapterCheck = {
      detailContainer: function () { return !!DOM_ADAPTER.detailContainer(); },
      triggerMounted: function () { return !!document.getElementById('feedbackTrigger'); },
      selectionCheckboxes: function () {
        return document.querySelectorAll('input.select-product, input.compare-check').length;
      },
      detailEntryInjected: function () { return !!document.getElementById('fbDetailEntry'); }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

;
globalThis.PFDSCatalogScope={pendingIds:new Set(),select:(rows,pending=false)=>pending?[]:rows};
;
 (async () => {
  // $ 必须最先定义（D091 修复）：D090 曾在第 29 行调用 $，而 $ 到第 68 行才 const 声明，
  // 触发 TDZ ReferenceError「Cannot access '$' before initialization」，整个初始化链路中断——
  // 表现为编辑入口状态永久停在“正在连接编辑入口…”、分析图表空白。前置定义以消除同类隐患。
  const $ = (id) => document.getElementById(id);
  // Visitor preview shares the current UI; this flag is NOT a data-security boundary.
  const visitorMode = true;
  document.body.dataset.audience = visitorMode ? 'visitor' : 'internal';
  $('mode-title').textContent = '正在读取产品资料…';
  let data = window.PET_FOOD_DATA;
  let editorEnabled = false;
  let editorVersionMismatch = false;
  let calibrationSourceStates = {};
  // D096：从产品库跳去情报（点品牌/工厂单元格）前记住视图位置，返回时恢复，
  // 避免"临时看一眼再回来却要从头翻"。声明前置，杜绝 D091 那类 TDZ 隐患。
  let libraryViewMemory = null;
  const localEditorOrigin = location.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(location.hostname);
  try {
    if (!localEditorOrigin || visitorMode) throw new Error('只读页面');
    const response = await fetch('/api/data', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
      data = await response.json();
      const healthResponse = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      const health = healthResponse.ok ? await healthResponse.json() : {};
      editorEnabled = health.editing === true && health.version === '0.7.0' && health.intake === true && health.nameCorrection === true && health.functionField === true && health.sourceMaintenance === true;
      editorVersionMismatch = !editorEnabled;
      if (health.calibrationSources === true) {
        try {
          const calibrationResponse = await fetch('/api/calibration-status', {cache:'no-store',signal:AbortSignal.timeout(5000)});
          if (calibrationResponse.ok) calibrationSourceStates = await calibrationResponse.json();
        } catch { /* Original-image assistance stays unavailable, not falsely verified. */ }
      }
    }
  } catch { /* A plain static-server view remains read-only. */ }
  if (!data) {
    document.body.innerHTML = '<p style="padding:2rem">数据文件未生成。请先运行导入脚本。</p>';
    return;
  }
  // The toolbar is created by mount() below; delegate from its stable host.
  $('workspace-intel').addEventListener('click', (event) => {
    if (!event.target.closest('#intel-back-library')) return;
    setWorkspace('library');
    restoreLibraryView();
  });

  const pendingCatalog = !visitorMode && new URLSearchParams(location.search).get('catalog') === 'pending';
  // Recover a failed catalog dependency once, rather than rendering an empty dashboard.
  if (!window.PFDSCatalogScope) await new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='catalog-scope.js?v=internal-v0.6.37';
    script.onload=()=>window.PFDSCatalogScope ? resolve() : reject(new Error('产品范围模块未加载'));
    script.onerror=()=>reject(new Error('产品范围模块未加载，请刷新'));
    document.head.append(script);
  });
  document.body.dataset.pendingCatalog = String(pendingCatalog);
  const catalogProducts = () => window.PFDSCatalogScope.select(data.products, pendingCatalog);
  let products = catalogProducts();
  if (visitorMode) data = {...data,products};
  if (window.PetFoodBrandIntel) window.PetFoodBrandIntel.mount(data, window.PET_FOOD_FACTORY_DATA, window.PET_FOOD_BRAND_PROFILE_DATA);
  const pendingLink = $('pending-products-link');
  pendingLink.href = pendingCatalog ? '?catalog=active' : '?catalog=pending';
  pendingLink.textContent = pendingCatalog ? '返回正式产品库' : '待补新品（' + window.PFDSCatalogScope.select(data.products,true).length + '）';
  // D089：品牌/工厂短口径注入（只读内存层；不写回 dashboard.json/Excel/db）。
  const factoryIntel = window.PetFoodFactoryIntel;
  const factoryData = window.PET_FOOD_FACTORY_DATA || { factories: [] };
  let factoryAssoc = factoryIntel ? factoryIntel.association(data, factoryData) : { byFactoryName: new Map(), byBrandId: new Map(), profiles: [] };
  function enrichProducts(list) {
    const foundedByBrand = new Map();
    for (const f of data.brandFacts || []) {
      if ((f.fieldLabel || '').includes('品牌成立时间') && !foundedByBrand.has(f.brandId)) foundedByBrand.set(f.brandId, f.valueText || '');
    }
    for (const p of list) {
      const founded = foundedByBrand.get(p.brandId) || '';
      p.brandFounded = founded || null;
      p.brandFoundedShort = factoryIntel ? factoryIntel.shortFounded(founded) : '';
      const fp = factoryAssoc.byFactoryName.get(factoryIntel ? factoryIntel.normalizeName(p.factoryName) : String(p.factoryName || ''));
      p.factoryProfileId = fp ? fp.factoryId : null;
      p.factoryFounded = fp ? (fp.founded?.value || null) : null;
      p.factoryFoundedShort = fp && factoryIntel ? factoryIntel.shortFounded(fp.founded?.value) : '';
      p.factoryScale = fp ? (fp.scale?.capacity || null) : null;
      p.factoryScaleShort = fp && factoryIntel ? factoryIntel.shortScale(fp.scale?.capacity) : '';
      p.factoryType = fp ? fp.type : null;
    }
  }
  const rebindAssoc = () => {
    products = catalogProducts();
    factoryAssoc = factoryIntel ? factoryIntel.association(data, factoryData) : { byFactoryName: new Map() };
    enrichProducts(products);
    fillIntelTextOptions();
  };
  enrichProducts(products);
  if (data.meta?.generatedAt) { const at = $('footer-generated-at'); if (at) at.textContent = data.meta.generatedAt; }
  let verificationTasks = [];
  let verificationPage = 1;
  const selected = new Set();
  let pageSize = 15;
  let currentPage = 1;
  let visibleSkus = [];
  let coreSavePending = false;
  // One shared query and selection, separate task surfaces. Move existing nodes
  // instead of duplicating forms/state or adding a second product data source.
  const workspaces = window.PetFoodWorkspaces;
  const workState = workspaces.state();
  const filters = document.querySelector('.filters');
  const commonFields = document.createElement('div'); commonFields.className = 'common-fields';
  filters.querySelector('.filter-heading').after(commonFields);
  for (const id of ['search','brand-filter','import-filter','function-filter']) commonFields.append($(id).closest('label'));
  commonFields.insertBefore(filters.querySelector('.filter-grid:not(.production-filters)'), $('import-filter').closest('label'));
  $('more-filters').append(filters.querySelector('.production-filters'));
  $('brand-filter').closest('label').after(filters.querySelector('.core-quick'));
  commonFields.append(filters.querySelector('.function-note'));
  $('more-filters').append(...filters.querySelectorAll(':scope > fieldset'), filters.querySelector('.filter-help'));
  filters.append(document.querySelector('.saved-views'));
  $('workspace-library').append(document.querySelector('.products-panel'));
  $('library-chart').append($('chart-panel'));
  $('analysis-scoring').append($('scoring-panel')); $('scoring-disclosure').open = false;
  $('management-brand').append($('brand-panel'));
  $('management-verification').append($('verification-panel'));
  $('management-tools').append($('batch-core'), $('open-maintenance'), $('jump-verification'), $('edit-guide'));
  // Reuse the selection toolbar across tasks, so chosen products stay visible.
  const selectionBar = document.querySelector('.selection-toolbar');
  document.querySelector('.workspace-nav').after(selectionBar);
  selectionBar.append($('open-compare'));
  $('management-tools').append($('select-page'));
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const shown = (value, suffix = '') => value === null || value === undefined || value === '' ? '待核验' : `${value}${suffix}`;
  const previewValue = value => value === null || value === undefined || value === '' ? '空白' : String(value);
  const numberShown = (value, suffix = '') => value === null || value === undefined || value === ''
    ? '待核验'
    : `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(value))}${suffix}`;
  const readableProductName = p => PFDSCleaning.productName(p.product, p.brand);
  // Mobile is a presentation of the same query, page and selected IDs, not a second catalogue.
  const mobileMedia = window.matchMedia('(max-width: 620px)');
  const filterClose = document.createElement('button');
  filterClose.type='button'; filterClose.id='mobile-filter-close'; filterClose.className='primary-button';
  filterClose.textContent='查看筛选结果'; filters.append(filterClose);
  function closeMobileFilters() {
    document.body.classList.remove('mobile-filters-open');
    $('mobile-filters').setAttribute('aria-expanded','false');
    if(mobileMedia.matches) $('mobile-filters').focus();
  }
  $('mobile-filters').addEventListener('click',()=>{
    document.body.classList.add('mobile-filters-open');
    $('mobile-filters').setAttribute('aria-expanded','true');
    $('search').focus();
  });
  filterClose.addEventListener('click',closeMobileFilters);
  filters.addEventListener('keydown',event=>{
    if(!mobileMedia.matches || !document.body.classList.contains('mobile-filters-open'))return;
    if(event.key==='Escape'){event.preventDefault();closeMobileFilters();}
    if(event.key==='Tab'){
      const available=[...filters.querySelectorAll('button,input,select,summary,a[href]')].filter(el=>!el.disabled&&el.getClientRects().length);
      const first=available[0],last=available.at(-1);
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  mobileMedia.addEventListener('change',()=>{document.body.classList.remove('mobile-filters-open');$('mobile-filters').setAttribute('aria-expanded','false');});
  $('mobile-chart').addEventListener('click',()=>{
    const active=document.body.classList.toggle('mobile-show-chart');
    $('mobile-chart').setAttribute('aria-pressed',String(active));
    $('mobile-chart').textContent=active?'收起图表':'看图表';
    if(active)renderScatter(filteredProducts());
  });
  $('mobile-table').addEventListener('click',()=>{
    const active=document.body.classList.toggle('mobile-show-table');
    $('mobile-table').setAttribute('aria-pressed',String(active));
    $('mobile-table').textContent=active?'产品卡片':'完整表格';
  });
  $('mobile-search').addEventListener('input',()=>{$('search').value=$('mobile-search').value;$('search').dispatchEvent(new Event('input',{bubbles:true}));});
  function productMetaParts(p) {
    const product = readableProductName(p);
    const normalize = value => String(value || '').replace(/[^\p{L}\p{N}\u4e00-\u9fff]/gu, '').toLocaleLowerCase('zh-CN');
    const productKey = normalize(product);
    const bilingualAliases = [['classic', '经典'], ['barf', '霸弗'], ['airdried', '风干'], ['steamdried', '微蒸风干'], ['orijen', '渴望'], ['nutram', '纽顿'], ['toptrees', '领先']];
    const brandKeys = String(p.brand || '').split(/[|｜/;；,&+\s]+/u).map(normalize).filter(key => key.length >= 2);
    const isRedundant = value => {
      const raw = String(value || '').trim();
      const primary = raw.split(/[（(]/u, 1)[0].trim();
      const key = normalize(primary);
      if (!raw || key.length < 2) return false;
      if (productKey.includes(key)) return true;
      if (bilingualAliases.some(([english, chinese]) => (key.includes(english) && productKey.includes(normalize(chinese))) || (key.includes(normalize(chinese)) && productKey.includes(english)))) return true;
      return (key.match(/[\u4e00-\u9fff]{2,}/g) || [])
        .map(run => run.replace(/(?:猫粮|主食|配方|系列)$/u, ''))
        .filter(run => run.length >= 2)
        .some(run => productKey.includes(run) || (run.length >= 4 && Array.from({length: run.length - 3}, (_, index) => run.slice(index, index + 4)).some(part => productKey.includes(part))));
    };
    const cleanValue = value => {
      const raw = String(value || '').trim();
      let primary = raw.split(/[（(]/u, 1)[0].trim();
      if (value === p.packageSize) return isRedundant(primary) ? '' : PFDSCleaning.brief(raw);
      for (const brandKey of brandKeys) {
        const brandPattern = String(p.brand || '').split(/[|｜/;；,&+\s]+/u).find(label => normalize(label) === brandKey);
        if (brandPattern) primary = primary.replace(new RegExp(`^${brandPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s®™]*`, 'iu'), '').trim();
      }
      const fragments = primary.split(/[|｜/;；,&+\s]+/u).filter(Boolean);
      const dedupeFragment = fragment => {
        if (isRedundant(fragment)) return '';
        let result = fragment;
        for (const run of (normalize(fragment).match(/[\u4e00-\u9fff]{2,}/g) || [])) {
          for (let length = Math.min(4, run.length); length >= 2; length -= 1) {
            for (let index = 0; index <= run.length - length; index += 1) {
              const overlap = run.slice(index, index + length);
              if (productKey.includes(overlap)) result = result.replace(overlap, '');
            }
          }
        }
        const cleaned = result.replace(/^(?:系列|猫粮|主食|配方)$/u, '').trim();
        return normalize(cleaned).length < 2 ? '' : cleaned;
      };
      const kept = fragments.map(dedupeFragment).filter(Boolean);
      if (!kept.length || isRedundant(primary)) return '';
      return kept.join(' ');
    };
    return [PFDSCleaning.seriesName(p), PFDSCleaning.brief(p.flavor), p.packageSize].map(cleanValue).filter(Boolean);
  }
  const selectionName = p => window.PetFoodScatter.productLabel({...p,product:readableProductName(p)});

  function syncWorkspace() {
    for (const area of workspaces.areas) $(`workspace-${area}`).hidden = area !== workState.area;
    document.querySelectorAll('[data-workspace]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.workspace === workState.area)));
    document.querySelectorAll('[data-analysis]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.analysis === workState.mode)));
    $('analysis-chart').hidden = !['nutrition','price'].includes(workState.mode);
    $('analysis-compare').hidden = workState.mode !== 'compare';
    $('analysis-scoring').hidden = workState.mode !== 'score';
    // D096：四张统计卡（筛选结果 / 覆盖品牌 / 蛋白中位数 / 元每斤记录中位数）回到产品库主页面。
    // 产品库始终显示；分析与比较页仍只在"营养分布 / 价格关系"下显示；情报页与资料管理页不显示。
    $('summary-strip').hidden = workState.area === 'intel' || workState.area === 'manage'
      || (workState.area === 'analysis' && !['nutrition','price'].includes(workState.mode));
    // D097：「当前显示全部产品 / 当前结果 N 款」这条结果摘要与统计卡同源同规则——直接跟着统计卡走，
    // 情报库与资料管理页不再显示"当前显示多少款产品"（该页不参与产品筛选，这个数字没有意义）。
    $('query-summary').hidden = $('summary-strip').hidden;
    const chartHost = workState.area === 'analysis' && ['nutrition','price'].includes(workState.mode) ? $('analysis-chart') : $('library-chart');
    chartHost.append($('chart-panel'));
    const panel = document.querySelector('.products-panel');
    (workState.area === 'manage' ? $('management-products') : $('workspace-library')).append(panel);
    document.body.dataset.workspace = workState.area;
    document.body.dataset.analysis = workState.mode;
    $('analysis-context').textContent = {
      nutrition:'同一组筛选结果的营养分布。图形设置可改指标与参考交点；价格条件只筛产品，不改变营养数值。',
      price:'比较参考单价与营养指标。可放大常用价格区间；报价对应包装见详情。',
      compare:'已选产品保持不变；返回产品库可增减选择。',
      score:'测试中：全部正式产品可按同一偏好规则试评，也可仅对比已选款。未知项标50*，不代表产品质量评级。'
    }[workState.mode];
  }
  function setWorkspace(area, mode) {
    if (visitorMode && area === 'manage') area = 'library';
    Object.assign(workState, workspaces.state(area, mode || workState.mode));
    syncWorkspace();
    document.querySelector('.content').scrollTo({top: 0});
    if (workState.area !== 'manage') renderScatter(filteredProducts());
    if (workState.area === 'analysis') { renderComparison(); if(workState.mode==='score') selectionLab.render(); }
    document.querySelector('.workspace-nav').scrollIntoView({block:'start'});
  }
  // D096：记录/恢复"产品库视图位置"。宽屏下真正的滚动容器是 .content（html/body 为 overflow:hidden），
  // 窄屏下则退回页面滚动，因此两者都记，返回时两者都还原。
  function rememberLibraryView() {
    const content = document.querySelector('.content');
    libraryViewMemory = {
      area: workState.area,
      mode: workState.mode,
      contentTop: content ? content.scrollTop : 0,
      windowY: window.scrollY || window.pageYOffset || 0,
    };
  }
  function restoreLibraryView() {
    const memory = libraryViewMemory;
    libraryViewMemory = null;
    if (!memory || memory.area !== 'library') return false;
    const apply = () => {
      const content = document.querySelector('.content');
      if (content) content.scrollTop = memory.contentTop;
      window.scrollTo(0, memory.windowY);
    };
    apply();
    requestAnimationFrame(apply);
    setTimeout(apply, 60);   // 散点图重绘后高度可能微调，再补一次
    return true;
  }
  function setAnalysis(mode, applyPreset = true) {
    if (!workspaces.modes.includes(mode)) return;
    workState.mode = mode;
    const preset = applyPreset ? workspaces.preset(mode) : null;
    if (preset) { Object.assign(axes,preset); syncChartControls(); }
    setWorkspace('analysis',mode);
    $('workspace-analysis').scrollIntoView({block:'start'});
  }
  document.querySelectorAll('[data-workspace]').forEach(b=>b.addEventListener('click',()=>setWorkspace(b.dataset.workspace)));
  document.querySelectorAll('[data-analysis]').forEach(b=>b.addEventListener('click',()=>setAnalysis(b.dataset.analysis)));
  $('back-to-library').addEventListener('click',()=>setWorkspace('library'));
  let sampleData = null;
  function renderNutrition(n) {
    const table = '<div class="table-wrap"><table><thead><tr><th>项目</th><th>比较符</th><th>数值</th><th>单位</th><th>计量基准</th><th>原文 / 来源</th></tr></thead><tbody>' +
      n.guarantees.map(v=>`<tr><th scope="row">${esc(v.label)}</th><td>${esc(v.comparator ?? '未记录')}</td><td>${esc(v.value)}</td><td>${esc(v.unit ?? '未记录')}<small class="price-basis">${esc(v.unitBasis ?? '')}</small></td><td>${esc(v.basis ?? '未记录')}</td><td>${esc(v.raw)}<small class="price-basis">${esc(v.source.fieldKey || v.fieldKey)} · 产品信息第${esc(v.source.row ?? '?')}行</small></td></tr>`).join('') + '</tbody></table></div>';
    return '<p class="theme-note">仅拆分，不代表已核或可评分。未记录的比较符不当等号；局部干物质限定不套整表；单位不换算。完整原文仍保留。</p>' + table +
      (n.unparsed.length ? '<h3>未自动拆分的原文</h3><ul>'+n.unparsed.map(v=>`<li>${esc(v.raw)} · ${esc(v.reason)}</li>`).join('')+'</ul>' : '') +
      `<h3>检测结果（独立）</h3><p class="theme-note">${esc(n.testNote)} 当前未绑定检测结果，不表示产品从未检测。</p>`;
  }
  function renderSample() {
    if (sampleData === data) return;
    sampleData = data;
    const sample = window.PetFoodSample.create(data);
    $('sample-open-product').disabled = sample.empty || !sample.skuId;
    $('sample-content').innerHTML = sample.groups.map(g=>`<details class="sample-group"><summary>${esc(g.title)}</summary>${g.nutrition ? renderNutrition(g.nutrition) : `<dl>${g.rows.map(r=>`<div><dt>${esc(r.label)}</dt><dd>${esc(r.value ?? '未记录')}<small>${esc(r.boundary || '')}</small></dd></div>`).join('')}</dl>`}</details>`).join('') +
      `<section class="sample-questions"><h3>需要一起确定的拆法</h3><ol>${sample.questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ol><p>${sample.replication.map(esc).join('；')}</p></section>`;
    $('sample-open-product').onclick = ()=>sample.skuId && openDetail(sample.skuId);
  }

  const controls = {
    search: $('search'), brand: $('brand-filter'), process: $('process-filter'), stage: $('stage-filter'),
    imported: $('import-filter'), functionValue: $('function-filter'),
    productionMode: $('production-mode-filter'), factoryName: $('factory-filter'),
    // D100：侧栏去掉「我的分组」「对比备注关键词」；新增「描述关键词」（ingredients 现为「成分关键词」）。
    ingredients: $('ingredient-keyword'), descriptionKeyword: $('description-keyword'),
    legendMode: $('legend-mode'), legendCategory: $('legend-category'), proteinMin: $('protein-min'), proteinMax: $('protein-max'),
    fatMin: $('fat-min'), fatMax: $('fat-max'), priceMin: $('price-min'), priceMax: $('price-max'),
    phosphorusMode: $('phosphorus-mode'), phosphorusMin: $('phosphorus-min'), phosphorusMax: $('phosphorus-max'),
    chlorideMode: $('chloride-mode'), chlorideMin: $('chloride-min'), chlorideMax: $('chloride-max'),
    animalIngredientMode: $('animal-ingredient-mode'), animalIngredientMin: $('animal-ingredient-min'), animalIngredientMax: $('animal-ingredient-max'),
    animalProteinMode: $('animal-protein-mode'), animalProteinMin: $('animal-protein-min'), animalProteinMax: $('animal-protein-max'),
    // D099：三个情报列（品牌创立 / 工厂成立 / 工厂规模）纳入同一套筛选，表头漏斗与左侧栏共用这几个控件。
    brandFounded: $('brand-founded-filter'), factoryFounded: $('factory-founded-filter'), factoryScale: $('factory-scale-filter')
  };
  // D099：选项按当前记录值域生成（与工厂名称同一个 value: 模式）。
  // 选项文本带条数便于判断值域；摘要 chip 取 data-short，不带条数。
  function fillIntelTextOptions() {
    for (const [id, field] of [['brand-founded-filter', 'brandFoundedShort'],
      ['factory-founded-filter', 'factoryFoundedShort'], ['factory-scale-filter', 'factoryScaleShort']]) {
      const select = $(id);
      if (!select) continue;
      const previous = select.value, counts = new Map();
      for (const p of products) {
        const text = String(p[field] ?? '').trim();
        if (!text || text === '—' || ['DATA_GAP','见详情','暂无资料'].includes(text)) continue;
        counts.set(text, (counts.get(text) || 0) + 1);
      }
      select.innerHTML = '<option value="">全部</option><option value="filled">有记录</option><option value="empty">未记录</option>' +
        [...counts].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN', { numeric: true }))
          .map(([text, count]) => `<option value="value:${esc(text)}" data-short="${esc(text)}">${esc(text)}（${count}款）</option>`).join('');
      select.value = [...select.options].some(option => option.value === previous) ? previous : '';
    }
  }
  const query = window.PetFoodQuery;
  const sorting = window.PetFoodSorting;
  const tableView = window.PetFoodTableView;
  let tableState = tableView.defaults(), tableWarning = '';
  let coreOnly = false; // 核心产品一键筛选：true=仅人工确认核心；由 Charles 后台逐款标定，前端只提供一键查看
  try { tableState = tableView.read(localStorage); } catch { tableWarning = '上次显示设置未能读取，已使用基础营养；产品资料不受影响。'; }
  let metricCatalog = sorting.options(products);
  function saveTableState() {
    try { tableView.write(localStorage,tableState); tableWarning = ''; }
    catch { tableWarning = '当前显示可用，但浏览器未能记住设置；产品资料不受影响。'; }
  }
  function syncSortControls(sortKey = tableState.sort) {
    tableState = tableView.normalize(tableState,sortKey);
    $('list-sort').value = tableState.sort;
    metricCatalog = sorting.options(products);
    const secondaryMetric = sorting.definition(tableState.secondary);
    if(secondaryMetric && !metricCatalog.some(d=>d.key===secondaryMetric.key))metricCatalog.push({...secondaryMetric,count:0});
    const primary = sorting.sortDefinition(tableState.sort)?.key;
    $('secondary-sort').innerHTML = '<option value="">保持原顺序</option>' + [...sorting.textDefinitions,...metricCatalog].filter(d=>d.key!==primary)
      .map(d=>`<option value="${esc(d.key)}">${esc(d.label)}</option>`).join('');
    $('secondary-sort').value = sorting.sortDefinition(tableState.secondary)?.key || '';
    $('secondary-direction').value = tableState.secondary.endsWith('-desc') ? 'desc' : 'asc';
    $('secondary-sort').disabled = !primary;
    $('secondary-direction').disabled = !primary || !tableState.secondary;
    renderColumnOptions();
  }
  function renderColumnOptions() {
    const active = tableView.effective(tableState, queryValues());
    const automatic = tableView.effective(tableView.defaults(),queryValues()).filter(k=>!tableView.defaults().columns.includes(k));
    const word = $('column-search').value.trim().toLocaleLowerCase('zh-CN');
    const counts = Object.fromEntries(metricCatalog.map(d=>[d.key,d.count]));
    $('column-options').innerHTML = tableView.columns.filter(d=>!word || (d.label+' '+d.key).toLocaleLowerCase('zh-CN').includes(word))
      .map(d=>`<label class="column-option"><input type="checkbox" data-column="${esc(d.key)}" ${active.includes(d.key)?'checked':''} ${automatic.includes(d.key)?'disabled':''}><span>${esc(d.label)}${d.metric?`<small>${counts[d.key]||0}款有数值</small>`:''}${automatic.includes(d.key)?'<small>筛选中，自动显示</small>':''}</span></label>`).join('');
    $('column-count').textContent = `· ${active.length}列`;
    const currentPreset = tableView.presetKey(tableState);
    $('table-preset-select').value = tableView.presets.some(p => p.key === currentPreset) ? currentPreset : 'custom';
    $('column-message').textContent = tableWarning || `${currentPreset==='custom'?'当前为自选组合':'已载入一个常用预设'}；筛选与排序指标自动显示。拖动表头可调整列顺序。显示列、列顺序和排序会在本机浏览器记住。`;
  }
  const scoring = window.PetFoodScoring;
  let scoreConfig = scoring.defaults(), scoreError = '';
  function syncScoreControls() {
    $('score-mode').value = scoreConfig.mode;
    $('score-price-scope').value = scoreConfig.priceScope;
    $('score-rules').innerHTML = scoring.keys.map(key => {
      const r = scoreConfig.rules[key], unit = key === 'pricePerJin' ? '元/斤' : '%';
      return `<fieldset class="score-rule"><legend>${esc(scoring.labels[key])} · ${unit}</legend>${[['low','目标最低'],['high','目标最高'],['tolerance','缓冲距离']].map(([field,label]) => `<label>${label}<input type="number" id="score-${key}-${field}" min="${field === 'tolerance' ? '0.01' : '0'}" step="0.1" value="${r[field]}"></label>`).join('')}<label>权重 <output id="score-${key}-weight-label">${r.weight}</output></label><input type="range" aria-label="${esc(scoring.labels[key])}权重" id="score-${key}-weight" min="0" max="100" step="1" value="${r.weight}"></fieldset>`;
    }).join('');
    $('score-rules').querySelectorAll('input').forEach(input => input.addEventListener('input', readScoreControls));
  }
  function readScoreControls() {
    try {
      const rules = Object.fromEntries(scoring.keys.map(key => [key,Object.fromEntries(['low','high','tolerance','weight'].map(field => {
        const raw = $(`score-${key}-${field}`).value;
        return [field, raw === '' ? NaN : Number(raw)];
      }))]));
      for (const key of scoring.keys) $(`score-${key}-weight-label`).textContent = rules[key].weight;
      scoreConfig = scoring.normalize({version:scoring.VERSION,mode:$('score-mode').value,priceScope:$('score-price-scope').value,rules});
      scoreError = '';
    } catch (error) { scoreError = error.message; }
    renderScoring(filteredProducts());
  }
  function scoreText(p) {
    if ($('score-mode').value === 'off') return '不评分，只看事实';
    if (scoreError) return `未计算：${scoreError}`;
    const result = scoring.score(p,scoreConfig);
    if (result.mode === 'off') return '不评分，只看事实';
    return `${result.total === null ? '不进总榜（资料不足）' : `偏好匹配 ${numberShown(result.total)} / 100`} · 覆盖${numberShown(result.coverage*100)}%\n` + result.dimensions.map(d => `${d.label}：${d.value === null ? '缺数值' : numberShown(d.value)}；目标${d.rule.low}–${d.rule.high}，缓冲${d.rule.tolerance}；${d.points === null ? d.reason : `${numberShown(d.points)}分 × 权重${numberShown(d.weight*100)}% = ${numberShown(d.contribution)}`}`).join('\n');
  }
  // D101：详情页暂不放出「个人偏好匹配」块（条件与权重分析的标注暂时未启用）。
  // 计算逻辑保留（scoreText / renderScoring 仍服务分析页）；如恢复详情展示，把本函数插回详情模板即可。
  function scoreSection(p) {
    return `<details class="detail-section"><summary>个人偏好匹配 <span class="detail-status">按当前设置</span></summary><p>${esc(scoreText(p))}</p><p class="detail-help">按当前记录和你的设置计算，不是品质评分或购买推荐。</p><details class="data-explanation"><summary>查看计算说明</summary><p>规则版本：${esc(scoring.VERSION)}。缺少启用指标时不补0；详细规则和权重在“条件与权重”中查看。</p></details></details>`;
  }
  function renderScoring(rows) {
    const off = $('score-mode').value === 'off';
    $('scoring-disclosure-status').textContent = off ? '未启用' : scoreError ? '设置需调整' : '已启用 · 不是质量分';
    $('score-rules').hidden = $('score-formula').hidden = off;
    if (off || scoreError) {
      $('score-status').textContent = off ? '当前不评分；演示规则仅供修改，不会自动产生专业评级。' : `已停止计算：${scoreError}`;
      $('score-results').innerHTML = ''; return;
    }
    const ranked = scoring.rank(rows,scoreConfig);
    $('score-status').textContent = `当前筛选${rows.length}款；${ranked.complete.length}款资料完整、可比较；${ranked.incomplete.length}款资料不足。按当前设置计算，结果不是品质或适用性结论。`;
    const row = (entry,index) => `<tr><td>${index ?? '—'}</td><td><button type="button" class="detail-button" data-score-detail="${esc(entry.product.skuId)}">${esc(entry.product.brand)} · ${esc(readableChartLabel(entry.product))}</button></td><td>${entry.result.total === null ? '资料不足' : numberShown(entry.result.total)}</td><td>${numberShown(entry.result.coverage*100)}%</td><td>${entry.result.dimensions.map(d=>`${esc(d.label)} ${d.points === null ? esc(d.reason) : `${numberShown(d.points)}分 / ${numberShown(d.weight*100)}%`}`).join('<br>')}</td></tr>`;
    $('score-results').innerHTML = `<div class="score-ranking"><table><thead><tr><th>排名</th><th>产品（点开看逐项计算）</th><th>偏好匹配/100</th><th>资料覆盖</th><th>维度分 / 归一权重</th></tr></thead><tbody>${ranked.complete.map((r,i)=>row(r,i+1)).join('')}</tbody></table></div>${ranked.incomplete.length ? `<details><summary>${ranked.incomplete.length}款未参与总榜：查看缺项</summary><div class="score-ranking"><table><tbody>${ranked.incomplete.map(r=>row(r)).join('')}</tbody></table></div></details>` : ''}`;
    $('score-results').querySelectorAll('[data-score-detail]').forEach(button=>button.addEventListener('click',()=>openDetail(button.dataset.scoreDetail)));
  }
  syncScoreControls();
  $('score-mode').addEventListener('change', readScoreControls);
  $('score-price-scope').addEventListener('change', readScoreControls);
  const trialUI = window.PetFoodEvaluationUI({esc,getProducts:()=>products,getSelected:()=>selected,sourceStates:calibrationSourceStates,
    label:p=>[p.brand,readableProductName(p),p.flavor].filter(Boolean).join(' · '),openDetail,
    setSelected:ids=>{selected.clear();ids.forEach(id=>selected.add(id));currentPage=1;render();},
    riskChanged:()=>{renderScatter(filteredProducts());renderComparison();autoUI.render();selectionLab.render();}});
  const managementAttributes = window.PetFoodAttributes;
  const analysis = window.PetFoodAnalysis;
  const autoUI = window.PetFoodAnalysisUI({esc,getProducts:()=>products,getSelected:()=>selected,
    label:p=>[p.brand,readableProductName(p),p.flavor].filter(Boolean).join(' · '),
    canEdit:()=>editorEnabled,getRisk:p=>trialUI.getRisk(p),openDetail,openEditor,changed:()=>render(),
    setSelected:ids=>{selected.clear();ids.filter(id=>products.some(p=>p.skuId===id)).forEach(id=>selected.add(id));currentPage=1;render();},
    showCompare:()=>setAnalysis('compare'),showChart:()=>{
      axes.x='pricePerJin';axes.y='conditionScore';syncChartControls();setAnalysis('price',false);
    }});
  const attributeDefinitions = data.fieldDefinitions.filter(f => f.valueLayer === 'management_attribute' && f.editable);
  const selectionLab = window.PFDSSelectionLabUI({esc,getProducts:()=>products,getSelected:()=>selected,
    label:p=>p.brand+' · '+readableProductName(p),openDetail,getRisk:p=>trialUI.getRisk(p),
    context:p=>({brand:(data.brandFacts||[]).filter(f=>f.brandId===p.brandId&&/研发|研究|成立|舆情|召回|市场|销量|生产|主体/.test(f.fieldLabel)),
      factory:factoryData.factories.filter(f=>factoryIntel&&factoryIntel.normalizeName(f.factoryName)===factoryIntel.normalizeName(p.factoryName))}),
    setSelected:ids=>{selected.clear();ids.forEach(id=>selected.add(id));currentPage=1;render();}});
  const queryValues = () => {
    const values = Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, control.type === 'checkbox' ? control.checked : control.value]));
    values.coreStatus = coreOnly ? 'confirmed' : '';
    return values;
  };
  syncSortControls();
  fillIntelTextOptions();
  const scatter = window.PetFoodScatter;
  const readableChartLabel = p => scatter.productLabel({ ...p, product: readableProductName(p) });
  const axes = { x: 'protein', y: 'fat', color: 'imported', size: 'uniform' };
  const defaultOrigin = { protein: 35, fat: 15, pricePerJin: 40, conditionScore:50 };
  const origin = { ...defaultOrigin };
  try {
    const saved = JSON.parse(localStorage.getItem('pet-food-scatter-origin-v1'));
    for (const key of ['protein', 'fat', 'pricePerJin','conditionScore']) {
      if (Number.isFinite(saved?.[key]) && saved[key] >= 0 && (key === 'pricePerJin' || saved[key] <= 100)) origin[key] = saved[key];
    }
  } catch { /* Local storage is optional for file-based viewing. */ }
  for(const id of ['x-axis','y-axis']) $(id).insertAdjacentHTML('beforeend','<option value="conditionScore">条件匹配 /100（非质量分）</option>');
  function syncChartControls() {
    $('x-axis').value = axes.x; $('y-axis').value = axes.y;
    $('point-color').value = axes.color; $('point-size').value = axes.size;
    for (const [axis, id] of [['x','protein-origin'], ['y','fat-origin']]) {
      const key = axes[axis], metric = scatter.metrics[key], input = $(id);
      $(`${axis}-origin-label`).textContent = `${metric.label} ${metric.unit} 基准`;
      input.value = origin[key];
      if (metric.max === null) input.removeAttribute('max'); else input.max = metric.max;
    }
  }
  const positionText = p => [axes.x, axes.y].map(key => `${scatter.metrics[key].label} ${numberShown(p[key], scatter.metrics[key].unit)}`).join(' / ');
  syncChartControls();

  function themeEvidence(p) {
    return query.textEvidence(p, queryValues());
  }

  function activeConditions() {
    const labels = { search: '产品', brand: '品牌', process: '工艺', stage: '阶段', imported: '进口属性', functionValue: '功能',
      ingredients: '成分关键词', descriptionKeyword: '描述关键词', productionMode: '生产方式', factoryName: '工厂名称',
      brandFounded: '品牌创立', factoryFounded: '工厂成立', factoryScale: '工厂规模',
      phosphorusMode: '磷口径', chlorideMode: '氯化物口径', animalIngredientMode: '动物性原料口径', animalProteinMode: '动物性蛋白口径' };
    const conditions = [];
    if (controls.legendCategory.value) conditions.push(`图例类别：${controls.legendCategory.value}`);
    if (coreOnly) conditions.push('核心角色：仅人工确认核心');
    for (const [key, label] of Object.entries(labels)) {
      const control = controls[key];
      if (!control.value.trim()) continue;
      const value = control.tagName === 'SELECT' ? (control.selectedOptions[0].dataset.short || control.selectedOptions[0].textContent) : control.value.trim();
      conditions.push(`${label}：${value}`);
    }
    for (const [key, label] of [['protein', '蛋白 %'], ['fat', '脂肪 %'], ['price', '参考单价'],
      ['phosphorus', '磷'], ['chloride', '氯化物'], ['animalIngredient', '动物性原料 %'], ['animalProtein', '动物性蛋白 %']]) {
      const low = controls[`${key}Min`].value, high = controls[`${key}Max`].value;
      if (low !== '' || high !== '') conditions.push(`${label}：${low === '' ? '不限' : low}–${high === '' ? '不限' : high}`);
    }
    // D099：按列生成的营养指标范围同样要在结果摘要里说清楚，否则会出现"筛了但看不到筛了什么"。
    for (const definition of Object.values(headerFilterDefinitions)) {
      if (!definition.metricRange) continue;
      const low = controls[definition.min].value, high = controls[definition.max].value;
      if (low !== '' || high !== '') conditions.push(`${definition.label}：${low === '' ? '不限' : low}–${high === '' ? '不限' : high}`);
    }
    return conditions;
  }

  function priceText(p) {
    if (p.priceBasis?.unitStatus === 'range') return `${numberShown(p.priceBasis.min)}–${numberShown(p.priceBasis.max)}（范围记录）`;
    return p.pricePerJin == null ? '口径待明确' : numberShown(p.pricePerJin);
  }
  function priceLabel(p) { return p.priceBasis?.label || '价格口径待明确'; }
  function priceStatusLabel(p) {
    return ({single_consistent:'规格价一致',bound:'已绑定报价',mismatch:'价格未对应',unmapped:'规格待核'}[p.priceBasis?.scope]
      || (p.priceBasis?.label === '规格与价格对应未明确' ? '规格待核' : '口径待核'));
  }

  function unique(field) {
    return [...new Set(products.map(p => p[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }
  function populate(select, values) {
    values.forEach(value => select.insertAdjacentHTML('beforeend', `<option value="${esc(value)}">${esc(value)}</option>`));
  }
  function refreshOptions() {
    const oldFactory = controls.factoryName.value;
    const factories = [...new Set(products.map(query.factoryName).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
    controls.factoryName.innerHTML = '<option value="">全部工厂</option><option value="filled">有工厂名称</option><option value="empty">未填写</option>' + factories.map(name=>`<option value="value:${esc(name)}">${esc(name)}</option>`).join('');
    if (oldFactory.startsWith('value:') && !factories.includes(oldFactory.slice(6))) controls.factoryName.insertAdjacentHTML('beforeend',`<option value="${esc(oldFactory)}">${esc(oldFactory.slice(6))}（当前无产品）</option>`);
    controls.factoryName.value = oldFactory;
    const oldFunction = controls.functionValue.value;
    const functionTags = [...new Set([...Object.values(query.functionLabels), ...products.flatMap(query.functionValues)])].sort((a,b)=>a.localeCompare(b,'zh-CN'));
    const filled = products.filter(p=>query.functionValues(p).length).length;
    controls.functionValue.innerHTML = '<option value="">全部产品</option>' +
      `<option value="filled">有功能分类（${filled}款）</option><option value="empty">功能空白（${products.length-filled}款）</option>` +
      functionTags.filter(label=>products.some(p=>query.functionValues(p).includes(label)) || oldFunction === 'value:'+label).map(label=>`<option value="value:${esc(label)}">${esc(label)}（${products.filter(p=>query.functionValues(p).includes(label)).length}款）</option>`).join('');
    if(oldFunction.startsWith('value:') && !functionTags.includes(oldFunction.slice(6)))controls.functionValue.insertAdjacentHTML('beforeend',`<option value="${esc(oldFunction)}">${esc(oldFunction.slice(6))}（当前无产品）</option>`);
    controls.functionValue.value = oldFunction;
    // D100：侧栏已去掉「我的分组」筛选入口，这里不再为它生成标签选项。
    // 分组本身仍是管理记录（详情页、散点颜色、图例分组照旧可用）。
    for (const [control, field] of [[controls.brand, 'brand'], [controls.process, 'process'], [controls.stage, 'stage'], [controls.imported, 'importStatus']]) {
      const oldValue = control.value;
      control.querySelectorAll('option:not(:first-child)').forEach(option => option.remove());
      populate(control, unique(field));
      control.value = oldValue;
    }
    $('pending-count').textContent = `(全库 ${products.filter(p => p.importStatus === '待核验').length})`;
    $('pending-import').disabled = !products.some(p => p.importStatus === '待核验');
    $('pending-import').hidden = $('pending-import').disabled;
    const generated = new Date(data.meta.generatedAt);
    document.body.dataset.editable = String(editorEnabled);
    $('topbar-meta').innerHTML = visitorMode
      ? `<span>访客预览 · ${products.length} 款产品</span><br>资料更新于 ${generated.toLocaleDateString('zh-CN')}`
      : `<span class="internal-status">内部版 · ${data.meta.skuCount} 款产品</span><br>数据生成于 ${generated.toLocaleDateString('zh-CN')} · ${editorEnabled ? '可编辑' : '只读'}`;
    if (!editorEnabled) $('edit-guide-mode').textContent = editorVersionMismatch ? '编辑服务版本不匹配：为避免新字段被旧服务忽略，当前只读。请先关闭旧编辑终端，再双击“打开编辑入口.command”。' : '当前是只读页面。要在网页修改，请双击项目中的“打开编辑入口.command”，然后在新打开的本机页面点击产品“编辑”。现役 Excel 仍保留旧版与修改记录。';
    $('mode-title').textContent = editorEnabled ? '可编辑模式 · 产品右侧直接修改' : '只读模式 · 当前页面不能保存';
    $('mode-help').textContent = editorEnabled ? '核心勾选直接保存到底稿；单款点“编辑”，批量与Excel维护在“资料管理”。' : editorVersionMismatch ? '编辑服务版本不匹配，当前只读：请关闭旧编辑终端，再双击“打开编辑入口.command”。' : '双击项目里的“打开编辑入口.command”，在打开的本机编辑页面修改；此页仍可筛选和比较。';
    if (pendingCatalog) $('mode-help').textContent = '待补新品：仅此维护视图展示，默认产品库不纳入。补充保存不会自动恢复展示。' + $('mode-help').textContent;
    $('jump-edit').textContent = '进入资料管理';
    $('batch-core').hidden = !editorEnabled;
    $('open-maintenance').hidden = !editorEnabled;
    $('jump-verification').hidden = !editorEnabled;
  }
  refreshOptions();
  $('jump-verification').hidden = !editorEnabled;

  // D099：表头漏斗里的营养指标范围条件（含按列生成的隐藏控件），与其它条件走同一入口，
  // 不建立第二套查询——判定本身仍由 query.js 提供，这里只负责取值。
  function metricRangeValues() {
    const ranges = {};
    for (const [key, definition] of Object.entries(headerFilterDefinitions)) {
      if (!definition.metricRange) continue;
      const low = controls[definition.min]?.value ?? '', high = controls[definition.max]?.value ?? '';
      if (low !== '' || high !== '') ranges[key] = [low, high];
    }
    return ranges;
  }
  function filteredProducts() {
    const values = queryValues(), ranges = metricRangeValues();
    return products.filter(p => query.matches(p, values)
      && query.matchesMetricRanges(p, ranges, (product, key) => sorting.metric(product, key).value));
  }

  const brandNames = new Map(products.map(p=>[p.brandId,p.brand]));
  $('brand-info-select').innerHTML += [...brandNames].sort((a,b)=>a[1].localeCompare(b[1],'zh-CN')).map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join('');
  $('brand-info-select').addEventListener('change', () => {
    const id=$('brand-info-select').value, facts=(data.brandFacts || []).filter(f=>f.brandId===id);
    $('brand-show-products').disabled=!id;
    $('brand-info-content').innerHTML = !id ? '' : !facts.length ? '<p>当前导出没有这个品牌的品牌信息记录。可重新导入现役工作簿；不自动补AI结论。</p>' : facts.map(f=>`<section class="detail-section"><h3>${esc(f.fieldLabel || '未标字段名')}</h3><p>${esc(f.valueText || '原表未填写')}</p><p class="detail-help">信息性质（原记录）：${esc(f.informationNature || '未填')} · 核验状态（原记录）：${esc(f.verificationStatus || '未填')} · 日期：${esc(f.verificationDate || '未填')}</p><p class="detail-help">原记录出处：${esc(f.sourceText || '未填')}</p><div class="source-box">${esc(data.meta.sourceRoot)}/${esc(f.source.file)}<br>${esc(f.source.sheet)} · 第${f.source.row}行</div></section>`).join('') + '<p class="detail-help">品牌信息目前只读；修改现役Excel的“品牌信息”页后重新导入。产品“编辑”的品牌背景原文是SKU字段，不会自动覆盖这里。</p>';
  });
  $('brand-show-products').addEventListener('click', () => { controls.brand.value=brandNames.get($('brand-info-select').value) || ''; $('data-guide-overlay').hidden=true; currentPage=1; render(); setWorkspace('library'); });
  // One shared reference entry, reusing the existing brand records and reading guidance.
  $('guide-brand-host').append($('brand-panel'));
  const brandGuideLink = document.createElement('button');
  brandGuideLink.type = 'button'; brandGuideLink.className = 'secondary-button';
  brandGuideLink.textContent = '查看品牌与工厂资料说明';
  $('management-brand').append(brandGuideLink);
  function openDataGuide(section = 'guide-indicators') {
    $('guide-metric-directory').innerHTML = `<details><summary>现有 ${sorting.definitions.length} 项指标目录</summary><dl class="guide-metric-list">${sorting.definitions.map(d=>`<div><dt>${esc(d.label)}</dt><dd>${esc(d.unit || '单位 / 分母或方法以原文为准')}</dd></div>`).join('')}</dl></details>`;
    $('guide-process-content').innerHTML = `<p>工艺描述制作方式，不代表品质高低。当前分类：${unique('process').map(esc).join(' / ') || '未记录'}。</p><details><summary>本库功能分类</summary><p>${[...new Set(products.flatMap(query.functionValues))].map(esc).join(' / ') || '未记录'}。</p></details>`;
    const factories = [...new Set(products.map(query.factoryName).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
    $('guide-factory-content').innerHTML = factories.length ? `<dl>${factories.map(name=>{
      const rows = products.filter(p=>query.factoryName(p)===name);
      return `<div><dt>${esc(name)}</dt><dd>${rows.length} 款记录 · ${[...new Set(rows.map(p=>p.brand))].map(esc).join(' / ')}<small class="detail-help">只按本款工厂名称汇总；具体原文与出处请在产品详情查看。</small></dd></div>`;
    }).join('')}</dl>` : '<p>当前尚无人工维护的工厂名称；产品详情仍保留工厂 / 进口原文。</p>';
    $('data-guide-overlay').hidden = false;
    if (section === 'guide-indicators') $('data-guide-overlay').querySelector('.drawer').scrollTop = 0;
    else $(section).scrollIntoView({block:'start'});
    $('data-guide-overlay').querySelector('.close-button').focus({preventScroll:true});
  }
  $('open-data-guide').addEventListener('click',()=>openDataGuide());
  $('open-tool-about').addEventListener('click',()=>openDataGuide('guide-about'));
  $('open-reading-guide').addEventListener('click',()=>openDataGuide(['price','pagePrice'].includes(sorting.sortDefinition($('list-sort').value)?.key) ? 'guide-price' : 'guide-indicators'));
  document.querySelectorAll('[data-guide-section]').forEach(button=>button.addEventListener('click',()=>{
    const section=$(button.dataset.guideSection);
    section.scrollIntoView({block:'start',behavior:'smooth'});
    section.setAttribute('tabindex','-1');
    section.focus({preventScroll:true});
  }));
  brandGuideLink.addEventListener('click',()=>openDataGuide('guide-brand-factory'));

  function renderSummary(rows) {
    const numeric = (key) => rows.map(row => row[key]).filter(value => value !== null && value !== undefined);
    const median = values => {
      if (!values.length) return null;
      const sorted = [...values].sort((a,b) => a-b), mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
    };
    const cards = [
      [rows.length, '筛选结果'],
      [new Set(rows.map(r => r.brand)).size, '覆盖品牌'],
      [shown(median(numeric('protein'))?.toFixed(1), '%'), '蛋白中位数'],
      [shown(median(numeric('pricePerJin'))?.toFixed(1), ' 元'), '参考单价中位数'],
    ];
    $('summary-strip').innerHTML = cards.map(([value,label]) => `<div class="summary-card"><strong>${esc(value)}</strong><span>${label}</span></div>`).join('');
  }

  function renderScatter(rows) {
    renderScatter.lastRows = rows; // 供窗口尺寸变化时按新宽度重绘；空结果也要覆盖，避免旧数据被重画
    const conditionChart=[axes.x,axes.y].includes('conditionScore');
    if(conditionChart) rows=rows.filter(p=>selected.has(p.skuId)).map(p=>({...p,conditionScore:autoUI.score(p)?.total??null}));
    const allPoints = scatter.points(rows, axes);
    const priceRange = $('chart-price-range');
    const priceAxis = [axes.x,axes.y].includes('pricePerJin');
    priceRange.disabled = !priceAxis;
    const limit = priceAxis && priceRange.value ? Number(priceRange.value) : null;
    const points = limit ? allPoints.filter(p=>p.pricePerJin <= limit) : allPoints;
    $('chart-range-note').textContent = limit ? `图中显示 ${points.length} 款，${allPoints.length-points.length} 款超出范围；产品列表与筛选不变。` : '';
    const xMetric = scatter.metrics[axes.x], yMetric = scatter.metrics[axes.y];
    const proteinOrigin = origin[axes.x], fatOrigin = origin[axes.y];
    $('chart-setting-summary').textContent = `参考交点 ${proteinOrigin}${xMetric.unit} / ${fatOrigin}${yMetric.unit} · ${$('point-color').selectedOptions[0].textContent}`;
    $('chart-title').textContent = `${xMetric.label} × ${yMetric.label}`;
    $('scatter').setAttribute('aria-label', `${xMetric.label}和${yMetric.label}散点图`);
    const categoryRows = products.filter(p => query.matches(p, {...queryValues(),legendCategory:''}));
    const categories = [...new Set(products.map(p => query.category(p, axes.color)))].sort((a,b) => a.localeCompare(b,'zh-CN'));
    const counts = categories.map(category => [category,categoryRows.filter(p => query.category(p,axes.color) === category).length]);
    $('chart-legend').innerHTML = `<button type="button" data-legend="" aria-pressed="${!controls.legendCategory.value}">全部类别</button>` + counts.filter(([category,count]) => count || controls.legendCategory.value === category).map(([category,count]) => `<button type="button" data-legend="${esc(category)}" aria-pressed="${controls.legendCategory.value === category}"><span class="dot" style="background:${scatter.color(category,categories,axes.color)}"></span>${esc(category)} ${count}</button>`).join('');
    $('chart-legend').querySelectorAll('[data-legend]').forEach(button => button.addEventListener('click', () => {
      controls.legendMode.value = axes.color;
      controls.legendCategory.value = button.dataset.legend === controls.legendCategory.value ? '' : button.dataset.legend;
      currentPage = 1; render();
    }));
    const sizeMax = Math.max(1,...products.map(p => Number.isFinite(p.pricePerJin) ? p.pricePerJin : 0));
    $('chart-hint').textContent = `当前以${xMetric.label} ${proteinOrigin}${xMetric.unit} / ${yMetric.label} ${fatOrigin}${yMetric.unit}为参考线。仅视觉基准，不是合格线或评分；刻度是实际值。绘制${points.length}款，${rows.length-allPoints.length}款因所选指标缺数值不绘制（列表保留）。悬停或聚焦看名称；在空白处按住拖动可框选一块范围统计其中品牌数与产品数（Esc 清除）；点图例筛选全部视图，再点取消。同点多款显示数量，混合类别为深蓝。${axes.color === 'theme' ? '多主题单列，不任选一个主题；文字命中不证明功效。' : axes.color === 'group' ? '多个分组单列，不任选一个分组。' : ''}${axes.size === 'pricePerJin' ? '点面积按参考价缩放；同点取已知价均值，缺价用小点虚线，不是低价或销量。' : ''}${axes.size === 'pricePerJin' || [axes.x,axes.y].includes('pricePerJin') ? '价格是工作簿参考记录，不是实时售价；范围/含糊价无精确值，规格对应未明确仍仅供参考。' : ''}`;
    const groupsByPosition = new Map();
    $('chart-hint').textContent = $('chart-hint').textContent.replace('刻度是实际值。','刻度显示记录值，不代表实测含量；保证下限与上限不能当成实际高低比较。');
    if(conditionChart) $('chart-hint').textContent='仅绘制已选且符合当前筛选的产品；'+$('chart-hint').textContent+' 条件匹配只对当前用户参数负责，不是产品品质。缺总分不画，但仍可在比较中看分项与缺项原因。';
    points.forEach(p => {
      const key = `${p[axes.x]}|${p[axes.y]}`;
      if (!groupsByPosition.has(key)) groupsByPosition.set(key, []);
      groupsByPosition.get(key).push(p);
    });
    const groups = [...groupsByPosition.values()];
    const host = $('scatter');
    if (!points.length) { host.innerHTML = '<div class="empty-state">'+(conditionChart?'所选产品暂无有效条件总分或被当前筛选排除。先在“评分与权重”设置条件，缺项看分项表；不生成占位点。':'当前结果没有同时具备所选两项数值的产品。')+'</div>'; return; }
    // 出图尺寸跟随实际可用宽度：固定 900×390 的 viewBox 在宽容器里会被
    // preserveAspectRatio 等比缩小并居中，两侧留白，窗口展开/最大化后图反而更小。
    // 这里让 viewBox 与容器同比，缩放比回到 1，图铺满可用宽度；高度按宽度微增并设上下限。
    const hostWidth = Math.round(host.clientWidth || host.getBoundingClientRect().width || 900);
    const W = Math.max(520, Math.min(2400, hostWidth));
    // 高度同时受视口高度约束，避免矮窗口里图表把可视区占满、必须滚动才能看到坐标轴。
    const heightRoom = Math.round((window.innerHeight || 900) * 0.5);
    const H = Math.max(320, Math.min(560, Math.round(W * 0.34), Math.max(320, heightRoom)));
    const margin = {left: 58, right: 24, top: 20, bottom: 48};
    renderScatter.lastWidth = W;
    // Data positions stay stable when the reference moves inside the same data range.
    const xd = limit && axes.x === 'pricePerJin' ? {min:0,max:limit,step:20} : scatter.domain(points.map(p => p[axes.x]), proteinOrigin, xMetric);
    const yd = limit && axes.y === 'pricePerJin' ? {min:0,max:limit,step:20} : scatter.domain(points.map(p => p[axes.y]), fatOrigin, yMetric);
    const { min: xmin, max: xmax } = xd, { min: ymin, max: ymax } = yd;
    const x = v => margin.left + (v-xmin)/(xmax-xmin)*(W-margin.left-margin.right);
    const y = v => H-margin.bottom - (v-ymin)/(ymax-ymin)*(H-margin.top-margin.bottom);
    let grid = '';
    const xStep = xd.step;
    for (let value = Math.ceil(xmin / xStep) * xStep; value <= xmax; value += xStep) {
      grid += `<line class="grid-line" x1="${x(value)}" y1="${margin.top}" x2="${x(value)}" y2="${H-margin.bottom}"/><text class="tick-label ${value === proteinOrigin ? 'reference-tick' : ''}" x="${x(value)}" y="${H-margin.bottom+20}" text-anchor="middle">${value}</text>`;
    }
    const yStep = yd.step;
    for (let value = Math.ceil(ymin / yStep) * yStep; value <= ymax; value += yStep) {
      grid += `<line class="grid-line" x1="${margin.left}" y1="${y(value)}" x2="${W-margin.right}" y2="${y(value)}"/><text class="tick-label ${value === fatOrigin ? 'reference-tick' : ''}" x="${margin.left-10}" y="${y(value)+4}" text-anchor="end">${value}</text>`;
    }
    const circles = groups.map((group, index) => {
      const p = group[0], grouped = group.length > 1;
      const cx = x(p[axes.x]), cy = y(p[axes.y]);
      const radius = scatter.radius(group,axes.size,sizeMax);
      const mixed = new Set(group.map(item => query.category(item,axes.color))).size > 1;
      const fill = mixed ? '#345d72' : scatter.color(query.category(p,axes.color),categories,axes.color);
      const missingSize = axes.size === 'pricePerJin' && group.some(item => !Number.isFinite(item.pricePerJin));
      const label = grouped
        ? `${group.length}款产品重叠，${positionText(p)}，查看产品列表`
        : `${p.brand}，${readableChartLabel(p)}，${positionText(p)}，查看详情`;
      return `<g><circle class="point ${grouped ? 'grouped-point' : ''}" data-group-index="${index}" cx="${cx}" cy="${cy}" r="${radius}" fill="${fill}" ${missingSize ? 'stroke-dasharray="2 2"' : ''} tabindex="0" role="button" aria-label="${esc(label)}"></circle>${grouped ? `<text class="group-count" x="${cx}" y="${cy + 3}" text-anchor="middle">${group.length}</text>` : ''}</g>`;
    }).join('');
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet" role="group" aria-label="各产品的蛋白与脂肪位置">${grid}<line class="reference-axis" x1="${x(Math.max(xmin,Math.min(xmax,proteinOrigin)))}" y1="${margin.top}" x2="${x(Math.max(xmin,Math.min(xmax,proteinOrigin)))}" y2="${H-margin.bottom}"/><line class="reference-axis" x1="${margin.left}" y1="${y(Math.max(ymin,Math.min(ymax,fatOrigin)))}" x2="${W-margin.right}" y2="${y(Math.max(ymin,Math.min(ymax,fatOrigin)))}"/><text class="axis-label" x="${(margin.left+W-margin.right)/2}" y="${H-8}" text-anchor="middle">粗蛋白 %</text><text class="axis-label" transform="translate(15 ${(margin.top+H-margin.bottom)/2}) rotate(-90)" text-anchor="middle">粗脂肪 %</text>${circles}<rect class="brush-rect" x="0" y="0" width="0" height="0"></rect></svg><div class="scatter-tooltip" id="scatter-tooltip" role="tooltip" hidden></div><div class="brush-count" id="brush-count" role="status" hidden></div>`;
    host.querySelectorAll('.axis-label')[0].textContent = `${xMetric.label} ${xMetric.unit}`;
    const referenceLines = host.querySelectorAll('.reference-axis');
    referenceLines[0].style.display = proteinOrigin < xmin || proteinOrigin > xmax ? 'none' : '';
    referenceLines[1].style.display = fatOrigin < ymin || fatOrigin > ymax ? 'none' : '';
    host.querySelectorAll('.axis-label')[1].textContent = `${yMetric.label} ${yMetric.unit}`;
    host.querySelector('svg').setAttribute('aria-label', `${xMetric.label}与${yMetric.label}的位置`);
    const tooltip = $('scatter-tooltip');
    const showTooltip = (node, group, event) => {
      const p = group[0];
      tooltip.innerHTML = group.length === 1
        ? `<strong>${esc(p.brand)} · ${esc(readableChartLabel(p))}</strong><span>${esc(positionText(p))}</span>`
        : `<strong>${group.length} 款同点产品 · ${esc(positionText(p))}</strong><span>${group.slice(0, 3).map(item => esc(`${item.brand} · ${readableChartLabel(item)}`)).join('<br>')}${group.length > 3 ? `<br>另有 ${group.length - 3} 款` : ''}</span><em>点击查看完整名单</em>`;
      tooltip.hidden = false;
      const sizeValues = group.map(item => item.pricePerJin).filter(Number.isFinite);
      const categoryText = [...new Set(group.map(item => query.category(item,axes.color)))].join('、');
      tooltip.insertAdjacentHTML('beforeend', `<span>${esc(categoryText)}${axes.color === 'theme' ? ` · ${esc([...new Set(group.flatMap(item => query.themes(item).map(key => query.themeLabels[key])))].join('、'))}` : ''}${axes.color === 'group' ? ` · ${esc([...new Set(group.flatMap(item => item.attributes?.comparison_tags || []))].join('、'))}` : ''}${axes.size === 'pricePerJin' ? ` · 已知价${sizeValues.length}/${group.length}款${sizeValues.length ? `，均值${numberShown(sizeValues.reduce((a,b)=>a+b,0)/sizeValues.length)}元/斤` : '，未按0定价'}` : ''}</span>`);
      const hostRect = host.getBoundingClientRect();
      const pointRect = node.getBoundingClientRect();
      const clientX = event?.clientX ?? (pointRect.left + pointRect.width / 2);
      const clientY = event?.clientY ?? pointRect.top;
      tooltip.style.left = `${Math.max(8, Math.min(clientX - hostRect.left + 12, hostRect.width - tooltip.offsetWidth - 8))}px`;
      tooltip.style.top = `${Math.max(8, Math.min(clientY - hostRect.top - tooltip.offsetHeight - 8, hostRect.height - tooltip.offsetHeight - 8))}px`;
    };
    host.querySelectorAll('[data-group-index]').forEach(node => {
      const group = groups[Number(node.dataset.groupIndex)];
      const activate = () => group.length === 1 ? openDetail(group[0].skuId) : openPointGroup(group);
      node.addEventListener('mouseenter', event => showTooltip(node, group, event));
      node.addEventListener('mousemove', event => showTooltip(node, group, event));
      node.addEventListener('mouseleave', () => { tooltip.hidden = true; });
      node.addEventListener('focus', () => showTooltip(node, group));
      node.addEventListener('blur', () => { tooltip.hidden = true; });
      node.addEventListener('click', activate);
      node.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
      });
    });
    bindBrush(host, groups, { W, H });
  }

  // D102 框选：按住左键在图上拖出一块矩形，实时统计框内品牌数与产品数，
  // 浮层贴在鼠标旁。松手保留统计，Esc 或点击空白清除。
  // 只读统计：不改筛选、不改数据、不写库；点圈仍走原本的详情/同点名单。
  function bindBrush(host, groups, { W, H }) {
    const svg = host.querySelector('svg');
    const rect = host.querySelector('.brush-rect');
    const counter = $('brush-count');
    if (!svg || !rect || !counter) return;
    const nodes = [...host.querySelectorAll('[data-group-index]')];
    // 圆心取自已渲染的 SVG 属性，避免二次换算出错；同点合并的多款按组整体计入。
    const centers = groups.map((group, index) => ({
      group,
      cx: Number(nodes[index]?.getAttribute('cx')),
      cy: Number(nodes[index]?.getAttribute('cy')),
    }));
    // viewBox 坐标与 CSS 像素可能不等（容器宽高与 viewBox 独立），换算需各自的比例。
    const toLocal = event => {
      const box = svg.getBoundingClientRect();
      return {
        x: (event.clientX - box.left) * (W / (box.width || W)),
        y: (event.clientY - box.top) * (H / (box.height || H)),
      };
    };
    const pointsIn = (x0, y0, x1, y1) => {
      const left = Math.min(x0, x1), right = Math.max(x0, x1);
      const top = Math.min(y0, y1), bottom = Math.max(y0, y1);
      return centers.filter(item =>
        Number.isFinite(item.cx) && item.cx >= left && item.cx <= right &&
        item.cy >= top && item.cy <= bottom);
    };
    let dragging = false, start = null, settled = false;

    const clearBrush = () => {
      // SVG 元素不认 HTML 的 hidden 属性，矩形一律用 class 控制显隐。
      rect.classList.remove('on');
      rect.setAttribute('width', '0');
      rect.setAttribute('height', '0');
      rect.classList.remove('set');
      counter.hidden = true;
      host.classList.remove('selecting');
      nodes.forEach(node => node.classList.remove('brush-dim', 'brush-hit'));
      dragging = false;
      settled = false;
      start = null;
    };
    const paint = (x0, y0, x1, y1, keep) => {
      const hits = pointsIn(x0, y0, x1, y1);
      const hitIndexes = new Set(hits.map(hit => centers.indexOf(hit)));
      rect.classList.add('on');
      rect.setAttribute('x', Math.min(x0, x1));
      rect.setAttribute('y', Math.min(y0, y1));
      rect.setAttribute('width', Math.abs(x1 - x0));
      rect.setAttribute('height', Math.abs(y1 - y0));
      rect.classList.toggle('set', Boolean(keep));
      nodes.forEach((node, index) => {
        const inBox = hitIndexes.has(index);
        node.classList.toggle('brush-hit', inBox);
        node.classList.toggle('brush-dim', !inBox && Boolean(keep));
      });
      // 品牌数按品牌去重；产品数按款计，同点重叠的多款各算一款。
      const skuCount = hits.reduce((n, hit) => n + hit.group.length, 0);
      const brandCount = new Set(hits.flatMap(hit => hit.group.map(p => p.brand))).size;
      counter.innerHTML =
        `<div class="brush-row"><span>品牌</span><b>${brandCount}</b></div>`
        + `<div class="brush-row"><span>产品</span><b>${skuCount}</b></div>`
        + (hits.length !== skuCount ? `<small>${hits.length} 个点位（含同点重叠）</small>` : '')
        + '<small>Esc 或点击空白处清除</small>';
      counter.hidden = false;
    };
    const placeCounter = event => {
      const hostRect = host.getBoundingClientRect();
      const width = counter.offsetWidth || 145;
      const height = counter.offsetHeight || 104;
      // 浮层贴在鼠标右下方；贴不下时翻到左上方，始终留在图内不被 overflow 裁掉。
      const left = Math.min(event.clientX - hostRect.left + 16, hostRect.width - width - 8);
      const top = Math.min(event.clientY - hostRect.top + 14, hostRect.height - height - 8);
      counter.style.left = `${Math.max(8, left)}px`;
      counter.style.top = `${Math.max(8, top)}px`;
    };

    svg.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      // 按在圆点上时不接管：让原本的点击/聚焦照常走，框选只从空白处起手。
      if (event.target.closest('.point')) return;
      dragging = true;
      settled = false;
      host.classList.add('selecting');
      counter.hidden = true;
      start = toLocal(event);
      svg.setPointerCapture?.(event.pointerId);
      paint(start.x, start.y, start.x, start.y, false);
      placeCounter(event);
      event.preventDefault();
    });
    svg.addEventListener('pointermove', event => {
      if (!dragging) return;
      const now = toLocal(event);
      paint(start.x, start.y, now.x, now.y, false);
      placeCounter(event);
    });
    const finish = event => {
      if (!dragging) return;
      dragging = false;
      host.classList.remove('selecting');
      svg.releasePointerCapture?.(event.pointerId);
      const now = toLocal(event);
      // 框选只从空白处起手，位移很小即视为误触，直接复原。
      if (Math.abs(now.x - start.x) <= 3 && Math.abs(now.y - start.y) <= 3) {
        clearBrush();
        return;
      }
      settled = true;
      paint(start.x, start.y, now.x, now.y, true);
      placeCounter(event);
    };
    svg.addEventListener('pointerup', finish);
    svg.addEventListener('pointercancel', clearBrush);
    // Esc 清除：挂在 svg 上时要求先点一下图区取得焦点，因此同时监听 window。
    const onKey = event => { if (event.key === 'Escape' && (dragging || settled)) clearBrush(); };
    svg.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onKey);
  }

  // 窗口尺寸变化后按新宽度重绘散点图：宽度变化不足 24px 不重画，避免拖动窗口时抖动；
  // 容器不可见（切到其他工作区）时宽度为 0，直接跳过。
  let scatterResizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(scatterResizeTimer);
    scatterResizeTimer = setTimeout(() => {
      if (!renderScatter.lastRows) return;
      const host = $('scatter');
      const width = host ? (host.clientWidth || 0) : 0;
      if (!width) return;
      if (Math.abs(width - (renderScatter.lastWidth || 0)) < 24) return;
      renderScatter(renderScatter.lastRows);
    }, 180);
  });

  function openPointGroup(group) {
    const first = group[0];
    $('detail-content').innerHTML = `<div class="detail-title"><p>散点图同一位置</p><h2 id="detail-title">${group.length} 款产品</h2><p>粗蛋白 ${numberShown(first.protein, '%')}，粗脂肪 ${numberShown(first.fat, '%')}</p></div><div class="group-list">${group.map(p => `<button class="group-product" type="button" data-group-detail="${p.skuId}"><strong>${esc(p.brand)} · ${esc(readableProductName(p))}</strong><span>${esc([p.series, p.flavor].filter(Boolean).join(' · '))}　参考单价 ${esc(priceText(p))} · ${esc(priceLabel(p))}</span></button>`).join('')}</div>`;
    $('detail-overlay').hidden = false;
    $('detail-content').querySelector('.detail-title p:last-child').textContent = positionText(first);
    $('detail-content').querySelectorAll('[data-group-detail]').forEach(button => button.addEventListener('click', () => openDetail(button.dataset.groupDetail)));
  }

  function metricCell(p, key) {
    if (key === 'productionMode') return `<td>${esc(query.productionMode(p))}</td>`;
    if (key === 'factory') {
      const fid = p.factoryProfileId;
      const fname = query.factoryName(p);
      return fid
        ? `<td class="factory-cell"><button type="button" class="cell-jump" data-jump-factory="${esc(fid)}" title="查看工厂情报：${esc(fname)}">${esc(fname)}</button></td>`
        : `<td class="factory-cell">${esc(fname)}</td>`;
    }
    if (key === 'brandFounded') return `<td class="intel-cell" title="${esc(p.brandFounded || '未记录品牌成立时间')}">${esc(p.brandFoundedShort || '—')}</td>`;
    if (key === 'factoryFounded') return `<td class="intel-cell" title="${esc(p.factoryFounded || '未记录工厂成立时间')}">${esc(p.factoryFoundedShort || '—')}</td>`;
    if (key === 'factoryScale') return `<td class="intel-cell" title="${esc(p.factoryScale || '未记录工厂规模')}">${esc(p.factoryScaleShort || '—')}</td>`;
    if (key === 'process') return `<td><span class="chip">${esc(p.process)}</span></td>`;
    if (key === 'function') {
      const evidence = query.evidenceFunctionEvidence(p);
      const basis = evidence.length ? '<small class="function-basis">有喂养/研究资料</small>' : '';
      return `<td class="function-cell" title="${esc(query.functionRaw(p) ? '底表人工填写' : evidence.length ? '有喂养/研究资料；详情区分页面展示、研究引用和非正式效果资料' : query.functionValues(p).length ? '由产品名/系列明确定位匹配' : '')}">${esc(query.functionValueSummary(p))}${basis}</td>`;
    }
    if (key === 'stage') return `<td>${esc(p.stage)}</td>`;
    if (key === 'imported') return `<td><span class="chip ${p.importStatus === '进口' ? 'imported-chip' : ''}">${esc(p.importStatus)}</span></td>`;
    return `<td class="metric-cell">${metricContent(p,key)}</td>`;
  }
  function metricContent(p,key) {
    const m = sorting.metric(p,key), warning = m.basis === '单位/分母待明确' ? '单位待明确' : m.basis === '分母/方法待明确' ? '口径待明确' : '';
    // D100：价格列不再在数值下方追加「规格待核 / 口径待核」小字（Charles：价格不需要增加描述）。
    // 信息一条没丢——口径状态并入悬停提示（title）与详情页「价格与规格」。
    const title = key === 'price'
      ? [tableView.tooltip(p,key), `${priceLabel(p)}（${priceStatusLabel(p)}）`].filter(Boolean).join('；')
      : tableView.tooltip(p,key);
    const text = m.value===null?'—':key==='price'?numberShown(m.value)+' 元/斤':sorting.display(m);
    return `<span tabindex="0" class="${m.value===null?'metric-missing':''}" title="${esc(title)}" aria-label="${esc(text+(title?'；'+title:''))}">${esc(text)}</span>${key !== 'price' && warning ? `<small class="metric-warning">${esc(warning)}</small>` : ''}`;
  }
  function rowHtml(p, columns) {
    const checked = selected.has(p.skuId) ? 'checked' : '';
    const evidence = themeEvidence(p) || [];
    const themeNote = evidence.length ? `<span class="theme-match">文本线索｜${evidence.map(item => esc(`${item.label}命中${item.source}：${item.excerpt}`)).join('；')}</span>` : '';
    const productMeta = productMetaParts(p);
    const coreTitle = (query.coreRaw(p) || (p.coreRoleStatus === 'candidate' ? '样板候选，未指定核心' : '未指定核心')) + '；' +
      (editorEnabled ? '勾选保存为核心，取消保存为非核心' : '只读；从本机编辑入口打开后可修改');
    return `<tr>
      <td><input class="compare-check" type="checkbox" data-sku="${p.skuId}" ${checked} aria-label="选择 ${esc(selectionName(p))}"></td>
      <td class="core-cell"><input class="core-check" type="checkbox" data-core-sku="${esc(p.skuId)}" ${p.coreRoleStatus === 'confirmed' ? 'checked' : ''} ${!editorEnabled || coreSavePending ? 'disabled' : ''} aria-label="核心产品 ${esc(p.brand)} · ${esc(selectionName(p))}" title="${esc(coreTitle)}"></td>
      <td class="brand-cell"><button type="button" class="cell-jump" data-jump-brand="${esc(p.brandId)}" title="查看品牌情报：${esc(p.brand)}">${esc(p.brand)}</button></td>
      <td class="product-cell"><strong>${esc(readableProductName(p))}</strong>${productMeta.length ? `<span>${esc(productMeta.join(' · '))}</span>` : ''}${themeNote}</td>
      ${columns.map(key=>metricCell(p,key)).join('')}
      <td><button class="detail-button" data-detail="${p.skuId}">详情</button>${editorEnabled ? ` <button class="detail-button" data-edit="${p.skuId}">编辑</button>` : ''}</td></tr>`;
  }

  const headerFilterDefinitions = {
    brand: {label:'品牌',type:'select',control:'brand'},
    product: {label:'产品',type:'search',control:'search'},
    process: {label:'工艺',type:'select',control:'process'},
    stage: {label:'阶段',type:'select',control:'stage'},
    imported: {label:'进口属性',type:'select',control:'imported'},
    function: {label:'功能',type:'select',control:'functionValue'},
    core: {label:'核心产品',type:'toggle'},
    productionMode: {label:'生产方式',type:'select',control:'productionMode'},
    factory: {label:'工厂名称',type:'select',control:'factoryName'},
    brandFounded: {label:'品牌创立',type:'select',control:'brandFounded'},
    factoryFounded: {label:'工厂成立',type:'select',control:'factoryFounded'},
    factoryScale: {label:'工厂规模',type:'select',control:'factoryScale'},
    protein: {label:'粗蛋白 %',type:'range',min:'proteinMin',max:'proteinMax',step:'0.1'},
    fat: {label:'粗脂肪 %',type:'range',min:'fatMin',max:'fatMax',step:'0.1'},
    price: {label:'参考价 元/斤',type:'range',min:'priceMin',max:'priceMax',step:'0.1'},
    phosphorus: {label:'磷',type:'range-mode',mode:'phosphorusMode',min:'phosphorusMin',max:'phosphorusMax',step:'0.01'},
    chloride: {label:'水溶性氯化物',type:'range-mode',mode:'chlorideMode',min:'chlorideMin',max:'chlorideMax',step:'0.01'},
    // D099：动物性原料 / 动物性蛋白本来就有左侧控件与口径下拉，只是表头没有入口——补上，不新增口径。
    animalIngredient: {label:'动物性原料 %',type:'range-mode',mode:'animalIngredientMode',min:'animalIngredientMin',max:'animalIngredientMax',step:'0.1'},
    animalProtein: {label:'动物性蛋白 %',type:'range-mode',mode:'animalProteinMode',min:'animalProteinMin',max:'animalProteinMax',step:'0.1'}
  };
  // D099：其余营养指标列（水分、钙、牛磺酸、各类维生素、能量、消化率……）原先能加入表头却没有任何筛选入口。
  // 这里按可添加列逐个补一组最低/最高输入：控件放在页面的隐藏容器里（不把筛选栏铺满），
  // 走的是同一套 controls → queryValues → query 链路，不是第二套查询。
  // 判定口径：只比较已记录的单值；口径不明或多值的记录不参与，不同基准不自动换算（与蛋白/脂肪一致）。
  for (const column of tableView.columns) {
    if (!column.metric || headerFilterDefinitions[column.key]) continue;
    const min = document.createElement('input'), max = document.createElement('input');
    min.type = 'number'; min.step = 'any'; max.type = 'number'; max.step = 'any';
    min.id = `metric-min-${column.key}`; max.id = `metric-max-${column.key}`;
    min.setAttribute('aria-label', `${column.label} 最低`); max.setAttribute('aria-label', `${column.label} 最高`);
    controls[`${column.key}Min`] = min; controls[`${column.key}Max`] = max;
    $('metric-range-controls').append(min, max);
    headerFilterDefinitions[column.key] = { label: column.label, type: 'range', min: `${column.key}Min`, max: `${column.key}Max`,
      step: '0.01', metricRange: true,
      hint: '按已记录的单值比较；口径不明、多值或未记录的都不参与，不同基准不自动换算。与其它筛选同时生效。' };
  }
  let openHeaderPopover = null;
  const headerFilterActive = key => {
    const definition = headerFilterDefinitions[key];
    if (!definition) return false;
    if (definition.type === 'toggle') return coreOnly;
    return [definition.control,definition.mode,definition.min,definition.max].filter(Boolean)
      .map(name => controls[name]?.value || '').some(Boolean);
  };
  // D098：表头筛选入口由「筛」字改为漏斗图标（原字符又丑又占位，Charles）。
  // 中文全称保留在 title / aria-label 上，读屏与悬停提示不变。
  const FILTER_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2.6 3.4h10.8l-4.1 4.9v4.5l-2.6-1.5V8.3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  const headerFilterButton = (key,label) => headerFilterDefinitions[key]
    ? `<button type="button" class="column-filter${headerFilterActive(key)?' is-active':''}" data-column-filter="${esc(key)}" aria-label="筛选${esc(label)}" title="筛选${esc(label)}" aria-haspopup="dialog">${FILTER_ICON}</button>`
    : '';
  function headerFilterOptions(control) {
    return [...controls[control].options].map(option => `<option value="${esc(option.value)}">${esc(option.textContent)}</option>`).join('');
  }
  function headerFilterMarkup(key) {
    const definition = headerFilterDefinitions[key];
    if (definition.type === 'toggle') return `<button type="button" class="secondary-button header-filter-toggle" data-header-filter-toggle aria-pressed="${coreOnly}">${coreOnly ? '当前：仅看核心产品' : '当前：全部产品'}</button><p class="theme-note">点按钮在「全部产品 / 仅人工确认核心」之间切换，与左侧筛选同步。</p>`;
    if (definition.type === 'select') return `<label>筛选${esc(definition.label)}<select data-header-filter-value>${headerFilterOptions(definition.control)}</select></label>`;
    if (definition.type === 'search') return `<label>查找${esc(definition.label)}<input data-header-filter-value type="search" value="${esc(controls[definition.control].value)}" placeholder="输入关键词"></label>`;
    const mode = definition.mode ? `<label>比较口径<select data-header-filter-mode>${headerFilterOptions(definition.mode)}</select></label>` : '';
    return `${mode}<div class="header-filter-range"><label>最低<input data-header-filter-min type="number" step="${definition.step}" value="${esc(controls[definition.min].value)}" placeholder="不限"></label><span>—</span><label>最高<input data-header-filter-max type="number" step="${definition.step}" value="${esc(controls[definition.max].value)}" placeholder="不限"></label></div>`;
  }
  function closeHeaderFilter() {
    openHeaderPopover?.remove();
    openHeaderPopover = null;
  }
  function applyHeaderFilter(key,popover,clear = false) {
    const definition = headerFilterDefinitions[key];
    if (definition.type === 'toggle') {
      if (clear) setCoreOnly(false);
    } else if (definition.type === 'select' || definition.type === 'search') {
      controls[definition.control].value = clear ? '' : popover.querySelector('[data-header-filter-value]').value;
      if (definition.control === 'search') $('list-search').value = controls.search.value;
    } else {
      if (definition.mode) controls[definition.mode].value = clear ? '' : popover.querySelector('[data-header-filter-mode]').value;
      controls[definition.min].value = clear ? '' : popover.querySelector('[data-header-filter-min]').value;
      controls[definition.max].value = clear ? '' : popover.querySelector('[data-header-filter-max]').value;
    }
    closeHeaderFilter();
    filterChanged();
  }
  function openHeaderFilter(key,anchor) {
    closeHeaderFilter();
    const definition = headerFilterDefinitions[key];
    if (!definition) return;
    const popover = document.createElement('div');
    popover.className = 'header-filter-popover';
    popover.setAttribute('role','dialog');
    popover.innerHTML = `<strong>筛选${esc(definition.label)}</strong>${headerFilterMarkup(key)}<p>${esc(definition.hint || '与左侧筛选同步；先筛选，再排序和分页。')}</p><div class="header-filter-actions"><button type="button" class="text-button" data-header-filter-clear>清除</button><button type="button" class="primary-button" data-header-filter-apply>应用</button></div>`;
    document.body.append(popover);
    const rect = anchor.getBoundingClientRect(), width = Math.min(300,window.innerWidth - 24);
    popover.style.width = `${width}px`;
    const left = Math.max(12,Math.min(rect.left,window.innerWidth - width - 12));
    const below = rect.bottom + 6, top = below + popover.offsetHeight <= window.innerHeight - 12 ? below : Math.max(12,rect.top - popover.offsetHeight - 6);
    popover.style.left = `${left}px`; popover.style.top = `${top}px`;
    if (definition.type === 'select') popover.querySelector('[data-header-filter-value]').value = controls[definition.control].value;
    if (definition.type === 'range-mode') popover.querySelector('[data-header-filter-mode]').value = controls[definition.mode].value;
    if (definition.type === 'toggle') {
      const toggle = popover.querySelector('[data-header-filter-toggle]');
      const syncToggle = () => { toggle.setAttribute('aria-pressed', String(coreOnly)); toggle.textContent = coreOnly ? '当前：仅看核心产品' : '当前：全部产品'; };
      syncToggle();
      toggle.addEventListener('click', () => { setCoreOnly(!coreOnly); syncToggle(); });
    }
    popover.querySelector('[data-header-filter-apply]').addEventListener('click',() => applyHeaderFilter(key,popover));
    popover.querySelector('[data-header-filter-clear]').addEventListener('click',() => applyHeaderFilter(key,popover,true));
    openHeaderPopover = popover;
  }

  function renderTable(rows) {
    const sortKey = $('list-sort').value;
    const sorted = sorting.sortRows(rows, sortKey, tableState.secondary);
    const metric = sorting.sortDefinition(sortKey);
    const readingNotes = {
      phosphorus:'按磷标示值排序：保证下限较低，不代表实际磷更低；生命阶段和标示标准可能不同。',
      chloride:'水溶性氯化物以Cl计，不等于食盐或钠含量；不能据此判断咸度。',
      calcium:'钙的保证下限不是实测值；钙、磷两个最低保证值相除不代表实际钙磷比。',
      price:'参考价不是实时到手价；请核对报价日期、渠道、规格及优惠条件。元/斤不等于每日喂养成本。',
      pagePrice:'页面价格可能对应不同包装或组合；先核对净重和购买数量，再比较价格。',
      animalIngredient:'动物性原料添加比例不等于动物性蛋白占比；鲜肉与肉粉的含水量不同。',
      animalProtein:'先确认是否指动物性蛋白占总蛋白的比例；不要与动物性原料添加比例混比。',
      pepsinDigest:'胃蛋白酶消化率不等于动物喂养试验的消化率；不同方法不能仅按百分比排名。',
      tractDigest:'消化率需核对测定对象、方法与试验条件；不能直接等同每只猫的吸收率。',
      stage:'生命阶段是适用范围，不是品质等级；不同阶段的营养标示下限可能不同。',
      core:'核心产品由Charles人工确定，是重点比较范围，不代表销量或品质排名。'
    };
    $('metric-reading-note').textContent = readingNotes[metric?.key] || '参考价不是实时售价；≥ / ≤ 是保证下限 / 上限，不是实测值。空白不代表零。';
    const columns = tableView.effective(tableState,queryValues());
    $('page-size').value = String(pageSize);
    renderColumnOptions();
    const isPrimary = key=>tableState.sort===key || tableState.sort.startsWith(key+'-');
    // D098：未排序不再渲染「↕」（常驻占位，Charles：很占位子）；已排序只留一个窄箭头，
    // 次级排序用更小更淡的箭头区分，不再带「²」上标。排序状态另有 aria-sort 与整格底色可辨。
    const arrow = key=>isPrimary(key)?(tableState.sort.endsWith('-desc')?'↓':'↑'):tableState.secondary.startsWith(key+'-')?(tableState.secondary.endsWith('-desc')?'↓':'↑'):'';
    const sortMark = key=>arrow(key)?`<span class="sort-mark${isPrimary(key)?' is-primary':' is-secondary'}" aria-hidden="true">${arrow(key)}</span>`:'';
    const sortButton = (key,label)=>`<button type="button" class="column-sort" data-column-sort="${key}" aria-label="按${esc(label)}排序" title="按${esc(label)}排序：正序 → 倒序 → 原始顺序">${esc(label)}${sortMark(key)}</button>`;
    const head = (key,label)=>`<th scope="col" ${isPrimary(key)?`aria-sort="${tableState.sort.endsWith('-desc')?'descending':'ascending'}"`:''}><div class="table-heading-tools">${sortButton(key,label)}${headerFilterButton(key,label)}</div></th>`;
    // Drag-to-reorder: only explicit user columns are draggable (fixed identity columns
    // 比较/核心/品牌/产品/操作 keep their position; auto columns are not in state.columns).
    const dragHead = (key,label)=>tableView.draggable(tableState,key)
      ? `<th scope="col" class="column-draggable" draggable="true" data-column-key="${key}" title="拖动调整列顺序" ${isPrimary(key)?`aria-sort="${tableState.sort.endsWith('-desc')?'descending':'ascending'}"`:''}><div class="table-heading-tools"><span class="column-grip" aria-hidden="true">⠿</span>${sortButton(key,label)}${headerFilterButton(key,label)}</div></th>`
      : head(key,label);
    $('product-head').innerHTML = '<th scope="col">比较</th>' + (visitorMode ? '' : head('core','核心')) + head('brand','品牌') + head('product','产品') +
      columns.map(key=>{const d=tableView.columns.find(d=>d.key===key);return dragHead(key,d.label);}).join('') + '<th scope="col">操作</th>';
    const secondary = sorting.sortDefinition(tableState.secondary);
    const missing = metric && sorting.definition(sortKey) ? ` · ${rows.filter(p=>sorting.metric(p,metric.key).value===null).length}款缺失在后` : '';
    $('sort-note').textContent = metric ? `按${metric.label}${sortKey.endsWith('-desc')?' ↓':' ↑'}${secondary?` · 同值按${secondary.label}${tableState.secondary.endsWith('-desc')?' ↓':' ↑'}`:''}${missing}。表头点击：正序 → 倒序 → 原始顺序。`
      : '原始顺序 · 所有数据表头均可排序：正序 → 倒序 → 原始顺序（文字按名称顺序）。';
    $('reset-sort').disabled = sortKey==='source';
    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    currentPage = Math.min(currentPage, totalPages);
    const start = (currentPage - 1) * pageSize;
    const visible = sorted.slice(start, start + pageSize);
    visibleSkus = visible.map(p => p.skuId);
    $('result-count').textContent = rows.length;
    $('product-rows').innerHTML = visible.map(p => rowHtml(p, columns)).join('');
    $('mobile-product-cards').innerHTML = visible.map(p=>`<article class="mobile-product-card">
      <p class="mobile-product-brand">${esc(p.brand)}${p.series?' · '+esc(p.series):''}</p>
      <h3><button type="button" class="text-button" data-detail="${esc(p.skuId)}">${esc(readableProductName(p))}</button></h3>
      <p class="mobile-product-meta">${esc([p.flavor,p.stage,p.process].filter(Boolean).join(' · '))}</p>
      <dl><div><dt>参考价</dt><dd>${metricContent(p,'price')}</dd></div><div><dt>粗蛋白</dt><dd>${metricContent(p,'protein')}</dd></div><div><dt>粗脂肪</dt><dd>${metricContent(p,'fat')}</dd></div></dl>
      <div class="mobile-product-actions"><label><input type="checkbox" class="compare-check" data-sku="${esc(p.skuId)}" ${selected.has(p.skuId)?'checked':''}> 加入比较</label><button type="button" class="secondary-button" data-detail="${esc(p.skuId)}">查看详情</button></div>
    </article>`).join('');
    $('empty-state').hidden = rows.length > 0;
    $('list-pager').hidden = rows.length === 0;
    $('page-status').textContent = `第 ${currentPage} / ${totalPages} 页 · 显示 ${sorted.length ? start + 1 : 0}–${Math.min(start + pageSize, sorted.length)} / ${sorted.length} 款`;
    $('prev-page').disabled = currentPage === 1;
    $('next-page').disabled = currentPage === totalPages;
    $('pending-import').setAttribute('aria-pressed', String(controls.imported.value === '待核验'));
    syncCoreToggle();
    document.querySelectorAll('.compare-check').forEach(box => box.addEventListener('change', event => {
      const sku = event.target.dataset.sku;
      if (event.target.checked) selected.add(sku); else selected.delete(sku);
      updateCompareState(); renderTable(filteredProducts());
    }));
    document.querySelectorAll('[data-detail]').forEach(button => button.addEventListener('click', () => openDetail(button.dataset.detail)));
    document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => openEditor(button.dataset.edit)));
    document.querySelectorAll('[data-jump-brand]').forEach(button => button.addEventListener('click', () => {
      rememberLibraryView();
      setWorkspace('intel');
      const ok = window.PetFoodIntelNav?.showBrand(button.dataset.jumpBrand);
      if (ok === false) $('core-quick-status').textContent = '未找到该品牌的情报档案。';
    }));
    document.querySelectorAll('[data-jump-factory]').forEach(button => button.addEventListener('click', () => {
      rememberLibraryView();
      setWorkspace('intel');
      const ok = window.PetFoodIntelNav?.showFactory(button.dataset.jumpFactory);
      if (ok === false) $('core-quick-status').textContent = '未找到该工厂的情报档案。';
    }));
    updateCompareState();
  }

  $('product-rows').addEventListener('change', async event => {
    const box = event.target.closest('[data-core-sku]');
    if (!box) return;
    const p = products.find(item=>item.skuId === box.dataset.coreSku);
    if (!p) return;
    const coreRole = box.checked ? 'confirmed' : 'excluded';
    box.checked = p.coreRoleStatus === 'confirmed';
    if (!editorEnabled || coreSavePending) return;
    coreSavePending = true;
    const name = `${p.brand} · ${selectionName(p)}`;
    $('core-save-status').textContent = `正在保存 ${name} 的核心选择…`;
    renderTable(filteredProducts());
    let saved = false;
    try {
      const response = await fetch('/api/batch-core', {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({skuIds:[p.skuId],coreRole,expectedRoles:{[p.skuId]:p.coreRoleStatus}})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '保存失败');
      saved = true;
      const latest = await fetch('/api/data', {cache:'no-store'});
      if (!latest.ok) throw new Error('看板刷新失败');
      const updated = await latest.json();
      if (!Array.isArray(updated.products)) throw new Error('看板数据不完整');
      data = updated; products = data.products; rebindAssoc(); syncSortControls(); refreshOptions();
      $('core-save-status').textContent = `已保存 ${name}：${coreRole === 'confirmed' ? '核心' : '非核心'}；Excel旧版与修改记录已保留。`;
    } catch (error) {
      $('core-save-status').textContent = saved ? `已保存 ${name}，但${error.message}；请刷新页面核对。`
        : `未确认保存 ${name}：${error.message}。请刷新后核对当前状态。`;
      // A lost response or concurrent change cannot be resolved from the stale local snapshot.
      editorEnabled = false; refreshOptions();
      $('mode-help').textContent = '本次核心保存状态需要刷新核对；当前暂以只读显示。';
    } finally {
      coreSavePending = false; render();
    }
  });

  function updateCompareState() {
    $('compare-count').textContent = selected.size;
    $('open-compare').disabled = selected.size < 2 || selected.size > 6;
    $('batch-core').disabled = selected.size === 0 || coreSavePending;
    const matching = new Set(filteredProducts().map(p => p.skuId));
    const outside = [...selected].filter(sku => !matching.has(sku)).length;
    $('selection-status').textContent = selected.size ? `已选 ${selected.size} 款${outside ? `（${outside}款不在当前筛选内）` : ''}${selected.size === 1 ? ' · 再选1款即可比较' : ''}${selected.size > 6 ? ' · 超过6款仅可批量设置，比较请缩小选择' : ''}` : '尚未选择产品';
    $('clear-selection').disabled = selected.size === 0;
    $('select-page').disabled = visibleSkus.length === 0;
    $('workspace-selection').textContent = selected.size ? `已选 ${selected.size} 款 · 切换工作区保留` : '未选产品 · 在产品库勾选后比较';
    selectionBar.hidden = selected.size === 0;
    $('selection-analysis').disabled = !workspaces.canCompare(selected.size);
    const chosen = products.filter(p=>selected.has(p.skuId));
    $('selected-products').innerHTML = chosen.slice(0,6).map(p=>`<button class="selected-product" type="button" data-remove-selected="${esc(p.skuId)}" aria-label="移除已选 ${esc(selectionName(p))}">${esc(p.brand)} · ${esc(readableProductName(p))}<span aria-hidden="true"> ×</span></button>`).join('') + (chosen.length > 6 ? `<small>另${chosen.length-6}款；比较最多6款</small>` : '');
    $('selected-products').querySelectorAll('[data-remove-selected]').forEach(b=>b.addEventListener('click',()=>{selected.delete(b.dataset.removeSelected);renderTable(filteredProducts());}));
    renderComparison();
    trialUI.render();
    autoUI.render();
    selectionLab.render();
  }

  function detailRawValue(key, value) {
    const ratioKeys = ['animal_ingredient_ratio_raw','animal_protein_ratio_raw','total_tract_digestibility_raw','pepsin_digestibility_raw'];
    const numeric = typeof value === 'number' ? value : (/^\s*\d+(?:\.\d+)?\s*$/.test(String(value)) ? Number(value) : NaN);
    if (ratioKeys.includes(key) && Number.isFinite(numeric) && numeric >= 0 && numeric <= 100)
      return `${numberShown(numeric <= 1 ? numeric * 100 : numeric)}%`;
    return value;
  }

  async function openDetail(skuId) {
    try { await window.PFDSRelease.detail(skuId); } catch(e) { alert(e.message); return; }
    const p = products.find(item => item.skuId === skuId); if (!p) return;
    const d = p.details || {};
    const has = value => value !== null && value !== undefined && String(value).trim() !== '';
    const text = value => has(value) ? String(value) : '';
    const section = (title, body, extra = '') => `<section class="detail-section reading-section ${extra}"><h3>${title}</h3>${body}</section>`;
    const rawSection = (title, key) => has(d[key]) ? section(title, `<p>${esc(d[key])}</p>`) : '';
    const fields = pairs => `<dl class="reading-fields">${pairs.filter(([,v])=>has(v)).map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
    const quote = window.PetFoodSample.pricing(p);
    const sourcePath = `${data.meta.sourceRoot.replace(/\/$/, '')}/${p.source.file}`;
    const functional = query.functionEvidenceGroups(p);
    const cleaned = PFDSCleaning.inspect(p);
    const cleaningSection = `<details class="detail-section"><summary>名称与规格整理记录</summary><p>易读名称：${esc(cleaned.displayName)}\n底稿名称：${esc(cleaned.rawName)}\n${esc(cleaned.packaging.interpretation)}</p>${cleaned.issues.map(x=>`<p>${esc(x)}</p>`).join('')}</details>`;
    const sourceNotes = p.sourceNotes ? `<details class="detail-section"><summary>整理出处与待确认项</summary><p>${p.sourceNotes.state === 'stale' ? '原文已更新，以下出处对应旧记录。' : '以下为资料整理出处。'}</p><p>${esc(p.sourceNotes.notes['说明'])}</p>${fields(Object.entries(p.sourceNotes.notes['字段出处'] || {}))}${(p.sourceNotes.notes['待确认'] || []).map(q=>`<p>${esc(q)}</p>`).join('')}</details>` : '';
    const nameHistory = p.nameHistory?.length ? `<details class="detail-section"><summary>旧名称与纠错记录</summary>${p.nameHistory.map(h=>`<p>${esc(h.product)} · ${esc(h.flavor || '')}<br>${esc(h.changedAt)} · ${esc(h.reason)}</p>`).join('')}</details>` : '';

    // Only reorganize source text: never infer a guarantee sign or convert its basis.
    const guarantees = [];
    for (const [label,key] of [['粗蛋白','protein_raw'],['粗脂肪','fat_raw']]) {
      if (!has(d[key])) continue;
      const value = text(d[key]).trim();
      guarantees.push([label, /^([≥≤<>]=?\s*)?\d+(\.\d+)?$/.test(value) ? value + '%' : value]);
    }
    const guaranteeNotes = [];
    for (const part of sorting.splitGuarantees(text(d.other_guaranteed_analysis_raw))) {
      const match = part.match(/^(.+?)\s*([≥≤<>＝=].*)$/) || part.match(/^([^\d]+?)\s*(\d.*)$/);
      if (match && !/标注|除水|基准|物质|标准|注[:：]/.test(match[1])) guarantees.push([match[1].trim(),match[2]]);
      else guaranteeNotes.push(part);
    }
    const nutrition = section('营养成分与保证值',
      guarantees.length ? fields(guarantees) + `${guaranteeNotes.length ? `<p class="reading-note">${guaranteeNotes.map(esc).join('；')}</p>` : ''}<p class="reading-note">保留资料中的 ≥ / ≤；未标符号的数值不推定为最低或最高值。蛋白、脂肪等只有数值而没有比较符时，也不代表实测值，需以包装或检测报告的原文为准。</p>` : '<p class="reading-note">暂无营养成分记录。</p>');
    const ratios = [
      ['动物性原料占比','animal_ingredient_ratio_raw'],['动物性蛋白占比','animal_protein_ratio_raw'],
      ['全肠道粗蛋白质消化率','total_tract_digestibility_raw'],['胃蛋白酶消化率','pepsin_digestibility_raw']
    ].filter(([,key])=>has(d[key])).map(([label,key])=>[label,detailRawValue(key,d[key])]);
    const ratioSection = ratios.length ? section('动物性成分与消化率', fields(ratios)) : '';

    const quotePairs = [['包装规格',PFDSCleaning.brief(p.packageSize)],['参考总价（元）',p.activeQuote?.total ?? p.pagePriceRaw],
      ['报价对应包装',p.activeQuote ? `${p.activeQuote.package} · ${p.activeQuote.grams}g × ${p.activeQuote.quantity}` : ''],
      ['记录日期',p.activeQuote?.date],['渠道',p.activeQuote?.channel],['优惠条件',p.activeQuote?.conditions]];
    const quoteSection = section('规格与价格', fields(quotePairs) +
      `<p class="reading-note">${priceStatusLabel(p)==='规格待核' ? '报价对应的包装尚待确认。' : ''}价格随渠道与活动变化，以购买时为准。</p>`);
    const hasFunction = query.functionValues(p).length > 0;
    const study = /^(无|未记录|暂无|未填写|—|-)$/.test(text(d.feeding_study_raw).trim()) ? '' : text(d.feeding_study_raw);
    const functionSection = hasFunction || study || functional.length ? section('功能与喂养研究',
      `${hasFunction ? `<p class="reading-function">${esc(query.functionValueSummary(p))}</p>` : ''}
      ${study ? `<p>${esc(study)}</p>` : functional.map(item=>`<p>${esc(item.excerpt || item.raw || item.source)}</p>`).join('')}
      <p class="reading-note">功能定位与研究资料不等同于每只猫的实际效果。</p>
      ${functional.length ? `<details class="reading-evidence"><summary>查看功能依据与来源</summary>${functional.map(item=>`<p><strong>${esc(item.labels.join(' / '))}</strong> · ${esc(item.source)}</p><p>${esc(item.excerpt || item.raw)}</p>${item.reference ? `<p class="source-path">${esc(item.reference)}</p>` : ''}${item.limitation ? `<p class="reading-note">${esc(item.limitation)}</p>` : ''}`).join('')}</details>` : ''}`) : '';
    const production = section('生产与品牌', fields([
      ['生产方式',query.productionMode(p)],['生产工厂',query.factoryName(p)],['产地属性',p.importStatus],['保质期',d.shelf_life_raw]
    ]) + `<div class="reading-links"><button class="secondary-button" id="detail-brand-intel" type="button">品牌介绍 →</button>${p.factoryProfileId ? '<button class="secondary-button" id="detail-factory-intel" type="button">工厂介绍 →</button>' : ''}</div>`);
    const originalKeys = [
      ['产品形态','format_raw'],['工艺说明','process_claim_raw'],['页面卖点','marketing_claims_raw'],
      ['原料溯源','traceability_raw'],['工厂与进口资料','factory_import_raw'],
      ['研发资料','rd_capability_raw'],['品牌背书','brand_endorsement_raw']
    ];
    const marketInfo = has(d.brand_positioning_raw)||has(d.market_position_raw)
      ? section('定位与市场表现', fields([['产品定位',d.brand_positioning_raw],['市场表现',d.market_position_raw]])+'<p class="reading-note">以上为资料中的定位与市场描述，请留意统计时期及产品范围；销量与排名不代表本款品质。更多出处见“品牌介绍”。</p>') : '';
    const originals = `<details class="detail-section reading-originals"><summary>补充资料与原文</summary>
      ${fields([['完整产品名',p.product],['系列原文',p.series],['口味原文',p.flavor],['规格原文',p.packageSize],['适用阶段原文',p.stageRaw],['产品形态',p.formatRaw]])}
      ${originalKeys.filter(([,key])=>has(d[key])).map(([label,key])=>rawSection(label,key)).join('')}
      ${rawSection('保证值原文（其余指标）','other_guaranteed_analysis_raw')}
      ${p.activeQuote?.sourceText ? `<p>报价来源：${esc(p.activeQuote.sourceText)}</p>` : ''}
    </details>`;
    const maintenance = `<details class="detail-section reading-maintenance"><summary>内部维护信息</summary>
      <div class="source-box">brand_id: ${esc(p.brandId)}<br>series_id: ${esc(p.seriesId)}<br>sku_id: ${esc(p.skuId)}<br>formula_version: ${esc(p.formulaVersion)}<br>工作表：产品信息 · 第 ${p.source.row} 行<br><span class="source-path">${esc(sourcePath)}</span></div>
      ${fields([['核心产品',query.coreRaw(p)],['进口确认',p.importConfirmation ? JSON.stringify(p.importConfirmation) : ''],['进口原始分类',p.importStatusRule],['价格记录口径',quote.arithmetic]])}
      ${cleaningSection}${sourceNotes}${nameHistory}
      <button class="secondary-button copy-source" id="copy-source" type="button">复制工作簿路径</button>
      ${editorEnabled ? '<button class="secondary-button" id="detail-verification" type="button">查看核验项</button><button class="primary-button detail-edit" id="detail-edit" type="button">编辑这款产品</button>' : ''}
    </details>`;
    const badges = [p.stage, p.process, p.importStatus, query.coreRaw(p)==='是' ? '核心产品' : ''].filter(Boolean);
    $('detail-content').innerHTML = `<div class="detail-title"><p class="reading-brand">${esc(p.brand)}</p>
      <h2 id="detail-title">${esc(readableProductName(p))}</h2>
      <div class="reading-badges">${badges.map(b=>`<span>${esc(b)}</span>`).join('')}</div>
      ${editorEnabled ? '<button class="secondary-button detail-edit-top" id="detail-edit-top" type="button">编辑资料</button>' : ''}
      </div>
      <div class="detail-metrics"><div class="metric"><span>粗蛋白</span><strong>${numberShown(p.protein,'%')}</strong></div><div class="metric"><span>粗脂肪</span><strong>${numberShown(p.fat,'%')}</strong></div><div class="metric"><span>参考价 · 元/斤</span><strong>${esc(priceText(p))}</strong></div></div>
      ${marketInfo}${quoteSection}${nutrition}${rawSection('配料 · 按原始顺序','ingredients_raw')}${rawSection('营养添加剂','additives_raw')}${ratioSection}
      ${functionSection}${production}${originals}${visitorMode ? '' : maintenance}`;
    $('detail-overlay').hidden = false;
    $('detail-overlay').querySelector('.drawer').scrollTop = 0;
    if(editorEnabled) $('detail-edit-top').onclick=()=>openEditor(skuId);
    $('copy-source')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(sourcePath);
        $('copy-source').textContent = '已复制路径';
      } catch {
        $('copy-source').textContent = '复制失败，请手动选中上方路径';
      }
    });
    if (editorEnabled) $('detail-edit').addEventListener('click', () => openEditor(skuId));
    $('detail-brand-intel').addEventListener('click', () => {
      $('detail-overlay').hidden = true;
      setWorkspace('intel');
      window.PetFoodIntelNav?.showBrand(p.brandId);
    });
    if (p.factoryProfileId) $('detail-factory-intel').addEventListener('click', () => {
      $('detail-overlay').hidden = true;
      setWorkspace('intel');
      window.PetFoodIntelNav?.showFactory(p.factoryProfileId);
    });
    if (editorEnabled) $('detail-verification').addEventListener('click', () => {
      $('detail-overlay').hidden = true;
      awaitVerificationPanel();
      $('verification-search').value = p.product;
      $('verification-priority').value = '';
      $('verification-field').value = '';
      $('verification-status').value = '';
      verificationPage = 1;
      renderVerification();
    });
  }

  const editFields = [
    ['page_price_raw', '页面价格（元）'], ['price_per_jin_raw', '元/斤'],
    ['protein_raw', '蛋白质（%）'], ['fat_raw', '脂肪（%）'],
    ['life_stage_raw', '适用阶段原文'], ['format_raw', '产品形态原文'], ['function_raw','功能'],
    ['production_mode_raw','生产方式'], ['factory_name_raw','工厂名称'],
    ['package_size_raw', '包装规格原文'],
    ['factory_import_raw', '工厂 / 进口信息原文'],
    ['ingredients_raw', '配料原文（原始顺序）'], ['additives_raw', '营养添加剂原文'],
    ['marketing_claims_raw', '页面卖点 / 声称原文'], ['other_guaranteed_analysis_raw', '其他保证值原文'],
    ['process_claim_raw', '工艺 / 官方原话'], ['shelf_life_raw', '保质期（未开封）'],
    ['animal_ingredient_ratio_raw', '动物性原料占比'], ['animal_protein_ratio_raw', '动物性蛋白占比'],
    ['total_tract_digestibility_raw', '全肠道粗蛋白质消化率'], ['pepsin_digestibility_raw', '胃蛋白酶消化率'],
    ['feeding_study_raw', '正式喂养实验 / 研究信息'], ['traceability_raw', '原料溯源'],
    ['brand_positioning_raw', '品牌定位原文'], ['market_position_raw', '市场地位原文'],
    ['rd_capability_raw', '研发能力原文'], ['brand_endorsement_raw', '品牌背书原文']
  ];
  const shortEditFields = new Set(['page_price_raw','price_per_jin_raw','protein_raw','fat_raw','life_stage_raw','format_raw','function_raw','package_size_raw','shelf_life_raw']);

  async function openEditor(skuId) {
    if (!editorEnabled || coreSavePending) return;
    const p = products.find(item => item.skuId === skuId); if (!p) return;
    $('detail-overlay').hidden = true;
    const inputs = editFields.filter(([key])=>key!=='function_raw').map(([key, label]) => {
      const value = esc(p.details[key] ?? '');
      const control = key === 'production_mode_raw'
        ? `<select name="${key}">${['','自有','代工'].map(mode=>`<option value="${mode}" ${mode === String(p.details[key] ?? '') ? 'selected' : ''}>${mode || '未填写（空白）'}</option>`).join('')}</select>`
        : key === 'factory_name_raw' ? `<input name="${key}" type="text" maxlength="500" value="${value}" placeholder="只填本款已知工厂；未知留空">`
        : !shortEditFields.has(key)
        ? `<textarea name="${key}" rows="4" maxlength="20000">${value}</textarea>`
        : `<input name="${key}" type="text" value="${value}">`;
      return `<label class="edit-field"><span>${label}</span>${control}${['production_mode_raw','factory_name_raw'].includes(key) ? '' : `<small>当前：${esc(shown(p.details[key]))}</small>`}</label>`;
    });
    const mainInputs = inputs.slice(0, 14).join('');
    const moreInputs = inputs.slice(14).join('');
    const quoteFields = [['package','绑定包装','text'],['grams','单包装净重（g）','number'],['quantity','购买数量（袋/件）','number'],['total','实付总价（元）','number'],['date','报价日期（可选）','date'],['channel','渠道（可选）','text'],['conditions','优惠条件 / 赠品（可选）','text'],['sourceText','来源说明 / 链接（可选）','text']];
    const quoteInputs = `<section class="detail-section"><h3>明确包装参考报价</h3><p class="detail-help">填写包装、单包装净重、数量与总价。只计主包装，赠品写入条件，不自动计入净重。日期/渠道可留空；保存到品牌Excel“报价记录”，用于价格图、筛选与比较，原价原文不覆盖。</p><label class="edit-field"><span>本次报价操作</span><select name="quoteMode"><option value="keep">不改报价</option><option value="save">录入 / 更新报价</option><option value="withdraw">停用报价，回到原始参考价</option></select></label><div id="quote-inputs" class="edit-grid" hidden>${quoteFields.map(([key,label,type]) => `<label class="edit-field"><span>${label}</span><input name="quote_${key}" type="${type}" ${type === 'number' ? `min="${key === 'total' ? 0 : key === 'quantity' ? 1 : 0.001}" step="${key === 'quantity' ? 1 : 'any'}"` : 'maxlength="2000"'} value="${esc(p.activeQuote?.[key] ?? '')}" ${key === 'package' ? 'placeholder="如：1.5kg主包装"' : ''}></label>`).join('')}</div><p id="quote-calculation" class="detail-help"></p></section>`;
    $('edit-content').innerHTML = `<div class="detail-title"><p>${esc(p.brand)} · ${esc(p.series)}</p><h2 id="edit-title">编辑 ${esc(readableProductName(p))}</h2><p>底稿原名：${esc(p.product)} · 产品信息第 ${p.source.row} 行</p></div>
      <p class="edit-notice">原文修改先预览再保存，保留旧版。产品名与口味的录入纠错在下面展开，SKU身份不变；核心、生产方式和工厂名称写回本款Excel底稿，分组单独保存。规格与价格不自动互算。</p>
<form id="edit-form"><section class="detail-section"><h3>我的管理信息</h3><p class="detail-help">可自行创建分组，不用填原因或证据；这不是产品事实或功效判断。清空后保存可移除。</p>${attributeDefinitions.map(f => `<label class="edit-field"><span>${esc(f.displayName)}</span>${f.dataType === 'tags' ? `<input name="${esc(f.fieldKey)}" type="text" value="${esc(managementAttributes.values(p)[f.fieldKey].join('，'))}" placeholder="如：直播备选，日常对比"><small>逗号分隔，最多10个，每个30字；保存后可在高级筛选中选择。</small>` : `<textarea name="${esc(f.fieldKey)}" rows="3" maxlength="1000" placeholder="只记录你的比较备注">${esc(managementAttributes.values(p)[f.fieldKey])}</textarea><small>最多1000字，不自动成为审核或评分结论。</small>`}</label>`).join('')}</section><div class="edit-grid">${mainInputs}</div><details class="edit-guide"><summary>更多原文字段</summary><div class="edit-grid">${moreInputs}</div></details>
        <label class="edit-field"><span>进口 / 国产分类</span><select name="importStatus"><option value="">保持当前分类（${esc(p.importStatus)}）</option><option value="进口">进口</option><option value="国产">国产</option></select><small>直接选择即可，不必填写证据表；具体国家、工厂和手续不由此推导。</small></label>
        <label class="edit-field"><span>核心产品</span><select name="coreRole"><option value="">保持当前状态（${esc(p.coreRoleStatus === 'confirmed' ? '已确认核心' : p.coreRoleStatus === 'excluded' ? '已确认非核心' : p.coreRoleStatus === 'candidate' ? '样板候选' : '未指定')}）</option><option value="confirmed">确认是核心产品</option><option value="excluded">确认不是核心产品</option><option value="unknown">恢复未指定（底稿留空）</option></select><small>人工选择写回本款底稿；候选不会自动变为核心。</small></label>
        <label class="edit-field"><span>修改原因（改底稿原文时简短填写）</span><textarea name="reason" rows="2" placeholder="如：规格录入校正；只选分类/核心可留空"></textarea></label>
        <label class="edit-field"><span>证据位置或说明（可选）</span><input name="evidence" type="text" placeholder="截图文件名、包装批次、页面链接或人工确认说明"></label>
        <section class="edit-preview" id="edit-preview" aria-live="polite" hidden></section>
        <div class="edit-actions"><button class="secondary-button" id="cancel-edit" type="button">取消</button><button class="primary-button" id="save-edit" type="submit">预览改动</button></div><p id="edit-message" class="edit-message" role="status"></p>
      </form><section class="detail-section"><h3>最近修改记录</h3><div id="edit-history">正在读取…</div></section>`;
    $('edit-overlay').hidden = false;
    $('cancel-edit').addEventListener('click', () => { $('edit-overlay').hidden = true; openDetail(skuId); });
    let previewSignature = null;
    const form = $('edit-form');
    form.insertAdjacentHTML('afterbegin', `<details class="detail-section" id="name-correction"><summary>纠正产品名 / 口味</summary><p>仅用于同一款的录入纠错，不用于换产品或真实配方改版。旧名保留且可搜索；相关口径/试评会按依赖停用。</p><label class="edit-field"><span>产品名</span><input name="product_name" required maxlength="200" value="${esc(p.product)}"></label><label class="edit-field"><span>口味</span><input name="flavor" maxlength="200" value="${esc(p.flavor||'')}"></label></details>`);
    form.insertAdjacentHTML('afterbegin', quoteInputs);
    form.insertAdjacentHTML('afterbegin',analysis.editorHtml(p,esc));
    const functionOptions = [...new Set([...Object.values(query.functionLabels), ...products.flatMap(query.functionValues)])];
    form.insertAdjacentHTML('afterbegin',`<label class="edit-field function-editor"><span>功能</span><input name="function_raw" type="text" list="function-suggestions" maxlength="20000" value="${esc(query.functionRaw(p))}" placeholder="如：美毛健肤；毛球管理"><datalist id="function-suggestions">${functionOptions.map(value=>`<option value="${esc(value)}"></option>`).join('')}</datalist><small>底表人工填写优先；留空时显示明确名称定位或已核对来源的实验展示分类。多个功能用分号隔开。${query.functions(p).length ? `当前系统分类：${esc(query.functionSummary(p))}。` : '没有系统匹配，留空即可。'}</small></label>`);
    const updateAnalysisInputs=()=>{
      const mode=form.elements.analysisMode.value;
      $('analysis-input-fields').hidden=mode!=='save';
      for(const field of $('analysis-input-fields').querySelectorAll('input,select,textarea'))field.disabled=mode!=='save';
    };
    form.elements.analysisMode.addEventListener('change',updateAnalysisInputs);updateAnalysisInputs();
    function quotePreview() {
      const mode = form.elements.quoteMode.value;
      $('quote-inputs').hidden = mode !== 'save';
      quoteFields.forEach(([key]) => {
        form.elements['quote_' + key].disabled = mode !== 'save';
        form.elements['quote_' + key].required = mode === 'save' && ['package','grams','quantity','total'].includes(key);
      });
      const grams = Number(form.elements.quote_grams.value), quantity = Number(form.elements.quote_quantity.value);
      const totalText = form.elements.quote_total.value, total = Number(totalText);
      $('quote-calculation').textContent = mode === 'withdraw' ? '保存后停用明确报价，分析回到原始参考价格；旧报价记录保留。'
        : mode === 'save' && grams > 0 && quantity > 0 && Number.isInteger(quantity) && totalText !== '' && total >= 0
          ? `预览：${numberShown(total * 500 / (grams * quantity))} 元/斤（${grams}g × ${quantity}，总价${total}元）。这不是实时售价或核验结论。`
          : mode === 'save' ? '请填写明确净重、整数数量和实付总价。' : '';
    }
    form.addEventListener('input', quotePreview);
    form.addEventListener('change', quotePreview);
    quotePreview();
    const saveButton = $('save-edit');
    const preview = $('edit-preview');
    const message = $('edit-message');
    const roleLabel = status => status === 'confirmed' ? '已确认核心' : status === 'excluded' ? '已确认非核心' : status === 'candidate' ? '样板候选' : '未指定（空白）';
    function currentPayload() {
      const changes = {};
      editFields.forEach(([key]) => {
        const value = form.elements[key].value.trim();
        if (value !== String(p.details[key] ?? '').trim()) changes[key] = value;
      });
      for (const key of ['product_name','flavor']) {
        const value=form.elements[key].value.trim();
        if(value!==String(p.details[key]??'').trim())changes[key]=value;
      }
      const selectedRole = form.elements.coreRole.value || null;
      const coreRole = selectedRole && selectedRole !== p.coreRoleStatus ? selectedRole : null;
      const importStatus = form.elements.importStatus.value || null;
      const nextAttributes = managementAttributes.parse(form.elements.comparison_tags.value, form.elements.comparison_note.value);
      const attributes = managementAttributes.changes(p, nextAttributes);
      const quoteMode = form.elements.quoteMode.value;
      const quoteChange = quoteMode === 'keep' ? {} : {
        quote: quoteMode === 'withdraw' ? null : Object.fromEntries(quoteFields.map(([key]) => [key, form.elements['quote_' + key].value.trim()])),
        expectedQuoteRevision: p.quoteRevision ?? null };
      return { skuId, changes, coreRole, importStatus, ...quoteChange,...analysis.editorPayload(form,p),
        ...(Object.keys(changes).some(k=>['product_name','flavor'].includes(k)) ? {identityCorrection:true,
          expectedIdentity:Object.fromEntries(['brand_name','series_name','product_name','flavor'].map(k=>[k,p.details[k]]))} : {}),
        ...(Object.keys(attributes).length ? { attributes, expectedAttributes: managementAttributes.values(p) } : {}),
        expected: { source: p.source, importStatus: p.importStatus, coreRoleStatus: p.coreRoleStatus,
          values: Object.fromEntries(Object.keys(changes).map(key => [key, p.details[key] ?? null])) },
        reason: form.elements.reason.value.trim() || (Object.keys(changes).length && Object.keys(changes).every(k=>['function_raw','production_mode_raw','factory_name_raw'].includes(k)) ? '修改产品功能或生产资料' : ''), evidence: form.elements.evidence.value.trim() };
    }
    function showPreview(payload) {
      const fields = [...editFields,['product_name','产品名纠错'],['flavor','口味纠错']].filter(([key]) => Object.hasOwn(payload.changes, key)).map(([key, label]) =>
        `<div class="preview-change"><dt>${esc(label)}</dt><dd><span>原值</span>${esc(previewValue(p.details[key]))}</dd><dd><span>新值</span>${esc(previewValue(payload.changes[key]))}</dd></div>`
      ).join('');
      const role = payload.coreRole ? `<div class="preview-change"><dt>核心 SKU 角色</dt><dd><span>原值</span>${esc(roleLabel(p.coreRoleStatus))}</dd><dd><span>新值</span>${esc(roleLabel(payload.coreRole))}</dd></div>` : '';
      const imported = payload.importStatus ? `<div class="preview-change"><dt>进口 / 国产分类</dt><dd><span>原值</span>${esc(p.importStatus)}</dd><dd><span>选择</span>${esc(payload.importStatus)}（保留原文，记录本次选择）</dd></div>` : '';
      const attributePreview = attributeDefinitions.filter(f => Object.hasOwn(payload.attributes || {}, f.fieldKey)).map(f => `<div class="preview-change"><dt>${esc(f.displayName)}（管理记录）</dt><dd><span>原值</span>${esc(managementAttributes.display(managementAttributes.values(p)[f.fieldKey]))}</dd><dd><span>新值</span>${esc(managementAttributes.display(payload.attributes[f.fieldKey]))}</dd></div>`).join('');
      preview.innerHTML = `<h3>保存前确认</h3><p>${esc(p.brand)} · ${esc(p.product)}。下方是本次修改范围，尚未保存。</p><dl>${fields}${role}${imported}${attributePreview}</dl>${payload.reason ? `<p><strong>修改原因：</strong>${esc(payload.reason)}</p>` : ''}${payload.evidence ? `<p><strong>证据说明：</strong>${esc(payload.evidence)}</p>` : ''}<p class="preview-caution">确认后只保存下方改动；核心、生产资料与其他底稿原文写回Excel并保留旧版，分类、分组和备注另留历史。</p>`;
      preview.hidden = false;
      if(Object.hasOwn(payload,'analysisInputs'))preview.insertAdjacentHTML('beforeend','<p>分析口径变更：'+esc(payload.analysisInputs?JSON.stringify(payload.analysisInputs):'停用口径，相关计算保持未知')+'。仅追加口径记录，原始数值不替换，旧版保留。</p>');
      if (Object.hasOwn(payload, 'quote')) preview.insertAdjacentHTML('beforeend', `<p>原报价：${p.activeQuote ? esc(`${p.activeQuote.package} · ${p.activeQuote.grams}g × ${p.activeQuote.quantity}，总价${p.activeQuote.total}元`) : '未录入明确报价'}。</p><p>报价变更：${payload.quote ? esc(`${payload.quote.package} · ${payload.quote.grams}g × ${payload.quote.quantity}，总价${payload.quote.total}元；日期${payload.quote.date || '未填'}，渠道${payload.quote.channel || '未填'}；条件${payload.quote.conditions || '未填'}；来源${payload.quote.sourceText || '未填'}`) : '停用明确报价，回到原始参考价'}。旧记录和Excel修改前备份保留。</p>`);
      saveButton.textContent = '确认保存并更新看板';
      preview.scrollIntoView({ block: 'nearest' });
    }
    function invalidatePreview() {
      if (previewSignature === null) return;
      previewSignature = null;
      preview.hidden = true;
      saveButton.textContent = '预览改动';
      message.textContent = '内容已变化，请重新预览。';
    }
    form.addEventListener('input', invalidatePreview);
    form.addEventListener('change', invalidatePreview);
    $('edit-form').addEventListener('submit', async event => {
      event.preventDefault();
      let payload;
      try { payload = currentPayload(); } catch (error) { message.textContent = error.message; return; }
      if (!Object.keys(payload.changes).length && !payload.coreRole && !payload.importStatus && !Object.keys(payload.attributes || {}).length && !Object.hasOwn(payload, 'quote')&&!Object.hasOwn(payload,'analysisInputs')) { message.textContent = '没有修改内容。'; return; }
      if (Object.keys(payload.changes).length && payload.reason.length < 2) { message.textContent = '修改底稿原文时，请简短填写原因。'; return; }
      const signature = JSON.stringify(payload);
      if (signature !== previewSignature) {
        previewSignature = signature;
        showPreview(payload);
        message.textContent = '请核对预览；确认后再点击“确认保存并更新看板”。';
        return;
      }
      saveButton.disabled = true; message.textContent = '正在保存和更新看板…';
      try {
        const response = await fetch('/api/edit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '保存失败');
        const latest = await fetch('/api/data', { cache: 'no-store' });
        if (!latest.ok) throw new Error('已保存，但看板刷新失败；请手动刷新页面。');
        data = await latest.json(); products = data.products; rebindAssoc(); syncSortControls();
        refreshOptions(); render(); await refreshVerification(); $('edit-overlay').hidden = true; openDetail(skuId);
        $('detail-content').insertAdjacentHTML('afterbegin', `<p class="save-success">已保存并更新看板；${result.history.backupFile ? 'Excel修改前旧版和' : ''}修改记录已保留。</p>`);
      } catch (error) {
        message.textContent = error.message;
      } finally { saveButton.disabled = false; }
    });
    try {
      const response = await fetch(`/api/history?skuId=${encodeURIComponent(skuId)}`, { cache: 'no-store' });
      const history = response.ok ? await response.json() : [];
      $('edit-history').innerHTML = history.length ? history.map(item => {
        const changes = Object.entries(item.changes || {}).map(([key, values]) => {
          const label = editFields.find(([field]) => field === key)?.[1] || (key === 'core_product_raw' ? '核心产品' : key);
          const display = key === 'function_raw' ? value => value == null || value === '' ? '' : value : shown;
          return `${esc(label)}：${esc(display(values.before))} → ${esc(display(values.after))}`;
        }).join('<br>');
        const role = item.coreRoleBefore !== item.coreRoleAfter ? `<br>核心产品：${esc(roleLabel(item.coreRoleAfter))}` : '';
        const imported = item.importStatusSelected ? `<br>进口分类：${esc(item.importStatusBefore)} → ${esc(item.importStatusAfter)}` : '';
        const attributes = Object.entries(item.attributeChanges || {}).map(([key, change]) => `<br>${esc(attributeDefinitions.find(f => f.fieldKey === key)?.displayName || key)}：${esc(managementAttributes.display(change.before))} → ${esc(managementAttributes.display(change.after))}`).join('');
        const backup = item.backupFile ? `<p class="source-path">旧版：${esc(data.meta.sourceRoot.replace(/\/$/, '') + '/' + item.backupFile)}</p>` : '';
        const restore = item.identityCorrection ? `<button class="secondary-button" data-name-restore="${esc(item.editId)}" type="button">带入旧名称 / 口味纠错</button>` : item.kind !== 'create' && Object.keys(item.changes || {}).length ? `<button class="secondary-button" data-restore="${esc(item.editId)}" type="button">预览撤销这条原文修改</button>` : '';
        const quoteHistory = item.quoteAfterId ? `<p>报价：${item.quoteAfter ? esc(`${item.quoteAfter.package} · ${item.quoteAfter.grams}g × ${item.quoteAfter.quantity}，总价${item.quoteAfter.total}元`) : '已停用'}</p>${p.quoteRevision === item.quoteAfterId ? `<button class="secondary-button" data-quote-restore="${esc(item.editId)}" type="button">预览撤销这次报价</button>` : ''}` : '';
        const analysisHistory=item.analysisAfterId?'<p>分析口径：'+esc(item.analysisAfter?JSON.stringify(item.analysisAfter):'已停用')+'</p>'+(p.analysisRevision===item.analysisAfterId?'<button class="secondary-button" data-analysis-restore="'+esc(item.editId)+'" type="button">预览撤销这次口径修改</button>':''):'';
        return `<div class="history-item"><strong>${esc(item.editedAt)}</strong><p>${changes}${role}${imported}${attributes}</p>${quoteHistory}${analysisHistory}<small>依据：${esc(item.reason)}</small>${backup}${restore}</div>`;
      }).join('') : '<p class="detail-help">暂无网页修改记录。</p>';
      $('edit-history').querySelectorAll('[data-name-restore]').forEach(button=>button.onclick=()=>{
        const old=history.find(h=>h.editId===button.dataset.nameRestore);
        const keys=['product_name','flavor'].filter(k=>old.changes[k]);
        if(keys.some(k=>String(p.details[k]??'')!==String(old.changes[k].after??''))){message.textContent='名称已有后续修改，请直接核对后纠错，不自动覆盖。';return;}
        for(const k of keys)form.elements[k].value=old.changes[k].before??'';
        form.elements.reason.value='撤销名称纠错：'+old.editId;
        $('name-correction').open=true;invalidatePreview();message.textContent='旧名称已带入，尚未保存。只恢复名称/口味，不恢复同批其他字段；请预览后确认。';
      });
      $('edit-history').querySelectorAll('[data-analysis-restore]').forEach(button=>button.onclick=()=>{
        const old=history.find(h=>h.editId===button.dataset.analysisRestore),v=old.analysisBefore;
        form.elements.analysisMode.value=v?'save':'withdraw';
        if(v) for(const k of [...Object.keys(analysis.INPUTS),'energyKcalKg','sourceText'])form.elements['analysis_'+k].value=v[k]??'';
        form.elements.reason.value='撤销口径修改：'+old.editId;updateAnalysisInputs();invalidatePreview();
        message.textContent='已带入先前口径，尚未保存；请预览后确认。恢复会绑定当前资料，不自动核准先前出处仍适用。';
      });
      document.querySelectorAll('[data-quote-restore]').forEach(button => button.addEventListener('click', () => {
        const event = history.find(h => h.editId === button.dataset.quoteRestore);
        form.elements.quoteMode.value = event.quoteBefore ? 'save' : 'withdraw';
        quoteFields.forEach(([key]) => { form.elements['quote_' + key].value = event.quoteBefore?.[key] ?? ''; });
        form.elements.reason.value = '撤销报价修改：' + event.editId;
        invalidatePreview(); quotePreview();
        const payload = currentPayload();
        previewSignature = JSON.stringify(payload); showPreview(payload);
        message.textContent = '已加载修改前报价，请核对并点击确认保存；原文字段、分组和分类不会自动撤销。';
      }));
      document.querySelectorAll('[data-restore]').forEach(button => button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const result = await maintenanceRequest('/api/restore-preview', { skuId, editId: button.dataset.restore });
          showMaintenancePreview(result.request, result, () => openEditor(skuId), skuId);
        } catch (error) { message.textContent = error.message; }
        finally { button.disabled = false; }
      }));
    } catch { $('edit-history').textContent = '暂时无法读取修改记录。'; }
  }

  async function maintenanceRequest(url, payload) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '资料维护未完成');
    return result;
  }

  function showMaintenancePreview(request, result, back, detailSku = null) {
    const label = key => editFields.find(([k]) => k === key)?.[1] || ({ brand_name: '品牌', series_name: '系列', product_name: '产品名', flavor: '口味',core_product_raw:'核心产品' })[key] || key;
    $('edit-overlay').hidden = false;
    $('edit-content').innerHTML = `<h2>确认维护范围</h2><p>修改 ${result.changedCount} 款 · 新增 ${result.newCount} 款，尚未写回。</p>
      <p class="edit-notice">${esc(result.note || '只写回下列字段；旧版保留。核心是本款底稿字段；进口确认仍单独维护，新款不继承品牌确认或核心选择。')}</p>
      ${result.plan.operations.map(op => `<section class="detail-section"><h3>${op.kind === 'create' ? '新增' : '修改'}：${esc(op.brand)} · ${esc(op.product)}</h3><p class="source-path">${esc(op.source.file)}${op.source.row ? ' · 第' + op.source.row + '行' : ' · 表尾追加'}</p><dl>${Object.entries(op.changes).map(([k, v]) => `<div class="preview-change"><dt>${esc(label(k))}</dt><dd><span>原值</span>${esc(previewValue(v.before))}</dd><dd><span>新值</span>${esc(previewValue(v.after))}</dd></div>`).join('')}</dl></section>`).join('')}
      ${result.plan.operations.filter(op=>op.provenance).map(op=>`<section class="detail-section"><h3>随产品保存的来源、口径与报价</h3><p>资料来源：${esc(op.provenance['说明'])}</p><p>字段出处：${esc(JSON.stringify(op.provenance['字段出处']))}</p><p>保留的疑点：${esc(op.provenance['待确认'].join('；')||'未填写')}</p><p>分析口径：${esc(op.analysisInputs?JSON.stringify(op.analysisInputs):'未知；不自动补比较符、基准或分母')}</p><p>报价：${esc(op.quote?`${op.quote.package} · ${op.quote.grams}g × ${op.quote.quantity}，总价${op.quote.total}元；${op.quote.sourceText||'未填出处'}`:'未绑定包装；不从规格猜报价')}</p><p>这不是已核实功效或品质评分。分类与核心角色不继承品牌选择。</p></section>`).join('')}
      <p>原因：${esc(result.plan.reason)}</p><div class="edit-actions"><button class="secondary-button" id="maintenance-back">返回修改</button><button class="primary-button" id="maintenance-save" ${!result.plan.operations.length ? 'disabled' : ''}>确认写回并更新看板</button></div><p id="maintenance-message" role="status"></p>`;
    $('maintenance-back').addEventListener('click', back);
    $('maintenance-save').addEventListener('click', async () => {
      $('maintenance-save').disabled = true; $('maintenance-back').disabled = true;
      $('maintenance-message').textContent = '正在留旧版、写回并更新看板…';
      try {
        const saved = await maintenanceRequest('/api/maintenance-apply', { ...request, preview: result.preview });
        const response = await fetch('/api/data', { cache: 'no-store' });
        if (!response.ok) throw new Error('写回完成但刷新失败，请手动刷新页面。');
        data = await response.json(); products = data.products; rebindAssoc(); syncSortControls();
        refreshOptions(); render(); await refreshVerification();
        $('edit-overlay').hidden = true;
        if (detailSku || saved.newCount === 1) openDetail(detailSku || saved.skuIds.at(-1));
        else {
          openMaintenance();
          $('maintenance-message').textContent = `已修改${saved.changedCount}款、新增${saved.newCount}款。旧版和修改记录已保留。`;
        }
      } catch (error) {
        $('maintenance-message').textContent = error.message;
        $('maintenance-save').disabled = false; $('maintenance-back').disabled = false;
      }
    });
  }

  function openMaintenance(draft = {}) {
    if (!editorEnabled) return;
    $('detail-overlay').hidden = true; $('edit-overlay').hidden = false;
    const exportIds = selected.size ? [...selected] : filteredProducts().map(p => p.skuId);
    const brands = [...new Set(products.map(p => p.brand))].sort();
    const fields = ['life_stage_raw', 'format_raw', 'function_raw', 'core_product_raw', 'production_mode_raw', 'factory_name_raw', 'package_size_raw', 'protein_raw', 'fat_raw', 'page_price_raw', 'price_per_jin_raw', 'ingredients_raw', 'additives_raw', 'factory_import_raw'];
    const intakeControl = key => {
      const choices = key === 'core_product_raw' ? ['','是','否'] : key === 'production_mode_raw' ? ['','自有','代工'] : null;
      if (choices) return `<select name="${key}">${choices.map(value=>`<option value="${value}" ${value === String(draft[key] ?? '') ? 'selected' : ''}>${value || '未指定（空白）'}</option>`).join('')}</select>`;
      if (key === 'factory_name_raw') return `<input name="${key}" maxlength="500" value="${esc(draft[key] ?? '')}" placeholder="只填本款已知工厂；未知留空">`;
      return shortEditFields.has(key) ? `<input name="${key}" value="${esc(draft[key] ?? '')}">` : `<textarea name="${key}" rows="3" maxlength="20000">${esc(draft[key] ?? '')}</textarea>`;
    };
    $('edit-content').innerHTML = `<h2>资料维护 / 新增产品</h2><p class="edit-notice">新增用下方表单或试行整理模板，先预览再保存到品牌Excel。未知留空；旧款改名从产品“编辑”进入，CSV仅供查阅。</p>
      <details class="detail-section"><summary>Excel批量维护（原模板继续可用）</summary><p>导出${selected.size ? '选中' : '当前筛选'}的 ${exportIds.length} 款；修改模板后上传此处。包含原文字段、功能、核心产品、生产方式与工厂名称；核心填是/否/空，生产方式填自有/代工/空。整行删除不删除SKU；存在的空白字段会清空旧值，旧模板缺少的新增字段保持原值。查阅CSV不用于回写。来源/口径/报价用单款编辑或新增整理流程。</p>
      <button class="secondary-button" id="maintenance-export" ${exportIds.length ? '' : 'disabled'}>导出可导入的Excel模板</button>
      <form id="maintenance-import-form"><label class="edit-field"><span>上传维护模板（xlsx，最大5MB）</span><input id="maintenance-file" type="file" accept="公开资料记录" required></label>
      <label class="edit-field"><span>批量修改原因</span><input name="reason" required minlength="2" maxlength="1000"></label><button class="primary-button">预览模板改动</button></form></details>
      <details class="detail-section" id="intake-json-panel"><summary>从整理模板 / AI整理结果带入</summary><p>下载试行JSON模板，把详情页按模板整理，再上传或粘贴。带入只是填写表单，不会保存；不凭AI输出认定事实。</p><button class="secondary-button" id="intake-template" type="button">下载空白整理模板</button><button class="secondary-button" id="intake-export" type="button">保存当前整理草稿</button><label class="edit-field"><span>上传整理草稿（JSON，最大200KB）</span><input id="intake-file" type="file" accept=".json,application/json"></label><label class="edit-field"><span>或粘贴整理结果JSON</span><textarea id="intake-json" rows="6"></textarea></label><button class="secondary-button" id="intake-load" type="button">带入下方表单（不保存）</button><p id="intake-message" role="status"></p></details>
      <section class="detail-section"><h3>新增一款SKU</h3><form id="maintenance-new-form"><div class="edit-grid">
      <label class="edit-field"><span>品牌</span><select name="brand_name">${brands.map(b => `<option ${b === draft.brand_name ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></label>
      <label class="edit-field"><span>系列（已有）</span><select name="series_name"></select></label>
      <label class="edit-field"><span>产品名（必填）</span><input name="product_name" required maxlength="200" value="${esc(draft.product_name || '')}"></label>
      <label class="edit-field"><span>口味</span><input name="flavor" maxlength="200" value="${esc(draft.flavor || '')}"></label>
      ${fields.map(k => `<label class="edit-field"><span>${esc(PFDSIntake.fields.find(([key]) => key === k)[1])}</span>${intakeControl(k)}</label>`).join('')}</div>
      <label class="edit-field"><span>资料来源位置（必填，保留图片顺序）</span><textarea name="intake_source" required maxlength="2000" rows="2" placeholder="如：详情页文件夹；01包装正面，02背标，03配料；采集日期。来源不表示已核实。"></textarea></label>
      <details class="detail-section"><summary>更多原文、字段出处与待确认问题</summary><div class="edit-grid">${editFields.filter(([k])=>!fields.includes(k) && !['production_mode_raw','factory_name_raw'].includes(k)).map(([k,l])=>`<label class="edit-field"><span>${esc(l)}</span><textarea name="${k}" rows="3" maxlength="20000">${esc(draft[k]??'')}</textarea></label>`).join('')}</div><label class="edit-field"><span>字段出处（可选，每行“字段名：位置”，名称按模板）</span><textarea name="intake_refs" rows="3" placeholder="规格：图02 背标净含量&#10;动物性原料占比：图05 投料说明"></textarea></label><label class="edit-field"><span>需要保留的冲突 / 未确定问题（每行一条）</span><textarea name="intake_questions" rows="3" placeholder="如：鲜肉比例与动物性原料占比分母不同，暂不互填"></textarea></label></details>
      ${analysis.editorHtml({},esc)}
      <details class="detail-section"><summary>明确包装参考报价（可选）</summary><label><input name="intake_quote" type="checkbox">随新产品录入明确报价</label><p>只计主包装，赠品不自动计重；未勾选则不录入报价，不从原规格推对应。</p><div class="edit-grid" id="intake-quote-fields" hidden>${PFDSIntake.quoteFields.map(([k,l,type])=>`<label class="edit-field"><span>${esc(l)}</span><input name="intake_quote_${k}" type="${type}" ${type==='number'?'step="any" min="0"':'maxlength="2000"'}></label>`).join('')}</div></details>
      <label class="edit-field"><span>新增原因</span><input name="reason" required minlength="2" maxlength="1000" value="${esc(draft.reason || '')}"></label><p>核心、生产方式和工厂名称只采用本次填写，默认留空；不继承品牌或其他产品的选择。</p><button class="primary-button">预览新增SKU</button></form></section><p id="maintenance-message" role="status"></p>`;
    const form = $('maintenance-new-form');
    const reviewPanel=document.createElement('section');
    reviewPanel.className='detail-section intake-review';
    reviewPanel.innerHTML='<h3>先核对身份与差异</h3><p class="detail-help">同系列不同口味分别保留；同配方不同包装先核对是否只需补规格或报价，不直接新增。新配方版本不覆盖旧资料。</p><button type="button" class="secondary-button" id="intake-review-button">检查同款、差异与缺项</button><div id="intake-review-result" role="status"></div>';
    form.before(reviewPanel);
    const showIntakeReview = value => {
      const result=PFDSIntake.review(value,products);
      $('intake-review-result').innerHTML=`<p><strong>${esc(result.summary)}</strong></p>
        <details><summary>本品牌系列分布（${result.groupCount}组）</summary><ul>${result.groups.map(g=>`<li>${esc(g.series||'系列未填写')} · ${g.count}款</li>`).join('')}</ul>${result.groupsTruncated?'<p>仅列前12组。</p>':''}</details>
        ${result.candidates.map(c=>`<details class="intake-candidate"><summary>${esc(c.product)} · ${esc(c.flavor||'口味未填')}（${c.changes.length}项差异）</summary><p>${esc(c.reasons.map(r=>r.message).join('；'))}。系列：${esc(c.series||'未填')}。仅供核对，不自动合并。</p>
        <dl>${c.changes.map(change=>`<div class="preview-change"><dt>${esc(change.label)} · ${esc(change.message)}</dt><dd>已有：${esc(previewValue(change.before))}</dd><dd>草稿：${esc(previewValue(change.after))}</dd></div>`).join('')}</dl></details>`).join('')}
        ${result.candidatesTruncated?'<p>仅展示前12个候选，请用产品名缩小范围。</p>':''}
        <details ${result.warnings.length?'open':''}><summary>需要留意（${result.warnings.length}项）</summary><ul>${result.warnings.map(w=>`<li>${esc(w.message)}</li>`).join('')}</ul></details>
        <p class="detail-help">检查只帮助缩小审核范围，不证明资料已核实。只更新价格或补充资料时，请保存草稿后从已有产品的“编辑”进入；新增仍需下方预览与确认。</p>`;
      return result;
    };
    $('intake-review-button').addEventListener('click',()=>{try{showIntakeReview(PFDSIntake.fromForm(form,analysis));}catch(error){$('intake-review-result').textContent=error.message;}});
    const updateSeries = () => {
      const names = [...new Set(products.filter(p => p.brand === form.elements.brand_name.value).map(p => p.series))];
      form.elements.series_name.innerHTML = names.map(s => `<option ${s === draft.series_name ? 'selected' : ''}>${esc(s)}</option>`).join('');
    };
    updateSeries(); form.elements.brand_name.addEventListener('change', updateSeries);
    const updateIntakeModes=()=>{
      $('analysis-input-fields').hidden=form.elements.analysisMode.value!=='save';
      for(const control of $('analysis-input-fields').querySelectorAll('input,select,textarea'))control.disabled=form.elements.analysisMode.value!=='save';
      $('intake-quote-fields').hidden=!form.elements.intake_quote.checked;
      for(const control of $('intake-quote-fields').querySelectorAll('input'))control.disabled=!form.elements.intake_quote.checked;
    };
    form.elements.analysisMode.querySelector('[value="withdraw"]').remove();
    form.addEventListener('change',updateIntakeModes);updateIntakeModes();
    const loadIntake=value=>{
      const v=PFDSIntake.validateShape(value), raw=v['原文字段'];
      const brand=raw['品牌'],series=raw['系列'];
      if(!products.some(p=>p.brand===brand&&p.series===series))throw new Error('草稿品牌/系列不在当前库中，不自动创建或猜匹配。');
      const a=v['分析口径'],q=v['报价'];
      if(a&&(typeof a!=='object'||Object.keys(a).some(k=>![...Object.keys(analysis.INPUTS),'energyKcalKg','sourceText'].includes(k))||Object.entries(analysis.INPUTS).some(([k,f])=>a[k]!==undefined&&!Object.hasOwn(f.options,a[k]))))throw new Error('分析口径未知或非法，不自动猜值。');
      if(q&&(typeof q!=='object'||Object.keys(q).some(k=>!PFDSIntake.quoteFields.some(f=>f[0]===k))))throw new Error('报价字段不正确。');
      form.elements.brand_name.value=brand;updateSeries();form.elements.series_name.value=series;
      for(const [k,l] of PFDSIntake.fields)if(!['brand_name','series_name'].includes(k))form.elements[k].value=['core_product_raw','production_mode_raw'].includes(k) ? String(raw[l]??'').trim() : raw[l]??'';
      const notes=v['来源']||{};form.elements.intake_source.value=notes['说明']||'';
      form.elements.intake_refs.value=Object.entries(notes['字段出处']||{}).map(([l,t])=>l+'：'+t).join('\n');
      form.elements.intake_questions.value=(notes['待确认']||[]).join('\n');
      form.elements.analysisMode.value=a?'save':'keep';
      for(const k of Object.keys(analysis.INPUTS))form.elements['analysis_'+k].value=a?.[k]||'unknown';
      form.elements.analysis_energyKcalKg.value=a?.energyKcalKg??'';form.elements.analysis_sourceText.value=a?.sourceText||'';
      form.elements.intake_quote.checked=!!q;for(const [k] of PFDSIntake.quoteFields)form.elements['intake_quote_'+k].value=q?.[k]??'';
      form.elements.reason.value=draft.reason||'按详情资料新增';updateIntakeModes();
      $('intake-message').textContent='已带入表单，尚未写入。核对原文、来源与未知项后点预览。';
      showIntakeReview(v);
    };
    const downloadDraft=v=>{const url=URL.createObjectURL(new Blob([JSON.stringify(v,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='产品整理草稿-v0.1.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    $('intake-template').onclick=async()=>{try{const response=await fetch('/api/intake-template',{cache:'no-store'});if(!response.ok)throw new Error('整理模板读取失败，请检查编辑入口版本。');const v=await response.json();v['原文字段']['品牌']=form.elements.brand_name.value;v['原文字段']['系列']=form.elements.series_name.value;downloadDraft(v);$('intake-message').textContent='空白模板已下载；先保留原文和出处，未知保持null/unknown。';}catch(error){$('intake-message').textContent=error.message;}};
    $('intake-export').onclick=()=>{try{downloadDraft(PFDSIntake.fromForm(form,analysis));$('intake-message').textContent='当前草稿已下载；不是事实主本，下次上传后继续整理。';}catch(error){$('intake-message').textContent=error.message;}};
    $('intake-load').onclick=()=>{try{loadIntake(JSON.parse($('intake-json').value));}catch(error){$('intake-message').textContent=error.message;}};
    $('intake-file').onchange=async()=>{try{const file=$('intake-file').files[0];if(!file||file.size>200000)throw new Error('请选择200KB以内的JSON整理草稿。');loadIntake(JSON.parse(await file.text()));}catch(error){$('intake-message').textContent=error.message;}};
    if(draft.intakeDraft)loadIntake(draft.intakeDraft);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      try {
        const intakeDraft=PFDSIntake.fromForm(form,analysis),reason=form.elements.reason.value;
        showIntakeReview(intakeDraft);
        const request = { draft:intakeDraft, reason };
        const result = await maintenanceRequest('/api/maintenance-preview', request);
        showMaintenancePreview(request, result, () => openMaintenance({ intakeDraft, reason }));
      } catch (error) { $('maintenance-message').textContent = error.message; }
    });
    $('maintenance-export').addEventListener('click', async () => {
      $('maintenance-export').disabled = true; $('maintenance-message').textContent = '正在生成维护模板…';
      try {
        const result = await maintenanceRequest('/api/template', { skuIds: exportIds });
        const bytes = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const link = document.createElement('a'); link.href = url; link.download = result.filename; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        $('maintenance-message').textContent = `已导出${result.count}款。修改后上传同一模板即可预览。`;
      } catch (error) { $('maintenance-message').textContent = error.message; }
      finally { $('maintenance-export').disabled = false; }
    });
    $('maintenance-import-form').addEventListener('submit', async event => {
      event.preventDefault();
      const file = $('maintenance-file').files[0];
      if (!file || file.size > 5000000) { $('maintenance-message').textContent = '请选择5MB以内的xlsx维护模板。'; return; }
      $('maintenance-message').textContent = '正在读取模板和核对差异…';
      try {
        const encoded = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
        const request = { template: encoded, reason: new FormData(event.target).get('reason') };
        const result = await maintenanceRequest('/api/maintenance-preview', request);
        showMaintenancePreview(request, result, openMaintenance);
      } catch (error) { $('maintenance-message').textContent = error.message; }
    });
  }

  const verificationStatusLabels = {
    pending: '自动待核', stale: '源变化需复核', needs_evidence: '待补证据',
    disputed: '有冲突', verified: '证据已核', user_confirmed: '人工已确认属性'
  };

  async function awaitVerificationPanel() {
    setWorkspace('manage');
    $('verification-panel').hidden = false;
    await refreshVerification();
    $('verification-panel').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function openBatchCore() {
    if (!editorEnabled || coreSavePending || !selected.size) return;
    const rows = products.filter(p => selected.has(p.skuId));
    const roleLabel = value => value === 'confirmed' ? '核心' : value === 'excluded' ? '非核心' : '样板候选 / 未设置';
    $('edit-content').innerHTML = `<div class="detail-title"><h2 id="edit-title">批量设置核心产品</h2><p>已选 ${rows.length} 款 · 只改下方列出的产品</p></div>
      <p class="edit-notice">核心是你的人工选择，写回本款Excel并保留旧版；不需要证据表。选择中可能包含当前筛选外的产品，请核对名单。</p>
      <form id="batch-form"><label class="edit-field"><span>设置为</span><select name="role"><option value="confirmed">核心产品</option><option value="excluded">非核心产品</option></select></label>
      <section class="edit-preview" id="batch-preview" hidden></section>
      <div class="edit-actions"><button class="secondary-button" id="batch-cancel" type="button">取消</button><button class="primary-button" id="batch-save" type="submit">预览所选产品</button></div>
      <p id="batch-message" class="edit-message" role="status"></p></form>`;
    $('edit-overlay').hidden = false;
    let signature = null;
    const form = $('batch-form'), button = $('batch-save'), message = $('batch-message');
    $('batch-cancel').addEventListener('click', () => { $('edit-overlay').hidden = true; });
    form.elements.role.addEventListener('change', () => {
      signature = null; $('batch-preview').hidden = true; button.textContent = '预览所选产品'; message.textContent = '选择已变化，请重新预览。';
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const role = form.elements.role.value;
      const changedCount = rows.filter(p => p.coreRoleStatus !== role).length;
      if (!changedCount) { message.textContent = '所选产品已是该状态，没有新改动。'; return; }
      const payload = { skuIds: rows.map(p => p.skuId), coreRole: role,
        expectedRoles: Object.fromEntries(rows.map(p => [p.skuId, p.coreRoleStatus])) };
      if (signature !== JSON.stringify(payload)) {
        signature = JSON.stringify(payload);
        $('batch-preview').innerHTML = `<h3>确认修改范围</h3><p>已选${rows.length}款，实际修改${changedCount}款；其余保持原状态。尚未保存。</p><ol class="batch-preview-list">${rows.map(p => `<li>${esc(p.brand)} · ${esc(p.product)}：${roleLabel(p.coreRoleStatus)} → ${roleLabel(role)}</li>`).join('')}</ol>`;
        $('batch-preview').hidden = false; button.textContent = '确认批量保存'; message.textContent = '核对名单后再确认保存。'; return;
      }
      button.disabled = true; message.textContent = '正在保存所选产品…';
      try {
        const response = await fetch('/api/batch-core', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '保存失败');
        const latest = await fetch('/api/data', { cache: 'no-store' });
        if (!latest.ok) throw new Error('已保存，请手动刷新看板。');
        data = await latest.json(); products = data.products; rebindAssoc(); syncSortControls(); selected.clear();
        refreshOptions(); render(); $('edit-overlay').hidden = true;
        $('core-save-status').textContent = `已更新 ${result.changedCount} 款核心选择；Excel旧版与修改记录已保留。`;
      } catch (error) { message.textContent = error.message; }
      finally { button.disabled = false; }
    });
  }

  async function refreshVerification() {
    if (!editorEnabled) return;
    try {
      const response = await fetch('/api/verification', { cache: 'no-store' });
      if (!response.ok) throw new Error('核验队列暂时无法读取');
      verificationTasks = await response.json();
      if ($('verification-priority').value === '1' && !verificationTasks.some(task => task.priority === 1)) $('verification-priority').value = '';
      renderVerification();
    } catch (error) {
      $('verification-list').textContent = `${error.message}；请检查本机编辑入口是否为最新版。`;
    }
  }

  function renderVerification() {
    const query = $('verification-search').value.trim().toLocaleLowerCase('zh-CN');
    const priority = $('verification-priority').value;
    const field = $('verification-field').value;
    const status = $('verification-status').value;
    const openStatuses = new Set(['pending', 'stale', 'needs_evidence', 'disputed']);
    const rows = verificationTasks.filter(task =>
      (!query || `${task.brand} ${task.product}`.toLocaleLowerCase('zh-CN').includes(query))
      && (!priority || String(task.priority) === priority)
      && (!field || task.fieldKey === field)
      && (!status || (status === 'open' ? openStatuses.has(task.status) : task.status === status)));
    const verified = verificationTasks.filter(task => task.status === 'verified').length;
    const stale = verificationTasks.filter(task => task.status === 'stale').length;
    const confirmed = verificationTasks.filter(task => task.status === 'user_confirmed').length;
    $('verification-summary').textContent = `${verificationTasks.length} 项线索 · 属性人工确认 ${confirmed} · 证据已核 ${verified} · 源变化需复核 ${stale}`;
    const totalPages = Math.max(1, Math.ceil(rows.length / 30));
    verificationPage = Math.min(verificationPage, totalPages);
    const start = (verificationPage - 1) * 30;
    $('verification-list').innerHTML = rows.length ? rows.slice(start, start + 30).map(task =>
      `<button class="verification-item" data-verification="${esc(task.taskId)}" type="button"><span class="verification-item-main"><strong>${esc(task.brand)} · ${esc(task.product)}</strong><small>${esc(task.fieldLabel)} · ${esc(task.reason)}</small></span><span class="verification-badge ${esc(task.status)}">${esc(verificationStatusLabels[task.status])}</span></button>`
    ).join('') : '<p class="empty-state">当前条件没有核验项。</p>';
    $('verification-page-status').textContent = rows.length ? `显示 ${start + 1}-${Math.min(start + 30, rows.length)} / ${rows.length} 项` : '0 项';
    $('verification-prev').disabled = verificationPage === 1;
    $('verification-next').disabled = verificationPage === totalPages;
    $('verification-list').querySelectorAll('[data-verification]').forEach(button =>
      button.addEventListener('click', () => openVerification(button.dataset.verification)));
  }

  function openVerification(taskId) {
    const task = verificationTasks.find(item => item.taskId === taskId);
    if (!task) return;
    const sourcePath = `${data.meta.sourceRoot.replace(/\/$/, '')}/${task.source.file}`;
    const previous = task.review ? `<section class="detail-section"><h3>上次人工记录${task.status === 'stale' ? '（源字段已变化，不再算已核）' : ''}</h3><p>状态：${esc(verificationStatusLabels[task.review.status])} · ${esc(task.review.reviewedAt)}<br>核对值：${esc(task.review.reviewedValue || '未填')}<br>证据：${esc(task.review.evidenceRef || '未填')}<br>说明：${esc(task.review.note)}</p></section>` : '';
    const sources = Object.entries(task.sourceFields).map(([key, value]) => `<div class="source-field"><strong>${esc(key)}</strong><p>${esc(shown(value))}</p></div>`).join('');
    const confirmation = task.confirmation ? `<section class="detail-section"><h3>进口属性人工确认${task.confirmation.status === 'stale' ? '（来源变化，需复核）' : ''}</h3><p>${esc(task.confirmation.value)} · ${esc(task.confirmation.confirmedAt)}<br>本项目对话人工确认，原话已归档<br>这是进口/国产分类确认，具体原产国、工厂及手续凭据另核。</p></section>` : '';
    $('verification-content').innerHTML = `<div class="detail-title"><p>${esc(task.brand)} · ${esc(task.product)}</p><h2 id="verification-title">${esc(task.fieldLabel)}</h2><p>SKU ${esc(task.skuId)} · 配方版本 ${esc(task.formulaVersion)}</p></div>
      <p class="edit-notice">${esc(task.reason)}。自动线索不构成事实结论；下方人工记录不会修改 Excel 或标准化结果。</p>
      <section class="detail-section"><h3>当前来源与规则结果</h3>${sources}<div class="source-box">产品信息 · 第 ${task.source.row} 行<br><span class="source-path">${esc(sourcePath)}</span></div></section>
      ${confirmation}${previous}
      <form id="verification-form"><label class="edit-field"><span>核验状态</span><select name="status"><option value="needs_evidence">待补证据</option><option value="disputed">有冲突 / 原文存疑</option><option value="verified">人工已核</option></select></label>
        <label class="edit-field"><span>核对值（标记已核时必填）</span><input name="reviewedValue" type="text" maxlength="1000" placeholder="例如：成品原产国意大利；或核心角色 confirmed"></label>
        <label class="edit-field"><span>证据位置（标记已核时必填）</span><input name="evidenceRef" type="text" maxlength="2000" placeholder="背标图片/批次、报告页码或具体网页链接"></label>
        <label class="edit-field"><span>核验结论 / 待补原因（必填）</span><textarea name="note" rows="4" maxlength="2000" required></textarea></label>
        <p class="edit-warning">“人工已核”只表示本核验项有可追溯依据，不会自动更新产品事实。进口手续与成品产地是两项；核心角色须先在产品编辑入口确认。页面声称的来源记录不等于功效已证实。</p>
        <div class="edit-actions"><button class="secondary-button" id="verification-cancel" type="button">取消</button><button class="primary-button" id="verification-save" type="submit">保存核验记录</button></div><p class="edit-message" id="verification-message" role="status"></p></form>`;
    $('verification-overlay').hidden = false;
    $('verification-cancel').addEventListener('click', () => { $('verification-overlay').hidden = true; });
    $('verification-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.target;
      const payload = { taskId, sourceFingerprint: task.sourceFingerprint,
        status: form.elements.status.value, reviewedValue: form.elements.reviewedValue.value.trim(),
        evidenceRef: form.elements.evidenceRef.value.trim(), note: form.elements.note.value.trim() };
      const button = $('verification-save'); button.disabled = true;
      $('verification-message').textContent = '正在保存核验记录…';
      try {
        const response = await fetch('/api/verification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '保存失败');
        verificationTasks = verificationTasks.map(item => item.taskId === taskId ? result.task : item);
        $('verification-overlay').hidden = true;
        renderVerification();
      } catch (error) { $('verification-message').textContent = error.message; }
      finally { button.disabled = false; }
    });
  }

  let comparisonMetrics = null;
  async function renderComparison() {
    if (document.body.dataset.workspace !== "analysis" || document.body.dataset.analysis !== "compare") return;
    const wanted=products.filter(p=>selected.has(p.skuId));
    if(wanted.length>=2 && wanted.length<=6) { try { await Promise.all(wanted.map(p=>window.PFDSRelease.detail(p.skuId))); } catch(e) { $("compare-inline").textContent=e.message; return; } }
    if(JSON.stringify(wanted.map(p=>p.skuId))!==JSON.stringify(products.filter(p=>selected.has(p.skuId)).map(p=>p.skuId))) return;
    const chosenRows = products.filter(p => selected.has(p.skuId));
    const pairFirst=$('compare-first'), pairSecond=$('compare-second');
    const priorFirst=pairFirst.value,priorSecond=pairSecond.value;
    pairFirst.innerHTML=chosenRows.map(p=>`<option value="${esc(p.skuId)}">${esc(p.brand+' · '+readableProductName(p))}</option>`).join('');
    pairFirst.value=chosenRows.some(p=>p.skuId===priorFirst)?priorFirst:(chosenRows[0]?.skuId||'');
    const others=chosenRows.filter(p=>p.skuId!==pairFirst.value);
    pairSecond.innerHTML=others.map(p=>`<option value="${esc(p.skuId)}">${esc(p.brand+' · '+readableProductName(p))}</option>`).join('');
    pairSecond.value=others.some(p=>p.skuId===priorSecond)?priorSecond:(others[0]?.skuId||'');
    $('mobile-compare-pair').hidden=chosenRows.length<3 || chosenRows.length>6;
    const rows=mobileMedia.matches && chosenRows.length>=3 && chosenRows.length<=6 ? chosenRows.filter(p=>[pairFirst.value,pairSecond.value].includes(p.skuId)) : chosenRows;
    if (!workspaces.canCompare(rows.length)) {
      $('compare-inline').innerHTML = `<p class="empty-state">${rows.length > 6 ? '已选超过6款，请回产品库缩小比较范围。' : `已选${rows.length}款，还需选择${2-rows.length}款才能比较。`}</p>`; return;
    }
    const heads = rows.map((p,i)=>`<th scope="col"><small>${String.fromCharCode(65+i)}</small> ${esc(p.brand)}<br>${esc(readableProductName(p))}<br><button type="button" class="text-button" data-compare-detail="${esc(p.skuId)}">详情</button></th>`).join('');
    const shortHeads=rows.map((p,i)=>`<th scope="col" title="${esc(p.brand+' · '+readableProductName(p))}"><button type="button" class="text-button" data-compare-detail="${esc(p.skuId)}" aria-label="${esc(String.fromCharCode(65+i)+' '+readableProductName(p)+' 详情')}">${String.fromCharCode(65+i)} · ${esc(p.brand)}</button></th>`).join('');
    const metrics = comparisonMetrics ?? [...new Set(['protein','fat','price',...tableView.effective(tableState,queryValues()).filter(key=>sorting.definition(key+'-asc'))])];
    $('comparison-metrics').innerHTML=sorting.definitions.map(d=>`<label><input type="checkbox" value="${esc(d.key)}" ${metrics.includes(d.key)?'checked':''}>${esc(d.label)}</label>`).join('');
    const priority=$('comparison-focus').value;
    const animalKeys=['animalIngredient','animalProtein','tractDigest','pepsinDigest'];
    const metricGroups=[
      {title:'基础营养',kind:'nutrition',keys:['protein','fat'].filter(k=>metrics.includes(k)),note:'≥ 是保证下限，≤ 是保证上限，不是实测值；需结合适用阶段与营养基准阅读。'},
      {title:'其他营养指标',kind:'nutrition',keys:metrics.filter(k=>!['protein','fat','price','pagePrice',...animalKeys].includes(k)),note:'比较标示记录，不作高低优劣排名。≥ 是保证下限，≤ 是保证上限；生命阶段、单位和原物/干物质基准需一起看，不能据较低下限判断实际含量更低。'},
      {title:'参考价格',kind:'price',keys:metrics.filter(k=>['price','pagePrice'].includes(k)),note:'价格是记录快照。对照包装净重、数量、日期及优惠条件；每斤价格不等于每日喂养成本。'},
      {title:'动物性成分与消化率',kind:'animalRatios',keys:metrics.filter(k=>animalKeys.includes(k)),note:'动物性原料与动物性蛋白的分母不同；体外胃蛋白酶消化率不等于体内消化率。缺失不代表较差。'}
    ].filter(g=>g.keys.length).map(g=>({...g,html:true,fields:g.keys.map(key=>[tableView.columns.find(d=>d.key===key).label,p=>metricContent(p,key)])}));
    const groups = [...metricGroups,
      ...workspaces.groups.map((g,index)=>({title:g.title,kind:({'配方与含量口径':'animalRatios','包装与参考价格来源':'price','功能与喂养研究':'feedingStudy'})[g.title],fields:[...g.fields.filter(([,key])=>key!=='source.file').map(([label,key])=>[label,p=>key==='series'?PFDSCleaning.seriesName(p):key==='flavor'?PFDSCleaning.brief(p.flavor):(workspaces.displayValue(p,key)??(key.startsWith('activeQuote.')?'未记录':null))]),
        ...(index===0 ? [['功能',p=>query.functionValues(p).join(' / ') || '—']] : [])]})),
      {title:'按我的条件',fields:[['当前结果与缺项',autoUI.text],['维护口径状态',p=>p.analysisInputState||'unknown'],['口径出处',p=>p.analysisInputs?.sourceText||null]]},
      {title:'我的偏好与管理记录',fields:[['个人偏好匹配',scoreText],...attributeDefinitions.map(f=>[f.displayName,p=>managementAttributes.display(managementAttributes.values(p)[f.fieldKey])])]}];
    const priceGroup=groups.find(g=>g.title==='参考价格'), packagingGroup=groups.find(g=>g.title==='包装与参考价格来源');
    if(priceGroup && packagingGroup) {
      priceGroup.fields.push(...packagingGroup.fields.filter(([label,get])=>
        !['元/斤原文','价格与规格口径',...(metrics.includes('pagePrice')?['页面价格原文（元）']:[])].includes(label)
        && rows.some(p=>![null,undefined,'','未记录','—'].includes(get(p))))
        .map(([label,get])=>[label==='页面价格原文（元）'?'参考总价（元）':label==='包装规格原文'?'包装规格':label,p=>esc(label==='包装规格原文'?PFDSCleaning.brief(get(p)):(get(p)??'—'))]));
      // Merged rows mix formatted numbers and text: compare their complete representation, not metric-key indices.
      delete priceGroup.keys;
      groups.splice(groups.indexOf(packagingGroup),1);
    }
    const differentOnly = $('compare-differences').checked;
    const readingOrder=['产品与适用阶段','参考价格','基础营养','包装与参考价格来源','配方与含量口径','动物性成分与消化率','其他营养指标','保证值原文与口径','功能与喂养研究','品牌与生产信息','按我的条件'];
    const visibleGroups = groups.filter(g=>g.title!=='我的偏好与管理记录' && (!visitorMode || g.title!=='按我的条件')).map(g=>({...g,fields:g.fields.filter(([,get],index)=>!differentOnly || new Set(rows.map(p=>g.keys?JSON.stringify(sorting.metric(p,g.keys[index])):String(get(p)??''))).size>1)})).filter(g=>g.fields.length).sort((a,b)=>(priority ? Number(b.kind===priority)-Number(a.kind===priority) : 0) || readingOrder.indexOf(a.title)-readingOrder.indexOf(b.title));
    $('compare-inline').innerHTML = `<p class="theme-note">${priority?'当前优先查看：'+esc($('comparison-focus').selectedOptions[0].textContent)+'（按你的选择调整顺序，不是重要性排名）。':'默认完整对照；可按需选择重点或只看差异。'}当前比较${rows.length}款${differentOnly?' · 只显示不同项':''}。— 表示未收录，不代表为零。</p>` + visibleGroups.map((g,i)=>`<details class="compare-group" ${(priority?i<2:['产品与适用阶段','参考价格','基础营养'].includes(g.title))?'open':''}><summary>${esc(g.title)}</summary>${g.fields.length?`<div class="table-wrap"><table class="compare-table"><thead><tr><th scope="col">指标</th>${i===0?heads:shortHeads}</tr></thead><tbody>${g.fields.map(([label,get])=>`<tr><th scope="row">${esc(label)}</th>${rows.map(p=>`<td>${g.html?get(p):esc(get(p) === '' || get(p) == null ? '—' : get(p))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p>请在“显示指标”中选择需要比较的数值。</p>'}</details>`).join('') + (!visibleGroups.length?'<p class="empty-state">当前查看项目没有差异。</p>':'');
    $('compare-inline').querySelectorAll('[data-compare-detail]').forEach(b=>b.addEventListener('click',()=>openDetail(b.dataset.compareDetail)));
    $('compare-inline').querySelectorAll('.compare-group').forEach((el,i)=>{if(visibleGroups[i]?.note){const note=document.createElement('p');note.className='theme-note';note.textContent=visibleGroups[i].note;el.querySelector('summary').after(note);}});
    const summary=window.PFDSComparisonSummary.summarize(rows.map((p,i)=>({...p,brand:'',product:String.fromCharCode(65+i),flavor:''})),{metrics,focus:priority,differentOnly});
    $('compare-inline').insertAdjacentHTML('afterbegin',`<details class="comparison-summary" aria-label="比较要点"><summary>比较摘要（展开查看）</summary><p class="detail-help">按当前资料整理，不作优劣排名；具体依据可点产品查看。</p><div class="comparison-keys">${rows.map((p,i)=>`<p><strong>${String.fromCharCode(65+i)}</strong> ${esc(p.brand+' · '+readableProductName(p))}</p>`).join('')}</div><dl>${summary.map(item=>`<div><dt>${esc(item.title)}</dt><dd>${esc(item.text)}</dd></div>`).join('')}</dl></details>`);
  }
  $('compare-differences').addEventListener('change', renderComparison);
  $('compare-reset-view').addEventListener('click',()=>{comparisonMetrics=null;$('comparison-focus').value='';$('compare-differences').checked=false;renderComparison();});
  $('comparison-metrics').addEventListener('change',()=>{comparisonMetrics=[...$('comparison-metrics').querySelectorAll('input:checked')].map(input=>input.value);renderComparison();});
  $('comparison-focus').addEventListener('change',renderComparison);
  $('compare-first').addEventListener('change',renderComparison);
  $('compare-second').addEventListener('change',renderComparison);
  mobileMedia.addEventListener('change',renderComparison);
  $('chart-price-range').addEventListener('change',()=>renderScatter(renderScatter.lastRows || filteredProducts()));
  function openCompare() { setAnalysis('compare'); }

  function exportCsv() {
    if (visitorMode) return;
    const projection = window.PetFoodCatalogExport.project(products, tableState, queryValues());
    const csv = window.PetFoodCatalogExport.csv(projection);
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
    link.download = `pet-food-filtered-${new Date().toISOString().slice(0,10)}.csv`;
    link.hidden = true; document.body.appendChild(link); link.click();
    // Allow the browser to accept the download before retiring its object URL.
    setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
  }

  async function render() {
    const requestState=JSON.stringify(queryValues());
    try { await window.PFDSRelease.prepare(queryValues()); } catch(e) { $("query-summary").textContent=e.message; return; }
    if(requestState!==JSON.stringify(queryValues())) return;
    $('mobile-search').value=$('search').value;
    syncPriceSliders();
    const moreCount = document.querySelectorAll('#more-filters input, #more-filters select');
    const applied = [...moreCount].filter(control => control.value.trim() !== '').length;
    $('more-filter-count').textContent = applied ? `· 已用 ${applied} 项` : '成分、描述、情报记录';
    const rows = filteredProducts(); renderSummary(rows); renderScatter(rows); renderScoring(rows); renderTable(rows); updateCompareState();
    const conditions = activeConditions();
    $('query-summary').innerHTML = `<strong>${conditions.length ? '同时满足' : '当前显示全部产品'}</strong>${conditions.map(item => `<span class="chip">${esc(item)}</span>`).join('')}<small>当前结果：${rows.length}款</small>`;
    renderSample();
  }

  const viewStore = window.PetFoodViews;
  let deletedView = null, pendingDelete = null;
  const viewMessage = message => { $('view-message').textContent = message; };
  function refreshViews(preferred = $('saved-view').value) {
    const views = viewStore.read(localStorage);
    $('saved-view').innerHTML = '<option value="">请选择方案</option>' + views.map(v =>
      `<option value="${esc(v.name)}">${esc(v.name)} · ${v.selected.length}款已选</option>`).join('');
    $('saved-view').value = views.some(v => v.name === preferred) ? preferred : '';
    $('restore-view').disabled = $('delete-view').disabled = !$('saved-view').value;
    pendingDelete = null; $('delete-view').textContent = '删除方案';
  }
  function viewAction(action) {
    try { action(); }
    catch (error) { viewMessage(`方案操作未完成：${error.message} 产品资料不受影响。`); }
  }
  $('save-view').addEventListener('click', () => viewAction(() => {
    if (scoreError) throw new Error(`评分配置无效：${scoreError}，请改正后保存。`);
    if (!$('view-name').value.trim()) { viewMessage('请先填写方案名称。'); return; }
    const saved = viewStore.add(localStorage, { name: $('view-name').value, query: queryValues(),
      sort: $('list-sort').value, table:tableState, selected: [...selected], origin,
      chart: { ...axes, priceOrigin: origin.pricePerJin,conditionOrigin:origin.conditionScore }, scoring: scoreConfig, evaluation:trialUI.getConfig(),analysis:autoUI.getConfig() });
    refreshViews(saved.name); viewMessage(`已保存「${saved.name}」：${filteredProducts().length}款匹配、${selected.size}款已选。`);
  }));
  $('saved-view').addEventListener('change', () => viewAction(() => { refreshViews(); viewMessage('恢复将替换当前筛选和已选产品，不写回任何产品资料。'); }));
  $('restore-view').addEventListener('click', () => viewAction(() => {
    const view = viewStore.read(localStorage).find(v => v.name === $('saved-view').value);
    if (!view) { refreshViews(); viewMessage('方案已不存在，请重新选择。'); return; }
    const options = Object.fromEntries(Object.entries(controls).filter(([, c]) => c.tagName === 'SELECT')
      .map(([key, c]) => [key, [...c.options].map(o => o.value)]));
    const restored = viewStore.resolve(view, products, options);
    if (restored.unavailable.length) { viewMessage(`未恢复：部分条件已不在当前选项中（${restored.unavailable.map(k => view.query[k]).join('、')}）。原方案保留，请按最新资料重新设置并另存。`); return; }
    for (const [key, control] of Object.entries(controls)) {
      if (control.type === 'checkbox') control.checked = restored.query[key];
      else control.value = restored.query[key];
    }
    coreOnly = restored.query.coreStatus === 'confirmed'; syncCoreToggle();
    $('list-search').value = controls.search.value; tableState = restored.table; saveTableState(); syncSortControls(restored.sort);
    selected.clear(); restored.selected.forEach(id => selected.add(id));
    Object.assign(origin, restored.origin, { pricePerJin: restored.chart.priceOrigin,conditionScore:restored.chart.conditionOrigin??50 });
    Object.assign(axes, { x: restored.chart.x, y: restored.chart.y, color: restored.chart.color, size: restored.chart.size }); syncChartControls();
    workState.mode = [axes.x,axes.y].includes('pricePerJin') ? 'price' : 'nutrition'; syncWorkspace();
    scoreConfig = restored.scoring; scoreError = ''; syncScoreControls();
    trialUI.setConfig(restored.evaluation);
    autoUI.setConfig(restored.analysis);
    currentPage = 1; render();
    viewMessage(`已恢复「${view.name}」：当前${filteredProducts().length}款匹配、${selected.size}款已选。${restored.missing.length ? `${restored.missing.length}个已选SKU已不在当前库中，已跳过；没有替换成其他产品。` : '需要比较时点击“横向比较”。'}`);
  }));
  $('delete-view').addEventListener('click', () => viewAction(() => {
    const name = $('saved-view').value;
    if (pendingDelete !== name) { pendingDelete = name; $('delete-view').textContent = '确认删除方案'; viewMessage(`仅删除「${name}」的查看设置，不删除SKU；删除后可在本页撤销。`); return; }
    deletedView = viewStore.remove(localStorage, name); refreshViews('');
    $('undo-delete-view').hidden = false; viewMessage(`已删除「${name}」。刷新前可撤销此次删除，产品资料未改动。`);
  }));
  $('undo-delete-view').addEventListener('click', () => viewAction(() => {
    if (!deletedView) return;
    const restored = viewStore.add(localStorage, deletedView); refreshViews(restored.name);
    deletedView = null; $('undo-delete-view').hidden = true; viewMessage(`已恢复方案「${restored.name}」。`);
  }));
  viewAction(() => refreshViews());
  const filterChanged = () => { currentPage = 1; render(); };
  function syncCoreToggle() {
    const button = $('core-toggle');
    const confirmed = products.filter(p => p.coreRoleStatus === 'confirmed').length;
    button.disabled = confirmed === 0;
    button.setAttribute('aria-pressed', String(coreOnly));
    button.innerHTML = `${coreOnly ? '显示全部产品' : '只看核心产品'} <span id="core-count">(${confirmed})</span>`;
    $('core-quick-status').textContent = confirmed === 0
      ? '尚未确认任何核心产品；在表格“核心”列勾选或在单款编辑中确认后，即可一键查看。'
      : coreOnly
        ? `当前仅显示人工确认核心 ${confirmed} 款；再点一次显示全部产品。`
        : `核心产品由你在后台逐款人工标定（已确认 ${confirmed} 款）；点按钮一键查看，再点一次显示全部。`;
  }
  function setCoreOnly(next) {
    if (coreOnly === next) return;
    coreOnly = next;
    syncCoreToggle();
    filterChanged();
  }
  $('core-toggle').addEventListener('click', () => setCoreOnly(!coreOnly));
  function syncPriceSliders() {
    const limit = scatter.priceLimit(products,controls.priceMin.value,controls.priceMax.value);
    $('price-slider-min').max = $('price-slider-max').max = limit;
    $('price-slider-min').value = controls.priceMin.value || 0;
    $('price-slider-max').value = controls.priceMax.value || limit;
    $('price-slider-label').textContent = `${controls.priceMin.value || '不限'} — ${controls.priceMax.value || '不限'} 元/斤 · 滑到两端为不限`;
  }
  for (const end of ['min','max']) $('price-slider-'+end).addEventListener('input', () => {
    const slider = $('price-slider-'+end), value = Number(slider.value), key = end === 'min' ? 'priceMin' : 'priceMax';
    controls[key].value = (end === 'min' && value === 0) || (end === 'max' && value === Number(slider.max)) ? '' : slider.value;
    if (controls.priceMin.value && controls.priceMax.value && Number(controls.priceMin.value) > Number(controls.priceMax.value)) controls[end === 'min' ? 'priceMax' : 'priceMin'].value = controls[key].value;
    filterChanged();
  });
  $('clear-price').addEventListener('click', () => { controls.priceMin.value = controls.priceMax.value = ''; filterChanged(); });
  $('point-color').addEventListener('change', () => { axes.color = $('point-color').value; controls.legendCategory.value = controls.legendMode.value = ''; filterChanged(); });
  $('point-size').addEventListener('change', () => { axes.size = $('point-size').value; renderScatter(filteredProducts()); });
  controls.search.addEventListener('input', () => { $('list-search').value = controls.search.value; filterChanged(); });
  $('list-search').addEventListener('input', () => { controls.search.value = $('list-search').value; filterChanged(); });
  Object.entries(controls).filter(([key]) => key !== 'search').forEach(([,control]) => control.addEventListener('change', filterChanged));
  ['protein-min','protein-max','fat-min','fat-max','price-min','price-max','ingredient-keyword','description-keyword',
    ...['phosphorus','chloride','animal-ingredient','animal-protein'].flatMap(key=>[key+'-min',key+'-max'])].forEach(id => $(id).addEventListener('input', filterChanged));
  for (const axis of ['x','y']) {
    $(`${axis}-axis`).addEventListener('change', () => {
      const other = axis === 'x' ? 'y' : 'x', value = $(`${axis}-axis`).value;
      if (value === axes[other]) axes[other] = axes[axis];
      axes[axis] = value; syncChartControls(); renderScatter(filteredProducts());
      workState.mode = [axes.x,axes.y].includes('pricePerJin') ? 'price' : 'nutrition'; syncWorkspace();
    });
  }
  for (const [axis, id] of [['x', 'protein-origin'], ['y', 'fat-origin']]) {
    const input = $(id);
    input.addEventListener('input', () => {
      const key = axes[axis], value = Number(input.value);
      if (input.value !== '' && Number.isFinite(value) && value >= 0 && (scatter.metrics[key].max === null || value <= scatter.metrics[key].max)) {
        origin[key] = value;
        try { localStorage.setItem('pet-food-scatter-origin-v1', JSON.stringify(origin)); } catch { /* Optional. */ }
        renderScatter(filteredProducts());
      }
    });
    input.addEventListener('change', () => { input.value = origin[axes[axis]]; });
  }
  $('reset-origin').addEventListener('click', () => {
    for (const key of [axes.x, axes.y]) origin[key] = defaultOrigin[key];
    syncChartControls();
    try { localStorage.setItem('pet-food-scatter-origin-v1', JSON.stringify(origin)); } catch { /* Optional. */ }
    renderScatter(filteredProducts());
  });
  function applyTableView(next) {
    tableState = tableView.normalize(next);
    saveTableState(); syncSortControls();
    currentPage = 1; renderTable(filteredProducts());
    if(workState.mode==='compare')renderComparison();
  }
  $('table-preset-select').addEventListener('change', event=>{
    if(event.target.value !== 'custom') applyTableView(tableView.preset(tableState,event.target.value));
  });
  $('product-head').addEventListener('click', event=>{
    const filterButton=event.target.closest('[data-column-filter]');
    if(filterButton){openHeaderFilter(filterButton.dataset.columnFilter,filterButton);return;}
    const button=event.target.closest('[data-column-sort]');
    if(button){const key=button.dataset.columnSort;applyTableView(tableView.headerSort(tableState,key));$('product-head').querySelector(`[data-column-sort="${key}"]`)?.focus({preventScroll:true});}
  });
  // Drag-to-reorder headers (desktop pointer drag; touch devices keep the column panel for show/hide).
  let dragColumnKey = '';
  const clearDropMarks = ()=>$('product-head').querySelectorAll('.drop-before,.drop-after').forEach(th=>th.classList.remove('drop-before','drop-after'));
  const clearDrag = ()=>{ dragColumnKey=''; clearDropMarks(); $('product-head').querySelectorAll('.is-dragging').forEach(th=>th.classList.remove('is-dragging')); };
  $('product-head').addEventListener('dragstart', event=>{
    const th = event.target.closest('th[data-column-key]');
    if(!th){ dragColumnKey=''; return; }
    dragColumnKey = th.dataset.columnKey;
    th.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragColumnKey);
  });
  $('product-head').addEventListener('dragover', event=>{
    if(!dragColumnKey) return;
    const th = event.target.closest('th[data-column-key]');
    if(!th || th.dataset.columnKey===dragColumnKey) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    clearDropMarks();
    const rect = th.getBoundingClientRect();
    th.classList.add(event.clientX < rect.left + rect.width/2 ? 'drop-before' : 'drop-after');
  });
  $('product-head').addEventListener('drop', event=>{
    const th = event.target.closest('th[data-column-key]');
    if(!dragColumnKey || !th || th.dataset.columnKey===dragColumnKey){ clearDrag(); return; }
    event.preventDefault();
    const rect = th.getBoundingClientRect();
    const before = event.clientX < rect.left + rect.width/2;
    applyTableView(tableView.move(tableState, dragColumnKey, th.dataset.columnKey, before));
    clearDrag();
  });
  $('product-head').addEventListener('dragend', clearDrag);
  document.addEventListener('click',event=>{if(!event.target.closest('.header-filter-popover,[data-column-filter]'))closeHeaderFilter();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeHeaderFilter();});
  $('reset-sort').addEventListener('click',()=>applyTableView({...tableState,sort:'source',secondary:''}));
  $('column-search').addEventListener('input',renderColumnOptions);
  $('column-options').addEventListener('change',event=>{
    const key=event.target.dataset.column;
    if(key){applyTableView(tableView.toggle(tableState,key,event.target.checked));$('column-options').querySelector(`[data-column="${key}"]`)?.focus();}
  });
  function changeSecondary() {
    const key=$('secondary-sort').value;
    applyTableView({...tableState,secondary:key?key+'-'+$('secondary-direction').value:''});
  }
  $('secondary-sort').addEventListener('change',changeSecondary);
  $('secondary-direction').addEventListener('change',changeSecondary);
  $('selection-analysis').addEventListener('click',()=>{selectionLab.showSelected();setAnalysis('score');});
  $('jump-edit').addEventListener('click', () => {
    setWorkspace('manage');
    document.querySelector('.products-panel').scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (editorEnabled) controls.search.focus({ preventScroll: true });
    else $('edit-guide').open = true;
  });
  $('select-page').addEventListener('click', () => { visibleSkus.forEach(sku => selected.add(sku)); renderTable(filteredProducts()); });
  $('clear-selection').addEventListener('click', () => { selected.clear(); renderTable(filteredProducts()); });
  $('batch-core').addEventListener('click', openBatchCore);
  $('open-maintenance').addEventListener('click', () => openMaintenance());
  $('jump-verification').addEventListener('click', awaitVerificationPanel);
  $('hide-verification').addEventListener('click', () => { $('verification-panel').hidden = true; });
  ['verification-search', 'verification-priority', 'verification-field', 'verification-status'].forEach(id =>
    $(id).addEventListener(id === 'verification-search' ? 'input' : 'change', () => { verificationPage = 1; renderVerification(); }));
  $('verification-prev').addEventListener('click', () => { if (verificationPage > 1) { verificationPage--; renderVerification(); } });
  $('verification-next').addEventListener('click', () => { verificationPage++; renderVerification(); });
  $('pending-import').addEventListener('click', () => { controls.imported.value = controls.imported.value === '待核验' ? '' : '待核验'; filterChanged(); });
  $('prev-page').addEventListener('click', () => { if (currentPage > 1) { currentPage -= 1; renderTable(filteredProducts()); } });
  $('next-page').addEventListener('click', () => { currentPage += 1; renderTable(filteredProducts()); });
  $('page-size').addEventListener('change', event => { pageSize = [15,30,50].includes(Number(event.target.value)) ? Number(event.target.value) : 15; currentPage = 1; renderTable(filteredProducts()); });
  $('reset-filters').addEventListener('click', () => { Object.values(controls).forEach(control => { if (control.type === 'checkbox') control.checked = false; else control.value = ''; }); setCoreOnly(false); $('list-search').value = ''; tableState = {...tableState,sort:'source',secondary:''}; saveTableState(); syncSortControls(); currentPage = 1; render(); });
  $('open-compare').addEventListener('click', openCompare); $('export-csv').addEventListener('click', exportCsv);
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).hidden = true));
  document.querySelectorAll('.overlay').forEach(overlay => overlay.addEventListener('click', event => { if (event.target === overlay) overlay.hidden = true; }));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') document.querySelectorAll('.overlay').forEach(overlay => overlay.hidden = true); });
  render();
  syncWorkspace();
  document.body.dataset.ready = 'true';
})().catch(error => {
  console.error('工作台初始化失败', error);
  const title = document.getElementById('mode-title');
  const help = document.getElementById('mode-help');
  if (title) title.textContent = '页面加载未完成，请刷新重试';
  if (help) help.textContent = '资料未修改。错误：' + error.message;
  document.body.dataset.loadError = 'true';
  const banner=document.querySelector('.mode-banner');
  if (banner) { const retry=document.createElement('button');retry.type='button';retry.className='primary-button';retry.textContent='重新加载';retry.onclick=()=>location.reload();banner.append(retry); }
});
