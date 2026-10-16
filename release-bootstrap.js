(async()=>{
  document.body.dataset.audience='visitor';
  const status=document.getElementById('release-status');
  const message=document.getElementById('release-message');
  const progress=text=>{message.textContent=text;};
  let payloadPromise;
  const payload = () => payloadPromise ||= (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('./display-a41a1ba46ca69af4.json', {signal:controller.signal});
      if (!response.ok) throw new Error('资料暂时未能加载，请重新加载');
      return await response.json();
    } finally { clearTimeout(timer); }
  })();
  const publicTextQuery = (() => { const module={exports:{}}; const require=()=>({});
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
  function functionEvidence(p, q = {}) {
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
  function evidenceFunctionEvidence(p, q = {}) {
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
  function functionRaw(p) {
    return String(p?.details?.function_raw ?? p?.functionRaw ?? '').trim();
  }
  function functionValues(p) {
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
  function coreRaw(p) {
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
  function textEvidence(p, q) {
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
  function themes(p) { return Object.keys(themePatterns).filter(theme => textEvidence(p, {theme}) !== null); }
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

return module.exports;
 })();
  const get = async url => {
    const p = await payload(), u = new URL(url, location.origin);
    if(u.pathname === '/api/release') return {...p,total:p.products.length};
    if(u.searchParams.get('revision') !== p.revision) throw new Error('资料已更新，请重新加载');
    if(u.pathname === '/api/products') return {revision:p.revision,products:p.products.slice(Number(u.searchParams.get('offset')),Number(u.searchParams.get('offset'))+25)};
    if(u.pathname.startsWith('/api/products/')) return {product:p.details[decodeURIComponent(u.pathname.split('/').pop())]};
    if(u.pathname === '/api/text-search') return Object.fromEntries(Object.values(p.details).map(row=>[row.skuId,publicTextQuery.textEvidence(row,JSON.parse(u.searchParams.get('q')))]));
    throw new Error('未知资料请求');
  };
  try {
    const info=await get('/api/release'),products=[];
    const pages=new Array(Math.ceil(info.total/25));
    let cursor=0,loaded=0;
    await Promise.all(Array.from({length:Math.min(4,pages.length)},async()=>{
      while(cursor<pages.length){
        const index=cursor++;
        const page=await get('/api/products?revision='+encodeURIComponent(info.revision)+'&offset='+index*25);
        if(page.revision!==info.revision)throw new Error('资料已更新，请重新加载');
        pages[index]=page.products;loaded+=page.products.length;
        progress('正在载入产品 '+loaded+' / '+info.total);
      }
    }));
    products.push(...pages.flat());
    if(products.length!==info.total)throw new Error('资料不完整，请刷新');
    window.PET_FOOD_DATA={meta:info.meta,fieldDefinitions:info.fieldDefinitions,brandFacts:info.brandFacts,products};
    window.PET_FOOD_FACTORY_DATA=info.factories;
    window.PET_FOOD_BRAND_PROFILE_DATA=info.profiles;
    window.PetFoodStudyFunctions=[];
    const inflight=new Map(),texts=new Map();
    const textQuery=q=>Object.fromEntries(['theme','themeKeyword','ingredients','descriptionKeyword'].filter(k=>q[k]).map(k=>[k,q[k]]));
    const textKey=q=>JSON.stringify(textQuery(q));
    window.PFDSRelease={
      async detail(id){
        const product=products.find(p=>p.skuId===id);
        if(!product)throw new Error('未找到产品');
        if(product.details)return product;
        if(!inflight.has(id))inflight.set(id,get('/api/products/'+encodeURIComponent(id)+'?revision='+info.revision).then(r=>{Object.assign(product,r.product);return product;}).finally(()=>inflight.delete(id)));
        return inflight.get(id);
      },
      async prepare(q){const key=textKey(q);if(key==='{}'||texts.has(key))return;
        texts.set(key,await get('/api/text-search?revision='+info.revision+'&q='+encodeURIComponent(key)));},
      textEvidence(p,q){const key=textKey(q);return key==='{}'?[]:(texts.get(key)?.[p.skuId]??null);}
    };
    // Candidates were validated against the original snapshot at build time.
    const candidate=(kind,p,stamp)=>p.publicCandidates?.[kind]?{...p.publicCandidates[kind],snapshot:stamp}:null;
    window.PFDSSelectionPilot={candidate:(p,s)=>candidate('pilot',p,s)};
    window.PFDSSelectionReviewed={candidate:(p,s)=>candidate('reviewed',p,s),resolve:(p,s,saved)=>candidate('reviewed',p,s)||saved};
    progress('正在准备图表与筛选…');
    for(const src of ["release-app-46e21d38d4b8ab44.js"]) await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('页面程序加载超时，请重新加载')),20000);
      const script=document.createElement('script');script.src=src;
      script.onload=()=>{clearTimeout(timer);resolve();};
      script.onerror=()=>{clearTimeout(timer);reject(new Error('页面程序加载失败，请重新加载'));};
      document.head.append(script);
    });
    const started=Date.now();
    while(document.body.dataset.ready!=='true'){
      if(document.body.dataset.loadError==='true'||Date.now()-started>20000)throw new Error('页面初始化未完成，请重新加载');
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    status.hidden=true;
  } catch(error) {
    document.body.dataset.loadError='true';
    progress(error.message);
    document.getElementById('release-retry').hidden=false;
  }
})();
