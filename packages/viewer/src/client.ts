/**
 * Canva-style editor chrome injected around the compiled slides:
 *   left  — rail + panels (Слайды / Элементы / Текст / Бренд)
 *   center— a vertical scroll of slide cards; the card nearest the viewport center is
 *           the "current" slide (tracked + sent to the AI so it knows where you are)
 *   right — AI chat that edits the deck through the same id-addressed ops
 * Kept as plain strings (no backticks / ${} inside) so it injects verbatim.
 */
export const CHROME_CSS = `
.dc-app{ margin:0; height:100vh; display:flex; font:14px/1.4 -apple-system,Segoe UI,sans-serif; background:#dfe2e7; overflow:hidden; }

#dc-left{ width:280px; flex:none; display:flex; background:#fff; border-right:1px solid #d7dae0; }
.dc-rail{ width:74px; flex:none; background:#f3f4f6; border-right:1px solid #e4e6eb; display:flex; flex-direction:column; }
.dc-tab{ border:none; background:none; padding:13px 4px; font-size:11px; color:#5b606b; cursor:pointer; }
.dc-tab.dc-act{ color:#ec5a13; background:#fff; }
.dc-tab .dc-ico{ display:block; font-size:18px; margin-bottom:3px; }
.dc-panels{ flex:1; overflow:auto; }
.dc-panel2{ display:none; padding:12px; }
.dc-panel2.dc-on{ display:block; }
.dc-panel2 h4{ margin:0 0 10px; font-size:12px; color:#9298a3; font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
.dc-slidethumb{ display:block; width:184px; height:103px; margin:0 0 10px; padding:0; position:relative; border:2px solid #c7cbd3; border-radius:5px; overflow:hidden; background:#000; cursor:pointer; }
.dc-slidethumb.dc-cur{ border-color:#ec5a13; }
.dc-slidethumb > section{ transform:scale(0.14375); transform-origin:top left; pointer-events:none; }
.dc-slidethumb .dc-no{ position:absolute; top:3px; left:5px; color:#fff; font:11px sans-serif; opacity:.85; }
.dc-block{ display:block; width:100%; text-align:left; margin-bottom:8px; padding:11px 12px; border:1px solid #e2e4e9; background:#fafbfc; border-radius:8px; cursor:pointer; font-size:13px; color:#222; }
.dc-block:hover{ background:#f0f1f3; }
.dc-swatches{ display:flex; flex-wrap:wrap; gap:8px; }
.dc-swatch{ width:34px; height:34px; border-radius:7px; border:1px solid #d7dae0; cursor:pointer; }

#dc-center{ flex:1; min-width:0; display:flex; flex-direction:column; background:#dfe2e7; position:relative; }
#dc-stage{ flex:1; position:relative; overflow-y:auto; overflow-x:hidden; display:flex; flex-direction:column; align-items:center; gap:24px; padding:30px 0 60px; min-height:0; }
.dc-frame{ display:block; flex:none; border:1px solid #aeb3bd; background:#000; }
.dc-frame > section{ transform-origin:top left; }
[data-cid]{ cursor:pointer; }
.dc-selected{ outline:2px solid #ec5a13 !important; outline-offset:-2px; }
#dc-panel{ position:absolute; top:14px; right:14px; width:224px; background:#fff; color:#111; border:1px solid #c2c6cf; border-radius:8px; padding:11px 12px; z-index:20; }
#dc-panel .dc-row{ display:flex; gap:8px; margin-bottom:4px; }
#dc-panel .dc-k{ color:#999; width:32px; }
#dc-panel code{ font:12px/1.4 ui-monospace,Menlo,monospace; color:#ec5a13; word-break:break-all; }
#dc-panel .dc-actions{ display:flex; gap:6px; margin-top:9px; }
#dc-panel button{ flex:1; border:1px solid #d0d0d0; background:#f6f6f6; color:#222; border-radius:6px; padding:6px; font-size:12px; cursor:pointer; }
#dc-panel .dc-note{ margin-top:9px; color:#9a9a9a; font-size:11px; }
#dc-flash{ position:absolute; bottom:14px; left:14px; background:#111; color:#fff; padding:7px 12px; border-radius:6px; font-size:12px; opacity:0; transition:opacity .2s; z-index:30; }

#dc-right{ width:330px; flex:none; display:flex; flex-direction:column; background:#fff; border-left:1px solid #d7dae0; }
#dc-chat-head{ padding:12px 14px; border-bottom:1px solid #eee; font-weight:600; color:#222; }
#dc-chat{ flex:1; overflow:auto; padding:12px; display:flex; flex-direction:column; gap:8px; }
.dc-msg{ padding:8px 11px; border-radius:10px; font-size:13px; max-width:88%; white-space:pre-wrap; }
.dc-msg.user{ align-self:flex-end; background:#ec5a13; color:#fff; }
.dc-msg.ai{ align-self:flex-start; background:#f1f2f4; color:#222; }
.dc-msg.sys{ align-self:center; color:#9298a3; font-size:12px; }
#dc-chat-form{ display:flex; gap:6px; padding:10px; border-top:1px solid #eee; }
#dc-chat-input{ flex:1; border:1px solid #d2d6de; border-radius:8px; padding:8px; font:13px sans-serif; resize:none; }
#dc-chat-send{ border:none; background:#ec5a13; color:#fff; border-radius:8px; width:38px; cursor:pointer; font-size:16px; }
`;

