import {readRelayConfiguration} from './configuration.mjs';
import {openRelaySharingService} from './sharing-service.mjs';
import {readJourneyStartupState} from '../journey-sync/startup-state.mjs';

// App lifetime, separate from the Settings dialog and manual connection. Paused
// recovery state never silently starts a relay session. No default service.
export function createAppRelayController({wasm,store,expectedGroup,member,prepare,onSaved,onStatus=()=>{},signal}){
  const options={wasm,store,expectedGroup:expectedGroup.slice(),member};
  let closed=false,service,key,timer,pending;
  const controller=new AbortController();
  const report=state=>{try{onStatus(state);}catch{}};
  const stop=()=>{service?.close();service=undefined;key=undefined;};
  const close=()=>{if(closed)return;closed=true;controller.abort();clearTimeout(timer);stop();signal?.removeEventListener('abort',close);};
  const refresh=()=>{
    if(closed||signal?.aborted){close();return Promise.resolve();}
    if(pending)return pending;
    pending=(async()=>{
      const config=await readRelayConfiguration(options);
      if(closed)return;
      if(!config.enabled){stop();report('off');return;}
      const startup=await readJourneyStartupState({...options,signal:controller.signal});
      if(closed)return;
      if(!['legacy','generation-ready'].includes(startup.status)){stop();report('review-required');return;}
      const next=JSON.stringify([config.revision,startup.status,startup.generation]);
      if(service&&!service.signal.aborted&&key===next)return;
      stop();await prepare();if(closed)return;
      const opened=await openRelaySharingService({...options,generationAware:startup.status==='generation-ready',signal:controller.signal,onSaved,
        onStatus:state=>report(state.state)});
      if(closed){opened?.close();return;}service=opened;key=next;
    })().catch(()=>{stop();if(!closed)report('unavailable');}).finally(()=>{pending=undefined;clearTimeout(timer);if(!closed)timer=setTimeout(()=>{void refresh();},2000);});
    return pending;
  };
  signal?.addEventListener('abort',close,{once:true});
  return Object.freeze({refresh,close,async synchronize(){await refresh();if(!service)return [];return service.synchronize();}});
}
