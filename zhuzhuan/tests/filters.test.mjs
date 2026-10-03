import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync('public/app.js','utf8');
test('interval endpoints, preferred line priority, duration sorting and distinct 1/11 lines',()=>{
 const state={commute:{minMinutes:5,maxMinutes:30,transfers:3,preferred:new Set(['2号线']),forbidden:new Set(['1号线']),sort:'desc'},homes:{selectedStationIds:[],query:'',walkMin:5,walk:30,cycleMin:2,cycle:15,sort:'walk-desc'},stations:[{id:'below',minutes:4,transfers:0,lines:['2号线'],routeLines:['2号线']},{id:'short',minutes:5,transfers:0,lines:['2号线'],routeLines:['2号线']},{id:'long',minutes:30,transfers:0,lines:['2号线'],routeLines:['2号线']},{id:'other',minutes:25,transfers:4,lines:['11号线'],routeLines:['11号线']},{id:'blocked',minutes:10,transfers:0,lines:['1号线'],routeLines:['1号线']}],communities:[{id:'a',name:'a',walk:5,cycle:2},{id:'b',name:'b',walk:30,cycle:15},{id:'c',name:'c',walk:31,cycle:15}]};
 const context=vm.createContext({state});vm.runInContext(source.slice(source.indexOf('function filteredStations()'),source.indexOf('function renderAll()')),context);
 assert.deepEqual(Array.from(vm.runInContext('filteredStations().map(x=>x.id)',context)),['long','short','other']);
 state.commute.sort='asc';assert.deepEqual(Array.from(vm.runInContext('filteredStations().map(x=>x.id)',context)),['short','long','other']);
 assert.deepEqual(Array.from(vm.runInContext('filteredCommunities().map(x=>x.id)',context)),['b','a']);
 state.homes.sort='cycle-asc';assert.deepEqual(Array.from(vm.runInContext('filteredCommunities().map(x=>x.id)',context)),['a','b']);
});
test('station search works without REST and duplicate landmarks require selection',async()=>{
 const state={city:'上海',metroReady:true,routeLoading:false,commute:{query:'上海静安寺站',matches:[]},stations:[{name:'静安寺',lng:121.44,lat:31.22}],amap:{config:{routesEnabled:false}}};let calls=0;
 const context=vm.createContext({state,metroZoom:1,renderAll(){},showToast(){},estimateMetroRoutes(){},encodeURIComponent,api:async()=>{calls++;return {pois:[{name:'广场一',address:'地址一',location:'121.40,31.20'},{name:'广场二',address:'地址二',location:'121.41,31.21'}]};}});
 vm.runInContext(source.slice(source.indexOf('function applyWorkLocation('),source.indexOf('function updateMapLabels()')),context);
 await vm.runInContext('findStationsByRoute()',context);assert.equal(state.routeOrigin,'121.44,31.22');assert.equal(calls,0);
 state.commute.query='广场';state.amap.config.routesEnabled=true;await vm.runInContext('findStationsByRoute()',context);assert.equal(state.commute.matches.length,2);assert.equal(calls,1);assert.equal(state.routeOrigin,'121.44,31.22');
});
