import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
test('Shanghai real metro graph: city selection, estimates, excluded lines and no bus edges',async()=>{
 const city={cityname:'上海市',adcode:'3100',spell:'shanghai'},network=JSON.parse(readFileSync('server/metro-shanghai.json','utf8'));
 const context={state:{commute:{forbidden:new Set(),transfers:1},homes:{},notes:{}},window:{addEventListener(){}},document:{getElementById(){return{};}},renderAll(){},escapeHtml:x=>x,URLSearchParams,console,fetch:async(url)=>({ok:true,json:async()=>url.includes('/cities')?{cities:[city]}:{city,network}})};
 vm.createContext(context);vm.runInContext(readFileSync('public/metro.js','utf8'),context);
 await context.window.selectMetroCity('上海');assert(context.state.stations.length>300);assert(context.state.stations.some(s=>s.name==='静安寺'));
 vm.runInContext("estimateMetroRoutes('121.4465,31.2230')",context);
 const result=context.state.stations.find(s=>s.name==='人民广场');assert(Number.isFinite(result.minutes));assert(result.transfers<=1);
 context.state.commute.forbidden.add('2号线');vm.runInContext("estimateMetroRoutes('121.4465,31.2230')",context);
 assert(context.state.stations.every(s=>!s.routeLines.includes('2号线')));
 await assert.rejects(context.window.selectMetroCity('不存在的城市'));
});
