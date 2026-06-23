/**
 * Canva-style editor chrome injected around the compiled slides:
 *   left  — wide rail + panels (Slides / Elements / Text / Brand), elements shown as
 *           visual cards
 *   center— a vertical scroll of slide cards; the card nearest center is the "current"
 *           slide (its id is sent to the AI). Selecting an element shows a slim floating
 *           toolbar (no big info box).
 *   right — AI chat that edits the deck through the same id-addressed ops
 * Kept as plain strings (no backticks / ${} inside) so it injects verbatim.
 */
export const CHROME_CSS = `
.dc-app{ margin:0; height:100vh; display:flex; font:14px/1.4 -apple-system,Segoe UI,sans-serif; background:#dfe2e7; overflow:hidden; }

#dc-left{ width:344px; flex:none; display:flex; background:#fff; border-right:1px solid #d7dae0; }
.dc-rail{ width:74px; flex:none; background:#f3f4f6; border-right:1px solid #e4e6eb; display:flex; flex-direction:column; }
.dc-tab{ border:none; background:none; padding:13px 4px; font-size:11px; color:#5b606b; cursor:pointer; }
.dc-tab.dc-act{ color:#ec5a13; background:#fff; }
.dc-tab .dc-ico{ display:block; font-size:18px; margin-bottom:3px; }
.dc-panels{ flex:1; overflow:auto; }
.dc-panel2{ display:none; padding:16px; }
.dc-panel2.dc-on{ display:block; }
.dc-panel2 h4{ margin:0 0 12px; font-size:12px; color:#9298a3; font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
.dc-slidethumb{ display:block; width:240px; height:135px; margin:0 0 12px; padding:0; position:relative; border:2px solid #c7cbd3; border-radius:6px; overflow:hidden; background:#000; cursor:pointer; }
.dc-slidethumb.dc-cur{ border-color:#ec5a13; }
.dc-slidethumb > section{ transform:scale(0.1875); transform-origin:top left; pointer-events:none; }
.dc-slidethumb .dc-no{ position:absolute; top:4px; left:7px; color:#fff; font:11px sans-serif; opacity:.85; }

.dc-grid{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.dc-el{ border:1px solid #e2e4e9; border-radius:10px; background:#fff; padding:0; cursor:pointer; overflow:hidden; text-align:center; }
.dc-el:hover{ border-color:#ec5a13; }
.dc-el .dc-prev{ background:#13151b; height:84px; display:flex; flex-direction:column; justify-content:center; align-items:flex-start; gap:5px; padding:14px; overflow:hidden; }
.dc-el .dc-lbl{ display:block; padding:8px; font-size:12px; color:#333; }

.dc-swatches{ display:flex; flex-wrap:wrap; gap:10px; }
.dc-swatch{ width:40px; height:40px; border-radius:8px; border:1px solid #d7dae0; cursor:pointer; }

#dc-center{ flex:1; min-width:0; display:flex; flex-direction:column; background:#dfe2e7; position:relative; }
#dc-stage{ flex:1; position:relative; overflow-y:auto; overflow-x:hidden; display:flex; flex-direction:column; align-items:center; gap:24px; padding:30px 0 60px; min-height:0; }
.dc-frame{ display:block; flex:none; border:1px solid #aeb3bd; background:#000; }
.dc-frame > section{ transform-origin:top left; }
[data-cid]{ cursor:pointer; }
.dc-selected{ outline:2px solid #ec5a13 !important; outline-offset:-2px; }
#dc-tool{ position:fixed; display:none; align-items:center; flex-wrap:wrap; gap:6px; max-width:92vw; background:#111; border-radius:9px; padding:5px 8px; z-index:40; color:#cdd2da; font:11px -apple-system,Segoe UI,sans-serif; }
#dc-tool button{ border:none; background:#2a2d34; color:#fff; height:28px; min-width:28px; padding:0 9px; border-radius:6px; cursor:pointer; font-size:12px; }
#dc-tool button:hover{ background:#3a3e47; }
#dc-tool select,#dc-tool input{ height:28px; border:1px solid #3a3e47; background:#2a2d34; color:#fff; border-radius:6px; font-size:12px; }
#dc-tool input.dc-t-text{ width:160px; padding:0 8px; }
#dc-tool select{ padding:0 4px; max-width:120px; }
#dc-tool .dc-t-al{ display:flex; gap:2px; }
#dc-tool .dc-t-al button{ min-width:28px; padding:0; }
#dc-tool .dc-t-al button.on{ background:#ec5a13; }
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
  var tool=document.getElementById('dc-tool');
  var cur=0, sel=null;

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
    for(var i=0;i<frames.length;i++){ var c=frames[i].offsetTop+frames[i].offsetHeight/2, d=Math.abs(c-mid); if(d<bestD){ bestD=d; best=i; } }
    cur=best; sessionStorage.setItem('dc-cur',String(cur));
    for(var t=0;t<thumbs.length;t++) thumbs[t].classList.toggle('dc-cur',t===cur);
  }
  function goTo(i){ var f=frames[i]; if(f) f.scrollIntoView({behavior:'smooth',block:'center'}); }
  function flash(m){ var h=document.getElementById('dc-flash'); h.textContent=m; h.style.opacity='1'; setTimeout(function(){ h.style.opacity='0'; },1600); }
  function post(url,obj){ return fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(obj)}).then(function(r){ return r.json(); }); }

  // selection toolbar (slim, floats above the element)
  function placeTool(){ if(!sel){ tool.style.display='none'; return; } tool.style.display='flex'; var r=sel.getBoundingClientRect(); var w=tool.offsetWidth||320; var left=Math.min(Math.max(8,r.left), window.innerWidth-w-8); tool.style.left=Math.max(8,left)+'px'; tool.style.top=Math.max(8,r.top-42)+'px'; }
  function setHead(t){ var h=document.getElementById('dc-chat-head'); if(h) h.textContent=t; }
  function deleteNode(cid){ post('/api/op',{ops:[{op:'remove_node',nodeId:cid}]}).then(function(res){ if(res&&res.error) flash('error: '+res.error); else flash('deleted'); }); }
  function clearSel(){ var n=document.querySelectorAll('.dc-selected'); for(var i=0;i<n.length;i++) n[i].classList.remove('dc-selected'); sel=null; tool.style.display='none'; setHead('AI assistant'); }
  function editText(el){ el.setAttribute('contenteditable','true'); el.focus(); var cid=el.getAttribute('data-cid');
    function finish(){ el.removeAttribute('contenteditable'); var txt=(el.textContent||'').replace(/\\s+/g,' ').trim(); post('/api/op',{ops:[{op:'set_text',nodeId:cid,value:txt}]}).then(function(res){ if(res&&res.error) flash('error: '+res.error); }); }
    el.addEventListener('blur',finish,{once:true});
    el.addEventListener('keydown',function(k){ if(k.key==='Enter'){ k.preventDefault(); el.blur(); } });
  }
  // contextual toolbar: which style props each component type exposes, and its text field
  function styleProps(type){
    if(type==='stat-callout') return {font:'valueFont',size:'valueSize',color:'valueColor'};
    if(type==='image-caption'||type==='slide'||type==='container') return {};
    return {font:'font',size:'size',color:'color'};
  }
  function contentField(type){
    if(type==='stat-callout') return 'value';
    if(type==='image-caption') return 'caption';
    if(type==='bullet-list') return 'items';
    if(type==='title'||type==='heading') return 'text';
    return null;
  }
  function opts(list,curr){ var s=''; list=list||[]; for(var i=0;i<list.length;i++){ s+='<option value="'+list[i]+'"'+(list[i]===curr?' selected':'')+'>'+list[i]+'</option>'; } return s; }
  function tokenKey(ref){ if(!ref) return ''; var m=/token:\\/\\/[a-z]+\\/([A-Za-z0-9-]+)/.exec(ref); return m?m[1]:''; }
  function esc(s){ return (''+s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

  function select(el){
    clearSel(); el.classList.add('dc-selected'); sel=el;
    var cid=el.getAttribute('data-cid'); var type=el.getAttribute('data-type');
    setHead('AI · selected: '+type);
    placeTool();
    fetch('/api/node?id='+encodeURIComponent(cid)).then(function(r){ return r.json(); }).then(function(node){ if(sel!==el) return; buildTool(cid,type,(node&&node.id)?node:null); }).catch(function(){ if(sel===el) buildTool(cid,type,null); });
  }
  function buildTool(cid,type,node){
    var sp=styleProps(type); var th=window.DC_THEME||{}; var st=(node&&node.style)||{}; var cf=contentField(type);
    var html='';
    if(cf){ var val=''; if(node&&node.content){ val = cf==='items' ? ((node.content.items||[]).join(' | ')) : (node.content[cf]||''); } html+='<input class="dc-t-text" placeholder="text" value="'+esc(val)+'">'; }
    if(sp.font) html+='Font<select class="dc-t-f">'+opts(th.font,tokenKey(st[sp.font]))+'</select>';
    if(sp.size) html+='Size<select class="dc-t-s">'+opts(th.type,tokenKey(st[sp.size]))+'</select>';
    if(sp.color) html+='Color<select class="dc-t-c">'+opts(th.color,tokenKey(st[sp.color]))+'</select>';
    if(cf==='text'||cf==='items'){ var al=(node&&node.textAlign)||'left'; html+='<span class="dc-t-al"><button data-al="left"'+(al==='left'?' class="on"':'')+'>L</button><button data-al="center"'+(al==='center'?' class="on"':'')+'>C</button><button data-al="right"'+(al==='right'?' class="on"':'')+'>R</button></span>'; }
    html+='<button data-act="ai" title="set as AI target">AI</button>';
    tool.innerHTML=html;
    var tf=tool.querySelector('.dc-t-text');
    if(tf) tf.addEventListener('change',function(){
      if(cf==='text'){ post('/api/op',{ops:[{op:'set_text',nodeId:cid,value:tf.value}]}); }
      else { var c={}; if(node&&node.content){ for(var k in node.content) c[k]=node.content[k]; } if(cf==='items'){ c.items=tf.value.split('|').map(function(s){ return s.trim(); }).filter(Boolean); } else { c[cf]=tf.value; } post('/api/op',{ops:[{op:'set_content',nodeId:cid,content:c}]}); }
    });
    var sf=tool.querySelector('.dc-t-f'); if(sf) sf.addEventListener('change',function(){ post('/api/op',{ops:[{op:'set_token',nodeId:cid,prop:sp.font,value:'token://font/'+sf.value}]}); });
    var ss=tool.querySelector('.dc-t-s'); if(ss) ss.addEventListener('change',function(){ post('/api/op',{ops:[{op:'set_token',nodeId:cid,prop:sp.size,value:'token://type/'+ss.value}]}); });
    var sclr=tool.querySelector('.dc-t-c'); if(sclr) sclr.addEventListener('change',function(){ post('/api/op',{ops:[{op:'set_token',nodeId:cid,prop:sp.color,value:'token://color/'+sclr.value}]}); });
    var als=tool.querySelectorAll('.dc-t-al button'); for(var i=0;i<als.length;i++){ (function(btn){ btn.onclick=function(ev){ ev.stopPropagation(); post('/api/op',{ops:[{op:'set_align',nodeId:cid,value:btn.getAttribute('data-al')}]}); }; })(als[i]); }
    var aib=tool.querySelector('[data-act="ai"]'); if(aib) aib.onclick=function(ev){ ev.stopPropagation(); post('/api/selection',{nodeId:cid}).then(function(){ flash('AI target = '+cid); }); };
    placeTool();
  }

  window.addEventListener('resize',function(){ fitAll(); updateCurrent(); placeTool(); });
  stage.addEventListener('scroll',function(){ updateCurrent(); placeTool(); });
  for(var t=0;t<thumbs.length;t++){ (function(idx){ thumbs[idx].onclick=function(){ goTo(idx); }; })(t); }
  document.addEventListener('keydown',function(e){
    var t=e.target, tag=t&&t.tagName;
    if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||(t&&t.getAttribute&&t.getAttribute('contenteditable')==='true')) return;
    if(e.key==='ArrowDown'){ e.preventDefault(); goTo(Math.min(cur+1,frames.length-1)); }
    if(e.key==='ArrowUp'){ e.preventDefault(); goTo(Math.max(cur-1,0)); }
    if((e.key==='Delete'||e.key==='Backspace')&&sel){ e.preventDefault(); deleteNode(sel.getAttribute('data-cid')); }
  });

  // left rail tabs
  var tabs=[].slice.call(document.querySelectorAll('.dc-tab'));
  var panels=[].slice.call(document.querySelectorAll('.dc-panel2'));
  function setTab(name){ sessionStorage.setItem('dc-tab',name);
    for(var i=0;i<tabs.length;i++) tabs[i].classList.toggle('dc-act',tabs[i].getAttribute('data-tab')===name);
    for(var j=0;j<panels.length;j++) panels[j].classList.toggle('dc-on',panels[j].getAttribute('data-panel')===name);
  }
  for(var i=0;i<tabs.length;i++){ (function(tb){ tb.onclick=function(){ setTab(tb.getAttribute('data-tab')); }; })(tabs[i]); }

  // insert blocks (Elements / Text) into the current slide
  var blockBtns=[].slice.call(document.querySelectorAll('[data-block]'));
  for(var b=0;b<blockBtns.length;b++){ (function(btn){ btn.onclick=function(){ var bid=btn.getAttribute('data-block'); var pid=curSlideId(); if(!pid) return;
    post('/api/insert_block',{blockId:bid,parentId:pid,index:999}).then(function(res){ if(res&&res.error) flash('error: '+res.error); else flash('added '+bid); });
  }; })(blockBtns[b]); }

  // brand swatches recolor the selected element
  var sw=[].slice.call(document.querySelectorAll('.dc-swatch'));
  for(var s=0;s<sw.length;s++){ (function(el){ el.onclick=function(){ if(!sel){ flash('select an element first'); return; }
    post('/api/op',{ops:[{op:'set_token',nodeId:sel.getAttribute('data-cid'),prop:'color',value:el.getAttribute('data-token')}]}).then(function(res){ if(res&&res.error) flash('error: '+res.error); });
  }; })(sw[s]); }

  // select / edit on the stage
  document.addEventListener('click',function(e){
    if(e.target.closest('#dc-tool')||e.target.closest('#dc-left')||e.target.closest('#dc-right')) return;
    var el=e.target.closest('#dc-stage [data-cid]');
    if(!el){ clearSel(); return; }
    e.preventDefault(); select(el);
  });
  document.addEventListener('dblclick',function(e){ var el=e.target.closest('#dc-stage [data-cid]'); if(!el) return; var type=el.getAttribute('data-type'); if(type!=='title'&&type!=='heading') return; e.preventDefault(); editText(el); });

  // AI chat — tells the model which slide is in view
  var chat=document.getElementById('dc-chat');
  function addMsg(cls,text){ var d=document.createElement('div'); d.className='dc-msg '+cls; d.textContent=text; chat.appendChild(d); chat.scrollTop=chat.scrollHeight; return d; }
  document.getElementById('dc-chat-form').addEventListener('submit',function(e){ e.preventDefault();
    var input=document.getElementById('dc-chat-input'); var msg=input.value.trim(); if(!msg) return;
    input.value=''; addMsg('user',msg); var pending=addMsg('sys','…');
    var selId=sel?sel.getAttribute('data-cid'):null;
    post('/api/chat',{message:msg,currentSlideId:curSlideId(),selectedId:selId}).then(function(res){ pending.remove(); addMsg('ai',res.reply||'(no reply)'); if(res.applied){ flash('applied '+res.applied+' edit(s)'); } }).catch(function(err){ pending.remove(); addMsg('sys','error: '+err); });
  });

  // Soft re-render: patch the slide DOM in place instead of reloading the page, so
  // scroll position, the selection, the open panel, and the chat history all survive.
  function stripIds(h){ return h.replace(/ data-cid="[^"]*"/g,'').replace(/ data-type="[^"]*"/g,'').replace(/ data-role="[^"]*"/g,''); }
  function softRefresh(){
    fetch('/api/slides').then(function(r){ return r.json(); }).then(function(data){
      if(!data.slides || data.slides.length!==frames.length){ location.reload(); return; }
      var theme=document.getElementById('dc-theme'); if(theme&&typeof data.css==='string') theme.textContent=data.css;
      var prev=sel?sel.getAttribute('data-cid'):null;
      var editing=document.querySelector('#dc-stage [contenteditable="true"]');
      if(editing) return; // don't clobber an in-progress text edit
      for(var i=0;i<frames.length;i++){
        frames[i].innerHTML=data.slides[i].html;
        if(thumbs[i]) thumbs[i].innerHTML='<span class="dc-no">'+(i+1)+'</span>'+stripIds(data.slides[i].html);
      }
      fitAll(); sel=null; tool.style.display='none';
      if(prev){ var again=document.querySelector('#dc-stage [data-cid="'+prev+'"]'); if(again) select(again); }
    }).catch(function(){ location.reload(); });
  }
  try{ var es=new EventSource('/api/events'); es.onmessage=function(){ softRefresh(); }; }catch(e){}
  setTab(sessionStorage.getItem('dc-tab')||'slides');
  fitAll();
  var saved=parseInt(sessionStorage.getItem('dc-cur')||'0',10); if(saved>0&&frames[saved]) frames[saved].scrollIntoView({block:'center'});
  updateCurrent();
})();
`;
