/**
 * The viewer's presentation chrome + interaction layer, injected around the compiled
 * slides. It frames each slide as a 16:9 card on a light workspace (so it reads as a
 * deck, not a long PDF), with prev/next, a slide counter, and a thumbnail filmstrip.
 * The human half of the loop: click an element to select it (see its stable id), edit
 * text in place, or mark it as the "AI target". Kept as plain strings (no backticks /
 * ${} inside) so it injects verbatim.
 */
export const CHROME_CSS = `
.dc-app{ margin:0; background:#cfd3da; height:100vh; overflow:hidden; }
#dc-stage{ position:fixed; top:44px; left:0; right:0; bottom:124px; display:flex; align-items:center; justify-content:center; }
.dc-frame{ display:none; border:1px solid #aeb3bd; background:#000; }
.dc-frame.dc-on{ display:block; }
.dc-frame > section{ transform-origin:top left; }
#dc-nav{ position:fixed; top:8px; left:50%; transform:translateX(-50%); display:flex; gap:14px; align-items:center; background:#fff; color:#222; border:1px solid #c2c6cf; border-radius:20px; padding:5px 8px; font:13px/1 -apple-system,Segoe UI,sans-serif; z-index:50; }
#dc-nav button{ width:26px; height:26px; border:1px solid #d2d6de; background:#f6f7f9; color:#222; border-radius:50%; cursor:pointer; font-size:15px; line-height:1; }
#dc-nav button:hover{ background:#ececf0; }
#dc-count{ min-width:46px; text-align:center; color:#555; }
#dc-film{ position:fixed; left:0; right:0; bottom:0; height:116px; background:#e6e8ec; border-top:1px solid #c2c6cf; display:flex; gap:12px; align-items:center; padding:0 16px; overflow-x:auto; }
.dc-thumb{ position:relative; width:176px; height:99px; flex:none; border:2px solid #b9bdc6; border-radius:5px; overflow:hidden; background:#000; padding:0; cursor:pointer; }
.dc-thumb.dc-cur{ border-color:#ec5a13; }
.dc-thumb > section{ transform:scale(0.1375); transform-origin:top left; pointer-events:none; }
.dc-thumb .dc-no{ position:absolute; top:3px; left:5px; color:#fff; font:11px sans-serif; opacity:.8; }
[data-cid]{ cursor:pointer; }
.dc-selected{ outline:2px solid #ec5a13 !important; outline-offset:-2px; }
#dc-bar{ position:fixed; top:8px; left:12px; color:#5b606b; font:12px/1 -apple-system,sans-serif; z-index:50; }
#dc-panel{ position:fixed; top:44px; right:14px; width:236px; background:#fff; color:#111; border:1px solid #c2c6cf; border-radius:8px; padding:11px 12px; font:13px/1.45 -apple-system,Segoe UI,sans-serif; z-index:60; }
#dc-panel .dc-row{ display:flex; gap:8px; margin-bottom:4px; }
#dc-panel .dc-k{ color:#999; width:32px; }
#dc-panel code{ font:12px/1.4 ui-monospace,Menlo,monospace; color:#ec5a13; word-break:break-all; }
#dc-panel .dc-actions{ display:flex; gap:6px; margin-top:9px; }
#dc-panel button{ flex:1; border:1px solid #d0d0d0; background:#f6f6f6; color:#222; border-radius:6px; padding:6px; font-size:12px; cursor:pointer; }
#dc-panel button:hover{ background:#ececec; }
#dc-panel .dc-note{ margin-top:9px; color:#9a9a9a; font-size:11px; }
#dc-flash{ position:fixed; bottom:128px; left:14px; background:#111; color:#fff; padding:7px 12px; border-radius:6px; font:12px sans-serif; opacity:0; transition:opacity .2s; z-index:60; }
`;

