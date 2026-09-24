// Fixed snapshot, sequential load and repeated searches under a chosen Node heap limit.
// Desktop diagnostic, not a browser or physical-phone memory measurement.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {Planner} from '../public/planner.js';
import {StreetGraph} from '../public/streets.js';
if(!global.gc)throw Error('Run Node with --expose-gc; this diagnostic measures retained memory.');
const records=[];
function sample(stage){const before=process.memoryUsage();global.gc();records.push({stage,before,retained:process.memoryUsage()});}
const load=async name=>JSON.parse(gunzipSync(await readFile(new URL('../data/'+name+'.json.gz',import.meta.url))));
sample('start');
const planner=new Planner(await load('network'));sample('timetable');
const graph=new StreetGraph(await load('streets'),await load('addresses'));planner.setStreets(graph);sample('streets-addresses');
let calls=0,nodes=0,parents=0;
const original=graph.reach.bind(graph);graph.reach=(...args)=>{const t=original(...args);calls++;nodes+=t.distance.size;parents+=t.parent.size;return t;};
const from=graph.search('277 Broadway Newmarket')[0],to=graph.search('10 Victoria Road Devonport')[0];
const runs=[];
for(const timeMode of ['arrive','arrive','leave','leave','arrive']){
 calls=nodes=parents=0;const start=performance.now();
 const journeys=planner.plan({from,to,date:'2026-09-23',time:'09:00',modes:['bus','train','ferry'],timeMode});
 if(!journeys.length)throw Error('No journey');
 runs.push({timeMode,ms:Math.round(performance.now()-start),calls,nodes,parents,journeys:journeys.map(j=>({departure:j.departure,arrival:j.arrival,legs:j.legs.map(l=>l.mode)})),forwardCache:planner.streetTransfers.size,reverseCache:planner.reverseStreetTransfers.size});
 sample(timeMode+' '+runs.length);
}
const report={node:process.version,records,runs};await mkdir('test-results',{recursive:true});await writeFile('test-results/routing-memory.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