export const CLIENT_JS = `
(function(){
  var stage=document.getElementById('dc-stage');
  var frames=[].slice.call(document.querySelectorAll('#dc-stage .dc-frame'));
  var thumbs=[].slice.call(document.querySelectorAll('.dc-slidethumb'));
  var cur=0;

  function curSlideId(){ var f=frames[cur]; var s=f&&f.querySelector('section'); return s?s.getAttribute('data-cid'):null; }
  function fitAll(){
    var sc=Math.min((stage.clientWidth-64)/1280, 0.95); if(sc<0.1) sc=0.1;
    for(var i=0;i<frames.length;i++){
      frames[i].style.width=(1280*sc)+'px'; frames[i].style.height=(720*sc)+'px';
      var sec=frames[i].querySelector('section'); if(sec) sec.style.transform='scale('+sc+')';
    }
  }
  function updateCurrent(){
    var mid=stage.scrollTop+stage.clientHeight/2, best=0, bestD=1e9;
    for(var i=0;i<frames.length;i++){
      var c=frames[i].offsetTop+frames[i].offsetHeight/2, d=Math.abs(c-mid);
      if(d<bestD){ bestD=d; best=i; }
    }
    cur=best; sessionStorage.setItem('dc-cur',String(cur));
    for(var t=0;t<thumbs.length;t++) thumbs[t].classList.toggle('dc-cur',t===cur);
  }
  function goto(i){ var f=frames[i]; if(f) f.scrollIntoView({behavior:'smooth',block:'center'}); }
  window.addEventListener('resize',function(){ fitAll(); updateCurrent(); });
  stage.addEventListener('scroll',updateCurrent);
  for(var t=0;t<thumbs.length;t++){ (function(idx){ thumbs[idx].onclick=function(){ goto(idx); }; })(t); }
  document.addEventListener('keydown',function(e){
    if(e.target&&e.target.getAttribute&&e.target.getAttribute('contenteditable')==='true') return;
    if(e.target&&e.target.id==='dc-chat-input') return;
    if(e.key==='ArrowDown'){ e.preventDefault(); goto(Math.min(cur+1,frames.length-1)); }
    if(e.key==='ArrowUp'){ e.preventDefault(); goto(Math.max(cur-1,0)); }
  });

  // left rail tabs
  var tabs=[].slice.call(document.querySelectorAll('.dc-tab'));
  var panels=[].slice.call(document.querySelectorAll('.dc-panel2'));
  function setTab(name){
    sessionStorage.setItem('dc-tab',name);
    for(var i=0;i<tabs.length;i++) tabs[i].classList.toggle('dc-act',tabs[i].getAttribute('data-tab')===name);
    for(var j=0;j<panels.length;j++) panels[j].classList.toggle('dc-on',panels[j].getAttribute('data-panel')===name);
  }
  for(var i=0;i<tabs.length;i++){ (function(tb){ tb.onclick=function(){ setTab(tb.getAttribute('data-tab')); }; })(tabs[i]); }

  function flash(m){ var h=document.getElementById('dc-flash'); h.textContent=m; h.style.opacity='1'; setTimeout(function(){ h.style.opacity='0'; },1600); }
  function post(url,obj){ return fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(obj)}).then(function(r){ return r.json(); }); }

  // insert blocks (Элементы / Текст) into the current slide
  var blockBtns=[].slice.call(document.querySelectorAll('.dc-block'));
  for(var b=0;b<blockBtns.length;b++){ (function(btn){ btn.onclick=function(){
    var bid=btn.getAttribute('data-block'); var pid=curSlideId(); if(!pid) return;
    post('/api/insert_block',{blockId:bid,parentId:pid,index:999}).then(function(res){ if(res&&res.error) flash('error: '+res.error); else flash('added '+bid); });
  }; })(blockBtns[b]); }

  // brand swatches recolor the selected element
  var sel=null;
  var sw=[].slice.call(document.querySelectorAll('.dc-swatch'));
  for(var s=0;s<sw.length;s++){ (function(el){ el.onclick=function(){
    if(!sel){ flash('select an element first'); return; }
    post('/api/op',{ops:[{op:'set_token',nodeId:sel.getAttribute('data-cid'),prop:'color',value:el.getAttribute('data-token')}]}).then(function(res){ if(res&&res.error) flash('error: '+res.error); });
  }; })(sw[s]); }

  // selection + inline edit
  function clearSel(){ var n=document.querySelectorAll('.dc-selected'); for(var i=0;i<n.length;i++) n[i].classList.remove('dc-selected'); }
  function panel(el){
    var p=document.getElementById('dc-panel');
    var cid=el.getAttribute('data-cid')||''; var type=el.getAttribute('data-type')||'';
    var editable=(type==='title'||type==='heading');
    p.innerHTML='<div class="dc-row"><span class="dc-k">id</span><code>'+cid+'</code></div>'+
      '<div class="dc-row"><span class="dc-k">type</span>'+type+'</div>'+
      '<div class="dc-actions"><button id="dc-copy">Copy @id</button><button id="dc-target">AI target</button></div>'+
      '<div class="dc-note">'+(editable?'double-click to edit text':'mark as AI target, then ask in chat')+'</div>';
    document.getElementById('dc-copy').onclick=function(){ try{ navigator.clipboard.writeText('@'+cid); }catch(e){} flash('copied @'+cid); };
    document.getElementById('dc-target').onclick=function(){ post('/api/selection',{nodeId:cid}).then(function(){ flash('AI target = '+cid); }); };
  }
  document.addEventListener('click',function(e){
    if(e.target.closest('#dc-panel')||e.target.closest('#dc-left')||e.target.closest('#dc-right')) return;
    var el=e.target.closest('#dc-stage [data-cid]'); if(!el) return;
    e.preventDefault(); clearSel(); el.classList.add('dc-selected'); sel=el; panel(el);
  });
  document.addEventListener('dblclick',function(e){
    var el=e.target.closest('#dc-stage [data-cid]'); if(!el) return;
    var type=el.getAttribute('data-type'); if(type!=='title'&&type!=='heading') return;
    e.preventDefault(); el.setAttribute('contenteditable','true'); el.focus();
    var cid=el.getAttribute('data-cid');
    function finish(){ el.removeAttribute('contenteditable'); var txt=(el.textContent||'').replace(/\\s+/g,' ').trim(); post('/api/op',{ops:[{op:'set_text',nodeId:cid,value:txt}]}).then(function(res){ if(res&&res.error) flash('error: '+res.error); }); }
    el.addEventListener('blur',finish,{once:true});
    el.addEventListener('keydown',function(k){ if(k.key==='Enter'){ k.preventDefault(); el.blur(); } });
  });

  // AI chat — tells the model which slide is in view
  var chat=document.getElementById('dc-chat');
  function addMsg(cls,text){ var d=document.createElement('div'); d.className='dc-msg '+cls; d.textContent=text; chat.appendChild(d); chat.scrollTop=chat.scrollHeight; return d; }
  document.getElementById('dc-chat-form').addEventListener('submit',function(e){
    e.preventDefault();
    var input=document.getElementById('dc-chat-input'); var msg=input.value.trim(); if(!msg) return;
    input.value=''; addMsg('user',msg); var pending=addMsg('sys','…');
    post('/api/chat',{message:msg,currentSlideId:curSlideId()}).then(function(res){
      pending.remove(); addMsg('ai',res.reply||'(no reply)');
      if(res.applied){ flash('applied '+res.applied+' edit(s)'); }
    }).catch(function(err){ pending.remove(); addMsg('sys','error: '+err); });
  });

  try{ var es=new EventSource('/api/events'); es.onmessage=function(){ location.reload(); }; }catch(e){}
  setTab(sessionStorage.getItem('dc-tab')||'slides');
  fitAll();
  var saved=parseInt(sessionStorage.getItem('dc-cur')||'0',10);
  if(saved>0&&frames[saved]) frames[saved].scrollIntoView({block:'center'});
  updateCurrent();
})();
`;
