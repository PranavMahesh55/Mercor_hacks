import type { Review } from './review';
export type SavedProject={id:string;name:string;file:Blob;type:string;duration:number;brief:string;script:string;review:Review|null;createdAt:string;generationMs:number|null;references:File[];scriptMode:string};
function db():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const req=indexedDB.open('takecheck',1);req.onupgradeneeded=()=>req.result.createObjectStore('projects',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(new Error('Local project storage is unavailable.'));});}
export async function saveProject(project:SavedProject){const d=await db();return new Promise<void>((resolve,reject)=>{const tx=d.transaction('projects','readwrite');tx.objectStore('projects').put(project);tx.oncomplete=()=>{d.close();resolve();};tx.onerror=()=>{d.close();reject(new Error('Could not save this video locally. Browser storage may be full.'));};});}
export async function listProjects():Promise<SavedProject[]>{const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('projects','readonly');const req=tx.objectStore('projects').getAll();req.onsuccess=()=>{d.close();resolve(req.result.sort((a:SavedProject,b:SavedProject)=>b.createdAt.localeCompare(a.createdAt)));};req.onerror=()=>{d.close();reject(new Error('Could not load local projects.'));};});}
export async function deleteProject(id:string){const d=await db();return new Promise<void>((resolve,reject)=>{const tx=d.transaction('projects','readwrite');tx.objectStore('projects').delete(id);tx.oncomplete=()=>{d.close();resolve();};tx.onerror=()=>{d.close();reject(new Error('Could not delete project.'));};});}
export async function cacheIdentity(video:Blob,brief:string,script:string,model:string,refs:File[],mode:string){
  const hash=async(b:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const vh=await hash(await video.arrayBuffer());const rh=await Promise.all(refs.map(async f=>hash(await f.arrayBuffer())));
  return hash(new TextEncoder().encode(JSON.stringify({vh,brief,script,model,rh,mode,version:'takecheck-1.0'})).buffer);
}
