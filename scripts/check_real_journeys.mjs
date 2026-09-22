// Validate integration against a fixed public snapshot; output is checked against
// the original GTFS ZIP by test/check_gtfs_journeys.py, not only the browser bundle.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {Planner} from '../public/planner.js';
import {StreetGraph} from '../public/streets.js';
const load=async name=>JSON.parse(gunzipSync(await readFile(new URL(`../data/${name}.json.gz`,import.meta.url))));
const start=performance.now();
const [network,streets,addresses]=await Promise.all(['network','streets','addresses'].map(load));
const planner=new Planner(network),graph=new StreetGraph(streets,addresses);planner.setStreets(graph);
const report={date:'2026-09-23',runtime:process.version,loadMs:Math.round(performance.now()-start),cases:[]};
for(const [name,fromQuery,toQuery,modes] of [
 ['train and ferry','277 Broadway Newmarket','10 Victoria Road Devonport',['bus','train','ferry']],
 ['city bus','1 Queen Street Auckland Central','805 Great North Road',['bus']],
 ['walking','1 Queen Street Auckland Central','2 Queen Street Auckland Central',['bus','train','ferry']],
]){
 const from=graph.search(fromQuery)[0],to=graph.search(toQuery)[0];
 if(!from||!to)throw new Error(`Address fixture missing: ${name}`);
 const began=performance.now();const journeys=planner.plan({from,to,date:report.date,time:'09:00',modes});
 if(!journeys.length)throw new Error(`No journey: ${name}`);
 const journey=journeys[0];
 if(name==='train and ferry'&&!['train','ferry'].every(m=>journey.legs.some(l=>l.mode===m)))throw new Error('Expected train/ferry combination');
 if(name==='city bus'&&!journey.legs.some(l=>l.mode==='bus'))throw new Error('Expected bus journey');
 if(name==='walking'&&!journey.walkOnly)throw new Error('Expected walking option');
 report.cases.push({name,from,to,modes,elapsedMs:Math.round(performance.now()-began),journey});
}
report.memoryBeforeGC=process.memoryUsage();
if(global.gc){global.gc();report.memoryAfterGC=process.memoryUsage();}
await mkdir('test-results',{recursive:true});await writeFile('test-results/real-journeys.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,cases:report.cases.map(c=>({name:c.name,modes:c.journey.legs.map(l=>l.mode),elapsedMs:c.elapsedMs,minutes:Math.ceil(c.journey.duration/60)}))},null,2));
