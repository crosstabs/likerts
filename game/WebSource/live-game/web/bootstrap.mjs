import { LiveClient } from './client.mjs';
import { mountLiveApp } from './ui.mjs';
let storage = null;
try { storage = sessionStorage; } catch { /* Private browser modes can still play on this tab. */ }
const client = new LiveClient({origin:location.origin,storage});
const ui = mountLiveApp({root:document.getElementById('app'),client,window});
window.addEventListener('pagehide',()=>ui.dispose(),{once:true});

window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
