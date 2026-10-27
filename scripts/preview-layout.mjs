import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const html=await readFile(path.join(root,'dist/index.html'),'utf8');
const jsPath=html.match(/<script[^>]*src="([^"]+)"[^>]*><\/script>/)?.[1];
const cssPath=html.match(/<link[^>]*href="([^"]+\.css)"[^>]*>/)?.[1];
if(!jsPath||!cssPath)throw new Error('Run npm run build before generating the layout preview');
const js=await readFile(path.join(root,'dist',jsPath),'utf8');
let css=await readFile(path.join(root,'dist',cssPath),'utf8');
const fontUrls=[...new Set([...css.matchAll(/url\(([^)]+\.woff2)\)/g)].map(m=>m[1]))];
for(const url of fontUrls){const file=url.replace(/^['"]|['"]$/g,'');const bytes=await readFile(path.resolve(root,'dist',file.replace(/^\//,'')));css=css.replaceAll(url,'data:font/woff2;base64,'+bytes.toString('base64'));}
const guard=`
// This exported file is a read-only visual preview, never the payroll application.
window.fetch=async(input)=>{
 const url=typeof input==='string'?input:input.url;
 if(url==='/api/config')return new Response(JSON.stringify({geofence_enabled:true,kiosk:false,workweek_start:1,timezone:'America/New_York',serverTime:new Date().toISOString()}),{headers:{'Content-Type':'application/json'}});
 if(url==='/api/me')return new Response(JSON.stringify({error:'Administrator login requires the running application.'}),{status:401,headers:{'Content-Type':'application/json'}});
 throw new Error('Read-only preview. Launch the full application to use this feature.');
};
history.replaceState=()=>{};
document.addEventListener('click',event=>{if(event.target.closest('.punch-actions button')){event.preventDefault();event.stopImmediatePropagation();document.getElementById('preview-status').textContent='Read-only preview: no GPS was requested and no punch was submitted.';}},true);
`;
const output=`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Hamilton Time Clock — Visual Preview</title><style>${css}</style><style>.preview-notice{position:fixed;bottom:0;left:0;right:0;z-index:100;background:#173c31;color:white;padding:12px 20px;font:12px/1.6 system-ui,sans-serif;text-align:center;border-top:2px solid #a3b68b}body{padding-bottom:62px}.preview-notice strong{color:#d9e5ba;margin-right:8px}</style></head><body><div id="root"></div><div class="preview-notice" role="status"><strong>READ-ONLY VISUAL PREVIEW</strong><span id="preview-status">Clock layout and navigation only. Punches and administrator data require the running application.</span></div><script>${guard.replaceAll('</script','<\\/script')}</script><script type="module">${js.replaceAll('</script','<\\/script')}</script></body></html>`;
const out=path.join(root,'..','hamilton-timeclock-preview.html');
await writeFile(out,output);
console.log('Visual preview generated: '+out);
