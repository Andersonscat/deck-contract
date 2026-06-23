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
.dc-slidethumb{ display:block; width:240px; height:135px; margin:0 0 12px; padding:0; position:relative; border:2px solid #c7cbd3; border-radius:6px; overflow:hidden; background:#000; cursor:pointer; text-align:left; }
.dc-slidethumb.dc-cur{ border-color:#ec5a13; }
.dc-slidethumb > section{ transform:scale(0.1875); transform-origin:top left; pointer-events:none; }
.dc-slidethumb .dc-no{ position:absolute; top:4px; left:7px; color:#fff; font:11px sans-serif; opacity:.85; }

.dc-grid{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.dc-el{ border:1px solid #e2e4e9; border-radius:10px; background:#fff; padding:0; cursor:pointer; overflow:hidden; text-align:center; }
.dc-el:hover{ border-color:#ec5a13; }
.dc-el.sel{ border:2px solid #ec5a13; }
.dc-el .dc-prev{ background:#13151b; height:84px; display:flex; flex-direction:column; justify-content:center; align-items:flex-start; gap:5px; padding:14px; overflow:hidden; }
.dc-el .dc-lbl{ display:block; padding:8px; font-size:12px; color:#333; }
.dc-back{ display:inline-flex; align-items:center; gap:6px; border:none; background:none; color:#5b606b; font-size:12px; cursor:pointer; padding:0 0 10px; }
.dc-back:hover{ color:#1f2330; }

.dc-swatches{ display:flex; flex-wrap:wrap; gap:10px; }
.dc-swatch{ width:40px; height:40px; border-radius:8px; border:1px solid #d7dae0; cursor:pointer; }

#dc-center{ flex:1; min-width:0; display:flex; flex-direction:column; background:#dfe2e7; position:relative; }
#dc-stage{ flex:1; position:relative; overflow-y:auto; overflow-x:hidden; display:flex; flex-direction:column; align-items:center; gap:24px; padding:30px 0 60px; min-height:0; }
.dc-frame{ display:block; flex:none; border:1px solid #aeb3bd; background:#000; }
.dc-frame > section{ transform-origin:top left; }
[data-cid]{ cursor:pointer; }
.dc-selected{ outline:2px solid #ec5a13 !important; outline-offset:-2px; }
#dc-hover{ position:fixed; pointer-events:none; z-index:35; display:none; border:2px solid rgba(74,108,247,.55); border-radius:3px; }
#dc-hover.drop{ border-color:#ec5a13; background:rgba(236,90,19,.08); }
#dc-coord{ position:fixed; pointer-events:none; z-index:60; display:none; background:#1c1f26; color:#fff; font:12px/1 -apple-system,Segoe UI,sans-serif; padding:8px 12px; border-radius:9px; white-space:nowrap; transform:translateX(-50%); }
#dc-guides{ position:fixed; left:0; top:0; pointer-events:none; z-index:37; }
.dc-guide{ position:fixed; display:none; background:#ff2d6e; }
.dc-guide.v{ width:2px; }
.dc-guide.h{ height:2px; }
#dc-dist{ position:fixed; left:0; top:0; pointer-events:none; z-index:37; }
.dc-dseg{ position:fixed; background:#ff2d6e; }
.dc-dseg.h{ height:2px; } .dc-dseg.v{ width:2px; }
.dc-dcap{ position:fixed; background:#ff2d6e; }
.dc-dlbl{ position:fixed; transform:translate(-50%,-50%); background:#ff2d6e; color:#fff; font:10px/1 -apple-system,Segoe UI,sans-serif; padding:2px 5px; border-radius:4px; white-space:nowrap; }
#dc-handles{ position:fixed; left:0; top:0; pointer-events:none; z-index:38; display:none; }
#dc-handles.on{ display:block; }
.dc-h{ position:fixed; width:10px; height:10px; background:#fff; border:1.5px solid #4a6cf7; border-radius:2px; pointer-events:auto; }
.dc-h.nw,.dc-h.se{ cursor:nwse-resize; }
.dc-h.ne,.dc-h.sw{ cursor:nesw-resize; }
.dc-h.n,.dc-h.s{ cursor:ns-resize; }
.dc-h.e,.dc-h.w{ cursor:ew-resize; }
#dc-topbar{ position:relative; z-index:50; margin:12px 16px 6px; min-height:54px; flex:none; display:flex; align-items:center; gap:10px; padding:0 14px; background:#fff; border:1px solid #e6e8ee; border-radius:14px; overflow:visible; }
#dc-tool{ display:flex; align-items:center; gap:12px; font:13px -apple-system,Segoe UI,sans-serif; color:#5b606b; white-space:nowrap; }
#dc-tool.dc-empty{ color:#9aa0aa; }
#dc-tool .dc-lbl{ color:#9298a3; font-size:11px; }
#dc-history{ display:flex; gap:5px; padding-right:10px; margin-right:6px; border-right:1px solid #eef0f2; }
#dc-history button{ width:34px; height:34px; display:flex; align-items:center; justify-content:center; border:1px solid #e6e8ee; background:#fff; color:#3a3f4a; border-radius:9px; cursor:pointer; }
#dc-history button:hover:not(:disabled){ background:#f3f4f6; }
#dc-history button:disabled{ color:#cad0d8; cursor:default; }
.dc-grp{ display:flex; align-items:center; gap:7px; }
.dc-dd{ position:relative; }
.dc-dd-trg{ height:34px; min-width:60px; display:flex; align-items:center; justify-content:space-between; gap:9px; border:1px solid #e6e8ee; background:#fff; border-radius:10px; padding:0 11px; cursor:pointer; font-size:13px; color:#1f2330; transition:background .12s,border-color .12s; }
.dc-dd-trg:hover{ background:#f6f7f9; border-color:#dcdfe6; }
.dc-cv{ width:0; height:0; border-left:4px solid transparent; border-right:4px solid transparent; border-top:5px solid #aab0bb; }
.dc-dd-menu{ position:absolute; top:calc(100% + 6px); left:0; min-width:128px; max-height:266px; overflow:auto; display:none; flex-direction:column; gap:1px; background:#fff; border:1px solid #e6e8ee; border-radius:12px; padding:6px; z-index:100; }
.dc-dd-menu.on{ display:flex; }
.dc-dd-item{ display:flex; align-items:center; gap:9px; text-align:left; border:none; background:none; padding:8px 10px; border-radius:8px; cursor:pointer; font-size:13px; color:#1f2330; }
.dc-dd-item:hover{ background:#f3f4f6; }
.dc-dd-item.sel{ color:#ec5a13; font-weight:600; }
.dc-sw{ width:15px; height:15px; border-radius:5px; border:1px solid rgba(0,0,0,.12); display:inline-block; flex:none; }
.dc-seg{ display:flex; border:1px solid #e6e8ee; border-radius:10px; overflow:hidden; height:34px; }
.dc-seg button{ width:36px; border:none; border-right:1px solid #eef0f2; background:#fff; color:#666c78; cursor:pointer; font-size:13px; transition:background .12s; }
.dc-seg button:last-child{ border-right:none; }
.dc-seg button:hover{ background:#f6f7f9; }
.dc-seg button.on{ background:#ec5a13; color:#fff; }
.dc-ai,.dc-add{ height:34px; border:1px solid #e6e8ee; background:#fff; color:#2a2f3a; border-radius:10px; padding:0 15px; cursor:pointer; font-size:13px; transition:background .12s; }
.dc-ai:hover,.dc-add:hover{ background:#f3f4f6; }
.dc-ai{ font-weight:600; }
#dc-flash{ position:absolute; bottom:14px; left:14px; background:#111; color:#fff; padding:7px 12px; border-radius:6px; font-size:12px; opacity:0; transition:opacity .2s; z-index:30; }

#dc-right{ width:330px; flex:none; display:flex; flex-direction:column; background:#fff; border-left:1px solid #d7dae0; }
#dc-chat-head{ padding:12px 14px; border-bottom:1px solid #eee; font-weight:600; color:#222; }
#dc-chat{ flex:1; overflow:auto; padding:12px; display:flex; flex-direction:column; gap:8px; }
.dc-msg{ padding:8px 11px; border-radius:10px; font-size:13px; max-width:88%; white-space:pre-wrap; }
.dc-msg.user{ align-self:flex-end; background:#ec5a13; color:#fff; }
.dc-msg.ai{ align-self:flex-start; background:#f1f2f4; color:#222; }
.dc-msg.sys{ align-self:center; color:#9298a3; font-size:12px; }
#dc-chat-form{ padding:12px; border-top:1px solid #eef0f2; }
.dc-inwrap{ position:relative; border:1px solid #e6e8ee; border-radius:14px; background:#fff; padding:11px 48px 11px 13px; transition:border-color .12s; }
.dc-inwrap:focus-within{ border-color:#cdd2da; }
#dc-chat-input{ display:block; width:100%; border:none; outline:none; resize:none; background:none; font:13px/1.45 -apple-system,Segoe UI,sans-serif; color:#1f2330; max-height:140px; overflow-y:auto; }
#dc-chat-send{ position:absolute; right:8px; bottom:8px; width:31px; height:31px; border:none; background:#ec5a13; color:#fff; border-radius:9px; cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0; transition:background .12s; }
#dc-chat-send:hover{ background:#d8500f; }
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

  // the contextual toolbar lives in the fixed top bar (#dc-topbar); no floating
  var TOOL_EMPTY='Select an element to edit it';
  function setHead(t){ var h=document.getElementById('dc-chat-head'); if(h) h.textContent=t; }
  function deleteNode(cid){ post('/api/op',{ops:[{op:'remove_node',nodeId:cid}]}).then(function(res){ if(res&&res.error) flash('error: '+res.error); else flash('deleted'); }); }
  function clearSel(){ var n=document.querySelectorAll('.dc-selected'); for(var i=0;i<n.length;i++) n[i].classList.remove('dc-selected'); sel=null; setHead('AI assistant'); buildDefaultTool(); hideHandles(); restoreElements(); }
  // when nothing is selected the top bar still shows useful content (insert actions)
  function buildDefaultTool(){
    if(!tool) return;
    tool.className=''; tool.innerHTML='';
    var lbl=document.createElement('span'); lbl.className='dc-lbl'; lbl.textContent='Insert'; tool.appendChild(lbl);
    [['heading','Text'],['stat-callout','Metric'],['bullet-list','List'],['image-caption','Image']].forEach(function(a){ var b=document.createElement('button'); b.type='button'; b.className='dc-add'; b.textContent=a[1]; b.onclick=function(ev){ ev.stopPropagation(); var pid=curSlideId(); if(!pid) return; post('/api/insert_block',{blockId:a[0],parentId:pid,index:999}).then(function(res){ if(res&&res.error) flash('error: '+res.error); else flash('added'); }); }; tool.appendChild(b); });
  }
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
  function tokenKey(ref){ if(!ref) return ''; var m=/token:\\/\\/[a-z]+\\/([A-Za-z0-9-]+)/.exec(ref); return m?m[1]:''; }
  function cap(s){ return (''+s).charAt(0).toUpperCase()+(''+s).slice(1); }
  // Apply edits optimistically to the live DOM so style/position changes are instant and the
  // slide doesn't have to be rebuilt (which flashes + drops the selection). Returns true only
  // if EVERY op was something we can render locally; structural ops fall back to a rebuild.
  var opInFlight=0;
  var CSS_PROP={ color:'color', font:'font-family', size:'font-size', marker:'--marker-color', valueColor:'color', valueFont:'font-family', valueSize:'font-size', labelColor:'--label-color', labelSize:'--label-size', captionColor:'--caption-color', captionSize:'--caption-size', radius:'border-radius', background:'background' };
  function tokenToVarJS(ref){ var m=/^token:\\/\\/([a-z][a-z0-9]*)\\/([A-Za-z0-9][A-Za-z0-9-]*)$/.exec(ref); return m?'var(--'+m[1]+'-'+m[2]+')':ref; }
  function applyOptimistic(ops){
    for(var i=0;i<ops.length;i++){ var o=ops[i]; var el=document.querySelector('#dc-stage [data-cid="'+o.nodeId+'"]'); if(!el) return false;
      if(o.op==='set_token'){ el.style.setProperty(CSS_PROP[o.prop]||('--'+o.prop), tokenToVarJS(o.value)); }
      else if(o.op==='set_align'){ el.style.textAlign=o.value; }
      else if(o.op==='set_frame'){ var f=o.frame; el.style.position='absolute'; el.style.left=f.x+'%'; el.style.top=f.y+'%'; if(f.w!=null) el.style.width=f.w+'%'; if(f.h!=null) el.style.height=f.h+'%'; }
      else if(o.op==='move_to'){ el.style.left=o.x+'%'; el.style.top=o.y+'%'; }
      else return false;
    }
    return true;
  }
  function applySlides(slides,rebuild){
    for(var i=0;i<frames.length;i++){ if(!slides[i]||lastSlideHtml[i]===slides[i].html) continue;
      if(rebuild) frames[i].innerHTML=slides[i].html;
      if(thumbs[i]) thumbs[i].innerHTML='<span class="dc-no">'+(i+1)+'</span>'+stripIds(slides[i].html);
      lastSlideHtml[i]=slides[i].html;
    }
    if(rebuild){ fitAll(); var prev=sel?sel.getAttribute('data-cid'):null; clearSel(); if(prev){ var again=document.querySelector('#dc-stage [data-cid="'+prev+'"]'); if(again) select(again); } }
    refreshHist();
  }
  function op(ops){
    var optimistic=applyOptimistic(ops); opInFlight++;
    return post('/api/op',{ops:ops}).then(function(res){ opInFlight--;
      if(res&&res.error){ flash('error: '+res.error); forceRebuild(); return; }
      if(res){ setHist(res); if(res.slides) applySlides(res.slides,!optimistic); }
    },function(){ opInFlight--; forceRebuild(); });
  }
  function forceRebuild(){ fetch('/api/slides').then(function(r){ return r.json(); }).then(function(d){ if(d&&d.slides) applySlides(d.slides,true); }).catch(function(){}); }
  function group(label,el){ var g=document.createElement('div'); g.className='dc-grp'; if(label){ var l=document.createElement('span'); l.className='dc-lbl'; l.textContent=label; g.appendChild(l); } g.appendChild(el); return g; }
  function makeDropdown(o){
    var wrap=document.createElement('div'); wrap.className='dc-dd';
    var trg=document.createElement('button'); trg.type='button'; trg.className='dc-dd-trg';
    function find(v){ for(var i=0;i<o.items.length;i++) if(o.items[i].v===v) return o.items[i]; return null; }
    function renderTrg(){ trg.innerHTML=''; var it=find(o.value); if(it&&it.swatch){ var s=document.createElement('span'); s.className='dc-sw'; s.style.background=it.swatch; trg.appendChild(s); } var t=document.createElement('span'); t.textContent=it?it.label:'—'; trg.appendChild(t); var cv=document.createElement('span'); cv.className='dc-cv'; trg.appendChild(cv); }
    renderTrg();
    var menu=document.createElement('div'); menu.className='dc-dd-menu';
    o.items.forEach(function(it){ var b=document.createElement('button'); b.type='button'; b.className='dc-dd-item'+(it.v===o.value?' sel':''); if(it.swatch){ var s=document.createElement('span'); s.className='dc-sw'; s.style.background=it.swatch; b.appendChild(s); } var t=document.createElement('span'); t.textContent=it.label; b.appendChild(t); b.onclick=function(ev){ ev.stopPropagation(); o.value=it.v; renderTrg(); menu.classList.remove('on'); o.onSelect(it.v); }; menu.appendChild(b); });
    trg.onclick=function(ev){ ev.stopPropagation(); var willOpen=!menu.classList.contains('on'); var all=document.querySelectorAll('.dc-dd-menu.on'); for(var i=0;i<all.length;i++) all[i].classList.remove('on'); if(willOpen) menu.classList.add('on'); };
    wrap.appendChild(trg); wrap.appendChild(menu); return wrap;
  }
  function alignSeg(cid,cur){ var seg=document.createElement('div'); seg.className='dc-seg'; ['left','center','right'].forEach(function(a){ var b=document.createElement('button'); b.type='button'; b.textContent=a.charAt(0).toUpperCase(); if(a===cur) b.className='on'; b.onclick=function(ev){ ev.stopPropagation(); op([{op:'set_align',nodeId:cid,value:a}]); }; seg.appendChild(b); }); return seg; }
  function insertBtn(label,blockId){ var b=document.createElement('button'); b.type='button'; b.className='dc-add'; b.textContent=label; b.onclick=function(ev){ ev.stopPropagation(); var pid=curSlideId(); if(!pid) return; post('/api/insert_block',{blockId:blockId,parentId:pid,index:999}).then(function(res){ if(res&&res.error) flash('error: '+res.error); else flash('added '+label); }); }; return b; }

  function select(el){
    clearSel(); el.classList.add('dc-selected'); sel=el;
    var cid=el.getAttribute('data-cid'); var type=el.getAttribute('data-type');
    setHead('AI · selected: '+type);
    if(VARIANTS[type]){ setTab('elements'); showVariants(type,null); }
    positionHandles();
    fetch('/api/node?id='+encodeURIComponent(cid)).then(function(r){ return r.json(); }).then(function(node){ if(sel!==el) return; var n=(node&&node.id)?node:null; buildTool(cid,type,n); if(VARIANTS[type]) showVariants(type,n); }).catch(function(){ if(sel===el) buildTool(cid,type,null); });
  }
  function buildTool(cid,type,node){
    tool.className=''; tool.innerHTML='';
    var sp=styleProps(type); var th=window.DC_THEME||{}; var st=(node&&node.style)||{}; var cf=contentField(type);
    if(sp.font){ tool.appendChild(group('Font', makeDropdown({ value:tokenKey(st[sp.font]), items:(th.font||[]).map(function(k){ return {v:k,label:cap(k)}; }), onSelect:function(v){ op([{op:'set_token',nodeId:cid,prop:sp.font,value:'token://font/'+v}]); } }))); }
    if(sp.size){ var sizes=th.type||{}; var keys=Object.keys(sizes).sort(function(a,b){ return sizes[b]-sizes[a]; }); tool.appendChild(group('Size', makeDropdown({ value:tokenKey(st[sp.size]), items:keys.map(function(k){ return {v:k,label:''+sizes[k]}; }), onSelect:function(v){ op([{op:'set_token',nodeId:cid,prop:sp.size,value:'token://type/'+v}]); } }))); }
    if(sp.color){ var cols=th.color||{}; var ck=Object.keys(cols); tool.appendChild(group('Color', makeDropdown({ value:tokenKey(st[sp.color]), items:ck.map(function(k){ return {v:k,label:cap(k),swatch:cols[k]}; }), onSelect:function(v){ op([{op:'set_token',nodeId:cid,prop:sp.color,value:'token://color/'+v}]); } }))); }
    if(cf==='text'||cf==='items'){ tool.appendChild(alignSeg(cid,(node&&node.textAlign)||'left')); }
    tool.appendChild(insertBtn('Text','heading'));
  }

  window.addEventListener('resize',function(){ fitAll(); updateCurrent(); positionHandles(); });
  stage.addEventListener('scroll',function(){ updateCurrent(); hideBox(); positionHandles(); });
  for(var t=0;t<thumbs.length;t++){ (function(idx){ thumbs[idx].onclick=function(){ goTo(idx); }; })(t); }
  document.addEventListener('keydown',function(e){
    var t=e.target, tag=t&&t.tagName;
    if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||(t&&t.getAttribute&&t.getAttribute('contenteditable')==='true')) return;
    var mod=e.metaKey||e.ctrlKey;
    if(mod&&(e.key==='z'||e.key==='Z')){ e.preventDefault(); if(e.shiftKey) doRedo(); else doUndo(); return; }
    if(mod&&(e.key==='y'||e.key==='Y')){ e.preventDefault(); doRedo(); return; }
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

  // Elements panel: insert blocks by default; style variants of the selected element on selection
  var elementsPanel=document.querySelector('.dc-panel2[data-panel="elements"]');
  var elementsDefaultHTML=elementsPanel?elementsPanel.innerHTML:'';
  function wireInsertButtons(){
    var bb=[].slice.call(document.querySelectorAll('[data-block]'));
    for(var b=0;b<bb.length;b++){ (function(btn){ btn.onclick=function(){ var bid=btn.getAttribute('data-block'); var pid=curSlideId(); if(!pid) return;
      post('/api/insert_block',{blockId:bid,parentId:pid,index:999}).then(function(res){ if(res&&res.error) flash('error: '+res.error); else flash('added '+bid); });
    }; })(bb[b]); }
  }
  wireInsertButtons();
  function restoreElements(){ if(elementsPanel){ elementsPanel.innerHTML=elementsDefaultHTML; wireInsertButtons(); } }
  var VARIANTS={
    title:[ {label:'White',ops:{color:'text',size:'h1'}}, {label:'Accent',ops:{color:'accent',size:'h1'}}, {label:'Display',ops:{color:'text',size:'display'}}, {label:'Muted',ops:{color:'muted',size:'h2'}} ],
    heading:[ {label:'White',ops:{color:'text',size:'h2'}}, {label:'Accent',ops:{color:'accent',size:'h2'}}, {label:'Big',ops:{color:'text',size:'h1'}}, {label:'Muted',ops:{color:'muted',size:'body'}} ],
    'bullet-list':[ {label:'Accent dots',ops:{marker:'accent',color:'text',size:'body'}}, {label:'Muted',ops:{marker:'muted',color:'muted',size:'body'}}, {label:'Large',ops:{marker:'accent',color:'text',size:'h2'}} ],
    'stat-callout':[ {label:'Accent',ops:{valueColor:'accent',valueSize:'h1'}}, {label:'Big',ops:{valueColor:'accent',valueSize:'display'}}, {label:'White',ops:{valueColor:'text',valueSize:'h1'}}, {label:'Muted',ops:{valueColor:'muted',valueSize:'h2'}} ],
    'image-caption':[ {label:'Caption muted',ops:{captionColor:'muted',captionSize:'caption'}}, {label:'Caption accent',ops:{captionColor:'accent',captionSize:'caption'}} ]
  };
  function propNs(p){ if(p==='size'||p.indexOf('Size')>=0) return 'type'; if(p==='font'||p.indexOf('Font')>=0) return 'font'; if(p==='radius') return 'radius'; return 'color'; }
  function px(k){ var m={display:26,h1:22,h2:17,body:14,caption:12}; return m[k]||18; }
  function esc2(s){ return (''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
  function trunc(s,n){ s=''+s; return s.length>n?s.slice(0,n-1)+'…':s; }
  function variantPreview(type,v,node){
    var c=(node&&node.content)||{};
    if(type==='stat-callout'){ var col='var(--color-'+(v.ops.valueColor||'accent')+')'; return '<div style="font:800 '+px(v.ops.valueSize)+'px/1.05 sans-serif;color:'+col+'">'+esc2(trunc(c.value||'3x',8))+'</div><div style="font-size:10px;color:var(--color-muted)">'+esc2(trunc(c.label||'metric',12))+'</div>'; }
    if(type==='bullet-list'){ var mk='var(--color-'+(v.ops.marker||'accent')+')'; var tc='var(--color-'+(v.ops.color||'text')+')'; var items=(c.items&&c.items.length)?c.items:['Item one','Item two','Item three']; var out=''; for(var i=0;i<Math.min(3,items.length);i++){ out+='<div style="display:flex;align-items:center;gap:5px;margin:2px 0"><span style="width:4px;height:4px;border-radius:50%;background:'+mk+';flex:none"></span><span style="font-size:'+Math.min(px(v.ops.size),12)+'px;color:'+tc+';white-space:nowrap;overflow:hidden">'+esc2(trunc(items[i],14))+'</span></div>'; } return out; }
    if(type==='image-caption'){ var cc='var(--color-'+(v.ops.captionColor||'muted')+')'; return '<div style="width:100%;height:38px;background:#3a4150;border-radius:6px"></div><div style="font-size:10px;margin-top:5px;color:'+cc+'">'+esc2(trunc(c.caption||'caption',16))+'</div>'; }
    var col2='var(--color-'+(v.ops.color||'text')+')'; return '<div style="font:800 '+px(v.ops.size)+'px/1.05 sans-serif;color:'+col2+'">'+esc2(trunc(c.text||'Aa',12))+'</div>';
  }
  function styleMatches(v,style){ var ks=Object.keys(v.ops); if(!ks.length) return false; for(var i=0;i<ks.length;i++){ if(tokenKey(style[ks[i]]||'')!==v.ops[ks[i]]) return false; } return true; }
  function showVariants(type,node){
    if(!elementsPanel) return; var vs=VARIANTS[type]; if(!vs){ restoreElements(); return; }
    var style=(node&&node.style)||{};
    var html='<button id="dc-el-back" class="dc-back"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>Elements</button><h4>'+cap(type)+' styles</h4><div class="dc-grid">';
    for(var i=0;i<vs.length;i++){ var selCls=styleMatches(vs[i],style)?' sel':''; html+='<button class="dc-el'+selCls+'" data-variant="'+i+'"><div class="dc-prev">'+variantPreview(type,vs[i],node)+'</div><span class="dc-lbl">'+vs[i].label+'</span></button>'; }
    elementsPanel.innerHTML=html+'</div>';
    var back=document.getElementById('dc-el-back'); if(back) back.onclick=function(ev){ ev.stopPropagation(); restoreElements(); };
    var cards=[].slice.call(elementsPanel.querySelectorAll('[data-variant]'));
    for(var k=0;k<cards.length;k++){ (function(card){ card.onclick=function(){ if(!sel) return; var v=vs[parseInt(card.getAttribute('data-variant'),10)]; var keys=Object.keys(v.ops); if(!keys.length) return; op(keys.map(function(prop){ return {op:'set_token',nodeId:sel.getAttribute('data-cid'),prop:prop,value:'token://'+propNs(prop)+'/'+v.ops[prop]}; })); }; })(cards[k]); }
  }

  // brand swatches recolor the selected element
  var sw=[].slice.call(document.querySelectorAll('.dc-swatch'));
  for(var s=0;s<sw.length;s++){ (function(el){ el.onclick=function(){ if(!sel){ flash('select an element first'); return; }
    post('/api/op',{ops:[{op:'set_token',nodeId:sel.getAttribute('data-cid'),prop:'color',value:el.getAttribute('data-token')}]}).then(function(res){ if(res&&res.error) flash('error: '+res.error); });
  }; })(sw[s]); }

  // select / edit on the stage
  document.addEventListener('click',function(e){
    if(dragged){ dragged=false; return; }
    if(e.target.closest('#dc-topbar')||e.target.closest('#dc-left')||e.target.closest('#dc-right')) return;
    var el=e.target.closest('#dc-stage [data-cid]');
    if(!el||el.tagName==='SECTION'){ clearSel(); return; } // clicking the slide background deselects
    e.preventDefault(); select(el);
  });
  // hover frame + free drag (move by coordinates -> set_frame / move_to)
  var dragHover=null, candEl=null, downPt=null, dragging=false, dragNode=null, dragged=false;
  var dragStart=null, dragSc=1, dragHasFrame=false, coordEl=null;
  function hbox(){ if(!dragHover){ dragHover=document.createElement('div'); dragHover.id='dc-hover'; document.body.appendChild(dragHover); } return dragHover; }
  function cbox(){ if(!coordEl){ coordEl=document.createElement('div'); coordEl.id='dc-coord'; document.body.appendChild(coordEl); } return coordEl; }
  function showBox(el){ var h=hbox(); var r=el.getBoundingClientRect(); h.className=''; h.style.display='block'; h.style.left=r.left+'px'; h.style.top=r.top+'px'; h.style.width=r.width+'px'; h.style.height=r.height+'px'; }
  function hideBox(){ if(dragHover) dragHover.style.display='none'; }
  function round3(n){ return Math.round(n*1000)/1000; }
  stage.addEventListener('mousemove',function(e){ if(dragging) return; var el=e.target.closest('#dc-stage [data-cid]'); if(el&&el.tagName!=='SECTION') showBox(el); else hideBox(); });
  stage.addEventListener('mouseleave',function(){ if(!dragging) hideBox(); });
  stage.addEventListener('mousedown',function(e){ var el=e.target.closest('#dc-stage [data-cid]'); if(!el||el.tagName==='SECTION') return; candEl=el; downPt={x:e.clientX,y:e.clientY}; dragged=false; });
  document.addEventListener('mousemove',function(e){
    if(resizing){ doResize(e); return; }
    if(dragging){
      var s=snapDrag(e);
      var sdx=(s.L-dragStart.x/100*1280)*dragSc, sdy=(s.T-dragStart.y/100*720)*dragSc;
      dragNode.style.transform='translate('+sdx+'px,'+sdy+'px)';
      var c=cbox(); c.style.display='block'; c.textContent='x: '+Math.round(s.L)+' pt   y: '+Math.round(s.T)+' pt';
      var r=dragNode.getBoundingClientRect(); c.style.left=(r.left+r.width/2)+'px'; c.style.top=Math.max(8,r.top-40)+'px';
      drawGuides(dragNode,s);
      return;
    }
    if(!candEl) return;
    if(Math.abs(e.clientX-downPt.x)+Math.abs(e.clientY-downPt.y)>5) startDrag();
  });
  document.addEventListener('mouseup',function(e){ if(resizing){ endResize(); candEl=null; return; } if(dragging) endDrag(e); candEl=null; });
  function startDrag(){
    dragging=true; dragNode=candEl; dragged=true; hideBox(); hideHandles(); document.body.style.cursor='grabbing';
    document.body.style.userSelect='none'; var sg=window.getSelection&&window.getSelection(); if(sg&&sg.removeAllRanges) sg.removeAllRanges();
    // Coordinate origin = the slide <section> (the absolute-positioning containing block,
    // because it carries transform:scale). Using .dc-frame here was the latent bug: the frame
    // and the section don't share a top edge, so committed % didn't match the rendered position.
    var fr=dragNode.closest('section'); var frr=fr.getBoundingClientRect(); dragSc=frr.width/1280;
    var er=dragNode.getBoundingClientRect();
    dragHasFrame=(getComputedStyle(dragNode).position==='absolute');
    dragStart={ x:(er.left-frr.left)/dragSc/1280*100, y:(er.top-frr.top)/dragSc/720*100, w:er.width/dragSc/1280*100, h:er.height/dragSc/720*100, mx:downPt.x, my:downPt.y };
    var tg=buildTargets(dragNode,fr,dragSc); vTargets=tg.vT; hTargets=tg.hT; snapBoxes=tg.boxes;
    dragNode.style.zIndex='6';
  }
  // Smart alignment guides (phase 3a + 3b): snap the active box per axis to the slide
  // centre/edges AND to every other element's edges/centres. Everything is in canvas units
  // (1280x720); the threshold is a screen-px value / scale so the magnet feels the same at
  // any zoom. Each target carries a cross-axis extent [lo,hi] so its guide line spans only
  // the involved boxes, not the whole slide. Slide/centre targets come first -> they win ties.
  var vTargets=[], hTargets=[], snapBoxes=[], guidesEl=null, distEl=null;
  function buildTargets(activeEl,sec,scl){
    var secr=sec.getBoundingClientRect();
    var vT=[{v:640,lo:0,hi:720},{v:0,lo:0,hi:720},{v:1280,lo:0,hi:720}];
    var hT=[{v:360,lo:0,hi:1280},{v:0,lo:0,hi:1280},{v:720,lo:0,hi:1280}];
    var boxes=[];
    var others=sec.querySelectorAll('[data-cid]');
    for(var i=0;i<others.length;i++){ var o=others[i]; if(o===activeEl||o.tagName==='SECTION'||o.contains(activeEl)||activeEl.contains(o)) continue;
      var r=o.getBoundingClientRect(); var L=(r.left-secr.left)/scl, T=(r.top-secr.top)/scl, W=r.width/scl, H=r.height/scl;
      vT.push({v:L+W/2,lo:T,hi:T+H},{v:L,lo:T,hi:T+H},{v:L+W,lo:T,hi:T+H});
      hT.push({v:T+H/2,lo:L,hi:L+W},{v:T,lo:L,hi:L+W},{v:T+H,lo:L,hi:L+W});
      boxes.push({L:L,T:T,W:W,H:H});
    }
    return { vT:vT, hT:hT, boxes:boxes };
  }
  function snapAxis(cands,targets,TH){ var best=null; for(var i=0;i<cands.length;i++){ for(var j=0;j<targets.length;j++){ var d=targets[j].v-cands[i]; if(Math.abs(d)<=TH&&(!best||Math.abs(d)<Math.abs(best.delta))) best={delta:d,t:targets[j]}; } } return best; }
  function snapEdge(c,targets,TH){ var best=null; for(var j=0;j<targets.length;j++){ var d=Math.abs(targets[j].v-c); if(d<=TH&&(!best||d<best.d)) best={d:d,t:targets[j]}; } return best?best.t:null; }
  // Phase 3c distribution: snap so the dragged box sits with EQUAL gaps between its nearest
  // left/right (or top/bottom) neighbour on the same row/column. Returns the snapped position
  // + the two equal gaps so we can draw measured spacing indicators.
  function distributeSnap(L,T,W,H,TH){
    var rx=null, ry=null;
    var la=null, ra=null; // horizontal neighbours (must vertically overlap)
    var ta=null, ba=null; // vertical neighbours (must horizontally overlap)
    for(var i=0;i<snapBoxes.length;i++){ var bx=snapBoxes[i];
      if(Math.min(T+H,bx.T+bx.H)-Math.max(T,bx.T)>0){ // vertical overlap -> horizontal neighbour
        if(bx.L+bx.W<=L+1){ if(!la||bx.L+bx.W>la.L+la.W) la=bx; }
        else if(bx.L>=L+W-1){ if(!ra||bx.L<ra.L) ra=bx; }
      }
      if(Math.min(L+W,bx.L+bx.W)-Math.max(L,bx.L)>0){ // horizontal overlap -> vertical neighbour
        if(bx.T+bx.H<=T+1){ if(!ta||bx.T+bx.H>ta.T+ta.H) ta=bx; }
        else if(bx.T>=T+H-1){ if(!ba||bx.T<ba.T) ba=bx; }
      }
    }
    if(la&&ra){ var g=((ra.L)-(la.L+la.W)-W)/2; if(g>0){ var tL=la.L+la.W+g; if(Math.abs(L-tL)<=TH) rx={L:tL,gap:g,a:la,b:ra}; } }
    if(ta&&ba){ var gy=((ba.T)-(ta.T+ta.H)-H)/2; if(gy>0){ var tT=ta.T+ta.H+gy; if(Math.abs(T-tT)<=TH) ry={T:tT,gap:gy,a:ta,b:ba}; } }
    return { x:rx, y:ry };
  }
  function snapDrag(e){
    var W=dragStart.w/100*1280, H=dragStart.h/100*720;
    var L=dragStart.x/100*1280+(e.clientX-dragStart.mx)/dragSc;
    var T=dragStart.y/100*720+(e.clientY-dragStart.my)/dragSc;
    var sx=null, sy=null, dist={x:null,y:null};
    if(!e.altKey){ var TH=6/dragSc;
      dist=distributeSnap(L,T,W,H,TH);
      if(dist.x){ L=dist.x.L; } else { sx=snapAxis([L,L+W/2,L+W],vTargets,TH); if(sx) L+=sx.delta; }
      if(dist.y){ T=dist.y.T; } else { sy=snapAxis([T,T+H/2,T+H],hTargets,TH); if(sy) T+=sy.delta; }
    }
    return { L:L, T:T, W:W, H:H, sx:sx, sy:sy, dist:dist };
  }
  function gbox(){ if(!guidesEl){ var c=document.createElement('div'); c.id='dc-guides'; var v=document.createElement('div'); v.className='dc-guide v'; var h=document.createElement('div'); h.className='dc-guide h'; c.appendChild(v); c.appendChild(h); document.body.appendChild(c); guidesEl={v:v,h:h}; } return guidesEl; }
  function drawGuides(el,s){ var g=gbox(); var secr=el.closest('section').getBoundingClientRect(); var scl=secr.width/1280;
    if(s.sx){ var loY=Math.min(s.sx.t.lo,s.T), hiY=Math.max(s.sx.t.hi,s.T+s.H); g.v.style.display='block'; g.v.style.left=(secr.left+s.sx.t.v*scl)+'px'; g.v.style.top=(secr.top+loY*scl)+'px'; g.v.style.height=((hiY-loY)*scl)+'px'; } else g.v.style.display='none';
    if(s.sy){ var loX=Math.min(s.sy.t.lo,s.L), hiX=Math.max(s.sy.t.hi,s.L+s.W); g.h.style.display='block'; g.h.style.top=(secr.top+s.sy.t.v*scl)+'px'; g.h.style.left=(secr.left+loX*scl)+'px'; g.h.style.width=((hiX-loX)*scl)+'px'; } else g.h.style.display='none';
    drawDist(s,secr,scl);
  }
  function distBox(){ if(!distEl){ distEl=document.createElement('div'); distEl.id='dc-dist'; document.body.appendChild(distEl); } return distEl; }
  function hseg(x1,x2,y,label){ var L=Math.min(x1,x2), len=Math.abs(x2-x1); return '<div class="dc-dseg h" style="left:'+L+'px;top:'+(y-1)+'px;width:'+len+'px"></div><div class="dc-dcap" style="left:'+x1+'px;top:'+(y-5)+'px;width:2px;height:10px"></div><div class="dc-dcap" style="left:'+(x2-2)+'px;top:'+(y-5)+'px;width:2px;height:10px"></div><div class="dc-dlbl" style="left:'+(L+len/2)+'px;top:'+(y-12)+'px">'+label+'</div>'; }
  function vseg(y1,y2,x,label){ var T=Math.min(y1,y2), len=Math.abs(y2-y1); return '<div class="dc-dseg v" style="left:'+(x-1)+'px;top:'+T+'px;height:'+len+'px"></div><div class="dc-dcap" style="left:'+(x-5)+'px;top:'+y1+'px;width:10px;height:2px"></div><div class="dc-dcap" style="left:'+(x-5)+'px;top:'+(y2-2)+'px;width:10px;height:2px"></div><div class="dc-dlbl" style="left:'+(x+14)+'px;top:'+(T+len/2)+'px">'+label+'</div>'; }
  function drawDist(s,secr,scl){
    if(!s.dist||(!s.dist.x&&!s.dist.y)){ hideDist(); return; }
    var html=''; var SX=function(c){ return secr.left+c*scl; }, SY=function(c){ return secr.top+c*scl; };
    if(s.dist.x){ var d=s.dist.x; var y=SY(s.T+s.H/2); var lbl=Math.round(d.gap);
      html+=hseg(SX(d.a.L+d.a.W),SX(s.L),y,lbl)+hseg(SX(s.L+s.W),SX(d.b.L),y,lbl); }
    if(s.dist.y){ var d2=s.dist.y; var x=SX(s.L+s.W/2); var lbl2=Math.round(d2.gap);
      html+=vseg(SY(d2.a.T+d2.a.H),SY(s.T),x,lbl2)+vseg(SY(s.T+s.H),SY(d2.b.T),x,lbl2); }
    distBox().innerHTML=html;
  }
  function hideDist(){ if(distEl) distEl.innerHTML=''; }
  function hideGuides(){ if(guidesEl){ guidesEl.v.style.display='none'; guidesEl.h.style.display='none'; } hideDist(); }
  // When the first element on a slide is moved out of flow, every other leaf element would
  // reflow (collapse together and overlap). To match Keynote/Canva, freeze all other leaves
  // at their current positions (also make them absolute) so only the dragged one moves.
  // Returns the set_frame ops; applies the same positions inline so there's no flash.
  function freezeSiblings(activeEl){
    var sec=activeEl.closest('section'); var secr=sec.getBoundingClientRect(); var scl=secr.width/1280;
    var leaves=sec.querySelectorAll('[data-cid]'); var todo=[];
    for(var i=0;i<leaves.length;i++){ var l=leaves[i];
      if(l===activeEl||l.querySelector('[data-cid]')||getComputedStyle(l).position==='absolute') continue; // skip self, containers, already-framed
      var r=l.getBoundingClientRect();
      todo.push({ el:l, f:{ x:round3((r.left-secr.left)/scl/1280*100), y:round3((r.top-secr.top)/scl/720*100), w:round3(r.width/scl/1280*100), h:round3(r.height/scl/720*100) } });
    }
    var ops=[];
    for(var j=0;j<todo.length;j++){ var t=todo[j]; t.el.style.position='absolute'; t.el.style.left=t.f.x+'%'; t.el.style.top=t.f.y+'%'; t.el.style.width=t.f.w+'%'; t.el.style.height=t.f.h+'%'; ops.push({op:'set_frame',nodeId:t.el.getAttribute('data-cid'),frame:t.f}); }
    return ops;
  }
  function endDrag(e){
    var s=snapDrag(e);
    var nx=round3(s.L/1280*100), ny=round3(s.T/720*100);
    var cid=dragNode.getAttribute('data-cid');
    // Freeze the other leaves BEFORE moving this one out of flow (captures their current rects).
    var freezeOps=dragHasFrame?[]:freezeSiblings(dragNode);
    // Pin the dragged element at its dropped position immediately (clear transform, set the
    // final absolute frame inline) so it stays exactly where released.
    dragNode.style.transform=''; dragNode.style.zIndex='';
    dragNode.style.position='absolute'; dragNode.style.left=nx+'%'; dragNode.style.top=ny+'%';
    if(!dragHasFrame){ dragNode.style.width=round3(dragStart.w)+'%'; dragNode.style.height=round3(dragStart.h)+'%'; }
    var dop=dragHasFrame?{op:'move_to',nodeId:cid,x:nx,y:ny}:{op:'set_frame',nodeId:cid,frame:{x:nx,y:ny,w:round3(dragStart.w),h:round3(dragStart.h)}};
    op(freezeOps.concat([dop]));
    dragging=false; document.body.style.cursor=''; document.body.style.userSelect=''; if(coordEl) coordEl.style.display='none'; hideGuides();
  }

  // resize handles (8) around the selected element -> set_frame
  var handlesEl=null, handleDivs={}, HK=['nw','n','ne','e','se','s','sw','w'];
  var resizing=false, rsc=1, startFrame=null, resizeHandle=null, resizeStart=null, resizeLast=null, resizeFreezeOps=[];
  function ensureHandles(){
    if(handlesEl) return;
    handlesEl=document.createElement('div'); handlesEl.id='dc-handles'; document.body.appendChild(handlesEl);
    HK.forEach(function(k){ var d=document.createElement('div'); d.className='dc-h '+k; handleDivs[k]=d; handlesEl.appendChild(d);
      d.addEventListener('mousedown',function(e){ e.stopPropagation(); e.preventDefault(); startResize(k,e); });
    });
  }
  function positionHandles(){
    if(!sel||sel.tagName==='SECTION'){ hideHandles(); return; }
    ensureHandles(); var r=sel.getBoundingClientRect();
    var pts={ nw:[r.left,r.top], n:[r.left+r.width/2,r.top], ne:[r.right,r.top], e:[r.right,r.top+r.height/2], se:[r.right,r.bottom], s:[r.left+r.width/2,r.bottom], sw:[r.left,r.bottom], w:[r.left,r.top+r.height/2] };
    HK.forEach(function(k){ var pt=pts[k]; handleDivs[k].style.left=(pt[0]-5)+'px'; handleDivs[k].style.top=(pt[1]-5)+'px'; });
    handlesEl.classList.add('on');
  }
  function hideHandles(){ if(handlesEl) handlesEl.classList.remove('on'); }
  function startResize(k,e){
    if(!sel) return;
    resizing=true; dragged=true; resizeHandle=k; document.body.style.userSelect='none';
    var fr=sel.closest('section'); var frr=fr.getBoundingClientRect(); rsc=frr.width/1280;
    var rh=sel.getBoundingClientRect();
    startFrame={ x:(rh.left-frr.left)/rsc/1280*100, y:(rh.top-frr.top)/rsc/720*100, w:rh.width/rsc/1280*100, h:rh.height/rsc/720*100 };
    // First resize of an in-flow element: freeze the slide (siblings + this element) so nothing
    // reflows when this element drops out of flow.
    resizeFreezeOps=[];
    if(getComputedStyle(sel).position!=='absolute'){
      resizeFreezeOps=freezeSiblings(sel);
      resizeFreezeOps.push({op:'set_frame',nodeId:sel.getAttribute('data-cid'),frame:{x:round3(startFrame.x),y:round3(startFrame.y),w:round3(startFrame.w),h:round3(startFrame.h)}});
      sel.style.position='absolute'; sel.style.left=round3(startFrame.x)+'%'; sel.style.top=round3(startFrame.y)+'%'; sel.style.width=round3(startFrame.w)+'%'; sel.style.height=round3(startFrame.h)+'%';
    }
    var tg=buildTargets(sel,fr,rsc); vTargets=tg.vT; hTargets=tg.hT; snapBoxes=tg.boxes;
    resizeStart={ mx:e.clientX, my:e.clientY };
  }
  function doResize(e){
    var dx=(e.clientX-resizeStart.mx)/rsc/1280*100, dy=(e.clientY-resizeStart.my)/rsc/720*100;
    var k=resizeHandle, ml=k.indexOf('w')>=0, mr=k.indexOf('e')>=0, mt=k.indexOf('n')>=0, mb=k.indexOf('s')>=0;
    var x=startFrame.x, y=startFrame.y, w=startFrame.w, h=startFrame.h, MIN=2;
    if(mr) w=startFrame.w+dx;
    if(ml){ x=startFrame.x+dx; w=startFrame.w-dx; }
    if(mb) h=startFrame.h+dy;
    if(mt){ y=startFrame.y+dy; h=startFrame.h-dy; }
    // snap the active edge to other elements' edges/centres + the slide
    var sx=null, sy=null;
    if(!e.altKey){ var TH=6/rsc;
      if(mr){ var t=snapEdge((x+w)/100*1280,vTargets,TH); if(t){ sx={t:t}; w=t.v/1280*100-x; } }
      else if(ml){ var tl=snapEdge(x/100*1280,vTargets,TH); if(tl){ sx={t:tl}; var nx=tl.v/1280*100; w=w+(x-nx); x=nx; } }
      if(mb){ var tb=snapEdge((y+h)/100*720,hTargets,TH); if(tb){ sy={t:tb}; h=tb.v/720*100-y; } }
      else if(mt){ var tt=snapEdge(y/100*720,hTargets,TH); if(tt){ sy={t:tt}; var ny=tt.v/720*100; h=h+(y-ny); y=ny; } }
      // equal-size: snap the dimension to match a peer's width/height when an edge didn't align
      if(!sx&&(mr||ml)){ var wc=w/100*1280; for(var i=0;i<snapBoxes.length;i++){ if(Math.abs(wc-snapBoxes[i].W)<=TH){ var nw=snapBoxes[i].W/1280*100; if(ml) x=x+(w-nw); w=nw; break; } } }
      if(!sy&&(mt||mb)){ var hc=h/100*720; for(var j=0;j<snapBoxes.length;j++){ if(Math.abs(hc-snapBoxes[j].H)<=TH){ var nh=snapBoxes[j].H/720*100; if(mt) y=y+(h-nh); h=nh; break; } } }
    }
    if(w<MIN){ if(ml) x=startFrame.x+startFrame.w-MIN; w=MIN; }
    if(h<MIN){ if(mt) y=startFrame.y+startFrame.h-MIN; h=MIN; }
    sel.style.position='absolute'; sel.style.left=round3(x)+'%'; sel.style.top=round3(y)+'%'; sel.style.width=round3(w)+'%'; sel.style.height=round3(h)+'%';
    resizeLast={ x:round3(x), y:round3(y), w:round3(w), h:round3(h) };
    drawGuides(sel,{ L:x/100*1280, T:y/100*720, W:w/100*1280, H:h/100*720, sx:sx, sy:sy });
    positionHandles();
  }
  function endResize(){
    resizing=false; document.body.style.userSelect=''; hideGuides();
    var ops=resizeFreezeOps.slice();
    if(resizeLast&&sel) ops.push({op:'set_frame',nodeId:sel.getAttribute('data-cid'),frame:resizeLast});
    if(ops.length) op(ops);
    resizeLast=null; resizeFreezeOps=[];
  }

  // close any open custom dropdown when clicking elsewhere
  document.addEventListener('click',function(e){ if(e.target.closest('.dc-dd')) return; var m=document.querySelectorAll('.dc-dd-menu.on'); for(var i=0;i<m.length;i++) m[i].classList.remove('on'); });
  document.addEventListener('dblclick',function(e){ var el=e.target.closest('#dc-stage [data-cid]'); if(!el) return; var type=el.getAttribute('data-type'); if(type!=='title'&&type!=='heading') return; e.preventDefault(); editText(el); });

  // AI chat — tells the model which slide is in view
  var chat=document.getElementById('dc-chat');
  function addMsg(cls,text){ var d=document.createElement('div'); d.className='dc-msg '+cls; d.textContent=text; chat.appendChild(d); chat.scrollTop=chat.scrollHeight; return d; }
  var ci=document.getElementById('dc-chat-input');
  function autoGrow(){ ci.style.height='auto'; ci.style.height=Math.min(ci.scrollHeight,140)+'px'; }
  ci.addEventListener('input',autoGrow);
  ci.addEventListener('keydown',function(e){ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); document.getElementById('dc-chat-form').requestSubmit(); } });

  // undo / redo
  var undoBtn=document.getElementById('dc-undo'), redoBtn=document.getElementById('dc-redo');
  function setHist(h){ if(undoBtn) undoBtn.disabled=!(h&&h.canUndo); if(redoBtn) redoBtn.disabled=!(h&&h.canRedo); }
  function refreshHist(){ fetch('/api/history').then(function(r){ return r.json(); }).then(setHist).catch(function(){}); }
  function doUndo(){ post('/api/undo',{}).then(setHist); }
  function doRedo(){ post('/api/redo',{}).then(setHist); }
  if(undoBtn) undoBtn.onclick=function(ev){ ev.stopPropagation(); doUndo(); };
  if(redoBtn) redoBtn.onclick=function(ev){ ev.stopPropagation(); doRedo(); };
  document.getElementById('dc-chat-form').addEventListener('submit',function(e){ e.preventDefault();
    var msg=ci.value.trim(); if(!msg) return;
    ci.value=''; autoGrow(); addMsg('user',msg); var pending=addMsg('sys','…');
    var selId=sel?sel.getAttribute('data-cid'):null;
    post('/api/chat',{message:msg,currentSlideId:curSlideId(),selectedId:selId}).then(function(res){ pending.remove(); addMsg('ai',res.reply||'(no reply)'); if(res.applied){ flash('applied '+res.applied+' edit(s)'); } }).catch(function(err){ pending.remove(); addMsg('sys','error: '+err); });
  });

  // Soft re-render: patch the slide DOM in place instead of reloading the page, so
  // scroll position, the selection, the open panel, and the chat history all survive.
  function stripIds(h){ return h.replace(/ data-cid="[^"]*"/g,'').replace(/ data-type="[^"]*"/g,'').replace(/ data-role="[^"]*"/g,''); }
  var lastSlideHtml=[];
  function softRefresh(){
    fetch('/api/slides').then(function(r){ return r.json(); }).then(function(data){
      if(!data.slides || data.slides.length!==frames.length){ location.reload(); return; }
      var theme=document.getElementById('dc-theme'); if(theme&&typeof data.css==='string') theme.textContent=data.css;
      var prev=sel?sel.getAttribute('data-cid'):null;
      var editing=document.querySelector('#dc-stage [contenteditable="true"]');
      if(editing||dragging||resizing||opInFlight>0) return; // don't clobber an edit/drag/resize or our own in-flight op (its response reconciles the cache)
      // Only re-render slides whose HTML actually changed, so a single edit doesn't rebuild
      // every slide (that full rebuild is what felt like a full page reload).
      var changed=false;
      for(var i=0;i<frames.length;i++){
        if(lastSlideHtml[i]===data.slides[i].html) continue;
        changed=true; lastSlideHtml[i]=data.slides[i].html;
        frames[i].innerHTML=data.slides[i].html;
        if(thumbs[i]) thumbs[i].innerHTML='<span class="dc-no">'+(i+1)+'</span>'+stripIds(data.slides[i].html);
      }
      if(!changed){ refreshHist(); return; }
      fitAll(); clearSel();
      if(prev){ var again=document.querySelector('#dc-stage [data-cid="'+prev+'"]'); if(again) select(again); }
      refreshHist();
    }).catch(function(){ location.reload(); });
  }
  fetch('/api/slides').then(function(r){ return r.json(); }).then(function(d){ if(d&&d.slides) for(var i=0;i<d.slides.length;i++) lastSlideHtml[i]=d.slides[i].html; }).catch(function(){});
  try{ var es=new EventSource('/api/events'); es.onmessage=function(){ softRefresh(); }; }catch(e){}
  setTab(sessionStorage.getItem('dc-tab')||'slides');
  fitAll();
  var saved=parseInt(sessionStorage.getItem('dc-cur')||'0',10); if(saved>0&&frames[saved]) frames[saved].scrollIntoView({block:'center'});
  updateCurrent();
  buildDefaultTool();
  refreshHist();
})();
`;
