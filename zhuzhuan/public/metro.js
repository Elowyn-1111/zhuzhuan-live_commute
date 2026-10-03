let metroDirectory,metroNetwork=null,metroLines=[],metroZoom=1,discoveryGeneration=0;
window.metroCities=async()=>{if(!metroDirectory){const result=await fetch('/api/metro/cities');if(!result.ok)throw Error('城市列表读取失败');metroDirectory=(await result.json()).cities;}return metroDirectory;};
window.selectMetroCity=async(value)=>{
 const normalized=value.trim().replace(/市$/,''),city=(await window.metroCities()).find(c=>c.cityname.replace(/市$/,'')===normalized||c.spell.toLowerCase()===normalized.toLowerCase());
 if(!city)throw Error('请选择列表中已开通地铁的城市。');
 const response=await fetch(`/api/metro/network?city=${city.adcode}`),payload=await response.json();if(!response.ok)throw Error(payload.error||'地铁图读取失败');
 if(!(payload.network?.l?.length))throw Error('该城市地铁数据暂不可用。');
 discoveryGeneration++;state.city=city.cityname.replace(/市$/,'');metroNetwork=payload.network;metroZoom=1;
 const stations=new Map();metroLines=metroNetwork.l.filter(line=>!(/有轨电车|磁浮|机场快线/.test(line.ln||line.kn||''))).map((line,index)=>{
  const name=line.ln||line.kn||`线路${index+1}`,rows=[];
  for(const raw of line.st||[]){const coordinate=String(raw.sl||'').split(',').map(Number);if(coordinate.length!==2||!coordinate.every(Number.isFinite))continue;const key=raw.n;let station=stations.get(key);if(!station){station={id:`metro_${city.adcode}_${raw.poiid||raw.sid}`,name:key,lng:coordinate[0],lat:coordinate[1],lines:[],line:'',minutes:Infinity,transfers:Infinity,source:'amap',timeSource:'estimate'};stations.set(key,station);}if(!station.lines.includes(name))station.lines.push(name);station.line=station.lines.join(' · ');rows.push(station);}
  return{name,color:/^[0-9a-f]{6}$/i.test(line.cl||'')?`#${line.cl}`:'#678c76',stations:rows};
 }).filter(line=>line.stations.length>1);
 state.stations=[...stations.values()];state.communities=[];state.routeOrigin=null;state.commute.query='';state.commute.selectedStations=[];state.commute.forbidden.clear();state.commute.preferred?.clear();state.commute.matches=[];state.homes.selectedStationIds=[];state.homes.selectedCommunity=null;state.homes.selectedCommunity=null;state.communityPois=[];state.metroReady=true;state.view='commute';state.notes.region='全部区域';state.notes.line='全部地铁线';if(state.apiAvailable)loadRemoteNotes();
 document.getElementById('city-button').innerHTML=`<span class="pin-small">●</span> ${escapeHtml(state.city)} <span class="chevron">⌄</span>`;
 document.getElementById('map-location-text').textContent=state.city;renderAll();
};
function metroKm(a,b){const c=Math.cos((a.lat+b.lat)*Math.PI/360);return Math.hypot((a.lng-b.lng)*c,a.lat-b.lat)*111.32;}
function estimateMetroRoutes(location){
 const [lng,lat]=location.split(',').map(Number),origin={lng,lat},nodes=[],stationNodes=new Map();
 metroLines.filter(line=>!state.commute.forbidden.has(line.name)).forEach(line=>{let previous=null;line.stations.forEach(station=>{const node={station,line:line.name,edges:[],index:nodes.length};nodes.push(node);const siblings=stationNodes.get(station.id)||[];for(const sibling of siblings){node.edges.push({to:sibling,cost:4,transfer:1});sibling.edges.push({to:node,cost:4,transfer:1});}siblings.push(node);stationNodes.set(station.id,siblings);if(previous){const cost=metroKm(previous.station,station)/40*60+1;node.edges.push({to:previous,cost,transfer:0});previous.edges.push({to:node,cost,transfer:0});}previous=node;});});
 const starts=[...stationNodes.keys()].map(id=>({station:stationNodes.get(id)[0].station,nodes:stationNodes.get(id)})).sort((a,b)=>metroKm(a.station,origin)-metroKm(b.station,origin)).slice(0,3);
 const maxTransfers=state.commute.transfers===3?6:state.commute.transfers,dist=new Map(),queue=[];
 for(const start of starts)for(const node of start.nodes){const cost=metroKm(start.station,origin)/4.5*60,key=`${node.index}:0`;dist.set(key,{cost,lines:[node.line]});queue.push({node,transfers:0,cost,lines:[node.line]});}
 while(queue.length){queue.sort((a,b)=>b.cost-a.cost);const current=queue.pop();if(current.cost!==dist.get(`${current.node.index}:${current.transfers}`)?.cost)continue;for(const edge of current.node.edges){const transfers=current.transfers+edge.transfer;if(transfers>maxTransfers)continue;const key=`${edge.to.index}:${transfers}`,cost=current.cost+edge.cost;if(cost<(dist.get(key)?.cost??Infinity)){const lines=edge.transfer?[...current.lines,edge.to.line]:current.lines;dist.set(key,{cost,lines});queue.push({node:edge.to,transfers,cost,lines});}}}
 for(const station of state.stations){let best={cost:Infinity,transfers:Infinity,lines:[]};for(const node of stationNodes.get(station.id)||[])for(let t=0;t<=maxTransfers;t++){const v=dist.get(`${node.index}:${t}`);if(v&&v.cost<best.cost)best={...v,transfers:t};}station.minutes=Math.ceil(best.cost);station.transfers=best.transfers;station.routeLines=best.lines;}
}
function renderMetroSchematic(){
 const old=document.getElementById('metro-schematic');old?.remove();document.getElementById('metro-loading')?.remove();markerLayer.innerHTML='';
 if(state.view!=='commute')return;
 const canvas=document.getElementById('map-canvas');
 if(!state.metroReady){const loading=document.createElement('div');loading.id='metro-loading';loading.className='metro-loading';loading.textContent='请选择城市';canvas.appendChild(loading);return;}
 const homes=state.homes.selectedStationIds.length>0,selected=state.stations.filter(s=>state.homes.selectedStationIds.includes(s.id)||state.commute.selectedStations.includes(s.id)),visible=homes?filteredCommunities():filteredStations();
 let focus=homes?[...selected,...visible]:selected.length?selected:visible.length?visible:state.stations;
 if(state.homes.selectedCommunity){const item=state.communities.find(x=>x.id===state.homes.selectedCommunity);if(item)focus=[item,...selected];}
 if(!focus.length)focus=state.stations;
 let west=Math.min(...focus.map(s=>s.lng)),east=Math.max(...focus.map(s=>s.lng)),south=Math.min(...focus.map(s=>s.lat)),north=Math.max(...focus.map(s=>s.lat));
 const midx=(east+west)/2,midy=(north+south)/2;let dx=Math.max(east-west,homes?.024:.065)/metroZoom,dy=Math.max(north-south,homes?.018:.05)/metroZoom;
 west=midx-dx*.7;east=midx+dx*.7;south=midy-dy*.7;north=midy+dy*.7;
 const width=Math.max(320,canvas.clientWidth),height=Math.max(300,canvas.clientHeight),scale=Math.min((width-70)/((east-west)*Math.cos(midy*Math.PI/180)),(height-80)/(north-south));
 const point=s=>[width/2+(s.lng-midx)*Math.cos(midy*Math.PI/180)*scale,height/2-(s.lat-midy)*scale];
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='metro-schematic';svg.classList.add('metro-schematic');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',`${state.city}地铁与小区位置图`);
 let markup=metroLines.map(line=>`<path d="${line.stations.map((s,i)=>`${i?'L':'M'}${point(s).join(' ')}`).join(' ')}" stroke="${line.color}" stroke-width="${homes?2.5:3.5}" opacity="${homes?.45:.7}"/>`).join('');
 const ids=new Set(visible.map(s=>s.id));const showLabels=homes||visible.length<65;
 for(const station of state.stations){const [x,y]=point(station);if(x<0||x>width||y<0||y>height)continue;const active=selected.some(s=>s.id===station.id),matched=homes?active:ids.has(station.id);markup+=`<g data-station-id="${escapeHtml(station.id)}" role="button" tabindex="0" aria-label="${escapeHtml(station.name)}"><title>${escapeHtml(station.name+' · '+station.line)}</title><circle cx="${x}" cy="${y}" r="${active?6:matched?4:2.2}" class="${active?'metro-selected':'metro-point'}" opacity="${matched?1:.35}"/>${(active||matched&&showLabels)?`<text x="${x+8}" y="${y-7}" class="${active?'metro-selected-label':''}">${escapeHtml(station.name)}</text>`:''}</g>`;}
 if(homes)for(const item of visible){const [x,y]=point(item);markup+=`<g data-community-id="${escapeHtml(item.id)}" role="button" tabindex="0" aria-label="${escapeHtml(item.name)}"><title>${escapeHtml(item.name)}</title><circle cx="${x}" cy="${y}" r="${state.homes.selectedCommunity===item.id?7:4}" class="metro-home"/>${state.homes.selectedCommunity===item.id?`<text x="${x+9}" y="${y-8}">${escapeHtml(item.name)}</text>`:''}</g>`;}
 if(state.routeOrigin){const [lng,lat]=state.routeOrigin.split(',').map(Number),[x,y]=point({lng,lat});markup+=`<circle cx="${x}" cy="${y}" r="6" fill="#574d40"/><text x="${x+10}" y="${y+5}">工作地点</text>`;}
 svg.innerHTML=markup;canvas.appendChild(svg);
 svg.addEventListener('click',event=>{const station=event.target.closest('[data-station-id]'),community=event.target.closest('[data-community-id]');if(station&&!homes)toggleStation(station.dataset.stationId);if(community){state.homes.selectedCommunity=community.dataset.communityId;state.communityPois=[];state.communityReviews=[];rightRail.innerHTML=renderRightCommunity();bindCommonActions();renderMetroSchematic();loadCommunityPois();}});
 svg.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)&&event.target.matches('[data-station-id],[data-community-id]')){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
 document.getElementById('map-provider-status').textContent='线路与位置：高德 · 地铁时间为估算';
}
let communityCursors=[];
async function discoverCommunities(more=false){
 if(more&&state.communityLoading)return;
 const generation=++discoveryGeneration;
 if(!more){state.communities=[];communityCursors=state.stations.filter(s=>state.homes.selectedStationIds.includes(s.id)).map(station=>({station,page:1,count:0,done:false}));}
 state.communityLoading=true;state.communityCoverage='正在读取真实小区';renderAll();
 const found=new Map(state.communities.map(item=>[item.id,item]));let failed=false;
 for(const cursor of communityCursors){
  if(cursor.done)continue;
  const station=cursor.station;
  try{for(let batch=0;batch<8&&cursor.page<=20;batch++){
   if(generation!==discoveryGeneration)return;
   const params=new URLSearchParams({location:`${station.lng},${station.lat}`,radius:'2500',page:String(cursor.page)}),result=await api(`discover/communities?${params}`);cursor.count=result.count;
   for(const item of result.communities){const walkEstimate=Math.ceil(metroKm(station,item)/4.5*60),cycleEstimate=Math.ceil(metroKm(station,item)/15*60),old=found.get(item.id);if(!old||old.walk>walkEstimate)found.set(item.id,{...item,station:station.name,station_id:station.id,walk:walkEstimate,cycle:cycleEstimate,timeSource:'estimate'});}
   const done=cursor.page*25>=result.count||result.fetchedCount===0;cursor.page++;cursor.done=done||cursor.page>20;
   state.communities=[...found.values()];renderAll();if(cursor.done)break;
  }}catch(e){failed=true;showToast(`小区查询失败：${e.message}`);}
 }
 if(generation!==discoveryGeneration)return;
 state.communityLoading=false;state.communityHasMore=communityCursors.some(cursor=>!cursor.done);
 const capped=communityCursors.some(cursor=>cursor.page>20&&cursor.count>500);
 state.communityCoverage=`已读取 ${found.size} 个小区 · 站点周边2.5km${state.communityHasMore?' · 可继续读取':''}${capped?' · 已达到单点分页上限，尚未覆盖全部小区':''}${failed?' · 部分查询失败':''} · 步行/骑行为距离估算`;renderAll();
}
window.addEventListener('resize',()=>{if(state.metroReady)renderMetroSchematic();});
