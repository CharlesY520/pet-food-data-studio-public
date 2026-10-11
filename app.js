(() => {
  window.addEventListener('error', event => {
    const box = document.getElementById('summary');
    if (box && event?.message) box.textContent = `页面加载遇到问题：${event.message}`;
  });
  const all = window.PUBLIC_PET_FOOD_DATA.products || [];
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = {sort:'product', dir:1, page:1, pageSize:15};
  const fields = [['brand','品牌'],['product','产品'],['stage','阶段'],['process','工艺'],['importStatus','进口属性'],['functions','功能'],['protein','蛋白'],['fat','脂肪'],['pricePerJin','参考价'],['phosphorus','磷'],['chloride','氯化物']];
  const unique = key => [...new Set(all.flatMap(p => Array.isArray(p[key]) ? p[key] : [p[key]]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'zh-CN'));
  function fillSelect(id, values) { const select=$(id); values.forEach(v => select.insertAdjacentHTML('beforeend', `<option value="${esc(v)}">${esc(v)}</option>`)); }
  fillSelect('brand', unique('brand')); fillSelect('process', unique('process')); fillSelect('stage', unique('stage')); fillSelect('importStatus', unique('importStatus')); fillSelect('function', unique('functions'));
  const val = id => $(id).value.trim();
  const num = id => val(id)==='' ? null : Number(val(id));
  function sortValue(p,key) {
    const value=p[key];
    if (value && typeof value==='object' && !Array.isArray(value)) return value.value;
    if (Array.isArray(value)) return value.join('、');
    return value;
  }
  function filtered() {
    const q=val('search').toLocaleLowerCase('zh-CN'), brand=val('brand'), process=val('process'), stage=val('stage'), imp=val('importStatus'), fn=val('function');
    const match=(p,field,lo,hi)=>{const x=p[field]; return (lo===null||typeof x==='number'&&x>=lo)&&(hi===null||typeof x==='number'&&x<=hi)};
    return all.filter(p => {
      const hay=[p.brand,p.series,p.product,p.flavor].join(' ').toLocaleLowerCase('zh-CN');
      return (!q||hay.includes(q))&&(!brand||p.brand===brand)&&(!process||p.process===process)&&(!stage||p.stage===stage)&&(!imp||p.importStatus===imp)&&(!fn||p.functions.includes(fn))&&match(p,'protein',num('proteinMin'),num('proteinMax'))&&match(p,'fat',num('fatMin'),num('fatMax'))&&match(p,'pricePerJin',num('priceMin'),num('priceMax'));
    }).sort((a,b)=>{const av=sortValue(a,state.sort),bv=sortValue(b,state.sort); const am=av===null||av===undefined||av==='', bm=bv===null||bv===undefined||bv===''; if(am||bm)return am===bm? a.product.localeCompare(b.product,'zh-CN') : am?1:-1; if(typeof av==='number'||typeof bv==='number')return (Number(av)-Number(bv))*state.dir||a.product.localeCompare(b.product,'zh-CN'); return String(av).localeCompare(String(bv),'zh-CN')*state.dir||a.product.localeCompare(b.product,'zh-CN');});
  }
  function fmt(value, suffix='') { return typeof value==='number'&&Number.isFinite(value) ? `${Number(value.toFixed(2))}${suffix}` : '—'; }
  function drawChart(items) {
    const el=$('chart'), w=Math.max(520,el.clientWidth||700), h=330, pad={l:48,r:18,t:18,b:36};
    const xs=items.map(p=>p.protein).filter(Number.isFinite), ys=items.map(p=>p.fat).filter(Number.isFinite), xmax=Math.max(50,...xs,40), ymax=Math.max(35,...ys,20);
    const x=v=>pad.l+(v/xmax)*(w-pad.l-pad.r), y=v=h-pad.b-(v/ymax)*(h-pad.t-pad.b);
    let svg=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="粗蛋白与粗脂肪散点图"><line x1="${pad.l}" y1="${h-pad.b}" x2="${w-pad.r}" y2="${h-pad.b}" stroke="#9aa8ba"/><line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${h-pad.b}" stroke="#9aa8ba"/><line x1="${x(35)}" y1="${pad.t}" x2="${x(35)}" y2="${h-pad.b}" stroke="#d6a83d" stroke-dasharray="5 5"/><line x1="${pad.l}" y1="${y(15)}" x2="${w-pad.r}" y2="${y(15)}" stroke="#d6a83d" stroke-dasharray="5 5"/><text x="${x(35)+5}" y="${pad.t+13}" fill="#8b6a16" font-size="11">35%蛋白</text><text x="${w-pad.r-45}" y="${y(15)-6}" fill="#8b6a16" font-size="11">15%脂肪</text><text x="${w/2}" y="${h-8}" text-anchor="middle" fill="#68778c" font-size="11">粗蛋白 %</text><text x="14" y="${h/2}" transform="rotate(-90 14 ${h/2})" text-anchor="middle" fill="#68778c" font-size="11">粗脂肪 %</text>`;
    items.forEach((p,i)=>{if(!Number.isFinite(p.protein)||!Number.isFinite(p.fat))return; const color=p.importStatus==='进口'?'#7a5af8':p.importStatus==='国产'?'#2a9d8f':'#9aa8ba'; svg+=`<circle class="dot" cx="${x(p.protein)}" cy="${y(p.fat)}" r="5" fill="${color}" opacity=".78" data-detail="${i}"/><title>${esc(p.brand+' · '+p.product)}</title>`});
    svg+='</svg>'; el.innerHTML=svg; el.querySelectorAll('.dot').forEach(dot=>dot.addEventListener('click',()=>show(items[Number(dot.dataset.detail)])));
  }
  function renderTable(items) { const start=(state.page-1)*state.pageSize, page=items.slice(start,start+state.pageSize); $('head').innerHTML='<tr>'+fields.map(([key,label])=>`<th><button data-sort="${key}">${label} ${state.sort===key?(state.dir===1?'↑':'↓'):'↕'}</button></th>`).join('')+'<th>查看</th></tr>'; $('rows').innerHTML=page.map((p,i)=>`<tr><td>${esc(p.brand)}</td><td><strong>${esc(p.product)}</strong><br><span class="muted">${esc(p.flavor)}</span></td><td>${esc(p.stage)}</td><td>${esc(p.process)}</td><td>${esc(p.importStatus)}</td><td>${p.functions.length?p.functions.map(x=>`<span class="tag">${esc(x)}</span>`).join(''):'—'}</td><td>${fmt(p.protein,'%')}</td><td>${fmt(p.fat,'%')}</td><td>${fmt(p.pricePerJin,' 元/斤')}</td><td>${p.phosphorus?esc(p.phosphorus.comparator)+fmt(p.phosphorus.value,'%'):'—'}</td><td>${p.chloride?esc(p.chloride.comparator)+fmt(p.chloride.value,'%'):'—'}</td><td><button class="link-button detail" data-index="${start+i}">详情</button></td></tr>`).join('')||'<tr><td colspan="13" class="muted">没有匹配产品</td></tr>'; $('page').textContent=items.length?`第 ${state.page} / ${Math.ceil(items.length/state.pageSize)} 页`:'—'; $('prev').disabled=state.page<=1; $('next').disabled=state.page>=Math.ceil(items.length/state.pageSize)||!items.length; $('head').querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{const key=b.dataset.sort;if(state.sort===key)state.dir=state.dir===1?-1:state.dir===-1?0:1;else{state.sort=key;state.dir=1}if(state.dir===0){state.sort='product';state.dir=1}state.page=1;render()}); $('rows').querySelectorAll('.detail').forEach(b=>b.onclick=()=>show(page[Number(b.dataset.index)-start])); }
  function show(p){ if(!p)return; $('detailBody').innerHTML=`<h2 class="detail-title">${esc(p.product)}</h2><p class="muted">${esc(p.brand)} · ${esc(p.series)} · ${esc(p.flavor)}</p><div class="detail-grid"><div class="detail-item"><small>阶段</small>${esc(p.stage)}</div><div class="detail-item"><small>工艺</small>${esc(p.process)}</div><div class="detail-item"><small>进口属性</small>${esc(p.importStatus)}</div><div class="detail-item"><small>功能</small>${p.functions.length?p.functions.map(x=>`<span class="tag">${esc(x)}</span>`).join(''):'—'}</div><div class="detail-item"><small>粗蛋白</small>${fmt(p.protein,'%')}</div><div class="detail-item"><small>粗脂肪</small>${fmt(p.fat,'%')}</div><div class="detail-item"><small>参考价</small>${fmt(p.pricePerJin,' 元/斤')}</div><div class="detail-item"><small>研究资料</small>${p.researchRecord?'<span class="research">有资料记录</span>':'未显示'}</div><div class="detail-item"><small>磷记录</small>${p.phosphorus?esc(p.phosphorus.comparator)+fmt(p.phosphorus.value,'%'):'—'}</div><div class="detail-item"><small>水溶性氯化物记录</small>${p.chloride?esc(p.chloride.comparator)+fmt(p.chloride.value,'%'):'—'}</div></div><p class="detail-note">这里只展示允许公开的摘要字段，不展示原始来源、内部ID、编辑记录或完整配方。研究资料提示不等于逐SKU功效已证实。</p>`; $('detail').showModal(); }
  function render(){const items=filtered();if(state.page>Math.max(1,Math.ceil(items.length/state.pageSize)))state.page=1;$('summary').textContent=`当前显示 ${items.length} 款产品 · 只读体验版`;try{drawChart(items);renderTable(items)}catch(error){$('summary').textContent=`页面加载遇到问题：${error?.message||error}`;console.error(error)}}
  [...document.querySelectorAll('input,select')].forEach(el=>el.addEventListener('input',()=>{if(el.id!=='pageSize')state.page=1;render()})); $('pageSize').onchange=()=>{state.pageSize=Number(val('pageSize'));state.page=1;render()}; $('reset').onclick=()=>{['search','brand','process','stage','importStatus','function','proteinMin','proteinMax','fatMin','fatMax','priceMin','priceMax'].forEach(id=>$(id).value='');state.page=1;render()}; $('prev').onclick=()=>{state.page--;render()}; $('next').onclick=()=>{state.page++;render()}; $('close').onclick=()=>$('detail').close(); render();
})();
