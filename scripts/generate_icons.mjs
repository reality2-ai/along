// Rasterise our own vector identity at native sizes for OS install surfaces.
import {chromium} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const svg=await readFile(new URL('../public/icon.svg',import.meta.url),'utf8');
const out=new URL('../public/icons/',import.meta.url);
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
try{
  const page=await browser.newPage();
  for(const [name,size,maskable]of [['icon-192.png',192,false],['icon-512.png',512,false],['maskable-512.png',512,true],['apple-touch-icon.png',180,false],['favicon-32.png',32,false]]){
    const encoded=await page.evaluate(async({svg,size,maskable})=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
      const ctx=canvas.getContext('2d');
      const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(svg);
      await image.decode();
      if(maskable){ctx.fillStyle='#214e40';ctx.fillRect(0,0,size,size);}
      ctx.drawImage(image,0,0,size,size);
      return canvas.toDataURL('image/png').split(',')[1];
    },{svg,size,maskable});
    await writeFile(new URL(name,out),Buffer.from(encoded,'base64'));
    console.log(`${name}: ${size} × ${size}`);
  }
}finally{await browser.close();}
