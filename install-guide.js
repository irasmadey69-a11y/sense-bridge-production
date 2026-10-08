(() => {
  'use strict';
  const packs = window.SB_I18N.modules.install_24;
  const ua = navigator.userAgent;
  let device = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'ios' : ((/Android/i.test(ua) || (/Linux/i.test(ua) && navigator.maxTouchPoints > 0 && Math.min(screen.width,screen.height) < 700)) || (/Linux/i.test(ua) && navigator.maxTouchPoints > 0 && Math.min(screen.width,screen.height) < 700)) ? 'android' : 'desktop';
  let installed = false;
  let busy = false;
  let dialog;
  let trigger;
  function copy() { return packs[typeof UI !== 'undefined' ? UI.lang : 'PL'] || packs.EN; }
  function shell() { return installed || sbIsStoreShell(); }
  function refresh() {
    const button = document.getElementById('installAppBtn');
    if(button) { button.style.display = shell() ? 'none' : ''; button.setAttribute('aria-haspopup','dialog'); }
    if(dialog && dialog.open) { if(shell()) dialog.close(); else render(); }
  }
  function line(parent,tag,text,className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if(className) node.className = className;
    parent.appendChild(node);
    return node;
  }
  function render() {
    const t = copy();
    const focused = dialog.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    dialog.replaceChildren();
    dialog.dir = document.documentElement.dir || 'ltr';
    const close = line(dialog,'button','×','sb-install-close');
    close.type = 'button'; close.dataset.focus = 'close'; close.setAttribute('aria-label',t.close);
    close.addEventListener('click',() => dialog.close());
    const logo = document.createElement('img'); logo.src='/icon-192.png'; logo.alt=''; logo.width=64; logo.height=64; dialog.appendChild(logo);
    const title = line(dialog,'h2',device === 'desktop' ? t.install+' · Sense Bridge' : t.title); title.id='sb-install-dialog-title';
    line(dialog,'p',device === 'desktop' ? t.desktop : t.lead,'sb-install-lead');
    const tabs = line(dialog,'div','','sb-install-tabs'); tabs.setAttribute('role','group'); tabs.setAttribute('aria-label','Android / iPhone / iPad / Desktop');
    for(const [key,label] of [['android','Android'],['ios','iPhone / iPad'],['desktop','Desktop']]) {
      const button = line(tabs,'button',label); button.type='button'; button.dataset.focus=key;
      button.setAttribute('aria-pressed',String(device === key));
      button.addEventListener('click',() => {device=key;render();});
    }
    const steps = line(dialog,'ol','','sb-install-cards');
    const descriptions = device === 'ios' ? [t.safari,t.ios,t.confirm+' · '+t.webapp] : [t.menu,device === 'android' ? t.android : t.desktop,t.launch];
    ['browser','action','icon'].forEach((kind,index) => {
      const item = line(steps,'li','');
      const art = line(item,'div','','sb-install-art'); art.setAttribute('aria-hidden','true');
      line(art,'span',String(index+1),'sb-install-number');
      if(kind==='action' && device==='ios') {
        art.innerHTML += '<svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" stroke-width="3"><path d="M15 22H9v21h30V22h-6M24 32V5m-9 9 9-9 9 9"/></svg><span>→ ⊞</span>';
      } else if(kind === 'icon') {
        const icon=document.createElement('img');icon.src='/icon-192.png';icon.alt='';icon.width=56;icon.height=56;art.appendChild(icon);
      } else { line(art,'span',kind==='browser' ? '▤ ⋮' : '⋮ → ⊞'); }
      line(item,'strong',descriptions[index]);
    });
    line(dialog,'p',t.note,'sb-install-note');
    if(deferredPrompt && device !== 'ios') {
      const native = line(dialog,'button',t.install,'sb-install-native'); native.type='button'; native.dataset.focus='native'; native.disabled=busy;
      native.addEventListener('click',promptInstall);
    }
    const done=line(dialog,'button',t.close,'sb-install-done');done.type='button';done.dataset.focus='done';done.addEventListener('click',() => dialog.close());
    if(focused) dialog.querySelector('[data-focus="'+focused+'"]')?.focus();
  }
  function guide() {
    if(!dialog) {
      dialog=document.createElement('dialog');dialog.id='sbInstallGuide';dialog.className='sb-install-dialog';dialog.setAttribute('aria-labelledby','sb-install-dialog-title');
      document.body.appendChild(dialog);
      dialog.addEventListener('click',e => {if(e.target === dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
      dialog.addEventListener('close',() => {if(trigger && !shell()) trigger.focus();});
    }
    render();if(!dialog.open) dialog.showModal();
  }
  async function promptInstall() {
    if(busy || shell()) return;
    const event=deferredPrompt;
    if(!event) {guide();return;}
    busy=true;deferredPrompt=null;
    try {
      await event.prompt();
      const choice=await event.userChoice;
      if(choice.outcome !== 'accepted') guide();
      else if(dialog?.open) dialog.close();
    } catch(e) {guide();}
    finally {busy=false;refresh();}
  }
  function open() {
    if(shell()) return;
    trigger=document.activeElement;
    if(deferredPrompt && device !== 'ios') return promptInstall();
    guide();
  }
  window.SBInstall={open,refresh};
  window.addEventListener('appinstalled',() => {
    if(!installed && typeof trackEvent==='function') trackEvent('shortcut_add');
    installed=true;deferredPrompt=null;refresh();
  });
  for(const mode of ['standalone','fullscreen','minimal-ui']) {
    const query=window.matchMedia('(display-mode: '+mode+')');
    if(query.addEventListener) query.addEventListener('change',refresh);
    else if(query.addListener) query.addListener(refresh);
  }
  if('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/service-worker.js',{scope:'/'}).catch(() => {});
  }
  function start() {
    refresh();
    const params=new URLSearchParams(location.search);
    const requested=(params.get('lang') || '').toUpperCase();
    if(params.get('install') === '1') {
      if(packs[requested] && typeof setUiLang === 'function') setUiLang(requested);
      if(!shell()) {trigger=document.getElementById('installAppBtn');guide();}
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
