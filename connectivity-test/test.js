'use strict';
const $=id=>document.getElementById(id);
let rows=[],state='等待读取',detailOpened=false,filterUsed=false,sequence=0;
$('script').textContent='程序：运行正常 ✓';
function report(){
 $('result').textContent=['GitHub独立测试 v20261016','页面：已打开；程序：正常','样例数据：'+state,'筛选：'+(filterUsed?'已操作':'尚未操作'),'详情：'+(detailOpened?'已打开':'尚未操作'),'设备：'+$('device').value,'网络：'+$('network').value,'VPN/代理：'+$('proxy').value+'（本人填写）'].join('\n');
}
function render(){
 $('rows').replaceChildren();
 for(const p of rows.filter(p=>!$('filter').value||p.type===$('filter').value)){
  const article=document.createElement('article'),name=document.createElement('strong'),button=document.createElement('button');
  name.textContent=p.name+' · '+p.type+' ';
  button.textContent='查看样例详情';
  button.onclick=()=>{$('detail').hidden=false;$('detail').textContent=p.name+'：'+p.description;detailOpened=true;report();};
  article.append(name,button);$('rows').append(article);
 }
}
async function load(){
 const ticket=++sequence,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000),start=performance.now();
 state='读取中…';$('data').textContent='样例数据：读取中…';$('retry').disabled=true;$('filter').disabled=true;report();
 try{
  const r=await fetch('./sample.json?t='+Date.now(),{cache:'no-store',signal:controller.signal});
  if(!r.ok)throw new Error('HTTP '+r.status);
  const value=await r.json();
  if(!Array.isArray(value)||value.length!==3||value.some(p=>typeof p.name!=='string'||typeof p.type!=='string'||typeof p.description!=='string'))throw new Error('样例格式异常');
  if(ticket!==sequence)return;
  rows=value;state='成功，3款虚构样例，约'+((performance.now()-start)/1000).toFixed(1)+'秒';
  $('data').textContent='样例数据：'+state+' ✓';$('filter').disabled=false;render();
 }catch(e){if(ticket!==sequence)return;state=e.name==='AbortError'?'15秒内未读到，请重试':e.message;$('data').textContent='样例数据：失败，'+state;}
 finally{clearTimeout(timer);if(ticket===sequence){$('retry').disabled=false;report();}}
}
$('retry').onclick=load;
$('filter').onchange=()=>{filterUsed=true;$('detail').hidden=true;render();report();};
for(const id of ['device','network','proxy'])$(id).onchange=report;
load();
