/* One renderer for the popup and read-only loopback dashboard. No chat content. */
const $ = id => document.getElementById(id);
const inExtension = location.protocol === 'chrome-extension:';
const endpoint = inExtension ? 'http://127.0.0.1:8765/status' : '/status';
const number = n => Number(n).toLocaleString();
let windowSeconds = 10800;
let latest = null;
let extensionState = {};
let refreshing = false;
function age(seconds) {
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ago`;
}
function timeLabel(epoch) { return new Date(epoch * 1000).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}); }
function render(data, ext = {}) {
  const now = data.now;
  $('saved').textContent = number(data.saved);
  const total = data.inventory?.total;
  $('coverage').textContent = total ? `${Math.min(100, data.saved / total * 100).toFixed(1)}% of ${number(total)} last discovered` : 'Total awaits a complete discovery';
  $('remaining').textContent = total ? `${number(data.remaining)} not yet saved` : 'Coverage not yet known';
  $('inventory-note').textContent = total ? `Inventory checked ${new Date(data.inventory.at * 1000).toLocaleString()}. New or changed chats can alter the total.` : 'Saved count is verified locally; a percentage needs a complete inventory.';
  $('track').classList.toggle('unknown', !total);
  $('fill').style.width = total ? `${Math.min(100, data.saved / total * 100)}%` : '0';
  if (total) { $('track').setAttribute('aria-valuenow', Math.min(data.saved,total)); $('track').setAttribute('aria-valuemax',total); }
  else { $('track').removeAttribute('aria-valuenow'); $('track').removeAttribute('aria-valuemax'); }
  const lastAge = data.last_write ? Math.max(0, now - data.last_write) : null;
  $('last-write').textContent = lastAge === null ? 'Not observed' : age(lastAge);
  $('last-time').textContent = data.last_write ? `${timeLabel(data.last_write)} · durable archive write` : 'No saved-file timestamp available';
  const run = ext.run;
  const worker = run ? {phase: run.stage.startsWith('rate limited') ? 'waiting' : 'fetching', at:run.heartbeat / 1000, stage:run.stage, stale:now-run.heartbeat/1000>180} : data.worker;
  let label = 'Awaiting worker status', tone='warn', activity='The archive is available. Worker heartbeat is not available yet.';
  if (lastAge !== null && lastAge < 600) {label='Making progress';tone='';activity='New conversations are being safely written to your archive.';}
  if (worker && !worker.stale) {
    label=worker.phase==='waiting' ? 'Rate limited · waiting' : worker.phase==='failed' ? 'Run needs attention' : worker.phase==='idle' ? 'Last run finished' : 'Syncing';
    tone=worker.phase==='waiting'?'warn':worker.phase==='failed'?'error':'';
    activity=worker.stage || (worker.phase==='fetching' ? `Current run: ${number(worker.attempted || 0)} of ${number(worker.total || 0)} fetch attempts; ${number(worker.failed || 0)} failed. Attempts are separate from saved chats.` : `Current stage: ${worker.phase}.`);
  } else if (worker?.stale) {label=lastAge!==null&&lastAge<600?'Making progress · heartbeat old':'Heartbeat is overdue';tone=lastAge!==null&&lastAge<600?'':'warn';activity='The last worker heartbeat is over three minutes old. A recent durable write is stronger evidence of progress.';}
  else if (lastAge!==null&&lastAge>=600) {label='No recent writes';activity='No durable write in the last ten minutes. The worker may be waiting, paused or stopped; status is unconfirmed.';}
  if (data.paused) {label='Paused';tone='warn';activity='The listener is paused. Existing saved conversations remain safe.';}
  $('badge').textContent=label;$('badge').className=`badge ${tone}`;
  $('activity').textContent=activity;
  $('freshness').textContent=`Updated ${timeLabel(now)}`;
  const events=(data.events||[]).filter(e=>e.at>=now-windowSeconds&&e.at<=now);
  const writes=events.reduce((s,e)=>s+e.written,0), reconstructed=events.some(e=>e.reconstructed);
  const measuredSpan=Math.min(windowSeconds, Math.max(0,now-data.tracking_since));
  const span=reconstructed?windowSeconds:measuredSpan;
  $('rate').textContent=span>=60?`${Math.round(writes*3600/span)}/h`:'Learning pace';
  $('rate-note').textContent=reconstructed?'Observed writes / hour · reconstructed history':`Durable writes / hour · ${Math.floor(span/60)}m measured`;
  $('chart-summary').textContent=`${number(writes)} ${reconstructed?'observed file writes':'durable writes'} in ${windowSeconds===900?'15 minutes':windowSeconds===3600?'1 hour':'3 hours'}`;
  const etaSpan=Math.min(3600,Math.max(0,now-data.tracking_since));
  const recentAdded=(data.events||[]).filter(e=>!e.reconstructed&&e.at>=now-etaSpan).reduce((s,e)=>s+(e.added||0),0);
  if (data.remaining===0) {$('eta').textContent='Inventory saved';$('eta-note').textContent='Document checks and errors may remain';}
  else if (data.remaining && etaSpan>=900 && recentAdded>=5 && lastAge<600) {const hours=data.remaining/(recentAdded/etaSpan*3600);$('eta').textContent=hours<1?`~${Math.ceil(hours*60)}m`:`~${Math.ceil(hours)}h`;$('eta-note').textContent='Estimate at measured new-chat pace; excludes retries/documents';}
  else {$('eta').textContent='Learning pace';$('eta-note').textContent='Waiting for 15m of measured new saves';}
  const buckets=Array.from({length:12},()=>({value:0,reconstructed:false}));
  for(const e of events){const i=Math.min(11,Math.floor((e.at-(now-windowSeconds))/windowSeconds*12));if(i>=0){buckets[i].value+=e.written;buckets[i].reconstructed ||= e.reconstructed;}}
  const max=Math.max(1,...buckets.map(b=>b.value));$('chart').replaceChildren();
  buckets.forEach((b,i)=>{const col=document.createElement('div');col.className='column';const count=document.createElement('span');count.textContent=b.value||'';const bar=document.createElement('div');bar.className=`bar ${b.reconstructed?'reconstructed':''}`;bar.style.height=`${Math.max(2,b.value/max*100)}px`;col.title=`${timeLabel(now-windowSeconds+i*windowSeconds/12)}: ${b.value} writes${b.reconstructed?' (reconstructed)':''}`;col.append(count,bar);$('chart').append(col);});
  $('chart').setAttribute('aria-label',`${writes} writes in the selected window. ${buckets.map(b=>b.value).join(', ')} per interval.`);
  $('chart-start').textContent=timeLabel(now-windowSeconds);
  $('history-note').textContent=reconstructed?`Pale bars: ${data.history_note}`:`Live tracking covers ${Math.floor(measuredSpan/60)}m of this window. Empty earlier intervals mean unobserved history, not verified inactivity.`;
  $('coverage-note').textContent=data.coverage_note;
  $('previous').hidden=!ext.lastError;$('previous-error').textContent=ext.lastError||'';
  $('notice').hidden=!data.paused && !(worker?.stale) && !(worker?.phase==='failed');
  $('notice-title').textContent=data.paused?'Sync is paused':worker?.phase==='failed'?'The current run needs attention':'Worker heartbeat needs checking';
  $('notice-body').textContent='Your existing archive is preserved. The status above separates confirmed writes from worker activity; an old warning does not prove the current sync stopped.';
}
async function refresh() {
  if(refreshing)return;refreshing=true;
  try {if(inExtension)extensionState=await chrome.storage.local.get(['run','lastError']);const r=await fetch(endpoint,{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Listener did not return status');latest=await r.json();render(latest,extensionState);$('connection').textContent='Updates automatically every 10 seconds. No conversation text is shown.';}
  catch(e){$('badge').textContent='Listener unavailable';$('badge').className='badge error';$('connection').textContent='Cannot reach the local listener. Last displayed counts may be stale; saved files are preserved.';$('freshness').textContent='Status is stale';}
  finally{refreshing=false;}
}
$('refresh').addEventListener('click',refresh);
for(const button of document.querySelectorAll('[data-window]'))button.addEventListener('click',()=>{windowSeconds=Number(button.dataset.window);document.querySelectorAll('[data-window]').forEach(b=>b.setAttribute('aria-pressed',b===button));if(latest)render(latest,extensionState);});
if(inExtension){document.body.classList.add('extension');$('sync').hidden=false;$('sync').addEventListener('click',async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const m=tab?.url?.match(/^https:\/\/chatgpt\.com\/(?:g\/[^/]+\/)?c\/([0-9a-f-]{36})/);chrome.runtime.sendMessage({type:'sync-now',force:m?[m[1]]:[]});});chrome.storage.onChanged.addListener(refresh);}
else $('dashboard').hidden=true;
refresh();setInterval(refresh,10000);
