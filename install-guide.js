import {createLocalizer, setLocalizedText} from './i18n.js';
const language=createLocalizer();
const choice=document.getElementById('guide-language-choice');
function apply(){
  document.documentElement.lang=language.tag;
  document.title=language.text('guide.title');
  for(const section of document.querySelectorAll('[data-guide-language]'))section.hidden=section.dataset.guideLanguage!==language.language;
  choice.value=language.language;
  document.getElementById('guide-draft').hidden=language.language!=='mi';
  for(const [id,key] of [['guide-back','guide.back'],['guide-open','guide.open']])setLocalizedText(document.getElementById(id),language,key);
}
choice.onchange=()=>{
  const previous=document.querySelector('[data-guide-language]:not([hidden])');
  const open=[...previous.querySelectorAll('details')].map(el=>el.open);
  const result=language.setLanguage(choice.value);
  apply();
  document.querySelectorAll('[data-guide-language]:not([hidden]) details').forEach((el,i)=>{el.open=!!open[i];});
  setLocalizedText(document.getElementById('guide-language-status'),language,result.stored?'language.changed':'language.session',{language:language.language==='mi'?'Te reo Māori':'English'});
};
apply();
document.getElementById('guide-language').hidden=false;