export const CLIENT_JS = `
(function(){
  var frames=[].slice.call(document.querySelectorAll('.dc-frame'));
  var thumbs=[].slice.call(document.querySelectorAll('.dc-thumb'));
  var total=frames.length;
  var cur=parseInt(sessionStorage.getItem('dc-cur')||'0',10); if(cur>=total||cur<0) cur=0;

  function fit(){
    var f=frames[cur]; if(!f) return;
    var stage=document.getElementById('dc-stage');
    var sc=Math.min((stage.clientWidth-48)/1280,(stage.clientHeight-48)/720);
    if(sc<0.05) sc=0.05;
    f.style.width=(1280*sc)+'px'; f.style.height=(720*sc)+'px';
    var sec=f.querySelector('section'); if(sec) sec.style.transform='scale('+sc+')';
  }
  function show(i){
    cur=Math.max(0,Math.min(i,total-1)); sessionStorage.setItem('dc-cur',String(cur));
    for(var k=0;k<frames.length;k++){ frames[k].classList.toggle('dc-on',k===cur); }
    for(var t=0;t<thumbs.length;t++){ thumbs[t].classList.toggle('dc-cur',t===cur); }
    var c=document.getElementById('dc-count'); if(c) c.textContent=(cur+1)+' / '+total;
    fit();
  }
  window.addEventListener('resize',fit);
  document.getElementById('dc-prev').onclick=function(){ show(cur-1); };
  document.getElementById('dc-next').onclick=function(){ show(cur+1); };
  document.addEventListener('keydown',function(e){
    if(e.target&&e.target.getAttribute&&e.target.getAttribute('contenteditable')==='true') return;
    if(e.key==='ArrowRight'||e.key==='PageDown') show(cur+1);
    if(e.key==='ArrowLeft'||e.key==='PageUp') show(cur-1);
  });
  for(var t=0;t<thumbs.length;t++){ (function(idx){ thumbs[idx].onclick=function(){ show(idx); }; })(t); }

  function flash(m){ var h=document.getElementById('dc-flash'); h.textContent=m; h.style.opacity='1'; setTimeout(function(){ h.style.opacity='0'; },1500); }
  function post(url,obj){ return fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(obj)}).then(function(r){ return r.json(); }); }
  function clearSel(){ var n=document.querySelectorAll('.dc-selected'); for(var i=0;i<n.length;i++){ n[i].classList.remove('dc-selected'); } }
  function panel(el){
    var p=document.getElementById('dc-panel');
    var cid=el.getAttribute('data-cid')||''; var type=el.getAttribute('data-type')||'';
    var editable=(type==='title'||type==='heading');
    p.innerHTML='<div class="dc-row"><span class="dc-k">id</span><code>'+cid+'</code></div>'+
      '<div class="dc-row"><span class="dc-k">type</span>'+type+'</div>'+
      '<div class="dc-actions"><button id="dc-copy">Copy @id</button><button id="dc-target">Set as AI target</button></div>'+
      '<div class="dc-note">'+(editable?'double-click to edit text':'use \\u201cSet as AI target\\u201d, then ask Claude to change it')+'</div>';
    document.getElementById('dc-copy').onclick=function(){ try{ navigator.clipboard.writeText('@'+cid); }catch(e){} flash('copied @'+cid); };
    document.getElementById('dc-target').onclick=function(){ post('/api/selection',{nodeId:cid}).then(function(){ flash('AI target = '+cid); }); };
  }
  document.addEventListener('click',function(e){
    if(e.target.closest('#dc-panel')||e.target.closest('#dc-film')||e.target.closest('#dc-nav')) return;
    var el=e.target.closest('#dc-stage [data-cid]'); if(!el) return;
    e.preventDefault(); clearSel(); el.classList.add('dc-selected'); panel(el);
  });
  document.addEventListener('dblclick',function(e){
    var el=e.target.closest('#dc-stage [data-cid]'); if(!el) return;
    var type=el.getAttribute('data-type'); if(type!=='title'&&type!=='heading') return;
    e.preventDefault(); el.setAttribute('contenteditable','true'); el.focus();
    var cid=el.getAttribute('data-cid');
    function finish(){
      el.removeAttribute('contenteditable');
      var txt=(el.textContent||'').replace(/\\s+/g,' ').trim();
      post('/api/op',{ops:[{op:'set_text',nodeId:cid,value:txt}]}).then(function(res){ if(res&&res.error){ flash('error: '+res.error); } });
    }
    el.addEventListener('blur',finish,{once:true});
    el.addEventListener('keydown',function(k){ if(k.key==='Enter'){ k.preventDefault(); el.blur(); } });
  });

  try{ var es=new EventSource('/api/events'); es.onmessage=function(){ location.reload(); }; }catch(e){}
  show(cur);
})();
`;
