/* Shared by the phone comparison and distribution views. */
const phoneAnalysis = (() => {
  const chartModes = {
    nutrition: {label:'蛋白 × 脂肪',x:'protein',y:'fat'},
    priceProtein: {label:'价格 × 蛋白',x:'price',y:'protein'},
    priceFat: {label:'价格 × 脂肪',x:'price',y:'fat'}
  };
  function distribution(entries, mode, zoom) {
    const {x,y}=chartModes[mode];
    const groups=new Map(),xs=[],ys=[];
    let missing=0,outside=0;
    for(const item of entries){
      const a=item[x],b=item[y];
      if(!Number.isFinite(a)||!Number.isFinite(b)){missing++;continue;}
      if(x==='price'&&zoom==='100'&&a>100){outside++;continue;}
      const key=a+','+b;
      if(!groups.has(key))groups.set(key,{key,x:a,y:b,items:[]});
      groups.get(key).items.push(item);
      xs.push(a);ys.push(b);
    }
    function axis(key,values){
      const metric=PetFoodScatter.metrics[key==='price'?'pricePerJin':key];
      return {...metric,...PetFoodScatter.domain(values,values.length?Math.min(...values):metric.default,metric)};
    }
    return {points:[...groups.values()].sort((a,b)=>a.x-b.x||a.y-b.y),missing,outside,count:xs.length,x:axis(x,xs),y:axis(y,ys)};
  }
  // Only pair a label with a reading when the line contains a single simple value.
  // Preserve the rest literally, including basis, ranges, estimates and mixed notes.
  function guaranteedRows(raw) {
    const rows=new Map();
    function append(label,value){rows.set(label,[...(rows.get(label)||[]),value]);}
    for(const rawLine of String(raw||'').split('\n')){
      const line=rawLine.trim();
      if(!line)continue;
      const m=line.match(/^([\p{L}\p{N}\s+αΩ−-]+?)(\([^)]*\))?\s*[:：]?\s*((?:>=|<=|≥|≤|>|<|≈|=)?\s*\d+(?:\.\d+)?\s*(?:%|％|mg\/kg|g\/kg|ppm|IU\/kg|kcal(?:\s*ME)?\/kg|kJ\/(?:100g|kg)))$/iu);
      if(!m){append('其他标示',line);continue;}
      let label=m[1].trim(),qualifier=m[2]||'';
      if(/^(?:omega|Ω|欧米伽)[-\s]?[36](?:脂肪酸)?$/i.test(label))label='Omega-'+label.match(/[36]/)[0];
      if(label==='总磷'||label==='磷'){qualifier=(label==='总磷'?'（总磷）':'')+qualifier;label='磷';}
      if(qualifier==='(max)')append(label,'≤'+m[3]);
      else if(qualifier==='(min)')append(label,'≥'+m[3]);
      else append(label,m[3]+(qualifier?' '+qualifier:''));
    }
    return rows;
  }
  return {chartModes,distribution,guaranteedRows};
})();
