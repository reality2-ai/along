import {metres} from './planner.js';

const normalise = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/\brd\b/g,'road').replace(/\bst\b/g,'street').replace(/\bave\b/g,'avenue').replace(/\bdr\b/g,'drive').replace(/\bmt\b/g,'mount').replace(/[^a-z0-9/ ]/g,' ').replace(/\s+/g,' ').trim();

class Heap {
  constructor(){this.items=[];}
  push(node,cost){const item=[node,cost],a=this.items;let i=a.length;a.push(item);while(i>0){const p=(i-1)>>1;if(a[p][1]<=cost)break;a[i]=a[p];i=p;}a[i]=item;}
  pop(){const a=this.items,first=a[0],last=a.pop();if(a.length){let i=0;while(2*i+1<a.length){let c=2*i+1;if(c+1<a.length&&a[c+1][1]<a[c][1])c++;if(a[c][1]>=last[1])break;a[i]=a[c];i=c;}a[i]=last;}return first;}
  get length(){return this.items.length;}
}

export class StreetGraph {
  constructor(data,addressData){
    if(data.version!==1)throw new Error('Please update the walking map.');
    this.data=data;
    if(!(data.coords instanceof Int32Array))data.coords=new Int32Array(data.coords);if(!(data.edges instanceof Int32Array))data.edges=new Int32Array(data.edges);
    data.flags=new Uint8Array(data.flags||data.edges.length/4);this.profile={avoidSteps:false,pace:1.25};
    const count=data.coords.length/2,edges=data.edges;
    this.head=new Int32Array(count).fill(-1);this.reverseHead=new Int32Array(count).fill(-1);
    this.next=new Int32Array(edges.length/4);this.reverseNext=new Int32Array(edges.length/4);
    this.grid=new Map();
    for(let i=0;i<count;i++){
      const {lat,lon}=this.point(i),key=this.cell(lat,lon);if(!this.grid.has(key))this.grid.set(key,[]);this.grid.get(key).push(i);
    }
    for(let i=0;i<edges.length;i+=4){const e=i/4,a=edges[i],b=edges[i+1];this.next[e]=this.head[a];this.head[a]=e;this.reverseNext[e]=this.reverseHead[b];this.reverseHead[b]=e;}
    this.addresses=addressData?.addresses?.length?addressData.addresses:data.addresses;
    this.addressIndex=new Map();
    this.addresses.forEach((a,i)=>{
      // Index by first number, including units. Normalise only the small candidate set per search.
      const number=a[1].match(/\d+/)?.[0]||'';
      if(!this.addressIndex.has(number))this.addressIndex.set(number,[]);this.addressIndex.get(number).push(i);
    });
  }
  cell(lat,lon){return `${Math.floor(lat*1000)}:${Math.floor(lon*1000)}`;}
  point(node){return {lat:this.data.coords[node*2]/1e6,lon:this.data.coords[node*2+1]/1e6};}
  search(query){
    const q=normalise(query),words=q.split(' ');if(q.length<3)return [];
    const number=q.match(/^\d+/)?.[0],candidates=number?this.addressIndex.get(number)||[]:null,results=[];
    const examine=i=>{const a=this.addresses[i],text=normalise(a[1]);if(words.every(w=>/^\d+[a-z]?$/.test(w)?text.split(' ').includes(w):text.includes(w)))results.push({id:a[0],name:a[1],lat:a[2],lon:a[3],street:a[4],placeType:'address',code:''});};
    if(candidates){for(const i of candidates)examine(i);}else{for(let i=0;i<this.addresses.length&&results.length<25;i++)examine(i);}
    return results.sort((a,b)=>a.name.length-b.name.length||a.name.localeCompare(b.name)).slice(0,10);
  }
  snap(place){
    if(!Number.isFinite(place.lat)||!Number.isFinite(place.lon))return null;
    const gx=Math.floor(place.lat*1000),gy=Math.floor(place.lon*1000),street=normalise(place.street||'');
    let best=null,bestStreet=null;
    for(let x=gx-2;x<=gx+2;x++)for(let y=gy-2;y<=gy+2;y++)for(const node of this.grid.get(`${x}:${y}`)||[]){
      const distance=metres(place.lat,place.lon,this.point(node));if(distance>120)continue;
      let accessible=false;
      for(const [heads,next] of [[this.head,this.next],[this.reverseHead,this.reverseNext]])for(let e=heads[node];e!==-1;e=next[e])if(!this.profile.avoidSteps||!this.data.flags[e]){accessible=true;break;}
      if(!accessible)continue;
      if(!best||distance<best.distance)best={node,distance,seconds:Math.ceil(distance/this.profile.pace)};
      if(street&&(!bestStreet||distance<bestStreet.distance)){
        for(let e=this.head[node];e!==-1;e=this.next[e])if((!this.profile.avoidSteps||!this.data.flags[e])&&normalise(this.data.names[this.data.edges[e*4+3]])===street){bestStreet={node,distance,seconds:Math.ceil(distance/this.profile.pace)};break;}
      }
    }
    return bestStreet||best;
  }
  reach(place,maxSeconds,reverse=false,{trackPath=true}={}){
    const snap=this.snap(place),distance=new Map(),parent=new Map();
    if(!snap||snap.seconds>maxSeconds)return {snap,distance,parent,reverse};
    const heap=new Heap();distance.set(snap.node,snap.seconds);heap.push(snap.node,snap.seconds);
    const head=reverse?this.reverseHead:this.head,next=reverse?this.reverseNext:this.next,edges=this.data.edges;
    while(heap.length){const [node,cost]=heap.pop();if(cost!==distance.get(node))continue;
      for(let e=head[node];e!==-1;e=next[e]){if(this.profile.avoidSteps&&this.data.flags[e])continue;const i=e*4,to=edges[i+(reverse?0:1)],arrival=cost+Math.ceil(edges[i+2]*1.25/this.profile.pace);
        if(arrival<=maxSeconds&&arrival<(distance.get(to)??Infinity)){distance.set(to,arrival);if(trackPath)parent.set(to,[node,e]);heap.push(to,arrival);}
      }
    }return {snap,distance,parent,reverse};
  }
  route(from,to,maxSeconds=1200){
    const end=this.snap(to);if(!end)return null;
    const tree=this.reach(from,maxSeconds),arrival=tree.distance.get(end.node);
    if(arrival===undefined||arrival+end.seconds>maxSeconds)return null;
    const edges=[];let node=end.node;
    while(tree.parent.has(node)){const [previous,edge]=tree.parent.get(node);edges.push(edge);node=previous;}
    edges.reverse();const steps=[],geometry=[[from.lat,from.lon]],c=this.data.edges;
    if(tree.snap.distance>5)steps.push({name:'Access to the walking network',metres:Math.round(tree.snap.distance),estimated:true});
    geometry.push([this.point(tree.snap.node).lat,this.point(tree.snap.node).lon]);
    for(const edge of edges){const i=edge*4,a=this.point(c[i]),b=this.point(c[i+1]),name=this.data.names[c[i+3]],length=metres(a.lat,a.lon,b),last=steps.at(-1);
      if(last?.name===name&&!last.estimated)last.metres+=length;else steps.push({name,metres:length});geometry.push([b.lat,b.lon]);
    }
    if(end.distance>5)steps.push({name:'Access to your destination',metres:Math.round(end.distance),estimated:true});
    geometry.push([to.lat,to.lon]);
    return {seconds:Math.ceil(arrival+end.seconds),metres:Math.round(steps.reduce((sum,s)=>sum+s.metres,0)),steps:steps.map(s=>({...s,metres:Math.round(s.metres)})),geometry};
  }
}
