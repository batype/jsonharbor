(() => {
  const key='jsonharbor-appearance-v1',valid=v=>['system','light','dark'].includes(v)?v:'system';
  let preference='system';try{preference=valid(localStorage.getItem(key));}catch{}
  const media=window.matchMedia('(prefers-color-scheme: dark)');
  function apply(){const mode=preference==='system'?(media.matches?'dark':'light'):preference;document.documentElement.dataset.appearance=mode;document.documentElement.style.colorScheme=mode;const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=mode==='dark'?'#101824':'#f5f7fb';const select=document.getElementById('appearance');if(select)select.value=preference;}
  apply();media.addEventListener('change',()=>{if(preference==='system')apply();});
  window.addEventListener('storage',e=>{if(e.key===key||e.key===null){preference=valid(e.newValue);apply();}});
  document.addEventListener('DOMContentLoaded',()=>{const select=document.getElementById('appearance');select.value=preference;select.addEventListener('change',()=>{preference=valid(select.value);try{localStorage.setItem(key,preference);}catch{}apply();});});
})();
