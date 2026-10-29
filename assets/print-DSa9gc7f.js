import{l as e}from"./model-UgRLMfq0.js";import{n as t}from"./CordView-rnxbCK_2.js";async function n(n,r,i,a){let{w:o,h:s}=e(r),c=t(r),l=document.createElement(`iframe`);l.style.cssText=`position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden`,document.body.appendChild(l);let u=l.contentDocument,d=[...document.querySelectorAll(`style, link[rel="stylesheet"]`)].map(e=>e.outerHTML).join(`
`),f=n.cloneNode(!0);f.style.transform=`none`,f.querySelectorAll(`[contenteditable]`).forEach(e=>e.removeAttribute(`contenteditable`)),f.querySelectorAll(`.ProseMirror-selectednode`).forEach(e=>e.classList.remove(`ProseMirror-selectednode`));let p=f.outerHTML,m=Array.from({length:i},(e,t)=>`<div class="cord-print-page" style="width:${c.w}px;height:${c.h}px"><div style="position:absolute;left:0;top:${-t*(c.h+32)}px">${p}</div></div>`).join(``);u.open(),u.write(`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><title>${a.replace(/</g,`&lt;`)}</title>${d}
<style>
@page { size: ${o}in ${s}in; margin: 0 }
html, body { margin: 0; padding: 0; background: #fff !important }
.cord-print-page { position: relative; overflow: hidden; break-after: page; page-break-after: always }
.cord-print-page:last-child { break-after: auto; page-break-after: auto }
.cord-sheet { box-shadow: none !important; border: 0 !important; border-radius: 0 !important }
.cord-pagebreak { visibility: hidden }
.cord-note--measure, .is-editor-empty::before { display: none !important }
</style></head><body>${m}</body></html>`),u.close(),await new Promise(e=>setTimeout(e,300)),await u.fonts?.ready,l.contentWindow.focus(),l.contentWindow.print(),setTimeout(()=>l.remove(),6e4)}export{n as printCord};