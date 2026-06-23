/**
 * The viewer's in-page interaction layer, injected into the compiled deck HTML. This is
 * the human half of the loop: the user clicks an element (sees its stable id), can edit
 * text directly, or "Set as AI target" so the model can change exactly what they pointed
 * at. Kept as plain strings (no backticks/${} inside) so it injects verbatim.
 */
export const CHROME_CSS = `
[data-cid]{ cursor:pointer; }
.dc-selected{ outline:2px solid #ec5a13 !important; outline-offset:-2px; }
#dc-bar{ position:fixed; top:12px; left:12px; background:#111; color:#fff; padding:6px 10px; border-radius:6px; font:12px/1 -apple-system,Segoe UI,sans-serif; z-index:2147483000; }
#dc-panel{ position:fixed; top:12px; right:12px; width:236px; background:#fff; color:#111; border:1px solid #d8d8d8; border-radius:8px; padding:11px 12px; font:13px/1.45 -apple-system,Segoe UI,sans-serif; z-index:2147483000; }
#dc-panel .dc-row{ display:flex; gap:8px; margin-bottom:4px; }
#dc-panel .dc-k{ color:#999; width:32px; }
#dc-panel code{ font:12px/1.4 ui-monospace,Menlo,monospace; color:#ec5a13; word-break:break-all; }
#dc-panel .dc-actions{ display:flex; gap:6px; margin-top:9px; }
#dc-panel button{ flex:1; border:1px solid #d0d0d0; background:#f6f6f6; color:#222; border-radius:6px; padding:6px; font-size:12px; cursor:pointer; }
#dc-panel button:hover{ background:#ececec; }
#dc-panel .dc-note{ margin-top:9px; color:#9a9a9a; font-size:11px; }
#dc-flash{ position:fixed; bottom:14px; left:14px; background:#111; color:#fff; padding:7px 12px; border-radius:6px; font:12px sans-serif; opacity:0; transition:opacity .2s; z-index:2147483000; }
`;

export const CLIENT_JS = `
(function(){
  var sel=null;
  function clear(){ var n=document.querySelectorAll('.dc-selected'); for(var i=0;i<n.length;i++){ n[i].classList.remove('dc-selected'); } }
  function flash(m){ var h=document.getElementById('dc-flash'); h.textContent=m; h.style.opacity='1'; setTimeout(function(){ h.style.opacity='0'; },1500); }
  function post(url,obj){ return fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(obj)}).then(function(r){ return r.json(); }); }
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
    if(e.target.closest('#dc-panel')) return;
    var el=e.target.closest('[data-cid]'); if(!el) return;
    e.preventDefault(); clear(); el.classList.add('dc-selected'); sel=el; panel(el);
  });
  document.addEventListener('dblclick',function(e){
    var el=e.target.closest('[data-cid]'); if(!el) return;
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
})();
`;

export function chromeHtml(clientJs: string): string {
  return (
    '<div id="dc-bar">deck-contract viewer · click an element</div>' +
    '<div id="dc-panel">click an element to select it</div>' +
    '<div id="dc-flash"></div>' +
    "<script>" +
    clientJs +
    "</script>"
  );
}
