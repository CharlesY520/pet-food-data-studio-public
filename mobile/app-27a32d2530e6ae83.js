(function(){
  'use strict';
  const app = document.getElementById('app');
  const sheet = document.getElementById('sheet');
  const sheetBody = document.getElementById('sheet-body');
  const message = document.getElementById('message');
  const products = mobileCatalog.products;
  const publicLoader = typeof publicMobileDetails === 'undefined' ? null : publicMobileDetails;
  let detailsReady = false, detailsRequest = null, detailsError = false;
  function fetchDetails(){
    if(detailsRequest)return;
    detailsError=false;
    const script=document.createElement('script');
    detailsRequest=script;
    script.src='details.js';
    script.onload=()=>{
      for(const [key,entry] of bySku)Object.assign(entry.item,mobileDetails[key]||{});
      detailsReady=true;
      if(['detail','compare','entity'].includes(getRoute().page))render();
    };
    script.onerror=()=>{detailsRequest=null;detailsError=true;script.remove();render();};
    document.head.append(script);
  }
  const bySku = new Map(products.flatMap(product => product.items.map(item => [item.id, {product, item}])));
  const tabs = {
    detail: ['营养与配料', '工艺与检测', '品牌与工厂'],
    compare: ['营养指标', '配料', '工艺与检测', '生产']
  };
  const nutrients={protein:'粗蛋白',fat:'粗脂肪'};
  const advancedMetrics=mobileCatalog.metrics.filter(m=>products.some(p=>p.items.some(v=>v.readings?.[m.key])));
  const metricByKey=new Map(advancedMetrics.map(m=>[m.key,m]));
  const firmLabels={production:'生产方式',origin:'产地属性',factoryId:'生产工厂',brandYear:'品牌创立或推出年份',factoryYear:'工厂成立年份',factoryScale:'工厂规模记录'};
  const firmKeys=Object.keys(firmLabels);
  const quickSortKeys=['price','protein','fat'];
  const sortFields={price:'参考价格',...nutrients,...Object.fromEntries(advancedMetrics.map(m=>[m.key,m.label])),...firmLabels};
  const collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
  const blankFirm=Object.fromEntries(firmKeys.map(k=>[k,'']));
  const rangeLabels={price:'每斤预算',...nutrients};
  const rangeKeys=Object.keys(rangeLabels).flatMap(key=>[key+'Min',key+'Max']);
  const sortOptions={default:'默认排序','price-asc':'价格从低到高','price-desc':'价格从高到低','protein-desc':'粗蛋白从高到低','protein-asc':'粗蛋白从低到高','fat-desc':'粗脂肪从高到低','fat-asc':'粗脂肪从低到高'};
  const blankFilters=()=>({search:'',brand:'',stage:'',process:'',flavor:'',func:'',metrics:{},...blankFirm,...Object.fromEntries(rangeKeys.map(k=>[k,'']))});
  function restoreFilters(saved={}){
    const next=blankFilters();
    if(saved.metrics&&typeof saved.metrics==='object')next.metrics=Object.fromEntries(Object.entries(saved.metrics).filter(([k,c])=>metricByKey.has(k)&&c&&typeof c==='object'));
    for(const key of Object.keys(next))if(key!=='metrics'&&typeof saved[key]==='string')next[key]=saved[key];
    // The original budget buttons stored a single upper bound.
    if(saved.priceMax===undefined&&typeof saved.budget==='string')next.priceMax=saved.budget;
    return next;
  }
  let sort='default';
  let filters=blankFilters(),scope='core',limit=12,entityLimit=10,directoryQuery='';
  let picked = [];
  const sessionKey = 'cat-food-mini-catalog-v2';
  try {
    const saved=JSON.parse(sessionStorage.getItem(sessionKey)||'{}');
    if(saved.scope==='all')scope='all';
    if(saved.sort==='default'||Object.hasOwn(sortFields,String(saved.sort).split('-')[0])&&/-(asc|desc)$/.test(saved.sort))sort=saved.sort;
    filters=restoreFilters(saved.filters);
    if(Array.isArray(saved.picked)) picked=[...new Set(saved.picked.filter(k=>bySku.has(k)))].slice(0,2);
  } catch { /* Private browsing can disable storage. */ }
  function saveView() {
    try { sessionStorage.setItem(sessionKey,JSON.stringify({picked,filters,scope,sort})); } catch { /* The open view still works. */ }
  }
  let listY = 0;
  let modalAction = null;
  const id = key => document.getElementById(key);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const known = value => value !== null && value !== undefined && value !== '';
  const percent = value => known(value) ? `≥${value}%` : '未收录';
  const price = v => known(v.price) ? `${v.price} 元/斤` : '未收录';
  const name = p => [p.brand,p.series,p.title].filter(Boolean).join(' · ');
  const variant = v => `${v.flavor} · ${v.stage}`;
  const closeSheet = () => { if (sheet.open) sheet.close(); modalAction=null; };
  const notify = text => { message.textContent = text; };
  const action = (type, text, cls='', attrs='') => `<button type="button" class="${cls}" data-action="${type}" ${attrs}>${text}</button>`;
  const skuAttr = v => `data-sku="${safe(v.id)}"`;
  const getRoute = () => {
    const q = new URLSearchParams(location.hash.slice(1));
    const page = q.get('page');
    const sku = q.get('sku');
    const kind=q.get('kind')==='factory'?'factory':'brand', id=q.get('id');
    if(page==='intel'||page==='brands')return {page,kind,region:['domestic','overseas'].includes(q.get('region'))?q.get('region'):'all'};
    if(page==='map')return {page,mode:['priceProtein','priceFat'].includes(q.get('mode'))?q.get('mode'):'nutrition',zoom:q.get('zoom')==='100'?'100':'all',point:q.get('point')||''};
    if(page==='entity' && (kind==='factory'?factoryById:brandById).has(id))return {page,kind,id,...(q.get('section')==='news'?{section:'news'}:{})};
    if (page === 'detail' && bySku.has(sku)) return {page,sku,tab:validTab(q.get('tab'),tabs.detail)};
    if (page === 'compare') return {page,tab:validTab(q.get('tab'),tabs.compare)};
    return {page:'list'};
  };
  function validTab(value, options) {
    const index = Number(value);
    return Number.isInteger(index) && index>=0 && index<options.length ? index : 0;
  }
  function snapshot(){return {filters:{...filters},scope,sort,limit,entityLimit,directoryQuery,y:window.scrollY};}
  function restore(s){if(!s)return;filters=restoreFilters(s.filters);scope=s.scope||'core';sort=s.sort||'default';limit=s.limit||12;entityLimit=s.entityLimit||10;directoryQuery=s.directoryQuery||'';}
  function navigate(route, replace=false, setup) {
    if (getRoute().page==='list') listY=window.scrollY;
    if(!replace) history.replaceState({...history.state,view:snapshot()},'');
    if(setup)setup();
    const url = route.page==='list' ? location.pathname+location.search : '#'+new URLSearchParams(route).toString();
    history[replace?'replaceState':'pushState']({mini:replace?Boolean(history.state?.mini):true},'',url);
    closeSheet(); render();
    if(route.section==='news'&&id('entity-news'))id('entity-news').scrollIntoView({block:'start'});
    else window.scrollTo(0,route.page==='list'&&!setup?listY:0);
  }
  function back() {
    closeSheet();
    if(history.state?.mini) history.back();
    else navigate({page:'list'},true);
  }
  const brandById=new Map(mobileCatalog.brands.map(b=>[b.id,b]));
  const factoryById=new Map(mobileCatalog.factories.map(f=>[f.id,f]));
  const allItems=[...bySku.values()];
  const stages=['幼猫','成猫','老年猫','全阶段'];
  const processes=[...new Set(allItems.map(x=>x.item.process).filter(Boolean))].sort();
  const functions=[...new Set(allItems.flatMap(x=>x.item.functions))].sort();
  const fishNames=/鱼|鳕|鲑|鳟|鲣|鲭|鲷|鲽|鲱|鲔|鲨|鳀/;
  const tastes={'鱼类':fishNames,'三文鱼':/三文鱼|鲑鱼/,'鳀鱼':/鳀鱼/,'鳕鱼':/鳕鱼/,'鸡肉':/鸡(?!蛋)|乌鸡/,'鸭肉':/鸭/,'牛肉':/牛肉|牛羊|鸡牛|安格斯牛/,'羊肉':/羊肉|牛羊|草饲羊/,'兔肉':/兔/,'乳鸽':/鸽/,'火鸡':/火鸡/,'虾类':/虾|海米/};
  const filterLabels={stage:'标注阶段',process:'主粮工艺',flavor:'口味',func:'功能分类'};
  function searchesFullCatalog(f){
    return Boolean(f.search.trim()||f.brand||Object.keys(f.metrics||{}).length||
      [...Object.keys(filterLabels),...rangeKeys,...firmKeys].some(k=>k!=='origin'&&f[k]));
  }
  function withinRange(v,f,key){
    const lo=f[key+'Min'],hi=f[key+'Max'];
    if(lo===''&&hi==='')return true;
    return Number.isFinite(v[key])&&(lo===''||v[key]>=Number(lo))&&(hi===''||v[key]<=Number(hi));
  }
  function normalize(str){return String(str||'').normalize('NFKC').toLowerCase().replace(/成年猫|成年期/g,'成猫').replace(/幼年猫|幼年期/g,'幼猫');}
  const dictionary=[...new Set([...mobileCatalog.brands.map(b=>b.short),...stages,...processes,...Object.keys(tastes),...functions,'超能奶盾','奶糕','猫粮'])].filter(Boolean).sort((a,b)=>b.length-a.length);
  const tokenPattern=new RegExp('('+dictionary.map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+'|[\\s+·、]+)','gi');
  function searchTerms(q){return normalize(q).split(tokenPattern).filter(t=>t && t!=='猫粮'&&!/^[\s+·、]+$/.test(t));}
  function tasteMatch(v,choice){
    let label=v.filterFlavor.replace(/鱼油|鳀鱼油|三文鱼油|鸡油|羊奶|牛乳|牛奶/g,'');
    if(choice==='鸡肉')label=label.replace(/火鸡/g,'');
    return tastes[choice]?.test(label) ?? false;
  }
  function passesAdvanced(v,f){
    for(const key of firmKeys){
      const wanted=f[key];
      if(!wanted)continue;
      const value=v[key];
      if(wanted==='@missing'?known(value):wanted==='@known'?!known(value):String(value)!==wanted)return false;
    }
    return Object.entries(f.metrics||{}).every(([key,c])=>{
      const m=v.readings?.[key];
      if(c.mode==='missing')return !m;
      if(!m||c.mode==='bounded'&&!m.bounded||c.mode==='comparable'&&!m.comparable)return false;
      return (c.low===''||m.value>=Number(c.low))&&(c.high===''||m.value<=Number(c.high));
    });
  }
  function matches(p,f=filters,terms=searchTerms(f.search)){
    if(f.brand && f.brand!==p.brandId)return [];
    const base=normalize(name(p)+' '+brandById.get(p.brandId).name);
    return p.items.filter(v=>{
      const hay=base+' '+normalize([v.lookup,v.flavor,v.age,v.stage,v.process].join(' '));
      return terms.every(t=>hay.includes(normalize(t))) && (!f.stage||v.stage===f.stage)
        && (!f.process||v.process===f.process) && withinRange(v,f,'price')
        && withinRange(v,f,'protein') && withinRange(v,f,'fat') && passesAdvanced(v,f)
        && (!f.flavor||tasteMatch(v,f.flavor)) && (!f.func||v.functions.includes(f.func));
    });
  }
  function foundProducts(f=filters){
    const terms=searchTerms(f.search),core=!searchesFullCatalog(f)&&scope==='core';
    return products.map(p=>[p,matches(p,f,terms)]).filter(([,rows])=>rows.length&&(!core||rows.some(v=>v.core)));
  }
  function representative(rows){return rows.find(v=>v.core)||(rows.length===1?rows[0]:null);}
  function sortedProducts(found){
    if(sort==='default')return found;
    const [metric,direction]=sort.split('-');
    return found.sort(([,rowsA],[,rowsB])=>{
      const a=orderValue(representative(rowsA),metric),b=orderValue(representative(rowsB),metric);
      if(!known(a)||!known(b))return Number(known(b))-Number(known(a));
      const diff=typeof a==='number'&&typeof b==='number'?a-b:collator.compare(String(a),String(b));
      return direction==='asc'?diff:-diff;
    });
  }
  function orderValue(v,key){
    if(!v)return null;
    if(metricByKey.has(key)){const m=v.readings[key];return m&&!m.boundOnly?m.value:null;}
    if(key==='factoryId')return v.factoryId?v.factory:null;
    return v[key];
  }
  function firmText(key,value){
    if(value==='@missing')return '未明确';
    if(value==='@known')return '有记录';
    if(key==='factoryId')return factoryById.get(value)?.name||'未明确';
    if(key.endsWith('Year'))return value+' 年';
    if(key==='production'&&value==='自有')return '自有工厂';
    return value;
  }
  const functionNote='按品牌对这款配方明确提出的功能主张归类。仅在口味名中出现，或只添加了某种原料，不据此归类。';
  const nutritionNote='营养数据整理自产品包装、品牌商品详情页等公开资料。粗蛋白、粗脂肪按标示保证值展示，检测结果另列。';
  function guideButton(){
    return action('guide','说明','guide-link','aria-label="使用与指标说明"');
  }
  function cover(){
    return '<header class="print-cover"><img class="cover-art" src="directions/blue-print.webp" alt="" fetchpriority="high"><div class="cover-type"><span class="cover-brand"><img src="charles-c.png" alt="">Charles 的 AI 小灶</span><h1>猫粮<br>工作台</h1></div></header>';
  }
  function guide(){
    const sections=[
      ['功能分类',functionNote],
      ['营养指标',nutritionNote+' ≥ 表示最低保证值，≤ 表示最高保证值。比较两款时也要留意单位和标示基准。'],
      ['参考价与口味','参考价按具体口味折算为元/斤，购买时可再核对规格和到手价。一款产品有多个口味时，默认优先显示核心口味。'],
      ['分布图','每个位置对应一组坐标。圆越大，落在这里的配方越多。朱红双圈标出你当前选中的位置。']
    ];
    show('使用与指标说明',sections.map(([title,body])=>para(title,body)).join('')+(publicLoader?'<p><a href="../">打开电脑网页版</a></p>':''),null);
  }
  function bottomNav(page){
    const selected=page==='compare'?'compare':['entity','intel'].includes(page)?'intel':'home';
    const links=[['home','找粮'],['compare','对比'],['intel','情报库']].map(([key,label])=>{
      const badge=key==='compare'&&picked.length?`<small class="nav-count">${picked.length}</small>`:'';
      const attrs=key===selected?'aria-current="page"':'';
      return action(key,`<i class="nav-icon nav-${key}" aria-hidden="true"></i>${badge}<span>${label}</span>`,'nav-tab',attrs);
    }).join('');
    return `<footer class="dock"><nav aria-label="主要页面">${links}</nav>${picked.length?clearComparisonButton():''}</footer>`;
  }
  function chip(key,label){return action('clear-filter',safe(label)+' ×','chip',`data-key="${key}" aria-label="清除${safe(label)}"`);}
  function chips(){
    const ranges=Object.entries(rangeLabels).map(([k,label])=>{
      const lo=filters[k+'Min'],hi=filters[k+'Max'];
      if(!lo&&!hi)return '';
      return chip(k,label+(lo&&hi?` ${lo}–${hi}`:lo?` ≥${lo}`:` ≤${hi}`)+(k==='price'?'元/斤':'%'));
    });
    return [filters.brand?chip('brand',brandById.get(filters.brand)?.short||'品牌'):'',...Object.keys(filterLabels).filter(k=>filters[k]).map(k=>chip(k,filters[k])),...ranges,...firmKeys.filter(k=>filters[k]&&!(k==='origin'&&['国产','进口'].includes(filters.origin))).map(k=>chip(k,firmLabels[k]+' · '+firmText(k,filters[k]))),...Object.entries(filters.metrics).map(([k,c])=>chip('metric-'+k,criterionLabel(k,c)))].join('');
  }
  function resetResultWindow(){limit=12;listY=0;}
  function listPage(){
    return `${cover()}<div class="home-search"><label class="search"><span class="lens" aria-hidden="true"></span><span class="sr">搜索品牌、产品或口味</span><input type="search" id="search" placeholder="搜品牌、产品或口味" value="${safe(filters.search)}"></label>${guideButton()}</div><div class="routes">${action('brands','按品牌找','routebtn')}${action('filter','条件筛选','routebtn')}${action('map','分布图 ↗','routebtn')}</div><div class="chips">${chips()}</div><section class="results" id="results">${results()}</section>`;
  }
  function results(){
    const found=sortedProducts(foundProducts()),active=searchesFullCatalog(filters),shown=found.slice(0,limit);
    const scopeSwitch=active?'':`<div class="switch">${action('scope','核心产品',scope==='core'?'chosen':'','data-mode="core"')}${action('scope','全部产品',scope==='all'?'chosen':'','data-mode="all"')}</div>`;
    const originSwitch='<div class="quick-origin" role="group" aria-label="产品产地">'+['国产','进口'].map(value=>
      action('origin',value,filters.origin===value?'chosen':'',`data-value="${value}" aria-pressed="${filters.origin===value}"`)).join('')+'</div>';
    const title=filters.brand?brandById.get(filters.brand)?.short:active?'匹配产品':'';
    const brandLink=filters.brand?entityButton('brand',filters.brand,'品牌档案'):'';
    const [orderKey,dir]=sort.split('-');
    const advancedSort=sort!=='default'&&!quickSortKeys.includes(orderKey);
    const current=advancedSort?'<option value="'+safe(sort)+'" selected>'+safe(sortFields[orderKey])+(dir==='asc'?' ↑':' ↓')+'</option>':'';
    const sorting=`<select aria-label="产品排序" id="order">${Object.entries(sortOptions).map(([key,label])=>`<option value="${key}" ${key===sort?'selected':''}>${label}</option>`).join('')}${current}<option value="more">更多排序指标…</option></select>`;
    return `<div class="result-title">${title?`<h2>${safe(title)}</h2>`:scopeSwitch}${originSwitch}</div><div class="result-tools">${sorting}<small class="result-count">${found.length} 个产品</small></div>${brandLink}${shown.length?columnHead():''}${shown.map(([p,rows])=>productRow(p,rows)).join('')}${!found.length?`<div class="empty">没有匹配的产品${action('reset','清除搜索和筛选','link')}</div>`:''}${found.length>limit?action('more',`再看 ${Math.min(12,found.length-limit)} 个产品`,'more'):''}`;
  }
  const modes={declared:'标示数值',bounded:'明确上限或等值',comparable:'单位与分母明确',missing:'无可筛数值'};
  function criterionLabel(key,c){
    const m=metricByKey.get(key);
    const bounds=c.low!==''&&c.high!==''?c.low+'–'+c.high:c.low!==''?'最低 '+c.low:c.high!==''?'最高 '+c.high:'';
    return [m.label,modes[c.mode],bounds&&bounds+m.unit].filter(Boolean).join(' · ');
  }
  function metricOptions(){
    return advancedMetrics.map(m=>'<option value="'+m.key+'">'+safe(m.label)+'（'+safe(m.unit)+'）</option>').join('');
  }
  function extraReadings(v){
    const key=sort.split('-')[0];
    const keys=new Set([...Object.keys(filters.metrics),...firmKeys.filter(k=>filters[k])]);
    if(key!=='default'&&!quickSortKeys.includes(key))keys.add(key);
    if(!keys.size||!v)return '';
    const values=[...keys].map(k=>{
      const m=v.readings[k],def=metricByKey.get(k);
      const text=def?(m?(m.sign||'')+Number(m.value.toFixed(5))+def.unit+(m.basis?' · '+m.basis:''):'未记录可比值')
        :known(v[k])?firmText(k,v[k]):'未明确';
      return sortFields[k]+' '+text;
    });
    return '<p class="extra-values">'+safe(values.join('　·　'))+'</p>';
  }
  function openSortSheet(){
    const [key,dir]=sort.split('-');
    const firms=firmKeys.map(k=>'<option value="'+k+'">'+firmLabels[k]+'</option>').join('');
    const basics=quickSortKeys.map(k=>'<option value="'+k+'">'+sortFields[k]+'</option>').join('');
    const controls='<label>排序指标<select id="sort-metric"><optgroup label="常用">'+basics+'</optgroup><optgroup label="品牌与工厂">'+firms+'</optgroup><optgroup label="营养与检测">'+metricOptions()+'</optgroup></select></label>'
      +'<label>顺序<select id="sort-direction"><option value="asc">升序（小到大、早到晚）</option><option value="desc">降序（大到小、晚到早）</option></select></label>';
    show('更多排序指标','<div class="advanced-fields">'+controls+'</div>'+action('sort-apply','应用排序','primary'),type=>{
      if(type!=='sort-apply')return;
      sort=id('sort-metric').value+'-'+id('sort-direction').value;
      resetResultWindow();closeSheet();render();window.scrollTo(0,0);
    });
    id('sort-metric').value=Object.hasOwn(sortFields,key)?key:'phosphorus';
    id('sort-direction').value=dir||'asc';
  }
  function filterSheet(){
    const draft=structuredClone(filters);
    const choices={stage:stages,process:processes,flavor:Object.keys(tastes),func:functions};
    const count=()=>foundProducts(draft).length;
    function metricRows(){
      return Object.entries(draft.metrics).map(([k,c])=>{
        const def=metricByKey.get(k);
        const permitted=['declared',...(['phosphorus','chloride'].includes(k)?['bounded']:[]),...(['animalIngredient','animalProtein'].includes(k)?['comparable']:[]),'missing'];
        const mode=permitted.map(m=>'<option value="'+m+'" '+(m===c.mode?'selected':'')+'>'+modes[m]+'</option>').join('');
        const ranges=['low','high'].map((bound,i)=>'<input type="number" inputmode="decimal" step="any" min="0" '+(def.unit==='%'?'max="100" ':'')+'data-bound="'+bound+'" aria-label="'+safe(def.label)+(i?'最高':'最低')+'" placeholder="'+(i?'最高':'最低')+'" value="'+safe(c[bound])+'" '+(c.mode==='missing'?'disabled':'')+'>').join('<span>至</span>');
        return '<div class="metric-condition" data-condition="'+k+'"><div class="metric-heading"><b>'+safe(def.label)+'（'+safe(def.unit)+'）</b>'+action('remove-metric','移除','link','data-key="'+k+'"')+'</div><select aria-label="'+safe(def.label)+'筛选口径" data-mode-select>'+mode+'</select><div class="metric-bounds">'+ranges+'</div></div>';
      }).join('');
    }
    function firmControls(){
      return firmKeys.map(k=>{
        const choices=[...new Set(allItems.map(x=>x.item[k]).filter(known).map(String))].sort((a,b)=>collator.compare(firmText(k,a),firmText(k,b)));
        const options=['','@known','@missing',...choices].map(val=>'<option value="'+safe(val)+'" '+(val===draft[k]?'selected':'')+'>'+safe(val?firmText(k,val):'不限')+'</option>').join('');
        return '<label>'+firmLabels[k]+'<select data-firm="'+k+'">'+options+'</select></label>';
      }).join('');
    }
    function contents(){
      const groups=Object.entries(filterLabels).map(([key,label])=>{
        const buttons=['',...choices[key]].map(value=>action('draft',safe(value||'不限'),draft[key]===value?'choice chosen':'choice',`data-key="${key}" data-value="${safe(value)}" aria-pressed="${draft[key]===value}"`)).join('');
        return `<fieldset><legend>${label}</legend>${key==='func'?`<p class="hint field-note">${functionNote}</p>`:''}<div class="choices">${buttons}</div></fieldset>`;
      });
      function rangeRow(key,label){
        const isPrice=key==='price',unit=isPrice?'元/斤':'百分比';
        const inputs=['Min','Max'].map((bound,i)=>{
          const end=i?'最高':'最低',field=key+bound;
          return `<label><span class="sr">${rangeLabels[key]}${end}${unit}</span><input data-range="${field}" type="number" min="0" ${isPrice?'':'max="100"'} step="any" inputmode="decimal" placeholder="${end}" value="${safe(draft[field])}"></label>`;
        });
        return `<div class="range-row"><b>${label}</b>${inputs.join('<span>至</span>')}</div>`;
      }
      const budget=`<fieldset class="range-fields"><legend>每斤预算（元/斤）</legend>${rangeRow('price','参考价')}</fieldset>`;
      const ranges=Object.entries(nutrients).map(([key,label])=>rangeRow(key,label)).join('');
      const nutrition=`<fieldset class="range-fields"><legend>营养指标（%）</legend>${ranges}<p class="hint">取自包装、品牌商品详情页等公开资料。范围按标示保证值筛选。</p><p id="range-error" role="status"></p></fieldset>`;
      const more='<details class="advanced-block" '+(Object.keys(draft.metrics).length?'open':'')+'><summary>更多营养指标 · 磷、钙、微量元素</summary><div class="advanced-fields"><select aria-label="添加营养指标" id="add-metric"><option value="">选择要筛选的指标</option>'+metricOptions()+'</select><div id="extra-conditions">'+metricRows()+'</div><p class="hint">查低磷时选「明确上限或等值」。≥ 只表示保证下限。</p></div></details>';
      const firms='<details class="advanced-block" '+(firmKeys.some(k=>draft[k])?'open':'')+'><summary>品牌与工厂 · 自有、代工、年份</summary><div class="advanced-fields">'+firmControls()+'</div></details>';
      return `<div class="filter-fields">${groups[0]}${budget}${nutrition}${more}${firms}${groups.slice(1).join('')}</div><div class="sheet-foot">${action('clear-draft','重置条件','link')}${action('apply',`查看 ${count()} 个产品`,'primary')}</div>`;
    }
    function update(){
      const inputs=sheetBody.querySelectorAll('[data-range]');
      let issue='';
      for(const input of inputs){
        draft[input.dataset.range]=input.value;
        if(!input.validity.valid)issue=input.dataset.range.startsWith('price')?'预算请输入大于或等于 0 的金额':'营养指标请输入 0 到 100 之间的数值';
      }
      for(const [key,label] of Object.entries(rangeLabels)){
        if(draft[key+'Min']&&draft[key+'Max']&&Number(draft[key+'Min'])>Number(draft[key+'Max']))issue=label+'的最低值超过了最高值';
      }
      for(const el of sheetBody.querySelectorAll('[data-condition]')){
        const k=el.dataset.condition,c=draft.metrics[k];
        for(const input of el.querySelectorAll('[data-bound]')){
          input.disabled=c.mode==='missing';
          if(c.mode==='missing'){input.value='';c[input.dataset.bound]='';continue;}
          c[input.dataset.bound]=input.value;
          if(!input.validity.valid)issue=metricByKey.get(k).label+'的数值超出允许范围';
        }
        if(c.low&&c.high&&Number(c.low)>Number(c.high))issue=metricByKey.get(k).label+'的最低值超过了最高值';
      }
      id('range-error').textContent=issue;
      const apply=sheetBody.querySelector('[data-action="apply"]');
      apply.disabled=Boolean(issue);
      apply.textContent=issue?'请调整范围':`查看 ${count()} 个产品`;
    }
    show('筛选条件',contents(),(type,node)=>{
      if(type==='apply'){filters=draft;resetResultWindow();closeSheet();render();window.scrollTo(0,0);return;}
      if(type==='remove-metric'){delete draft.metrics[node.dataset.key];id('extra-conditions').innerHTML=metricRows();update();return;}
      if(type==='clear-draft'){
        draft.metrics={};id('extra-conditions').innerHTML='';
        for(const sel of sheetBody.querySelectorAll('[data-firm]')){draft[sel.dataset.firm]='';sel.value='';}
        for(const key of Object.keys(filterLabels))draft[key]='';
        for(const input of sheetBody.querySelectorAll('[data-range]'))input.value='';
      }
      else if(type==='draft')draft[node.dataset.key]=node.dataset.value;
      else return;
      for(const el of sheetBody.querySelectorAll('[data-action="draft"]')){
        const on=draft[el.dataset.key]===el.dataset.value;el.classList.toggle('chosen',on);el.setAttribute('aria-pressed',on);
      }
      update();
    });
    const fields=sheetBody.querySelector('.filter-fields');
    fields.addEventListener('input',e=>{if(e.target.matches('[data-range],[data-bound]'))update();});
    fields.addEventListener('change',e=>{
      const el=e.target;
      if(el.id==='add-metric'&&el.value){
        const k=el.value;
        if(!draft.metrics[k])draft.metrics[k]={mode:'declared',low:'',high:''};
        id('extra-conditions').innerHTML=metricRows();el.value='';
        id('extra-conditions').querySelector('[data-condition="'+k+'"] select').focus();
      }else if(el.hasAttribute('data-mode-select'))draft.metrics[el.closest('[data-condition]').dataset.condition].mode=el.value;
      else if(el.dataset.firm)draft[el.dataset.firm]=el.value;
      update();
    });
  }
  function entityButton(kind,key,label,cls='link'){return key?action('entity',safe(label)+' ›',cls,`data-kind="${kind}" data-id="${safe(key)}"`):safe(label||'未收录');}
  function archiveRows(kind,key){return allItems.filter(({product:p,item:v})=>kind==='brand'?p.brandId===key:v.factoryId===key);}
  const directoryRegions={
    brand:{domestic:'国内品牌',overseas:'海外品牌',unknown:'归属未明确'},
    factory:{domestic:'国内工厂',overseas:'海外工厂',unknown:'所在地未明确'}
  };
  function directoryContent(route,kind){
    const list=kind==='factory'?mobileCatalog.factories:mobileCatalog.brands.filter(b=>route.page!=='brands'||archiveRows('brand',b.id).length);
    const needle=normalize(directoryQuery).trim(), labels=directoryRegions[kind];
    const match=list.filter(e=>normalize(e.name).includes(needle)&&(route.region==='all'||e.region===route.region));
    const groups=Object.entries(labels).map(([region,label])=>{
      const entries=match.filter(e=>(e.region||'unknown')===region);
      if(!entries.length)return '';
      const buttons=entries.map(e=>action(route.page==='brands'?'brand-products':'entity',
        `<strong>${safe(e.short||e.name)}</strong><small>${archiveRows(kind,e.id).length} 款配方</small>`,
        'entry',`data-kind="${kind}" data-id="${safe(e.id)}"`)).join('');
      return `<section class="dir-group" data-region="${region}"><h3>${label} <small>${entries.length}</small></h3><div class="${kind==='brand'?'brand-grid':'dir-list'}">${buttons}</div></section>`;
    }).join('');
    return groups||'<p class="empty">没有匹配的档案</p>';
  }
  function directoryPage(route){
    const intel=route.page==='intel',kind=intel?route.kind:'brand',title=intel?'情报库':'按品牌找粮';
    const regionSwitch='<div class="directory-regions" role="group" aria-label="'+(kind==='brand'?'品牌归属':'工厂所在地')+'">'+
      Object.entries({all:'全部',domestic:directoryRegions[kind].domestic,overseas:directoryRegions[kind].overseas}).map(([key,label])=>
        action('dir-region',label,route.region===key?'chosen':'',`data-region="${key}" aria-pressed="${route.region===key}"`)).join('')+'</div>';
    return (intel?'':nav('找粮','返回'))+`<header class="hero"><div class="mast"><h1 class="dir-heading">${title}</h1>${guideButton()}</div><label class="search"><span class="lens" aria-hidden="true"></span><input aria-label="搜索${kind==='brand'?'品牌':'工厂'}" id="dir-search" type="search" placeholder="搜索${kind==='brand'?'品牌中文名或英文名':'工厂名称'}" value="${safe(directoryQuery)}"></label></header><section class="directory">${intel?`<div class="switch">${action('dir-kind','品牌档案',kind==='brand'?'chosen':'','data-mode="brand"')}${action('dir-kind','工厂档案',kind==='factory'?'chosen':'','data-mode="factory"')}</div>`:''}${regionSwitch}<div id="dir-results">${directoryContent(route,kind)}</div></section>`;
  }
  function sourceList(refs){
    if(!refs?.length)return '';
    return '<ul class="news-sources">'+refs.map(s=>'<li>'+(/^https?:\/\//i.test(s.url)?'<a href="'+safe(s.url)+'" target="_blank" rel="noopener noreferrer">'+safe(s.name)+'</a>':safe(s.name))+'</li>').join('')+'</ul>';
  }
  function newsBlock(kind,key,preview=false){
    const intel=publicLoader ? publicLoader.intel : mobileIntel;
    const brand=kind==='brand',entry=(brand?intel.brands:intel.factories)[key];
    const title=brand?'品牌舆情与召回':'工厂动态';
    if(!entry)return '';
    const {items}=entry;
    const head='<h2>'+title+(items.length?' <small>'+items.length+' 条</small>':'')+'</h2>';
    const scope=brand?'品牌层面的记录，涉及的产品、批次和处理状态见各条说明。':entry.asOf?'资料截至 '+entry.asOf:'';
    const limit=preview?1:items.length;
    const feed=items.slice(0,limit).map(e=>'<article class="news-item">'+(e.date||e.status?'<p class="news-meta">'+safe([e.date,e.status].filter(Boolean).join(' · '))+'</p>':'')
      +(e.title?'<h3>'+safe(e.title)+'</h3>':'')+(e.body?'<p>'+safe(e.body)+'</p>':'')
      +(e.sources?.length?sourceList(e.sources):'')+'</article>').join('');
    const refs=entry.sources?.length?'<details class="news-refs"><summary>工厂动态来源（'+entry.sources.length+'）</summary>'+sourceList(entry.sources)+'</details>':'';
    const pool=!preview&&entry.archiveSources?.length?'<details class="news-refs"><summary>'+(brand?'品牌':'工厂')+'档案公开来源（'+entry.archiveSources.length+'）</summary>'+sourceList(entry.archiveSources)+'</details>':'';
    const more=preview&&items.length>1?action('entity','看全部'+items.length+'条'+(brand?'品牌记录':'工厂动态')+' ›','more','data-kind="'+kind+'" data-id="'+safe(key)+'" data-section="news"'):'';
    return '<section class="news-block"'+(preview?'':' id="entity-news"')+'>'+head+(scope&&items.length?'<p class="hint">'+safe(scope)+'</p>':'')+(feed||'<p class="hint">当前档案暂无可展示的记录</p>')+refs+pool+more+'</section>';
  }
  function entityPage(route){
    const isBrand=route.kind==='brand',entity=(isBrand?brandById:factoryById).get(route.id);
    const entries=archiveRows(route.kind,route.id);
    const linked=new Map();
    for(const {product:p,item:v} of entries){
      const counterpart=isBrand?factoryById.get(v.factoryId):brandById.get(p.brandId);
      if(counterpart)linked.set(counterpart.id,counterpart);
    }
    const profiles=[...linked.values()].map(x=>entityButton(isBrand?'factory':'brand',x.id,x.short||x.name,'rel')).join('');
    const listed=entries.slice(0,entityLimit).map(({product:p,item:v})=>action('open-related',`<strong>${safe(name(p))}</strong><small>${safe(variant(v))}</small>`,'entry related',skuAttr(v))).join('');
    return nav(isBrand?'品牌档案':'工厂档案','返回')+`<div class="entity-heading"><small>${isBrand?'品牌':'工厂'}</small><h1>${safe(entity.name)}</h1>${entity.date?`<p>资料核对至 ${safe(entity.date)}</p>`:''}</div><section class="panel profile">${entries.length?action('jump-related',`看${isBrand?'本品牌':'同厂'}产品 · ${entries.length} 款配方 ↓`,'more'):''}<h2>档案摘要</h2>${entity.fields.map(([k,v],i)=>v.length>95?`<div class="field"><b>${safe(k)}</b><span>${safe(v.slice(0,80))}… ${action('profile-note','看全文 ›','link',`data-index="${i}"`)}</span></div>`:field(k,v)).join('')||'<p>暂无公开摘要</p>'}${newsBlock(route.kind,route.id)}${profiles?`<h2>${isBrand?'关联工厂':'关联品牌'}</h2><div class="relations">${profiles}</div>`:''}<h2 id="associated-products" tabindex="-1">关联产品 <small>${entries.length} 款配方</small></h2>${listed}${entries.length>entityLimit?action('more-related','查看更多关联产品','more'):''}</section>`;
  }
  function mapPage(route){
    const core=scope==='core'&&!searchesFullCatalog(filters);
    const entries=foundProducts().flatMap(([,rows])=>core?rows.filter(v=>v.core):rows);
    const graph=phoneAnalysis.distribution(entries,route.mode,route.zoom);
    const selected=graph.points.find(pt=>pt.key===route.point);
    const modes=Object.entries(phoneAnalysis.chartModes).map(([key,mode])=>action('map-mode',mode.label,route.mode===key?'chosen':'','data-mode="'+key+'" aria-pressed="'+(route.mode===key)+'"')).join('');
    const xTitle=graph.x.label+'（'+graph.x.unit+'）',yTitle=graph.y.label+'（'+graph.y.unit+'）';
    function axisTicks(axis,vertical){
      const ticks=[];
      for(let n=axis.min;n<=axis.max+axis.step/100;n+=axis.step){
        const ratio=(n-axis.min)/(axis.max-axis.min),pos=vertical?190-153*ratio:38+282*ratio;
        ticks.push(vertical?'<line x1="38" x2="320" y1="'+pos+'" y2="'+pos+'"/><text x="31" y="'+(pos+4)+'" text-anchor="end">'+n+'</text>'
          :'<line x1="'+pos+'" x2="'+pos+'" y1="37" y2="190"/><text x="'+pos+'" y="210" text-anchor="middle">'+n+'</text>');
      }
      return ticks.join('');
    }
    let selectionRing='';
    const orderedPoints=selected?[...graph.points.filter(pt=>pt!==selected),selected]:graph.points;
    const dots=orderedPoints.map(pt=>{
      const cx=38+282*(pt.x-graph.x.min)/(graph.x.max-graph.x.min),cy=190-153*(pt.y-graph.y.min)/(graph.y.max-graph.y.min);
      const r=Math.min(10,3.7+Math.sqrt(pt.items.length-1)*1.4);
      if(selected===pt)selectionRing='<g class="selection-ring"><circle cx="'+cx+'" cy="'+cy+'" r="'+(r+2)+'"/><circle cx="'+cx+'" cy="'+cy+'" r="'+(r+3.5)+'"/></g>';
      return '<circle data-coordinate="'+pt.key+'" cx="'+cx+'" cy="'+cy+'" r="'+r+'" class="'+(selected===pt?'selected-dot':'')+'"/>';
    });
    const plot='<svg id="distribution-chart" role="img" aria-label="'+safe(xTitle+'与'+yTitle+'分布图')+'" viewBox="0 0 344 240">'
      +'<g class="gridlines">'+axisTicks(graph.x,false)+axisTicks(graph.y,true)+'</g>'
      +'<text x="13" y="19">'+safe(yTitle)+'</text><text x="320" y="233" text-anchor="end">'+safe(xTitle)+'</text>'
      +'<g class="plot-dots">'+dots.join('')+'</g>'+selectionRing+'</svg>';
    const zoom=route.mode==='nutrition'?'':action('map-zoom',route.zoom==='100'?'显示全部价格':'只看 100 元/斤以内','link','aria-pressed="'+(route.zoom==='100')+'"');
    const range=[filters.origin&&firmText('origin',filters.origin),core?'核心口味':searchesFullCatalog(filters)?'符合条件的配方':'全部配方'].filter(Boolean).join(' · ');
    const counts=[range+' · '+graph.count+' 款入图',graph.missing?'缺少坐标值 '+graph.missing+' 款':'',graph.outside?'超过价格范围 '+graph.outside+' 款':''].filter(Boolean).join('，');
    const choice=graph.points.map(pt=>'<option value="'+pt.key+'" '+(selected===pt?'selected':'')+'>'+pt.x+graph.x.unit+' / '+pt.y+graph.y.unit+' · '+pt.items.length+' 款</option>').join('');
    const cards=selected?'<h2>'+selected.x+graph.x.unit+' / '+selected.y+graph.y.unit+' · '+selected.items.length+' 款配方</h2>'+selected.items.map(v=>{
      const p=bySku.get(v.id).product;
      return '<div class="map-card">'+action('open-related','<strong>'+safe(p.brand+' · '+p.title)+'</strong><small>'+safe(variant(v))+' · '+safe(price(v))+'</small>','entry',skuAttr(v))
        +action('pick',picked.includes(v.id)?'✓ 已加入':'＋ 对比','small-btn',skuAttr(v))+'</div>';
    }).join(''):'';
    return nav('找粮','返回')+'<div class="map-page"><h1>配方分布图</h1><div class="switch map-modes">'+modes+'</div><div class="map-meta"><span>'+counts+'</span>'+zoom+'</div>'
      +(graph.count?plot+'<p class="hint">点圆查看配方。圆越大，配方越多。朱红双圈表示当前选中。</p><select aria-label="按坐标选择配方" id="coordinates"><option value="">选择坐标</option>'+choice+'</select>'+cards:'<div class="empty">当前范围内没有可绘制的配方</div>')+'</div>';
  }
  function selectPoint(key){
    const route=getRoute();
    history.replaceState(history.state,'','#'+new URLSearchParams({...route,point:key}));
    render();
  }
  function otherPage(route){
    if(route.page==='map')return mapPage(route);
    if(route.page==='entity')return entityPage(route);
    if(route.page==='intel'||route.page==='brands')return directoryPage(route);
    return listPage();
  }
  function columnHead(){
    return '<div class="column-head"><span>产品 / 口味</span><span>粗蛋白</span><span>粗脂肪</span><span>元/斤</span><span class="sr">对比</span></div>';
  }
  function productRow(p,rows) {
    const v=representative(rows);
    const flavor=v && !p.title.includes(v.flavor) && v.flavor!=='口味未注明' ? ((v.core && p.items.length>1?'核心口味 ':'')+v.flavor) : '';
    const label=v ? [flavor,v.stage,v.process].filter(Boolean).join(' · ') : `匹配 ${rows.length} 款配方`;
    const target=v?skuAttr(v):`data-family="${p.id}"`;
    const active=v&&picked.includes(v.id);
    const productLabel=`<span class="item-label"><span class="prod-brand">${safe([p.brand,p.series].filter(Boolean).join(' · '))}</span><strong class="prod-name">${safe(p.title)}</strong><span class="flavor-line">${safe(label)}</span></span>`;
    function reading(key,unit){
      return `<span class="reading">${v&&known(v[key])?safe(v[key])+unit:'—'}</span>`;
    }
    const numbers=reading('protein','%')+reading('fat','%')+reading('price','');
    const pick=action('pick',active?'✓ 已选':'＋ 对比','row-pick'+(active?' on':''),`${target} aria-pressed="${Boolean(active)}" aria-label="${active?'移出':'加入'}对比 · ${safe(name(p))}"`);
    const related=rows.length>1?action('all-options',`${rows.length} 款配方 ›`,'link variant-count',`data-family="${p.id}"`):'';
    const matching=rows.length<p.items.length&&rows.length>1?`<p class="match">匹配到 ${safe(rows.map(variant).join('、'))}</p>`:'';
    return `<article class="product">${action('open-product',productLabel+numbers,'open-product',target)}${pick}${related}${matching}${extraReadings(v)}</article>`;
  }
  function clearComparisonButton(){
    return action('clear-comparison','清空对比','clear-comparison');
  }
  const field=(label,value)=>`<div class="field"><b>${safe(label)}</b><span>${safe(known(value)?value:'未收录')}</span></div>`;
  const para=(label,value)=>`<div class="para"><h3>${safe(label)}</h3><p>${safe(known(value)?value:'未收录')}</p></div>`;
  const readable = s=>String(s||'').replace(/;/g,'；').replace(/(?:；|;)(?=乳基冻干|冻干鸡肉碎|主粮菌种|冻干\()/g,'。\n');
  const docTitles={ingredients:'完整配料', additives:'营养添加剂', guarantees:'其他保证值',pepsin:'胃蛋白酶消化率',tract:'全肠道粗蛋白消化率',study:'喂养研究',method:'工艺说明',rd:'研发资料',animal:'动物性原料占比',animalProtein:'动物性蛋白占比'};
  function docLink(v,key,label) {
    return v[key]?action('document',safe(label||docTitles[key])+' ›','link longlink',`${skuAttr(v)} data-field="${key}"`):'未收录';
  }
  function longField(v,key){
    return `<div class="field"><b>${docTitles[key]}</b><span>${docLink(v,key,'查看全文')}</span></div>`;
  }
  function tabBar(options,tab){return `<div class="tabs" aria-label="内容分类">${options.map((label,i)=>action('tab',label,i===tab?'active':'',`data-index="${i}" aria-pressed="${i===tab}"`)).join('')}</div>`;}
  function nav(title,backText){return `<nav class="subnav">${action('back','‹ '+backText,'back')}<span>${title}</span></nav>`;}
  function detailPage(route){
    const {product:p,item:v}=bySku.get(route.sku);
    const numbers=[['参考价 / 斤',known(v.price)?`¥${v.price}`:'未收录'],['粗蛋白',v.proteinText||percent(v.protein)],['粗脂肪',v.fatText||percent(v.fat)]];
    const summary=`<div class="summary"><div class="identity"><div><span class="prod-brand">${safe([p.brand,p.series].filter(Boolean).join(' · '))}</span><h1>${safe(p.title)}</h1><span class="flavor-line">${safe(v.age)} · ${safe(v.process)}</span></div></div><div class="pickerline"><span>${v.core?'核心口味':'当前配方'}　<strong>${safe(v.flavor)}</strong></span>${p.items.length>1?action('variants','换配方 ›','link',skuAttr(v)):''}</div><div class="metrics">${numbers.map(([label,value])=>`<div><span>${label}</span><b class="${value==='未收录'?'missing':''}">${safe(value)}</b></div>`).join('')}</div></div>`;
    let content;
    if(route.tab===0) content=['<p class="hint field-note">'+nutritionNote+'</p>',longField(v,'ingredients'),longField(v,'additives'),longField(v,'guarantees'),field('动物性原料占比',v.animal),field('动物性蛋白占比',v.animalProtein),field('包装规格',v.pack),field('保质期',v.shelf)].join('');
    else if(route.tab===1)content=[field('主粮工艺',v.process),field('功能分类',v.functions.join('、')),para('品牌介绍',readable(v.features)),para('品牌工艺说明',readable(v.method)),field('胃蛋白酶消化率',v.pepsin),field('全肠道粗蛋白消化率',v.tract),para('喂养研究',readable(v.study)),para('研发资料',readable(v.rd)),v.research?para('检测摘要',v.research):''].join('');
    else content=[entityButton('brand',p.brandId,'查看'+p.brand+'品牌档案','more'),field('产地属性',v.origin),field('生产方式',v.production),field('生产工厂',v.factory),v.factoryId?entityButton('factory',v.factoryId,'查看工厂档案','more'):'',v.productionNote?para('生产资料',v.productionNote):'',v.traceability?para('原料来源',v.traceability):'',newsBlock('brand',p.brandId,true),v.factoryId?newsBlock('factory',v.factoryId,true):'<section class="news-block"><h2>工厂动态</h2><p class="hint">本款具体生产企业尚未明确。</p></section>'].join('');
    const selected=picked.includes(v.id);
    const pick=action('pick',selected?'✓ 已加入对比':picked.length===2?'替换对比款':'＋ 加入对比','detail-pick',`${skuAttr(v)} aria-pressed="${selected}"`);
    return nav('产品详情','返回')+summary+`<div class="detail-action">${pick}</div>`+tabBar(tabs.detail,route.tab)+`<section class="panel">${content}</section>`;
  }
  function comparePage(route){
    const pair=picked.map(k=>bySku.get(k));
    const heading=nav('猫粮工作台','返回')+'<header class="compare-heading"><h1 class="compare-title">两款对比</h1>'+(pair.length?action('tray','管理已选配方','link'):'')+'</header>';
    if(pair.length<2){
      const current=pair.length?`<strong>${safe(name(pair[0].product))}</strong><p>${safe(variant(pair[0].item))}</p>`:'';
      return heading+`<section class="panel compare-start">${current}<p>${pair.length?'再选一款，即可并排查看。':'选择两款配方，并排查看营养、配料和生产信息。'}</p>${action('find',pair.length?'去选第二款':'去找粮','primary')}</section>`;
    }
    const plain=(label,key)=>row(label,pair.map(({item})=>item[key]));
    const missing='<span class="missing-cell">未收录</span>';
    function row(label,values,html=false){
      return '<div class="compare-row"><h3>'+safe(label)+'</h3>'+values.map(value=>'<div class="compare-cell">'+(known(value)?(html?value:safe(value)):missing)+'</div>').join('')+'</div>';
    }
    function guaranteeTable(){
      const tables=pair.map(({item})=>phoneAnalysis.guaranteedRows(item.guarantees));
      const labels=new Set(tables.flatMap(t=>[...t.keys()]));
      if(labels.delete('其他标示'))labels.add('其他标示');
      return [...labels].map(label=>row(label,tables.map(t=>t.get(label)?.join('\n')))).join('');
    }
    function section(){
      if(route.tab===0){
        return plain('适用阶段','age')+row('参考价 · 元/斤',pair.map(({item})=>item.price))
          +row('粗蛋白',pair.map(({item})=>item.proteinText||percent(item.protein)))
          +row('粗脂肪',pair.map(({item})=>item.fatText||percent(item.fat)))
          +(pair.some(({item})=>item.basis)?plain('标示基准','basis'):'')+guaranteeTable();
      }
      if(route.tab===1){
        return plain('动物性原料占比','animal')+plain('动物性蛋白占比','animalProtein')
          +plain('配料表','ingredients')+plain('营养添加剂','additives');
      }
      if(route.tab===2)return plain('主粮工艺','process')+plain('胃蛋白酶消化率','pepsin')
        +plain('全肠道粗蛋白消化率','tract')+plain('检测摘要','research')+plain('喂养研究','study')+plain('工艺说明','method')+plain('研发资料','rd');
      return row('品牌',pair.map(({product:p})=>entityButton('brand',p.brandId,p.brand)),true)
        +row('品牌创立或推出年份',pair.map(({item})=>item.brandYear&&item.brandYear+' 年'))+plain('产地属性','origin')+plain('生产方式','production')
        +row('工厂',pair.map(({item:v})=>entityButton('factory',v.factoryId,v.factory)),true);
    }
    const pins=pair.map(({product:p,item:v})=>'<div class="pin"><span>'+safe([p.brand,p.series].filter(Boolean).join(' · '))+'</span><strong>'+safe(p.title)+'</strong><span>'+safe(variant(v))+'</span></div>').join('');
    return heading
      +'<div class="compare-pins pair-head">'+pins+'</div>'+tabBar(tabs.compare,route.tab)
      +'<div class="compare-rows">'+section()+'</div>';
  }
  function render(){
    saveView();
    const route=getRoute();
    if(route.page==='list' && location.hash) history.replaceState(null,'',location.pathname+location.search);
    const needsDetail=['detail','entity'].includes(route.page)||route.page==='compare'&&picked.length===2;
    const loadState=publicLoader ? publicLoader.prepare(route,picked,bySku,render)
      : needsDetail&&!detailsReady ? (detailsError?'error':'loading') : 'ready';
    if(loadState!=='ready'){
      app.innerHTML=nav('产品资料','返回')+'<section class="panel">'+(loadState==='error'?action('retry','重新加载资料','link'):'正在读取资料…')+'</section>'+bottomNav(route.page);
      if(!publicLoader&&!detailsError)fetchDetails();
      return;
    }
    app.innerHTML=(route.page==='detail'?detailPage(route):route.page==='compare'?comparePage(route):otherPage(route))+bottomNav(route.page);
    document.title=route.page==='list'?'猫粮工作台':({map:'配方分布图',detail:'产品详情',compare:'两款对比',entity:'资料档案',brands:'按品牌找粮',intel:'情报库'})[route.page]+' · 猫粮工作台';
  }
  function show(title,body,handler){
    sheetBody.innerHTML=`<div class="sheet-head"><h2 id="sheet-title">${safe(title)}</h2>${action('close','×','','aria-label="关闭"')}</div>${body}`;
    modalAction=handler;if(!sheet.open)sheet.showModal();sheet.scrollTop=0;
  }
  function openOptions(p,rows,mode,current) {
    const buttons=rows.map(v=>action('option',`<span>${safe(variant(v))}${v.core?'　<small>核心</small>':''}</span><small>${v.id===current?'✓ 当前':safe(price(v))}</small>`,'option'+(v.id===current?' chosen':''),skuAttr(v))).join('');
    show(mode==='pick'?'选择要对比的配方':'选择配方',`<p class="sheet-caption">${safe(name(p))}</p>`+buttons,(type,node)=>{
      if(type!=='option')return;
      const v=bySku.get(node.dataset.sku).item;closeSheet();
      if(mode==='pick'){toggle(v);return;}
      const route=getRoute();
      navigate({page:'detail',sku:v.id,tab:route.page==='detail'?route.tab:0},route.page==='detail');
    });
  }
  function tray(replacement){
    const before=getRoute();
    const body=picked.map(k=>{const {product:p,item:v}=bySku.get(k);return `<div class="selection-row"><span><b>${safe(p.brand+' · '+p.title)}</b><small>${safe(variant(v))}</small></span>${action('change',replacement?'替换此款':'移除','link',skuAttr(v))}</div>`;}).join('');
    show(replacement?'替换哪一款？':'已选配方',body,(type,node)=>{
      if(type!=='change')return;
      const k=node.dataset.sku;
      if(replacement)picked=picked.map(x=>x===k?replacement.id:x);
      else picked=picked.filter(x=>x!==k);
      closeSheet();
      if(before.page==='compare'&&picked.length<2)navigate({page:'list'},true);
      else render();
    });
  }
  function toggle(v){
    if(picked.includes(v.id))picked=picked.filter(x=>x!==v.id);
    else if(picked.length<2)picked.push(v.id);
    else {tray(v);return;}
    notify(`已选 ${picked.length} 款`);render();
  }
  sheet.addEventListener('click',event=>{
    if(event.target===sheet){const r=sheet.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeSheet();return;}
    const btn=event.target.closest('button[data-action]');
    if(!btn)return;
    if(btn.dataset.action==='close')closeSheet();else modalAction?.(btn.dataset.action,btn);
  });
  app.addEventListener('input',event=>{
    if(event.target.id==='dir-search'){
      directoryQuery=event.target.value;const r=getRoute();
      id('dir-results').innerHTML=directoryContent(r,r.page==='brands'?'brand':r.kind);return;
    }
    if(event.target.id!=='search')return;
    resetResultWindow();
    filters.search=event.target.value;saveView();id('results').innerHTML=results();
  });
  app.addEventListener('change',event=>{
    if(event.target.id==='order'){
      if(event.target.value==='more'){event.target.value=sort;openSortSheet();return;}
      sort=event.target.value;resetResultWindow();saveView();id('results').innerHTML=results();return;
    }
    if(event.target.id==='coordinates'){selectPoint(event.target.value);id('coordinates')?.focus({preventScroll:true});return;}
    const k=event.target.dataset.filter;if(!k)return;
    filters[k]=event.target.value;saveView();event.target.classList.toggle('active',Boolean(filters[k]));id('results').innerHTML=results();
  });
  app.addEventListener('click',event=>{
    const chart=event.target.closest('#distribution-chart');
    if(chart){
      const transform=chart.getScreenCTM();
      if(!transform)return;
      const pt=new DOMPoint(event.clientX,event.clientY).matrixTransform(transform.inverse());
      let closest=null,distance=16/transform.a;
      for(const dot of chart.querySelectorAll('[data-coordinate]')){
        const d=Math.hypot(pt.x-dot.cx.baseVal.value,pt.y-dot.cy.baseVal.value);
        if(d<=distance){distance=d;closest=dot;}
      }
      if(closest)selectPoint(closest.dataset.coordinate);
      return;
    }
    const btn=event.target.closest('[data-action]');if(!btn)return;
    const type=btn.dataset.action, route=getRoute();
    const obj=bySku.get(btn.dataset.sku), p=obj?.product || products.find(g=>g.id===btn.dataset.family), v=obj?.item;
    switch(type){
      case 'guide':guide();break;
      case 'retry':if(publicLoader){publicLoader.retry();render();}else fetchDetails();break;
      case 'jump-related':id('associated-products').focus();id('associated-products').scrollIntoView({block:'start'});break;
      case 'profile-note': {
        const e=(route.kind==='brand'?brandById:factoryById).get(route.id);
        const [label,body]=e.fields[Number(btn.dataset.index)];
        show(label,`<p class="sheet-caption">${safe(e.name)}</p><p class="fulltext">${safe(body)}</p>`,null);break;
      }
      case 'more':limit+=12;id('results').innerHTML=results();break;
      case 'more-related':entityLimit+=10;render();break;
      case 'origin':
        filters.origin=filters.origin===btn.dataset.value?'':btn.dataset.value;
        resetResultWindow();render();break;
      case 'scope':scope=btn.dataset.mode;resetResultWindow();render();break;
      case 'filter':filterSheet();break;
      case 'clear-filter':{
        const key=btn.dataset.key;
        if(key.startsWith('metric-'))delete filters.metrics[key.slice(7)];
        else if(Object.hasOwn(rangeLabels,key)){filters[key+'Min']='';filters[key+'Max']='';}
        else filters[key]='';
        resetResultWindow();render();break;
      }
      case 'map':navigate({page:'map'});break;
      case 'map-mode':navigate({...route,mode:btn.dataset.mode,point:''},true);break;
      case 'map-zoom':navigate({...route,zoom:route.zoom==='100'?'all':'100',point:''},true);break;
      case 'intel':if(route.page!=='intel')navigate({page:'intel',kind:'brand'},false,()=>{directoryQuery=''});break;
      case 'home':if(route.page!=='list')navigate({page:'list'});break;
      case 'brands':navigate({page:'brands'},false,()=>{directoryQuery=''});break;
      case 'dir-region':navigate({...route,region:btn.dataset.region},true);break;
      case 'dir-kind':navigate({...route,kind:btn.dataset.mode},true,()=>{directoryQuery=''});break;
      case 'entity':navigate({page:'entity',kind:btn.dataset.kind,id:btn.dataset.id,...(btn.dataset.section==='news'?{section:'news'}:{})},false,()=>{entityLimit=10;});break;
      case 'open-related':navigate({page:'detail',sku:v.id});break;
      case 'brand-products':navigate({page:'list'},false,()=>{filters={...filters,search:'',brand:btn.dataset.id};resetResultWindow();});break;
      case 'open-product': if(v)navigate({page:'detail',sku:v.id});else openOptions(p,matches(p),'detail');break;
      case 'variants': openOptions(p,p.items,'detail',v.id);break;
      case 'all-options': openOptions(p,matches(p),'detail');break;
      case 'pick': if(v)toggle(v);else openOptions(p,matches(p),'pick');break;
      case 'document': {
        const key=btn.dataset.field;
        show(docTitles[key],`<p class="sheet-caption">${safe(name(p)+' · '+variant(v))}</p><p class="fulltext">${safe(readable(v[key]))}</p>`,null);break;
      }
      case 'compare': if(route.page!=='compare')navigate({page:'compare'});break;
      case 'clear-comparison':
        if(route.page==='compare')navigate({page:'list'},true,()=>{picked=[];});
        else {picked=[];render();}
        notify('已清空对比');break;
      case 'tray': tray();break;
      case 'tab': navigate({...route,tab:Number(btn.dataset.index)},true);break;
      case 'choose-next':
      case 'find': navigate({page:'list'});break;
      case 'back': back();break;
      case 'reset': filters=blankFilters();resetResultWindow();render();break;
    }
  });
  window.addEventListener('popstate',event=>{closeSheet();restore(event.state?.view);render();window.scrollTo(0,event.state?.view?.y||0);});
  render();
})();

