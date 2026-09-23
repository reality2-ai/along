export function normaliseRoutes(routes){
  if(!Array.isArray(routes)||routes.length>4||routes.some(r=>!r||!['bus','train','ferry'].includes(r.mode)||typeof r.route!=='string'||!r.route.trim()||r.route.length>120))return null;
  return routes.map(({mode,route})=>({mode,route}));
}
export function journeyRoutes(journey){return journey.legs.filter(l=>l.mode!=='walk').map(({mode,route})=>({mode,route}));}
export function sameRoutes(a,b){return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((r,i)=>r.mode===b[i].mode&&r.route===b[i].route);}
export function routePreferenceLabel(routes){return routes.length?routes.map(r=>`${r.mode[0].toUpperCase()+r.mode.slice(1)} ${r.route}`).join(' → '):'Walk or roll';}
const KEY='along-device-preview-journeys-v1';
// Keep saved places while bounding learned history separately. A new search
// must not silently remove a saved place received from another device.
const retained=journeys=>[...journeys.filter(j=>j.saved),...journeys.filter(j=>!j.saved).slice(0,30)];
export function readPreferences(storage=globalThis.localStorage){
  try{const data=JSON.parse(storage.getItem(KEY));if(data&&Array.isArray(data.journeys))return {learning:data.learning!==false,mobility:data.mobility&&typeof data.mobility==='object'?data.mobility:{},journeys:retained(data.journeys.filter(j=>j.from?.id&&j.to?.id&&Number.isFinite(j.count)&&Array.isArray(j.hours)&&Array.isArray(j.days))).map(j=>({...j,savedRoutes:normaliseRoutes(j.savedRoutes)}))};}catch{}
  return {learning:true,journeys:[]};
}
export function writePreferences(data,storage=globalThis.localStorage){try{storage.setItem(KEY,JSON.stringify(data));return true;}catch{return false;}}
export function recordJourney(data,from,to,context){
  if(!data.learning)return data;
  const journeys=data.journeys.map(j=>({...j,hours:[...j.hours],days:[...j.days]}));
  let journey=journeys.find(j=>j.from.id===from.id&&j.to.id===to.id);
  if(!journey){journey={from,to,count:0,hours:Array(24).fill(0),days:Array(7).fill(0),last:0,saved:false};journeys.push(journey);}
  journey.count++;journey.hours[context.hour]++;journey.days[context.day]++;journey.last=context.timestamp;
  return {...data,journeys:retained(journeys.sort((a,b)=>Number(b.saved)-Number(a.saved)||b.last-a.last))};
}
export function suggestions(data,{hour,day}){
  const weekend=d=>d===0||d===6;
  const score=j=> (j.saved?30:0)+Math.log2(j.count+1)*3+j.hours.reduce((sum,n,h)=>sum+n*(Math.min(Math.abs(h-hour),24-Math.abs(h-hour))<=2?2:0),0)+j.days.reduce((sum,n,d)=>sum+(weekend(d)===weekend(day)?n:0),0);
  return data.journeys.filter(j=>j.saved||(data.learning&&j.count>=2)).sort((a,b)=>score(b)-score(a)||b.last-a.last).slice(0,3);
}
