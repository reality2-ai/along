import {newFeedback,readFeedback,writeFeedback,clearFeedback,prepareHandoff,markHandoff,verifyFeedbackReceipt} from './feedback.js';
export function setupFeedback(language,getContext){
  const dialog=document.createElement('dialog');dialog.id='feedback';dialog.setAttribute('aria-labelledby','feedback-title');
  const phrase=key=>`<span data-feedback-text="${key}"></span>`;
  dialog.innerHTML=`<div class="dialog-title"><h2 id="feedback-title">${phrase('feedback.title')}</h2><button type="button" id="feedback-close">${phrase('action.back')}</button></div>
  <p>${phrase('feedback.public')}</p><p>${phrase('feedback.signin')}</p>
  <div id="feedback-edit"><label for="feedback-message">${phrase('feedback.message')}</label><textarea id="feedback-message" rows="5" maxlength="4000" aria-describedby="feedback-local"></textarea><p id="feedback-local">${phrase('feedback.local')}</p>
  <label class="setting"><input id="feedback-context" type="checkbox"> ${phrase('feedback.context')}</label><p id="feedback-context-preview" class="field-help"></p>
  <button type="button" class="primary-button" id="feedback-review">${phrase('feedback.review')}</button></div>
  <div id="feedback-reviewed" hidden><label for="feedback-body">${phrase('feedback.body')}</label><textarea id="feedback-body" rows="7" readonly></textarea><p id="feedback-copy-help" hidden>${phrase('feedback.copyHelp')}</p>
  <button type="button" class="secondary-button" id="feedback-copy">${phrase('feedback.copy')}</button>
  <button type="button" class="text-button" id="feedback-edit-again">${phrase('feedback.edit')}</button>
  <a class="primary-button" id="feedback-github" target="_blank" rel="noopener noreferrer">${phrase('feedback.github')}</a></div>
  <div id="feedback-receipt" hidden><p>${phrase('feedback.handoff')}</p><label for="feedback-url">${phrase('feedback.url')}</label><input id="feedback-url" type="url" inputmode="url" placeholder="https://github.com/reality2-ai/along/issues/…"><button type="button" class="secondary-button" id="feedback-check">${phrase('feedback.check')}</button>
  <details id="feedback-retry"><summary>${phrase('feedback.retry')}</summary><p>${phrase('feedback.retryHelp')}</p><label class="setting"><input id="feedback-not-submitted" type="checkbox"> ${phrase('feedback.notSubmitted')}</label><a id="feedback-reopen" target="_blank" rel="noopener noreferrer" hidden>${phrase('feedback.github')}</a></details></div>
  <p id="feedback-status" role="status" aria-live="polite"></p><p id="feedback-storage" role="status"></p><p><a id="feedback-confirmed" target="_blank" rel="noopener noreferrer" hidden>${phrase('feedback.view')}</a></p>
  <button type="button" class="text-button" id="feedback-clear">${phrase('feedback.clear')}</button>`;
  document.body.append(dialog);
  const $=id=>document.getElementById(id);
  let draft=readFeedback(),reviewing=false,statusKey='',storageKey='',opener=null,request=0;
  function status(key){statusKey=key;localize();}
  function localize(){
    for(const el of dialog.querySelectorAll('[data-feedback-text]')){const p=language.phrase(el.dataset.feedbackText);el.textContent=p.text;el.lang=p.lang;}
    for(const [id,key] of [['feedback-status',statusKey],['feedback-storage',storageKey]]){const p=key?language.phrase(key):{text:'',lang:language.tag};$(id).textContent=p.text;$(id).lang=p.lang;}
  }
  function persist(){storageKey=writeFeedback(draft)?'feedback.stored':'feedback.session';localize();}
  function render(){
    $('feedback-edit').hidden=reviewing||!!draft.handoff;
    $('feedback-reviewed').hidden=!reviewing&&!draft.handoff;
    $('feedback-receipt').hidden=!draft.handoff||!!draft.receipt;
    $('feedback-edit-again').hidden=!!draft.handoff;
    $('feedback-github').hidden=!!draft.handoff;
    $('feedback-confirmed').hidden=!draft.receipt;
    if(draft.receipt)$('feedback-confirmed').href=draft.receipt;
    if(reviewing||draft.handoff){const handoff=prepareHandoff(draft);$('feedback-body').value=handoff.body;$('feedback-copy-help').hidden=!handoff.copyRequired;$('feedback-github').href=handoff.url;$('feedback-reopen').href=handoff.url;}
    localize();
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-feedback-open]');if(!button)return;
    opener=button;$('feedback-check').disabled=false;if(!draft)draft=newFeedback({...getContext(),screen:button.dataset.feedbackOpen||getContext().screen});
    $('feedback-message').value=draft.message;$('feedback-context').checked=draft.shareContext;
    $('feedback-context-preview').textContent=`Along ${draft.context.version} · ${draft.context.language} · ${draft.context.screen}`;
    $('feedback-context-preview').lang='en-NZ';
    reviewing=false;statusKey=draft.receipt?'feedback.received':draft.handoff?'feedback.unverified':'';render();dialog.showModal();
    (draft.handoff?$('feedback-url'):$('feedback-message')).focus();
  });
  $('feedback-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{request++;opener?.focus({preventScroll:true});});
  $('feedback-message').oninput=()=>{draft.message=$('feedback-message').value;persist();};
  $('feedback-context').onchange=()=>{draft.shareContext=$('feedback-context').checked;persist();};
  $('feedback-review').onclick=()=>{
    if(!draft.message.trim()){status('feedback.empty');$('feedback-message').focus();return;}
    reviewing=true;persist();render();$('feedback-body').focus();
  };
  $('feedback-edit-again').onclick=()=>{reviewing=false;render();$('feedback-message').focus();};
  function handoff(event){
    if(!navigator.onLine){event.preventDefault();status('feedback.offline');return;}
    draft=markHandoff(draft);persist();status('feedback.unverified');
    // Let the explicit link open first, then expose receipt controls on return.
    setTimeout(()=>{render();$('feedback-url').focus();},0);
  }
  $('feedback-github').onclick=handoff;$('feedback-reopen').onclick=handoff;
  $('feedback-not-submitted').onchange=()=>{$('feedback-reopen').hidden=!$('feedback-not-submitted').checked;};
  $('feedback-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('feedback-body').value);status('feedback.copied');}catch{$('feedback-body').focus();$('feedback-body').select();status('feedback.selectCopy');}};
  $('feedback-check').onclick=async()=>{
    const sequence=++request;status('feedback.checking');$('feedback-check').disabled=true;
    const result=await verifyFeedbackReceipt(draft,$('feedback-url').value.trim(),{signal:AbortSignal.timeout(10000)});
    if(sequence!==request)return;$('feedback-check').disabled=false;
    if(result.status==='received'){draft.receipt=result.url;persist();render();status('feedback.received');}
    else status('feedback.'+result.status);
  };
  $('feedback-clear').onclick=()=>{
    request++;if(!clearFeedback()){storageKey='feedback.session';localize();return;}draft=null;reviewing=false;statusKey='';storageKey='';dialog.close();
  };
  language.subscribe(localize);localize();
}
