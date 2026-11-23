import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {eq,sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createMockAdapter} from '../src/ai/adapter.js';
import {buildApp} from '../src/app.js';
import {createDb} from '../src/db/client.js';
import {runMigrations} from '../src/db/migrate.js';
import {classSession} from '../src/db/schema.js';
import {DEMO_PASSWORD,IDS,seed} from '../src/db/seed.js';
import {loadEnv} from '../src/env.js';

const DB_URL=process.env.TEST_DATABASE_URL;
if(!DB_URL || new URL(DB_URL).pathname!=='/treoo_test') throw new Error('Publication regression requires the isolated treoo_test database');
const {db,pool}=createDb(DB_URL);
let app:FastifyInstance;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const login=async(email:string)=>{
 const r=await app.inject({method:'POST',url:'/api/auth/login',payload:{email,password:DEMO_PASSWORD}});
 expect(r.statusCode).toBe(200);
 return {headers:{cookie:'treoo_sid='+r.cookies.find(c=>c.name==='treoo_sid')!.value}};
};
beforeAll(async()=>{
 await db.execute(sql`drop schema if exists treoo cascade`);
 await runMigrations(DB_URL);
 await seed(db);
 const env=loadEnv({NODE_ENV:'test',DATABASE_URL:DB_URL,AI_MODE:'mock',LOGIN_RATE_LIMIT:'1000',UPLOAD_DIR:await mkdtemp(path.join(os.tmpdir(),'treoo-pub-'))});
 app=await buildApp({env,db,ai:createMockAdapter()});
});
afterAll(async()=>{await app?.close();await pool.end();});
async function publishedCase(){
 const ana=await login('ana@northbridge.demo');
 const sam=await login('sam@northbridge.demo');
 const m=(await app.inject({method:'POST',url:'/api/materials',payload:{title:'First material',source:'Original source',text:'FIRST published transcription'},...ana})).json();
 // Use a real stored original, not a fake database key.
 const key=await app.svc.storage.save(IDS.academyA,png,'png');
 await db.execute(sql`update treoo.material set storage_key=${key},mime_type='image/png' where id=${m.id}`);
 const l=(await app.inject({method:'POST',url:'/api/lessons',payload:{title:'Revision ONE',materialId:m.id,activities:[{title:'Activity ONE'}]},...ana})).json();
 const s=(await app.inject({method:'POST',url:'/api/sessions',payload:{groupId:IDS.groupB1,scheduledOn:'2026-12-15',lessonId:l.id},...ana})).json();
 await app.inject({method:'POST',url:`/api/sessions/${s.id}/deliver`,payload:{shareMaterial:true},...ana});
 const p=await app.inject({method:'POST',url:`/api/sessions/${s.id}/publish`,...ana});
 expect(p.statusCode).toBe(200);
 return {ana,sam,m,l,s,p:p.json()};
}
describe('published material contract',()=>{
 it('freezes material metadata, text and original until explicit republication',async()=>{
  const {ana,sam,m,l,s}=await publishedCase();
  await app.inject({method:'PUT',url:`/api/materials/${m.id}`,payload:{title:'CHANGED metadata',source:'CHANGED source',extractedText:'CHANGED transcription'},...ana});
  const second=(await app.inject({method:'POST',url:'/api/materials',payload:{title:'Second material',text:'SECOND transcription'},...ana})).json();
  expect((await app.inject({method:'PUT',url:`/api/lessons/${l.id}`,payload:{title:'Revision TWO',materialId:second.id,activities:[{title:'Activity TWO'}],expectedRevision:1},...ana})).statusCode).toBe(200);
  let items=(await app.inject({url:'/api/portal/library',...sam})).json();
  expect(items.find((x:{id:string})=>x.id===m.id)).toMatchObject({title:'First material',source:'Original source',text:'FIRST published transcription',hasOriginal:true});
  expect(items.some((x:{id:string})=>x.id===second.id)).toBe(false);
  const original=await app.inject({url:`/api/portal/materials/${m.id}/original`,...sam});
  expect(original.statusCode).toBe(200);expect(original.rawPayload).toEqual(png);
  expect(JSON.stringify(items)).not.toContain('storageKey');
  expect((await app.inject({method:'POST',url:`/api/sessions/${s.id}/publish`,...ana})).statusCode).toBe(200);
  items=(await app.inject({url:'/api/portal/library',...sam})).json();
  expect(items.find((x:{id:string})=>x.id===second.id)).toMatchObject({title:'Second material',text:'SECOND transcription'});
  expect(items.some((x:{id:string})=>x.id===m.id)).toBe(false);
  expect((await app.inject({url:`/api/portal/materials/${m.id}/original`,...sam})).statusCode).toBe(404);
 });
 it('rejects lesson reassignment while published and permits it after unpublish',async()=>{
  const {ana,sam,l,s}=await publishedCase();
  const second=(await app.inject({method:'POST',url:'/api/lessons',payload:{title:'Unpublished replacement'},...ana})).json();
  const payload={scheduledOn:s.scheduledOn,lessonId:second.id};
  expect((await app.inject({method:'PUT',url:`/api/sessions/${s.id}`,payload,...ana})).statusCode).toBe(409);
  expect((await app.inject({url:`/api/portal/sessions/${s.id}`,...sam})).json().lessonId).toBe(l.id);
  await app.inject({method:'POST',url:`/api/sessions/${s.id}/unpublish`,...ana});
  expect((await app.inject({method:'PUT',url:`/api/sessions/${s.id}`,payload,...ana})).statusCode).toBe(200);
 });
 it('does not fall back to live material or lesson content for legacy publications',async()=>{
  const {ana,sam,m,s,p}=await publishedCase();
  await db.update(classSession).set({publishedSnapshot:null}).where(eq(classSession.id,s.id));
  let items=(await app.inject({url:'/api/portal/library',...sam})).json();
  expect(items.some((x:{id:string})=>x.id===m.id)).toBe(false);
  expect((await app.inject({url:`/api/portal/materials/${m.id}/original`,...sam})).statusCode).toBe(404);
  expect((await app.inject({url:`/api/portal/sessions/${s.id}`,...sam})).json()).toMatchObject({lessonTitle:null,activities:[],vocab:[]});
  const {material:_material,...legacy}=p.publishedSnapshot;
  await db.update(classSession).set({publishedSnapshot:legacy}).where(eq(classSession.id,s.id));
  items=(await app.inject({url:'/api/portal/library',...sam})).json();
  expect(items.some((x:{id:string})=>x.id===m.id)).toBe(false);
  await app.inject({method:'POST',url:`/api/sessions/${s.id}/publish`,...ana});
  expect((await app.inject({url:'/api/portal/library',...sam})).json().some((x:{id:string})=>x.id===m.id)).toBe(true);
 });
 it('revokes library and original access immediately when sharing is disabled',async()=>{
  const {ana,sam,m,s}=await publishedCase();
  expect((await app.inject({url:`/api/portal/materials/${m.id}/original`,...sam})).statusCode).toBe(200);
  await app.inject({method:'POST',url:`/api/sessions/${s.id}/deliver`,payload:{shareMaterial:false},...ana});
  expect((await app.inject({url:'/api/portal/library',...sam})).json().some((x:{id:string})=>x.id===m.id)).toBe(false);
  expect((await app.inject({url:`/api/portal/materials/${m.id}/original`,...sam})).statusCode).toBe(404);
 });
 it('publishing concurrently with a save yields one coherent lesson revision',async()=>{
  const {ana,l,s}=await publishedCase();
  const [save,publish]=await Promise.all([
   app.inject({method:'PUT',url:`/api/lessons/${l.id}`,payload:{title:'Revision TWO',materialId:l.materialId,activities:[{title:'Activity TWO'}],expectedRevision:1},...ana}),
   app.inject({method:'POST',url:`/api/sessions/${s.id}/publish`,...ana}),
  ]);
  expect(save.statusCode).toBe(200);expect(publish.statusCode).toBe(200);
  const snap=publish.json().publishedSnapshot;
  expect([1,2]).toContain(snap.lessonRevision);
  expect(snap.title).toBe(snap.lessonRevision===1?'Revision ONE':'Revision TWO');
  expect(snap.activities.map((x:{title:string})=>x.title)).toEqual([snap.lessonRevision===1?'Activity ONE':'Activity TWO']);
 });
});
